-- Payroll: several payrolls may be open at once.
--
-- HR may start a payroll for any month and year that has none yet, whatever
-- the status of the others (drafts included); before, a new payroll waited
-- until every other one was disbursed. One payroll per month and year still
-- holds (payrolls_period_key, checked by payroll_create too).

drop index public.payrolls_one_open;

-- Start a month's payroll with everyone who may log in (probation, active,
-- notice period). Refused if that month and year already has one.
create or replace function public.payroll_create(p_year integer, p_month integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
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

  insert into public.payrolls (year, month, created_by)
  values (p_year, p_month, public.current_employee_id())
  returning id into v_id;
  insert into public.payroll_items (payroll_id, employee_id)
  select v_id, e.id from public.employees e where public.is_login_status(e.status);
  return v_id;
end;
$$;
