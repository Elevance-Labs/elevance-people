-- Onboarding and offboarding checklist sections may name a department.
--
-- A section with no department is for everyone, as before. One with a
-- department is copied only into onboardings and offboardings of employees in
-- that department (an onboarding uses the job's department, as the new
-- employee's record does). Section names are now unique within a department
-- (or among the sections for everyone), so two departments may each have,
-- say, an "Equipment" section. Deleting a department deletes its sections, as
-- it does the rest of its config. Existing sections stay for everyone.

alter table public.onboarding_template_sections
  add column department_id uuid references public.departments (id) on delete cascade;
alter table public.offboarding_template_sections
  add column department_id uuid references public.departments (id) on delete cascade;

drop index public.onboarding_template_sections_name_key;
create unique index onboarding_template_sections_name_key
  on public.onboarding_template_sections (department_id, lower(name)) nulls not distinct;
drop index public.offboarding_template_sections_name_key;
create unique index offboarding_template_sections_name_key
  on public.offboarding_template_sections (department_id, lower(name)) nulls not distinct;

grant insert (name, department_id), update (name, department_id)
  on public.onboarding_template_sections to authenticated;
grant insert (name, department_id), update (name, department_id)
  on public.offboarding_template_sections to authenticated;

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
  insert into public.onboarding_tasks (onboarding_id, section, section_order, title, sort_order)
  select v_onboarding, s.name, s.sort_order, t.title, t.sort_order
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

    -- Sections for everyone, and those for the employee's department.
    insert into public.offboarding_tasks (offboarding_id, section, section_order, title, sort_order)
    select v_offboarding, s.name, s.sort_order, t.title, t.sort_order
      from public.offboarding_template_sections s
      join public.offboarding_template_tasks t on t.section_id = s.id
     where s.department_id is null or s.department_id = new.department_id;
  elsif tg_op = 'UPDATE' and old.status = 'notice_period' and public.is_login_status(new.status) then
    update public.offboardings
       set status = 'cancelled', cancelled_by = public.current_employee_id(), cancelled_at = now(),
           cancel_reason = 'Back to ' || replace(new.status::text, '_', ' ') || ' from notice period.'
     where employee_id = new.id and status = 'in_progress';
  end if;
  return null;
end;
$$;
