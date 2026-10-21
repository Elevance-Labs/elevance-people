-- ---------------------------------------------------------------------------
-- Salary history: appraisals (salary revisions). HR writes one for an
-- employee — basic salary and contractual amount from a starting month — as a
-- draft, sends it for review, and a company admin approves it or rejects it
-- back to draft with a reason. An employee has at most one open (draft or in
-- review) at a time, and nobody handles their own.
--
-- Approved revisions are the employee's salary history. The active salary is
-- the latest approved one whose month has come; it stays active until a later
-- one takes over. A new revision must start after the latest approved one, so
-- the history only moves forward. Employees read their own approved history
-- through my_salaries.
--
-- A new payroll line now takes basic salary and contractual amount from the
-- salary active in the payroll's month, and falls back to the latest earlier
-- payroll (as before) for someone with no approved salary. The allowance
-- still carries from the latest earlier payroll.
-- ---------------------------------------------------------------------------

create type public.salary_revision_status as enum ('draft', 'review', 'approved');

create table public.salary_revisions (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null,
  -- The first day of the month the salary applies from.
  effective_from     date not null check (extract(day from effective_from) = 1),
  basic_salary       numeric(12, 2) not null check (basic_salary >= 0),
  contractual_amount numeric(12, 2) not null default 0 check (contractual_amount >= 0),
  note               text check (length(note) <= 2000),
  status             public.salary_revision_status not null default 'draft',
  -- Stamped by salary_revisions_guard and salary_revision_move.
  created_by         uuid references public.employees (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  submitted_by       uuid references public.employees (id) on delete set null,
  submitted_at       timestamptz,
  approved_by        uuid references public.employees (id) on delete set null,
  approved_at        timestamptz,
  -- The last rejection, kept on the draft it went back to.
  rejected_by        uuid references public.employees (id) on delete set null,
  rejected_at        timestamptz,
  rejection_reason   text check (length(rejection_reason) <= 2000),
  -- Named: salary_revisions references employees several times.
  constraint salary_revisions_employee_id_fkey foreign key (employee_id)
    references public.employees (id) on delete cascade
);
create unique index salary_revisions_one_open_key
  on public.salary_revisions (employee_id) where status <> 'approved';
create unique index salary_revisions_month_key
  on public.salary_revisions (employee_id, effective_from) where status = 'approved';
create index salary_revisions_employee_idx on public.salary_revisions (employee_id, effective_from);

-- The approved salary in force for an employee in a month.
create function public.salary_on(p_employee_id uuid, p_month date)
returns public.salary_revisions language sql stable security definer set search_path = '' as $$
  select r.* from public.salary_revisions r
   where r.employee_id = p_employee_id and r.status = 'approved' and r.effective_from <= p_month
   order by r.effective_from desc limit 1;
$$;

-- Drafts only: stamps the creator, refuses someone's own, someone who has
-- left, and a month not after their latest approved salary. Status isn't
-- client-writable, so a status change is salary_revision_move's, and passes.
create function public.salary_revisions_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status public.employee_status;
  v_latest date;
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    return new;
  end if;
  -- Deleting the employee cascades to all of their appraisals.
  if tg_op = 'DELETE' and not exists (select 1 from public.employees e where e.id = old.employee_id) then
    return old;
  end if;
  if tg_op <> 'INSERT' and old.status <> 'draft' then
    raise exception 'Only a draft appraisal can be changed.';
  end if;
  if (case when tg_op = 'DELETE' then old.employee_id else new.employee_id end)
     = public.current_employee_id() then
    raise exception 'You cannot write an appraisal for yourself.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := public.current_employee_id();
    select status into v_status from public.employees where id = new.employee_id;
    if v_status in ('left', 'terminated') then
      raise exception 'This employee has left.';
    end if;
  else
    if new.employee_id <> old.employee_id then
      raise exception 'An appraisal can''t be moved to another employee.';
    end if;
    new.updated_at := now();
  end if;

  select max(r.effective_from) into v_latest
    from public.salary_revisions r
   where r.employee_id = new.employee_id and r.status = 'approved' and r.id <> new.id;
  if new.effective_from <= v_latest then
    raise exception 'An appraisal must start after the current salary, from %.', to_char(v_latest, 'FMMonth YYYY');
  end if;
  return new;
end;
$$;

create trigger salary_revisions_guard
  before insert or update or delete on public.salary_revisions
  for each row execute function public.salary_revisions_guard();

-- Moves an appraisal: draft → review (HR), review → approved (a company
-- admin), review → draft (a company admin, rejecting it with a reason).
-- Nobody moves their own.
create function public.salary_revision_move(
  p_revision_id uuid, p_status public.salary_revision_status, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me       uuid := public.current_employee_id();
  v_revision public.salary_revisions;
  v_latest   date;
begin
  select * into v_revision from public.salary_revisions where id = p_revision_id for update;
  if not found or not public.is_hr() or v_revision.employee_id = v_me then
    raise exception 'Appraisal not found.' using errcode = 'P0002';
  end if;

  if v_revision.status = 'draft' and p_status = 'review' then
    update public.salary_revisions
       set status = 'review', submitted_by = v_me, submitted_at = now(), updated_at = now()
     where id = p_revision_id;
  elsif v_revision.status = 'review' and p_status in ('approved', 'draft') then
    if not public.is_company_admin() then
      raise exception 'Only a company admin can approve or reject an appraisal.' using errcode = '42501';
    end if;
    if p_status = 'draft' then
      if nullif(trim(p_reason), '') is null then
        raise exception 'Give a reason for rejecting this appraisal.' using errcode = '23514';
      end if;
      update public.salary_revisions
         set status = 'draft', rejected_by = v_me, rejected_at = now(), rejection_reason = trim(p_reason),
             updated_at = now()
       where id = p_revision_id;
    else
      -- Another may have been approved since this one was written.
      select max(r.effective_from) into v_latest
        from public.salary_revisions r
       where r.employee_id = v_revision.employee_id and r.status = 'approved';
      if v_revision.effective_from <= v_latest then
        raise exception 'An appraisal must start after the current salary, from %. Reject it to change the month.',
          to_char(v_latest, 'FMMonth YYYY');
      end if;
      update public.salary_revisions
         set status = 'approved', approved_by = v_me, approved_at = now(), updated_at = now()
       where id = p_revision_id;
    end if;
  else
    raise exception 'An appraisal % can''t be moved to %.',
      case v_revision.status when 'review' then 'in review' else 'that is ' || v_revision.status::text end,
      p_status;
  end if;
end;
$$;

-- The caller's own approved salaries, newest first: the month each applies
-- from, the figures and when it was approved. No notes.
create function public.my_salaries()
returns table (id uuid, effective_from date, basic_salary numeric, contractual_amount numeric,
               approved_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.effective_from, r.basic_salary, r.contractual_amount, r.approved_at
    from public.salary_revisions r
   where r.employee_id = public.current_employee_id() and r.status = 'approved'
   order by r.effective_from desc;
$$;

-- Lines change only while their payroll is a draft; HR's columns only by HR
-- and the rest only by finance. A new line takes the employee's name and
-- number, basic salary and contractual amount from their salary for the
-- payroll's month (else their latest earlier payroll), and the allowance from
-- their latest earlier payroll.
create or replace function public.payroll_items_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_payroll  public.payrolls;
  v_employee public.employees;
  v_previous public.payroll_items;
  v_salary   public.salary_revisions;
  v_hr       boolean := false;
  v_finance  boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_hr := (new.basic_salary, new.contractual_amount, new.absent_days, new.hr_remarks)
            is distinct from (old.basic_salary, old.contractual_amount, old.absent_days, old.hr_remarks);
    v_finance := (new.bonus_type, new.bonus_value, new.absent_deduction, new.allowance, new.arrears,
                  new.advance_salary, new.loan_deduction, new.tax_amount, new.finance_remarks)
                 is distinct from (old.bonus_type, old.bonus_value, old.absent_deduction, old.allowance,
                                   old.arrears, old.advance_salary, old.loan_deduction, old.tax_amount,
                                   old.finance_remarks);
    -- Nothing a person edits (e.g. employee_id cleared as the record is deleted).
    if not (v_hr or v_finance) then
      return new;
    end if;
    -- auth.uid() is null for the SQL editor / service role.
    if auth.uid() is not null then
      if v_hr and not public.is_hr() then
        raise exception 'Only HR can change basic salary, contractual amount, absent days and HR remarks.'
          using errcode = '42501';
      end if;
      if v_finance and not public.is_finance() then
        raise exception 'Only finance can change bonus, arrears, deductions, allowance, tax and finance remarks.'
          using errcode = '42501';
      end if;
    end if;
  end if;

  select * into v_payroll from public.payrolls
   where id = case when tg_op = 'DELETE' then old.payroll_id else new.payroll_id end
     for share;
  if not found then
    raise exception 'Payroll not found.' using errcode = 'P0002';
  end if;
  if v_payroll.status <> 'draft' then
    raise exception 'This payroll is %. Only a draft payroll can be changed.',
      case v_payroll.status when 'review' then 'in review' else v_payroll.status::text end;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    return new;
  end if;

  select * into v_employee from public.employees where id = new.employee_id;
  if not found or not public.is_login_status(v_employee.status) then
    raise exception 'Only employees on probation, active or on their notice period can be on a payroll.';
  end if;
  new.employee_number := v_employee.employee_number;
  new.full_name := v_employee.full_name;

  select i.* into v_previous
    from public.payroll_items i join public.payrolls p on p.id = i.payroll_id
   where i.employee_id = new.employee_id and (p.year, p.month) < (v_payroll.year, v_payroll.month)
   order by p.year desc, p.month desc limit 1;
  if found then
    new.basic_salary := v_previous.basic_salary;
    new.contractual_amount := v_previous.contractual_amount;
    new.allowance := v_previous.allowance;
  end if;

  v_salary := public.salary_on(new.employee_id, make_date(v_payroll.year, v_payroll.month, 1));
  if v_salary.id is not null then
    new.basic_salary := v_salary.basic_salary;
    new.contractual_amount := v_salary.contractual_amount;
  end if;
  return new;
end;
$$;

revoke all on public.salary_revisions from anon, authenticated;
-- Status and stamps change only through the guard and salary_revision_move.
grant select, delete on public.salary_revisions to authenticated;
grant insert (employee_id, effective_from, basic_salary, contractual_amount, note),
      update (effective_from, basic_salary, contractual_amount, note)
  on public.salary_revisions to authenticated;

revoke execute on function
  public.salary_on(uuid, date), public.salary_revisions_guard(),
  public.salary_revision_move(uuid, public.salary_revision_status, text), public.my_salaries()
  from public, anon, authenticated;
grant execute on function
  public.salary_revision_move(uuid, public.salary_revision_status, text), public.my_salaries()
  to authenticated;

alter table public.salary_revisions enable row level security;

-- Appraisals: HR (and company admins) see and write everyone's but their own.
-- Writes are drafts only (salary_revisions_guard). Employees read their own
-- approved salaries through my_salaries.
create policy salary_revisions_select on public.salary_revisions for select to authenticated
  using ((select public.is_hr()) and employee_id is distinct from (select public.current_employee_id()));
create policy salary_revisions_insert on public.salary_revisions for insert to authenticated
  with check ((select public.is_hr()));
create policy salary_revisions_update on public.salary_revisions for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy salary_revisions_delete on public.salary_revisions for delete to authenticated
  using ((select public.is_hr()));
