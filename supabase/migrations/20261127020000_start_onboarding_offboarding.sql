-- HR starts an onboarding or an offboarding from the employee record.
--
-- Until now an onboarding came only from a hire (application_hire), and an
-- offboarding only from putting someone on notice (employees_offboarding). A
-- record made by hand, or someone set straight to left or terminated, had
-- neither. Two HR-only functions fill the gap:
--
-- * onboarding_start: for someone joining who has no onboarding yet; due the
--   day after joining, with the checklist for their department.
-- * offboarding_start: for someone on notice, left or terminated with no
--   offboarding in progress and none completed since; never one's own. The
--   last working day is their date of separation, and the reason is
--   terminated for someone terminated.
--
-- employees_offboarding now also cancels an offboarding in progress when
-- someone goes back to working from left or terminated, not only from notice.
-- Nothing the previous build reads or writes changes.

create function public.onboarding_start(p_employee_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_employee   public.employees;
  v_onboarding uuid;
begin
  if not public.is_hr() then
    raise exception 'Only HR can start an onboarding.' using errcode = '42501';
  end if;
  select * into v_employee from public.employees where id = p_employee_id for update;
  if not found then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if v_employee.status <> 'joining' then
    raise exception 'Only someone joining can be onboarded.';
  end if;
  if exists (select 1 from public.onboardings o where o.employee_id = p_employee_id) then
    raise exception 'They already have an onboarding.' using errcode = '23505';
  end if;
  insert into public.onboardings (employee_id, due_date, created_by)
  values (p_employee_id, v_employee.date_of_joining + 1, public.current_employee_id())
  returning id into v_onboarding;
  -- The checklist: sections for everyone, and those for their department.
  perform public.onboarding_sync(v_onboarding);
  return v_onboarding;
end;
$$;

create function public.offboarding_start(p_employee_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_employee    public.employees;
  v_offboarding uuid;
begin
  if not public.is_hr() then
    raise exception 'Only HR can start an offboarding.' using errcode = '42501';
  end if;
  select * into v_employee from public.employees where id = p_employee_id for update;
  if not found or not public.can_work_offboarding(p_employee_id) then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if v_employee.status not in ('notice_period', 'left', 'terminated') then
    raise exception 'Only someone on notice, left or terminated can be offboarded.';
  end if;
  if exists (select 1 from public.offboardings o
              where o.employee_id = p_employee_id and o.status = 'in_progress') then
    raise exception 'Their offboarding is already in progress.' using errcode = '23505';
  end if;
  if (select o.status from public.offboardings o where o.employee_id = p_employee_id
       order by o.started_at desc limit 1) = 'completed' then
    raise exception 'They have already been offboarded.' using errcode = '23505';
  end if;
  insert into public.offboardings (employee_id, reason, last_working_day, started_by)
  values (p_employee_id, case when v_employee.status = 'terminated' then 'terminated'::public.offboarding_reason end,
          v_employee.date_of_separation, public.current_employee_id())
  returning id into v_offboarding;
  -- The checklist: sections for everyone, and those for their department.
  perform public.offboarding_sync(v_offboarding);
  return v_offboarding;
end;
$$;

revoke execute on function public.onboarding_start(uuid), public.offboarding_start(uuid)
  from public, anon, authenticated;
grant execute on function public.onboarding_start(uuid), public.offboarding_start(uuid) to authenticated;

-- Starts an offboarding, with a copy of the checklist, when someone is put on
-- notice; cancels the one under way if they go back to working.
create or replace function public.employees_offboarding()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_offboarding uuid;
begin
  if new.status = 'notice_period'
     and (tg_op = 'INSERT' or old.status is distinct from 'notice_period')
     and not exists (select 1 from public.offboardings o
                      where o.employee_id = new.id and o.status = 'in_progress') then
    insert into public.offboardings (employee_id, last_working_day, started_by)
    values (new.id, new.date_of_separation, public.current_employee_id())
    returning id into v_offboarding;
    -- The checklist: sections for everyone, and those for their department.
    perform public.offboarding_sync(v_offboarding);
  elsif tg_op = 'UPDATE' and old.status in ('notice_period', 'left', 'terminated')
        and new.status in ('probation', 'extended_probation', 'active') then
    update public.offboardings
       set status = 'cancelled', cancelled_by = public.current_employee_id(), cancelled_at = now(),
           cancel_reason = 'Back to ' || replace(new.status::text, '_', ' ')
                           || ' from ' || replace(old.status::text, '_', ' ') || '.'
     where employee_id = new.id and status = 'in_progress';
  end if;
  return null;
end;
$$;
