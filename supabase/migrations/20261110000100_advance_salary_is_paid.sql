-- ---------------------------------------------------------------------------
-- Advance salary is money paid out to the person this month, recovered later
-- through the loan deduction. It was being subtracted like a deduction; it
-- now adds to gross salary, and net is gross less loan deduction and tax.
--
-- Payrolls already run must keep their figures. A new flag on each line,
-- advance_deducted, keeps the old rule (advance subtracted from net, not in
-- gross) for every line on a payroll past draft when this runs; it is not
-- client-writable, and new lines get the new rule. Lines on a draft payroll
-- switch to the new rule, since nothing on them is final yet.
--
-- Gross and net are generated columns, which can't take a new expression in
-- place, so they are dropped and added again in the same order; the flag
-- keeps every existing line's values as they were.
--
-- my_payslips returns the flag too, so a payslip lays the advance out the
-- way its line was worked out. Its return type changes, so it is recreated.
-- ---------------------------------------------------------------------------

alter table public.payroll_items
  add column advance_deducted boolean not null default false;

-- payroll_items_guard lets this through: it changes no HR or finance column.
update public.payroll_items i
   set advance_deducted = true
  from public.payrolls p
 where p.id = i.payroll_id and p.status <> 'draft';

alter table public.payroll_items
  drop column gross_salary,
  drop column net_salary,
  add column gross_salary numeric(12, 2) not null generated always as (
    basic_salary + contractual_amount
    + case when bonus_type = 'percent' then round(basic_salary * bonus_value / 100, 2)
           else bonus_value end
    + allowance + arrears - absent_deduction
    + case when advance_deducted then 0 else advance_salary end) stored,
  add column net_salary numeric(12, 2) not null generated always as (
    basic_salary + contractual_amount
    + case when bonus_type = 'percent' then round(basic_salary * bonus_value / 100, 2)
           else bonus_value end
    + allowance + arrears - absent_deduction
    + case when advance_deducted then -advance_salary else advance_salary end
    - loan_deduction - tax_amount) stored;

drop function public.my_payslips();

-- The caller's own lines on disbursed payrolls, newest first. No remarks.
create function public.my_payslips()
returns table (payroll_id uuid, year integer, month integer, disbursed_at timestamptz,
               employee_number integer, full_name text, basic_salary numeric,
               contractual_amount numeric, bonus_type text, bonus_value numeric, bonus numeric,
               absent_days numeric, absent_deduction numeric, allowance numeric, arrears numeric,
               gross_salary numeric, advance_salary numeric, loan_deduction numeric,
               tax_amount numeric, net_salary numeric, advance_deducted boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.year, p.month, p.disbursed_at, i.employee_number, i.full_name, i.basic_salary,
         i.contractual_amount, i.bonus_type, i.bonus_value, i.bonus, i.absent_days,
         i.absent_deduction, i.allowance, i.arrears, i.gross_salary, i.advance_salary,
         i.loan_deduction, i.tax_amount, i.net_salary, i.advance_deducted
    from public.payroll_items i
    join public.payrolls p on p.id = i.payroll_id
   where p.status = 'disbursed' and i.employee_id = public.current_employee_id()
   order by p.year desc, p.month desc;
$$;

revoke execute on function public.my_payslips() from public, anon, authenticated;
grant execute on function public.my_payslips() to authenticated;
