-- Payrolls move on from processed to disbursed, and only a disbursed payroll
-- gives employees their payslips.
--
-- Finance marks a processed payroll disbursed once the salaries have been
-- paid out (who and when are stamped). A payroll is now open until it is
-- disbursed, so the next one can't start before. my_payslips lists lines on
-- disbursed payrolls only, with the disbursal time in place of the
-- processing time.
--
-- Until now processed was the last step and meant paid, so payrolls already
-- processed are marked disbursed (by whoever processed them, at that time):
-- employees keep the payslips they already see.

alter table public.payrolls
  add column disbursed_by uuid references public.employees (id) on delete set null,
  add column disbursed_at timestamptz;

drop index public.payrolls_one_open;

update public.payrolls
   set status = 'disbursed', disbursed_by = processed_by, disbursed_at = processed_at
 where status = 'processed';

create unique index payrolls_one_open on public.payrolls ((true)) where status <> 'disbursed';

create or replace function public.payroll_create(p_year integer, p_month integer)
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
  select * into v_open from public.payrolls where status <> 'disbursed';
  if found then
    raise exception 'The % payroll is still %. It must be disbursed before another is started.',
      to_char(make_date(v_open.year, v_open.month, 1), 'FMMonth YYYY'),
      case v_open.status when 'draft' then 'a draft' when 'review' then 'in review' else v_open.status::text end;
  end if;

  insert into public.payrolls (year, month, created_by)
  values (p_year, p_month, public.current_employee_id())
  returning id into v_id;
  insert into public.payroll_items (payroll_id, employee_id)
  select v_id, e.id from public.employees e where public.is_login_status(e.status);
  return v_id;
end;
$$;

create or replace function public.payroll_move(p_payroll_id uuid, p_status public.payroll_status)
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
  elsif v_payroll.status = 'processed' and p_status = 'disbursed' then
    if not public.is_finance() then
      raise exception 'Only finance can mark a payroll disbursed.' using errcode = '42501';
    end if;
    update public.payrolls set status = 'disbursed', disbursed_by = v_me, disbursed_at = now()
     where id = p_payroll_id;
  else
    raise exception 'A payroll can''t move from % to %.', v_payroll.status, p_status;
  end if;
end;
$$;

-- The return type changes (disbursed_at for processed_at), so it is made
-- again, with its grants.
drop function public.my_payslips();
create function public.my_payslips()
returns table (payroll_id uuid, year integer, month integer, disbursed_at timestamptz,
               employee_number integer, full_name text, basic_salary numeric,
               contractual_amount numeric, bonus_type text, bonus_value numeric, bonus numeric,
               absent_days numeric, absent_deduction numeric, allowance numeric, arrears numeric,
               gross_salary numeric, advance_salary numeric, loan_deduction numeric,
               tax_amount numeric, net_salary numeric)
language sql stable security definer set search_path = '' as $$
  select p.id, p.year, p.month, p.disbursed_at, i.employee_number, i.full_name, i.basic_salary,
         i.contractual_amount, i.bonus_type, i.bonus_value, i.bonus, i.absent_days,
         i.absent_deduction, i.allowance, i.arrears, i.gross_salary, i.advance_salary,
         i.loan_deduction, i.tax_amount, i.net_salary
    from public.payroll_items i
    join public.payrolls p on p.id = i.payroll_id
   where p.status = 'disbursed' and i.employee_id = public.current_employee_id()
   order by p.year desc, p.month desc;
$$;
revoke execute on function public.my_payslips() from public, anon, authenticated;
grant execute on function public.my_payslips() to authenticated;
