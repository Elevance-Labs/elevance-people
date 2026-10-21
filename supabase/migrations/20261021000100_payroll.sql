-- Finance → Payroll: one payroll per month, with a line per employee.
--
-- HR admins, finance admins and company admins see and work on payrolls
-- (can_manage_payroll); nobody else can read them. "Finance" is a finance
-- admin or a company admin (is_finance), as "HR" is an HR admin or a company
-- admin.
--
-- A payroll is for a month and year, one per month, and is never deleted.
-- payroll_create starts one with every employee who is on probation, active
-- or on their notice period; each person's basic salary, contractual amount
-- and allowance carry over from their latest earlier payroll. Only one
-- payroll may be open (not yet processed) at a time.
--
-- Status moves only through payroll_move:
--   draft → review              anyone who manages payroll
--   review → approved           company admin
--   review / approved → draft   company admin
--   approved → processed        finance
-- Processed is final. Lines are added, changed and removed only while the
-- payroll is a draft. HR changes basic salary, contractual amount, absent
-- days and HR remarks; finance changes the rest. Bonus, gross and net salary
-- are worked out by the database. Name and employee number are copied from
-- the employee when the line is added, and kept if the record is deleted.

create type public.payroll_status as enum ('draft', 'review', 'approved', 'processed');

create function public.is_finance()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(public.current_app_role() in ('finance_admin', 'company_admin'), false);
$$;

create function public.can_manage_payroll()
returns boolean language sql stable set search_path = '' as $$
  select public.is_hr() or public.is_finance();
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Written only by payroll_create and payroll_move.
create table public.payrolls (
  id           uuid primary key default gen_random_uuid(),
  year         integer not null check (year between 2000 and 2999),
  month        integer not null check (month between 1 and 12),
  status       public.payroll_status not null default 'draft',
  created_by   uuid references public.employees (id) on delete set null,
  created_at   timestamptz not null default now(),
  -- The last move to review, approved and processed. Going back to draft
  -- clears the review and approval.
  submitted_by uuid references public.employees (id) on delete set null,
  submitted_at timestamptz,
  approved_by  uuid references public.employees (id) on delete set null,
  approved_at  timestamptz,
  processed_by uuid references public.employees (id) on delete set null,
  processed_at timestamptz,
  updated_at   timestamptz not null default now(),
  constraint payrolls_period_key unique (year, month)
);
-- At most one payroll not yet processed.
create unique index payrolls_one_open on public.payrolls ((true)) where status <> 'processed';

-- Money is in PKR.
create table public.payroll_items (
  id                 uuid primary key default gen_random_uuid(),
  payroll_id         uuid not null references public.payrolls (id) on delete cascade,
  -- Null once the employee record is deleted; the name and number stay.
  employee_id        uuid references public.employees (id) on delete set null,
  -- Copied from the employee by payroll_items_guard.
  employee_number    integer not null,
  full_name          text not null,
  basic_salary       numeric(12, 2) not null default 0 check (basic_salary >= 0),
  contractual_amount numeric(12, 2) not null default 0 check (contractual_amount >= 0),
  -- An amount, or a percentage of basic salary.
  bonus_type         text not null default 'amount' check (bonus_type in ('amount', 'percent')),
  bonus_value        numeric(12, 2) not null default 0 check (bonus_value >= 0),
  -- The generated columns are mirrored in src/lib/payroll.ts.
  bonus              numeric(12, 2) not null generated always as (
                       case when bonus_type = 'percent' then round(basic_salary * bonus_value / 100, 2)
                            else bonus_value end) stored,
  -- In half days.
  absent_days        numeric(3, 1) not null default 0
                     check (absent_days between 0 and 31 and absent_days % 0.5 = 0),
  absent_deduction   numeric(12, 2) not null default 0 check (absent_deduction >= 0),
  allowance          numeric(12, 2) not null default 0 check (allowance >= 0),
  gross_salary       numeric(12, 2) not null generated always as (
                       basic_salary + contractual_amount
                       + case when bonus_type = 'percent' then round(basic_salary * bonus_value / 100, 2)
                              else bonus_value end
                       + allowance - absent_deduction) stored,
  advance_salary     numeric(12, 2) not null default 0 check (advance_salary >= 0),
  loan_deduction     numeric(12, 2) not null default 0 check (loan_deduction >= 0),
  tax_amount         numeric(12, 2) not null default 0 check (tax_amount >= 0),
  net_salary         numeric(12, 2) not null generated always as (
                       basic_salary + contractual_amount
                       + case when bonus_type = 'percent' then round(basic_salary * bonus_value / 100, 2)
                              else bonus_value end
                       + allowance - absent_deduction
                       - advance_salary - loan_deduction - tax_amount) stored,
  hr_remarks         text check (length(hr_remarks) <= 1000),
  finance_remarks    text check (length(finance_remarks) <= 1000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint payroll_items_employee_key unique (payroll_id, employee_id)
);
create index payroll_items_employee_idx on public.payroll_items (employee_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger payrolls_touch before update on public.payrolls
  for each row execute function public.touch_updated_at();

-- Lines change only while their payroll is a draft; HR's columns only by HR
-- and the rest only by finance. A new line takes the employee's name and
-- number, and their standing figures from their latest earlier payroll.
create function public.payroll_items_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_payroll  public.payrolls;
  v_employee public.employees;
  v_previous public.payroll_items;
  v_hr       boolean := false;
  v_finance  boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_hr := (new.basic_salary, new.contractual_amount, new.absent_days, new.hr_remarks)
            is distinct from (old.basic_salary, old.contractual_amount, old.absent_days, old.hr_remarks);
    v_finance := (new.bonus_type, new.bonus_value, new.absent_deduction, new.allowance,
                  new.advance_salary, new.loan_deduction, new.tax_amount, new.finance_remarks)
                 is distinct from (old.bonus_type, old.bonus_value, old.absent_deduction, old.allowance,
                                   old.advance_salary, old.loan_deduction, old.tax_amount, old.finance_remarks);
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
        raise exception 'Only finance can change bonus, deductions, allowance, tax and finance remarks.'
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
  return new;
end;
$$;

create trigger payroll_items_guard
  before insert or update or delete on public.payroll_items
  for each row execute function public.payroll_items_guard();

-- ---------------------------------------------------------------------------
-- Payroll actions (RPCs). The only way a payroll is created or moves status.
-- ---------------------------------------------------------------------------

-- Start a month's payroll with everyone who may log in (probation, active,
-- notice period). Refused while another payroll is open.
create function public.payroll_create(p_year integer, p_month integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_open public.payrolls;
  v_id   uuid;
begin
  if not public.can_manage_payroll() then
    raise exception 'Only HR and finance can create a payroll.' using errcode = '42501';
  end if;
  if p_year is null or p_month is null or p_year not between 2000 and 2999 or p_month not between 1 and 12 then
    raise exception 'Pick a month and year.' using errcode = '23514';
  end if;
  if exists (select 1 from public.payrolls where year = p_year and month = p_month) then
    raise exception 'There is already a payroll for %.', to_char(make_date(p_year, p_month, 1), 'FMMonth YYYY')
      using errcode = '23505';
  end if;
  select * into v_open from public.payrolls where status <> 'processed';
  if found then
    raise exception 'The % payroll is still %. It must be processed before another is started.',
      to_char(make_date(v_open.year, v_open.month, 1), 'FMMonth YYYY'),
      case v_open.status when 'draft' then 'a draft' when 'review' then 'in review' else 'approved' end;
  end if;

  insert into public.payrolls (year, month, created_by)
  values (p_year, p_month, public.current_employee_id())
  returning id into v_id;
  insert into public.payroll_items (payroll_id, employee_id)
  select v_id, e.id from public.employees e where public.is_login_status(e.status);
  return v_id;
end;
$$;

create function public.payroll_move(p_payroll_id uuid, p_status public.payroll_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me      uuid := public.current_employee_id();
  v_payroll public.payrolls;
begin
  select * into v_payroll from public.payrolls where id = p_payroll_id for update;
  if not found or not public.can_manage_payroll() then
    raise exception 'Payroll not found.' using errcode = 'P0002';
  end if;

  if v_payroll.status = 'draft' and p_status = 'review' then
    if not exists (select 1 from public.payroll_items where payroll_id = p_payroll_id) then
      raise exception 'Add at least one employee before sending the payroll for review.';
    end if;
    update public.payrolls set status = 'review', submitted_by = v_me, submitted_at = now()
     where id = p_payroll_id;
  elsif v_payroll.status = 'review' and p_status = 'approved' then
    if not public.is_company_admin() then
      raise exception 'Only a company admin can approve a payroll.' using errcode = '42501';
    end if;
    update public.payrolls set status = 'approved', approved_by = v_me, approved_at = now()
     where id = p_payroll_id;
  elsif v_payroll.status in ('review', 'approved') and p_status = 'draft' then
    if not public.is_company_admin() then
      raise exception 'Only a company admin can send a payroll back to draft.' using errcode = '42501';
    end if;
    update public.payrolls
       set status = 'draft', submitted_by = null, submitted_at = null, approved_by = null, approved_at = null
     where id = p_payroll_id;
  elsif v_payroll.status = 'approved' and p_status = 'processed' then
    if not public.is_finance() then
      raise exception 'Only finance can mark a payroll processed.' using errcode = '42501';
    end if;
    update public.payrolls set status = 'processed', processed_by = v_me, processed_at = now()
     where id = p_payroll_id;
  else
    raise exception 'A payroll can''t move from % to %.', v_payroll.status, p_status;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row level security
-- ---------------------------------------------------------------------------
revoke all on public.payrolls, public.payroll_items from anon, authenticated;

-- Payrolls change only through the functions above.
grant select on public.payrolls to authenticated;
-- Name, number and the worked-out columns aren't writable; the trigger
-- decides who may change which of the rest.
grant select, delete on public.payroll_items to authenticated;
grant insert (payroll_id, employee_id),
      update (basic_salary, contractual_amount, absent_days, hr_remarks, bonus_type, bonus_value,
              absent_deduction, allowance, advance_salary, loan_deduction, tax_amount, finance_remarks)
  on public.payroll_items to authenticated;

revoke execute on function
  public.is_finance(), public.can_manage_payroll(), public.payroll_items_guard(),
  public.payroll_create(integer, integer), public.payroll_move(uuid, public.payroll_status)
  from public, anon, authenticated;
grant execute on function
  public.is_finance(), public.can_manage_payroll(),
  public.payroll_create(integer, integer), public.payroll_move(uuid, public.payroll_status)
  to authenticated;

alter table public.payrolls enable row level security;
alter table public.payroll_items enable row level security;

-- HR and finance only.
create policy payrolls_select on public.payrolls
  for select to authenticated using ((select public.can_manage_payroll()));
create policy payroll_items_select on public.payroll_items
  for select to authenticated using ((select public.can_manage_payroll()));
create policy payroll_items_insert on public.payroll_items
  for insert to authenticated with check ((select public.can_manage_payroll()));
create policy payroll_items_update on public.payroll_items
  for update to authenticated
  using ((select public.can_manage_payroll())) with check ((select public.can_manage_payroll()));
create policy payroll_items_delete on public.payroll_items
  for delete to authenticated using ((select public.can_manage_payroll()));
