-- Leaves: who's off, for everyone's dashboard.
--
-- The dashboard now shows who is off today and who will be in the next 30
-- days, beside the announcements. Leaves stay readable only by the employee,
-- their manager and HR (RLS), so this comes through who_is_off: approved
-- leave of people who may log in, ending today or later and starting within
-- 30 days (Pakistan time, as company_today), with the name, dates and half
-- day only. No leave type, reason or days, so nobody learns why someone is
-- off. Empty unless the caller is a bound employee.

create function public.who_is_off()
returns table (employee_id uuid, full_name text, start_date date, end_date date, half_day boolean)
language sql stable security definer set search_path = '' as $$
  select l.employee_id, e.full_name, l.start_date, l.end_date, l.half_day
    from public.leaves l
    join public.employees e on e.id = l.employee_id
   where (select public.current_employee_id()) is not null
     and l.status = 'approved'
     and public.is_login_status(e.status)
     and l.end_date >= (now() at time zone 'Asia/Karachi')::date
     and l.start_date <= (now() at time zone 'Asia/Karachi')::date + 30
   order by l.start_date, e.full_name;
$$;

revoke execute on function public.who_is_off() from public, anon, authenticated;
grant execute on function public.who_is_off() to authenticated;
