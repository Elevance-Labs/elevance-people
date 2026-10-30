-- HR, finance and company admins may claim reimbursements, without HR's
-- flag, for themselves or for anyone who may log in.
--
-- A claim now records who made it (created_by, stamped by
-- reimbursements_guard). Whoever made a claim may withdraw it while in review,
-- as may its employee, and may not approve, process, reject or disburse it:
-- nobody decides a claim they are the employee of or made. Admins upload
-- receipts into the employee's folder, so HR may now upload there as finance
-- already could. Existing claims were all made by their employee.

alter table public.reimbursements
  add column created_by uuid references public.employees (id) on delete set null;

update public.reimbursements set created_by = employee_id;

-- HR's flag, or a payroll role (HR, finance and company admins).
create or replace function public.can_claim_reimbursements()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_manage_payroll()
         or coalesce((select e.can_claim_reimbursements from public.employees e
                       where e.id = public.current_employee_id()), false);
$$;

-- A new claim: for someone who may log in, made by themselves while they
-- may claim, or by a payroll role for anyone; for a day that has come, with
-- receipts already uploaded into the employee's folder and on no other
-- claim. Stamps who made it.
create or replace function public.reimbursements_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.current_employee_id();
  v_path text;
begin
  -- auth.uid() is null for the SQL editor / service role: anyone may be claimed for.
  if auth.uid() is not null
     and not public.can_manage_payroll()
     and not (new.employee_id = v_me and public.can_claim_reimbursements()) then
    raise exception 'You can''t claim reimbursements. Ask HR if you think you should.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees e
                  where e.id = new.employee_id and public.is_login_status(e.status)) then
    raise exception 'Claims can only be made for someone on probation, active or on their notice period.'
      using errcode = '23514';
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
  new.created_by := v_me;
  return new;
end;
$$;

-- Moves a claim: review → approved or rejected (HR), approved → processed or
-- rejected (finance), review → withdrawn (its employee, or whoever made it).
-- Rejecting needs a reason. Nobody decides a claim they are the employee of
-- or made.
create or replace function public.reimbursement_move(
  p_reimbursement_id uuid, p_status public.reimbursement_status, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := public.current_employee_id();
  v_claim  public.reimbursements;
  v_reason text := nullif(trim(p_reason), '');
  v_own    boolean;
begin
  select * into v_claim from public.reimbursements where id = p_reimbursement_id for update;
  v_own := coalesce(v_me in (v_claim.employee_id, v_claim.created_by), false);
  if not found or not (v_own or public.can_manage_payroll()) then
    raise exception 'Claim not found.' using errcode = 'P0002';
  end if;

  if p_status = 'withdrawn' then
    if not v_own then
      raise exception 'Only the employee, or whoever made the claim, can withdraw it.' using errcode = '42501';
    end if;
    if v_claim.status <> 'review' then
      raise exception 'Only a claim in review can be withdrawn.';
    end if;
    update public.reimbursements set status = 'withdrawn', withdrawn_at = now() where id = p_reimbursement_id;
    return;
  end if;

  if v_own then
    raise exception 'Someone else has to decide a claim that is yours or that you made.' using errcode = '42501';
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
-- folder, or both. Not a claim they are the employee of or made. Final.
create or replace function public.reimbursement_disburse(
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
  if coalesce(v_me in (v_claim.employee_id, v_claim.created_by), false) then
    raise exception 'Someone else has to decide a claim that is yours or that you made.' using errcode = '42501';
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

-- For oneself while allowed to claim; payroll roles for anyone.
drop policy reimbursements_insert on public.reimbursements;
create policy reimbursements_insert on public.reimbursements for insert to authenticated
  with check ((select public.can_manage_payroll())
              or (employee_id = (select public.current_employee_id()) and (select public.can_claim_reimbursements())));

-- Receipts into one's own folder while allowed to claim; payroll roles (who
-- claim for others, and upload proof of payment) into anyone's.
drop policy reimbursement_files_upload on storage.objects;
create policy reimbursement_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'reimbursements'
              and (((storage.foldername(name))[1] = (select public.current_employee_id())::text
                    and (select public.can_claim_reimbursements()))
                   or (select public.can_manage_payroll())));
