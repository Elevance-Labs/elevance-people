-- Onboardings and offboardings in progress follow the checklist, and the
-- manager ticks only their own department's tasks on offboardings too.
--
-- Each onboarding and offboarding task now links to the checklist task it
-- came from. Whenever the checklist changes (a section or task added,
-- renamed, moved, re-departmented or deleted), and whenever an employee's
-- department changes, every one in progress is brought back in line: tasks
-- no longer on the checklist for that person go, new ones are added
-- unticked, and names, order and department follow the checklist. Ticks on
-- the tasks that stay are kept. Completed and cancelled ones never change.
-- A task added to an offboarding clears its sign-offs, as unticking does.
--
-- Offboarding tasks also keep their section's department now: HR ticks any
-- task, the employee's manager only those from their own department's
-- sections (as on onboardings).
--
-- Tasks in progress are linked to the checklist by section name and title;
-- any that match nothing were removed from the checklist and are dropped.

alter table public.onboarding_tasks
  add column template_task_id uuid references public.onboarding_template_tasks (id) on delete set null;
create index onboarding_tasks_template_idx on public.onboarding_tasks (template_task_id);

alter table public.offboarding_tasks
  add column department_id uuid references public.departments (id) on delete set null,
  add column template_task_id uuid references public.offboarding_template_tasks (id) on delete set null;
create index offboarding_tasks_template_idx on public.offboarding_tasks (template_task_id);

-- HR ticks any checklist task; anyone else (the manager) only those from
-- their own department's sections.
create function public.can_tick_checklist_task(p_department_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_hr()
      or p_department_id = (select e.department_id from public.employees e
                             where e.id = public.current_employee_id());
$$;

-- Brings an onboarding in progress in line with the checklist for the
-- employee's department. Does nothing to a closed one.
create function public.onboarding_sync(p_onboarding_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_department uuid;
begin
  select e.department_id into v_department
    from public.onboardings o join public.employees e on e.id = o.employee_id
   where o.id = p_onboarding_id and o.status = 'in_progress';
  if not found then
    return;
  end if;
  delete from public.onboarding_tasks k
   where k.onboarding_id = p_onboarding_id
     and not exists (select 1 from public.onboarding_template_tasks t
                       join public.onboarding_template_sections s on s.id = t.section_id
                      where t.id = k.template_task_id
                        and (s.department_id is null or s.department_id = v_department));
  update public.onboarding_tasks k
     set section = s.name, section_order = s.sort_order, title = t.title, sort_order = t.sort_order,
         department_id = s.department_id
    from public.onboarding_template_tasks t
    join public.onboarding_template_sections s on s.id = t.section_id
   where k.onboarding_id = p_onboarding_id and k.template_task_id = t.id
     and (k.section, k.section_order, k.title, k.sort_order, k.department_id)
         is distinct from (s.name, s.sort_order, t.title, t.sort_order, s.department_id);
  insert into public.onboarding_tasks
    (onboarding_id, template_task_id, section, section_order, title, sort_order, department_id)
  select p_onboarding_id, t.id, s.name, s.sort_order, t.title, t.sort_order, s.department_id
    from public.onboarding_template_tasks t
    join public.onboarding_template_sections s on s.id = t.section_id
   where (s.department_id is null or s.department_id = v_department)
     and not exists (select 1 from public.onboarding_tasks k
                      where k.onboarding_id = p_onboarding_id and k.template_task_id = t.id);
end;
$$;

-- The same for an offboarding; a task added clears the sign-offs given.
create function public.offboarding_sync(p_offboarding_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_department uuid;
begin
  select e.department_id into v_department
    from public.offboardings o join public.employees e on e.id = o.employee_id
   where o.id = p_offboarding_id and o.status = 'in_progress';
  if not found then
    return;
  end if;
  delete from public.offboarding_tasks k
   where k.offboarding_id = p_offboarding_id
     and not exists (select 1 from public.offboarding_template_tasks t
                       join public.offboarding_template_sections s on s.id = t.section_id
                      where t.id = k.template_task_id
                        and (s.department_id is null or s.department_id = v_department));
  update public.offboarding_tasks k
     set section = s.name, section_order = s.sort_order, title = t.title, sort_order = t.sort_order,
         department_id = s.department_id
    from public.offboarding_template_tasks t
    join public.offboarding_template_sections s on s.id = t.section_id
   where k.offboarding_id = p_offboarding_id and k.template_task_id = t.id
     and (k.section, k.section_order, k.title, k.sort_order, k.department_id)
         is distinct from (s.name, s.sort_order, t.title, t.sort_order, s.department_id);
  insert into public.offboarding_tasks
    (offboarding_id, template_task_id, section, section_order, title, sort_order, department_id)
  select p_offboarding_id, t.id, s.name, s.sort_order, t.title, t.sort_order, s.department_id
    from public.offboarding_template_tasks t
    join public.offboarding_template_sections s on s.id = t.section_id
   where (s.department_id is null or s.department_id = v_department)
     and not exists (select 1 from public.offboarding_tasks k
                      where k.offboarding_id = p_offboarding_id and k.template_task_id = t.id);
  if found then
    update public.offboardings
       set hr_signed_by = null, hr_signed_at = null, manager_signed_by = null, manager_signed_at = null
     where id = p_offboarding_id;
  end if;
end;
$$;

-- Any change to a checklist reaches every one of its kind in progress.
create function public.onboarding_checklist_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.onboarding_sync(o.id) from public.onboardings o where o.status = 'in_progress';
  return null;
end;
$$;

create function public.offboarding_checklist_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.offboarding_sync(o.id) from public.offboardings o where o.status = 'in_progress';
  return null;
end;
$$;

create trigger onboarding_checklist_changed
  after insert or update or delete on public.onboarding_template_sections
  for each statement execute function public.onboarding_checklist_changed();
create trigger onboarding_checklist_changed
  after insert or update or delete on public.onboarding_template_tasks
  for each statement execute function public.onboarding_checklist_changed();
create trigger offboarding_checklist_changed
  after insert or update or delete on public.offboarding_template_sections
  for each statement execute function public.offboarding_checklist_changed();
create trigger offboarding_checklist_changed
  after insert or update or delete on public.offboarding_template_tasks
  for each statement execute function public.offboarding_checklist_changed();

-- An employee moved to another department gets that department's sections.
create function public.employees_checklists()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.onboarding_sync(o.id) from public.onboardings o
    where o.employee_id = new.id and o.status = 'in_progress';
  perform public.offboarding_sync(o.id) from public.offboardings o
    where o.employee_id = new.id and o.status = 'in_progress';
  return null;
end;
$$;

create trigger employees_checklists
  after update of department_id on public.employees
  for each row when (old.department_id is distinct from new.department_id)
  execute function public.employees_checklists();

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
  -- The checklist: sections for everyone, and those for the job's department.
  perform public.onboarding_sync(v_onboarding);

  update public.job_applications set stage = 'hired', stage_changed_at = now()
   where id = p_application_id;
  insert into public.application_stage_events
    (application_id, kind, from_stage, to_stage, reason, created_by)
  values (p_application_id, 'move', v_app.stage, 'hired', nullif(trim(p_reason), ''), v_me);
  return v_onboarding;
end;
$$;

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
  elsif tg_op = 'UPDATE' and old.status = 'notice_period' and public.is_login_status(new.status) then
    update public.offboardings
       set status = 'cancelled', cancelled_by = public.current_employee_id(), cancelled_at = now(),
           cancel_reason = 'Back to ' || replace(new.status::text, '_', ' ') || ' from notice period.'
     where employee_id = new.id and status = 'in_progress';
  end if;
  return null;
end;
$$;

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
  if not public.can_tick_checklist_task(v_department) then
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

-- Tick a task off, or untick it (which clears the sign-offs): HR any task,
-- the manager those from their own department's sections.
create or replace function public.offboarding_task_set(p_task_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_offboarding public.offboardings;
  v_department  uuid;
begin
  select o.* into v_offboarding
    from public.offboarding_tasks t join public.offboardings o on o.id = t.offboarding_id
   where t.id = p_task_id for update of o;
  if not found or not public.can_work_offboarding(v_offboarding.employee_id) then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;
  select t.department_id into v_department from public.offboarding_tasks t where t.id = p_task_id;
  if not public.can_tick_checklist_task(v_department) then
    raise exception 'Only HR can tick this task. Managers tick the tasks for their own department.'
      using errcode = '42501';
  end if;
  if v_offboarding.status <> 'in_progress' then
    raise exception 'This offboarding is already %.', v_offboarding.status;
  end if;
  update public.offboarding_tasks
     set done_by = case when p_done then public.current_employee_id() end,
         done_at = case when p_done then now() end
   where id = p_task_id and (done_at is null) = p_done;
  if not p_done and found then
    update public.offboardings
       set hr_signed_by = null, hr_signed_at = null, manager_signed_by = null, manager_signed_at = null
     where id = v_offboarding.id;
  end if;
end;
$$;

revoke execute on function
  public.can_tick_checklist_task(uuid), public.onboarding_sync(uuid), public.offboarding_sync(uuid),
  public.onboarding_checklist_changed(), public.offboarding_checklist_changed(), public.employees_checklists()
  from public, anon, authenticated;

-- Link the tasks in progress to the checklist, then bring them in line.
update public.onboarding_tasks k
   set template_task_id = (select t.id from public.onboarding_template_tasks t
                             join public.onboarding_template_sections s on s.id = t.section_id
                            where s.name = k.section and t.title = k.title
                            order by s.department_id nulls first, t.sort_order limit 1)
  from public.onboardings o
 where o.id = k.onboarding_id and o.status = 'in_progress';
update public.offboarding_tasks k
   set template_task_id = (select t.id from public.offboarding_template_tasks t
                             join public.offboarding_template_sections s on s.id = t.section_id
                            where s.name = k.section and t.title = k.title
                            order by s.department_id nulls first, t.sort_order limit 1)
  from public.offboardings o
 where o.id = k.offboarding_id and o.status = 'in_progress';
select public.onboarding_sync(id) from public.onboardings where status = 'in_progress';
select public.offboarding_sync(id) from public.offboardings where status = 'in_progress';
