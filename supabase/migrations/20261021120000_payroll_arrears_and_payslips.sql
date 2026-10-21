-- Payroll arrears, and payslips for employees.
--
-- Arrears: a new finance column on payroll lines (pay owed from earlier
-- months), added to gross salary. Gross and net are generated columns, which
-- can't take a new expression in place, so they are dropped and added again
-- after arrears; their values are worked out afresh.
--
-- Payslips: once a payroll is processed, each employee reads their own line
-- of it through my_payslips. Payroll tables stay closed to everyone but HR
-- and finance; the function leaves out the HR and finance remarks, which are
-- internal.

alter table public.payroll_items
  drop column gross_salary,
  drop column net_salary,
  add column arrears numeric(12, 2) not null default 0 check (arrears >= 0),
  add column gross_salary numeric(12, 2) not null generated always as (
    basic_salary + contractual_amount
    + case when bonus_type = 'percent' then round(basic_salary * bonus_value / 100, 2)
           else bonus_value end
    + allowance + arrears - absent_deduction) stored,
  add column net_salary numeric(12, 2) not null generated always as (
    basic_salary + contractual_amount
    + case when bonus_type = 'percent' then round(basic_salary * bonus_value / 100, 2)
           else bonus_value end
    + allowance + arrears - absent_deduction
    - advance_salary - loan_deduction - tax_amount) stored;

grant update (arrears) on public.payroll_items to authenticated;

-- As before, with arrears among finance's columns.
create or replace function public.payroll_items_guard()
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
  return new;
end;
$$;

-- The caller's own lines on processed payrolls, newest first. No remarks.
create function public.my_payslips()
returns table (payroll_id uuid, year integer, month integer, processed_at timestamptz,
               employee_number integer, full_name text, basic_salary numeric,
               contractual_amount numeric, bonus_type text, bonus_value numeric, bonus numeric,
               absent_days numeric, absent_deduction numeric, allowance numeric, arrears numeric,
               gross_salary numeric, advance_salary numeric, loan_deduction numeric,
               tax_amount numeric, net_salary numeric)
language sql stable security definer set search_path = '' as $$
  select p.id, p.year, p.month, p.processed_at, i.employee_number, i.full_name, i.basic_salary,
         i.contractual_amount, i.bonus_type, i.bonus_value, i.bonus, i.absent_days,
         i.absent_deduction, i.allowance, i.arrears, i.gross_salary, i.advance_salary,
         i.loan_deduction, i.tax_amount, i.net_salary
    from public.payroll_items i
    join public.payrolls p on p.id = i.payroll_id
   where p.status = 'processed' and i.employee_id = public.current_employee_id()
   order by p.year desc, p.month desc;
$$;

revoke execute on function public.my_payslips() from public, anon, authenticated;
grant execute on function public.my_payslips() to authenticated;
