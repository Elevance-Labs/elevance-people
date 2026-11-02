-- The new hire's manager works on their onboarding alongside HR.
--
-- An onboarding task now keeps the department of the checklist section it was
-- copied from (null for the sections for everyone). HR still ticks any task;
-- the employee's manager in the org chart may now see the onboarding and tick
-- the tasks from their own department's sections. Completing and cancelling
-- stay with HR. Tasks copied before this have no department, so stay HR's.

alter table public.onboarding_tasks
  add column department_id uuid references public.departments (id) on delete set null;

-- HR, or the employee's manager in the org chart.
create function public.can_see_onboarding(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_hr() or public.is_manager_of(p_employee_id);
$$;

revoke execute on function public.can_see_onboarding(uuid) from public, anon, authenticated;
grant execute on function public.can_see_onboarding(uuid) to authenticated;

drop policy onboardings_select on public.onboardings;
create policy onboardings_select on public.onboardings
  for select to authenticated using (public.can_see_onboarding(employee_id));
drop policy onboarding_tasks_select on public.onboarding_tasks;
create policy onboarding_tasks_select on public.onboarding_tasks
  for select to authenticated
  using (exists (select 1 from public.onboardings o
                  where o.id = onboarding_id and public.can_see_onboarding(o.employee_id)));

create or replace function public.application_hire(
  p_application_id uuid, p_company_email text, p_date_of_joining date, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me         uuid := public.current_employee_id();
  v_app        public.job_applications;
  v_job        public.job_openings;
  v_employee   uuid;
  v_onboarding uuid;
begin
  if not public.is_hr() then
    raise exception 'Only HR can hire.' using errcode = '42501';
  end if;
  select * into v_app from public.job_applications where id = p_application_id for update;
  if not found then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
  if not 'hired' = any (public.application_next_stages(v_app.stage)) then
    raise exception 'An application can''t move from % to hired.', v_app.stage;
  end if;
  if nullif(trim(p_company_email), '') is null or p_date_of_joining is null then
    raise exception 'Give the new employee''s company email and date of joining.' using errcode = '23514';
  end if;
  select * into v_job from public.job_openings where id = v_app.job_opening_id;

  insert into public.employees
    (full_name, company_email, date_of_joining, personal_email, phone, department_id, designation_id, status)
  values (v_app.full_name, lower(trim(p_company_email)), p_date_of_joining, v_app.email, v_app.phone,
          v_job.department_id, v_job.designation_id, 'joining')
  returning id into v_employee;

  insert into public.onboardings (employee_id, application_id, due_date, created_by)
  values (v_employee, v_app.id, p_date_of_joining + 1, v_me)
  returning id into v_onboarding;

  -- Sections for everyone, and those for the job's department.
  insert into public.onboarding_tasks
    (onboarding_id, section, section_order, title, sort_order, department_id)
  select v_onboarding, s.name, s.sort_order, t.title, t.sort_order, s.department_id
    from public.onboarding_template_sections s
    join public.onboarding_template_tasks t on t.section_id = s.id
   where s.department_id is null or s.department_id = v_job.department_id;

  update public.job_applications set stage = 'hired', stage_changed_at = now()
   where id = p_application_id;
  insert into public.application_stage_events
    (application_id, kind, from_stage, to_stage, reason, created_by)
  values (p_application_id, 'move', v_app.stage, 'hired', nullif(trim(p_reason), ''), v_me);
  return v_onboarding;
end;
$$;

-- Tick a task off, or untick it, while the onboarding is in progress: HR any
-- task, the employee's manager those from their own department's sections.
create or replace function public.onboarding_task_set(p_task_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_status     public.onboarding_status;
  v_employee   uuid;
  v_department uuid;
begin
  select o.status, o.employee_id, t.department_id into v_status, v_employee, v_department
    from public.onboarding_tasks t join public.onboardings o on o.id = t.onboarding_id
   where t.id = p_task_id for update of o;
  if not found or not public.can_see_onboarding(v_employee) then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;
  if not public.is_hr()
     and (v_department is null
          or v_department is distinct from (select e.department_id from public.employees e
                                             where e.id = public.current_employee_id())) then
    raise exception 'Only HR can tick this task. Managers tick the tasks for their own department.'
      using errcode = '42501';
  end if;
  if v_status <> 'in_progress' then
    raise exception 'This onboarding is already %.', v_status;
  end if;
  update public.onboarding_tasks
     set done_by = case when p_done then public.current_employee_id() end,
         done_at = case when p_done then now() end
   where id = p_task_id;
end;
$$;
