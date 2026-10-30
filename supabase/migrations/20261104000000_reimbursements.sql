-- Reimbursements: employees HR allows claim back what they spent for work.
--
-- HR (HR admins and company admins) picks who may claim, with a flag on the
-- employee record. A claim is a description, the expense date, an amount and
-- one to three receipts (images or PDFs) in a new private bucket, at
-- <employee_id>/<uuid>.<ext>. Submitting puts it in review; the employee may
-- withdraw it until HR acts. HR approves or rejects it, then finance marks an
-- approved claim processed (or rejects it), and finally disbursed, with the
-- transaction date and a reference or proof of payment. Rejecting needs a
-- reason. Nobody decides their own claim. Status changes only through
-- reimbursement_move / reimbursement_disburse.

alter table public.employees add column can_claim_reimbursements boolean not null default false;
grant update (can_claim_reimbursements) on public.employees to authenticated;

create type public.reimbursement_status as enum
  ('review', 'approved', 'processed', 'disbursed', 'rejected', 'withdrawn');

-- Inserted by the employee (in review); every later change is by the functions below.
create table public.reimbursements (
  id                     uuid primary key default gen_random_uuid(),
  employee_id            uuid not null,
  description            text not null
                         check (description = trim(description) and description <> '' and length(description) <= 2000),
  expense_date           date not null,
  -- PKR.
  amount                 numeric(12, 2) not null check (amount > 0),
  -- 1–3 files in the reimbursements bucket, in the employee's folder.
  receipt_paths          text[] not null
                         check (cardinality(receipt_paths) between 1 and 3 and array_position(receipt_paths, null) is null),
  status                 public.reimbursement_status not null default 'review',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  approved_by            uuid references public.employees (id) on delete set null,
  approved_at            timestamptz,
  processed_by           uuid references public.employees (id) on delete set null,
  processed_at           timestamptz,
  disbursed_by           uuid references public.employees (id) on delete set null,
  disbursed_at           timestamptz,
  rejected_by            uuid references public.employees (id) on delete set null,
  rejected_at            timestamptz,
  rejection_reason       text check (length(rejection_reason) <= 2000),
  withdrawn_at           timestamptz,
  -- How it was paid, set on disbursal: the date, and a reference or a proof
  -- file (in the bucket, in the employee's folder), or both.
  transaction_date       date,
  transaction_reference  text check (length(transaction_reference) <= 200),
  transaction_proof_path text,
  -- Named: reimbursements references employees several times.
  constraint reimbursements_employee_id_fkey foreign key (employee_id)
    references public.employees (id) on delete cascade,
  constraint reimbursements_disbursal_check
    check (status <> 'disbursed'
           or (transaction_date is not null
               and (transaction_reference is not null or transaction_proof_path is not null)))
);
create index reimbursements_employee_idx on public.reimbursements (employee_id);
create index reimbursements_status_idx on public.reimbursements (status);

-- HR has said the caller may claim reimbursements.
create function public.can_claim_reimbursements()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select e.can_claim_reimbursements from public.employees e
                    where e.id = public.current_employee_id()), false);
$$;

-- A new claim: from someone HR allows to claim who may log in, for a day
-- that has come, with receipts already uploaded into their folder and on no
-- other claim.
create function public.reimbursements_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_path text;
begin
  if not exists (select 1 from public.employees e
                  where e.id = new.employee_id and e.can_claim_reimbursements
                    and public.is_login_status(e.status)) then
    raise exception 'You can''t claim reimbursements. Ask HR if you think you should.' using errcode = '42501';
  end if;
  if new.expense_date > public.company_today() then
    raise exception 'The expense date can''t be in the future.' using errcode = '23514';
  end if;
  if (select count(distinct p) from unnest(new.receipt_paths) p) <> cardinality(new.receipt_paths) then
    raise exception 'The same receipt is attached twice.' using errcode = '23514';
  end if;
  foreach v_path in array new.receipt_paths loop
    if split_part(v_path, '/', 1) <> new.employee_id::text
       or not exists (select 1 from storage.objects o
                       where o.bucket_id = 'reimbursements' and o.name = v_path) then
      raise exception 'Upload the receipts before submitting the claim.';
    end if;
  end loop;
  if exists (select 1 from public.reimbursements r where r.receipt_paths && new.receipt_paths) then
    raise exception 'A receipt is already on another claim.' using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger reimbursements_guard
  before insert on public.reimbursements
  for each row execute function public.reimbursements_guard();

create trigger reimbursements_touch before update on public.reimbursements
  for each row execute function public.touch_updated_at();

-- Moves a claim: review → approved or rejected (HR), approved → processed or
-- rejected (finance), review → withdrawn (its employee). Rejecting needs a
-- reason. Nobody decides their own claim.
create function public.reimbursement_move(
  p_reimbursement_id uuid, p_status public.reimbursement_status, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := public.current_employee_id();
  v_claim  public.reimbursements;
  v_reason text := nullif(trim(p_reason), '');
begin
  select * into v_claim from public.reimbursements where id = p_reimbursement_id for update;
  if not found or (v_claim.employee_id is distinct from v_me and not public.can_manage_payroll()) then
    raise exception 'Claim not found.' using errcode = 'P0002';
  end if;

  if p_status = 'withdrawn' then
    if v_claim.employee_id is distinct from v_me then
      raise exception 'Only the employee can withdraw their claim.' using errcode = '42501';
    end if;
    if v_claim.status <> 'review' then
      raise exception 'Only a claim in review can be withdrawn.';
    end if;
    update public.reimbursements set status = 'withdrawn', withdrawn_at = now() where id = p_reimbursement_id;
    return;
  end if;

  if v_claim.employee_id = v_me then
    raise exception 'Someone else has to decide your own claim.' using errcode = '42501';
  end if;
  if v_claim.status = 'review' and p_status in ('approved', 'rejected') then
    if not public.is_hr() then
      raise exception 'Only HR can approve or reject a claim in review.' using errcode = '42501';
    end if;
  elsif v_claim.status = 'approved' and p_status in ('processed', 'rejected') then
    if not public.is_finance() then
      raise exception 'Only finance can process or reject an approved claim.' using errcode = '42501';
    end if;
  else
    raise exception 'A claim can''t move from % to %.', v_claim.status, p_status;
  end if;

  if p_status = 'rejected' then
    if v_reason is null then
      raise exception 'Give a reason for rejecting the claim.' using errcode = '23514';
    end if;
    update public.reimbursements
       set status = 'rejected', rejected_by = v_me, rejected_at = now(), rejection_reason = v_reason
     where id = p_reimbursement_id;
  elsif p_status = 'approved' then
    update public.reimbursements set status = 'approved', approved_by = v_me, approved_at = now()
     where id = p_reimbursement_id;
  else
    update public.reimbursements set status = 'processed', processed_by = v_me, processed_at = now()
     where id = p_reimbursement_id;
  end if;
end;
$$;

-- Finance marks a processed claim disbursed: the transaction date (not in the
-- future) and a reference, or proof of payment uploaded into the employee's
-- folder, or both. Final.
create function public.reimbursement_disburse(
  p_reimbursement_id uuid, p_transaction_date date, p_reference text, p_proof_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me        uuid := public.current_employee_id();
  v_claim     public.reimbursements;
  v_reference text := nullif(trim(p_reference), '');
  v_proof     text := nullif(p_proof_path, '');
begin
  select * into v_claim from public.reimbursements where id = p_reimbursement_id for update;
  if not found or not public.can_manage_payroll() then
    raise exception 'Claim not found.' using errcode = 'P0002';
  end if;
  if not public.is_finance() then
    raise exception 'Only finance can mark a claim disbursed.' using errcode = '42501';
  end if;
  if v_claim.employee_id = v_me then
    raise exception 'Someone else has to decide your own claim.' using errcode = '42501';
  end if;
  if v_claim.status <> 'processed' then
    raise exception 'Only a processed claim can be disbursed.';
  end if;
  if p_transaction_date is null or p_transaction_date > public.company_today() then
    raise exception 'Enter the transaction date (today or earlier).' using errcode = '23514';
  end if;
  if v_reference is null and v_proof is null then
    raise exception 'Enter the transaction reference or upload proof of payment.' using errcode = '23514';
  end if;
  if v_proof is not null
     and (split_part(v_proof, '/', 1) <> v_claim.employee_id::text
          or not exists (select 1 from storage.objects o
                          where o.bucket_id = 'reimbursements' and o.name = v_proof)) then
    raise exception 'Upload the proof of payment first.';
  end if;

  update public.reimbursements
     set status = 'disbursed', disbursed_by = v_me, disbursed_at = now(), transaction_date = p_transaction_date,
         transaction_reference = v_reference, transaction_proof_path = v_proof
   where id = p_reimbursement_id;
end;
$$;

revoke all on public.reimbursements from anon, authenticated;
-- Status, stamps and payment details change only through the functions above.
grant select, insert (employee_id, description, expense_date, amount, receipt_paths)
  on public.reimbursements to authenticated;

revoke execute on function
  public.can_claim_reimbursements(), public.reimbursements_guard(),
  public.reimbursement_move(uuid, public.reimbursement_status, text),
  public.reimbursement_disburse(uuid, date, text, text)
  from public, anon, authenticated;
grant execute on function
  public.can_claim_reimbursements(),
  public.reimbursement_move(uuid, public.reimbursement_status, text),
  public.reimbursement_disburse(uuid, date, text, text)
  to authenticated;

-- The employee their own; HR and finance all. Only for oneself, and only
-- when HR allows it (the guard checks that too).
alter table public.reimbursements enable row level security;
create policy reimbursements_select on public.reimbursements for select to authenticated
  using (employee_id = (select public.current_employee_id()) or (select public.can_manage_payroll()));
create policy reimbursements_insert on public.reimbursements for insert to authenticated
  with check (employee_id = (select public.current_employee_id()) and (select public.can_claim_reimbursements()));

-- Receipts and proof of payment, private, at <employee_id>/<uuid>.<ext>. The
-- employee uploads receipts into their own folder; finance uploads proof
-- into the employee's. The employee, HR and finance read them. A file can
-- be removed only while no claim points at it (an upload left by a failed
-- submit, or once the employee is deleted). Nothing is overwritten.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reimbursements', 'reimbursements', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy reimbursement_files_read on storage.objects for select to authenticated
  using (bucket_id = 'reimbursements'
         and ((storage.foldername(name))[1] = (select public.current_employee_id())::text
              or (select public.can_manage_payroll())));
create policy reimbursement_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'reimbursements'
              and (((storage.foldername(name))[1] = (select public.current_employee_id())::text
                    and (select public.can_claim_reimbursements()))
                   or (select public.is_finance())));
create policy reimbursement_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'reimbursements'
         and ((storage.foldername(name))[1] = (select public.current_employee_id())::text
              or (select public.can_manage_payroll()))
         and not exists (select 1 from public.reimbursements r
                          where objects.name = any (r.receipt_paths) or r.transaction_proof_path = objects.name));
