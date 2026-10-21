-- Onboarding: a checklist for every new hire.
--
-- Company admins keep the onboarding checklist under Configuration: sections,
-- each with tasks, in an order they set (onboarding_template_sections and
-- onboarding_template_tasks; reordered only through onboarding_reorder_*).
--
-- Hiring an applicant now goes through application_hire instead of
-- application_move. In one step it creates their employee record (name,
-- phone, personal email, the job's department and designation, status
-- Joining, with the company email and joining date HR gives), an onboarding
-- due the day after joining, and a copy of the checklist as the onboarding's
-- tasks, then moves the application to hired. Editing the checklist later
-- doesn't change onboardings already started.
--
-- HR ticks tasks off (onboarding_task_set), then completes the onboarding or
-- cancels it with a reason (onboarding_complete / onboarding_cancel). No task
-- is required to complete it. One onboarding per employee.
--
-- A hire can't be undone while the employee record it created exists.

create type public.onboarding_status as enum ('in_progress', 'completed', 'cancelled');

-- ---------------------------------------------------------------------------
-- The checklist (Configuration → Onboarding)
-- ---------------------------------------------------------------------------
create table public.onboarding_template_sections (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (name = trim(name) and name <> '' and length(name) <= 200),
  -- Set on insert (last), changed only by onboarding_reorder_sections.
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index onboarding_template_sections_name_key on public.onboarding_template_sections (lower(name));

create table public.onboarding_template_tasks (
  id         uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.onboarding_template_sections (id) on delete cascade,
  title      text not null check (title = trim(title) and title <> '' and length(title) <= 500),
  -- Within the section. Set on insert (last), changed only by onboarding_reorder_tasks.
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index onboarding_template_tasks_section_idx on public.onboarding_template_tasks (section_id, sort_order);

-- ---------------------------------------------------------------------------
-- Onboardings: written only by application_hire and the onboarding functions
-- ---------------------------------------------------------------------------
create table public.onboardings (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null,
  -- The hire that started it.
  application_id uuid,
  due_date       date not null,
  status         public.onboarding_status not null default 'in_progress',
  created_by     uuid references public.employees (id) on delete set null,
  created_at     timestamptz not null default now(),
  completed_by   uuid references public.employees (id) on delete set null,
  completed_at   timestamptz,
  cancelled_by   uuid references public.employees (id) on delete set null,
  cancelled_at   timestamptz,
  cancel_reason  text check (length(cancel_reason) <= 2000),
  -- Named: the app embeds the employee through this exact FK, since
  -- onboardings references employees several times.
  constraint onboardings_employee_id_fkey foreign key (employee_id)
    references public.employees (id) on delete cascade,
  constraint onboardings_employee_id_key unique (employee_id),
  constraint onboardings_application_id_fkey foreign key (application_id)
    references public.job_applications (id) on delete set null,
  constraint onboardings_application_id_key unique (application_id),
  constraint onboardings_cancel_needs_reason check (status <> 'cancelled' or cancel_reason is not null)
);

-- The checklist as it was when the onboarding started.
create table public.onboarding_tasks (
  id            uuid primary key default gen_random_uuid(),
  onboarding_id uuid not null references public.onboardings (id) on delete cascade,
  section       text not null,
  section_order integer not null,
  title         text not null,
  sort_order    integer not null,
  done_by       uuid references public.employees (id) on delete set null,
  done_at       timestamptz
);
create index onboarding_tasks_onboarding_idx
  on public.onboarding_tasks (onboarding_id, section_order, sort_order);

-- ---------------------------------------------------------------------------
-- Triggers: a new section or task goes last
-- ---------------------------------------------------------------------------
create function public.onboarding_template_sections_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select coalesce(max(s.sort_order) + 1, 0) into new.sort_order
      from public.onboarding_template_sections s;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger onboarding_template_sections_stamp
  before insert or update on public.onboarding_template_sections
  for each row execute function public.onboarding_template_sections_stamp();

create function public.onboarding_template_tasks_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select coalesce(max(t.sort_order) + 1, 0) into new.sort_order
      from public.onboarding_template_tasks t where t.section_id = new.section_id;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger onboarding_template_tasks_stamp
  before insert or update on public.onboarding_template_tasks
  for each row execute function public.onboarding_template_tasks_stamp();

-- ---------------------------------------------------------------------------
-- Checklist order (RPCs, company admins). Each takes every id, in the new
-- order, so a stale list is refused rather than half applied.
-- ---------------------------------------------------------------------------
create function public.onboarding_reorder_sections(p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_company_admin() then
    raise exception 'Only a company admin can change the onboarding checklist.' using errcode = '42501';
  end if;
  if cardinality(p_ids) is distinct from (select count(*) from public.onboarding_template_sections)::integer
     or exists (select 1 from public.onboarding_template_sections s where s.id <> all (p_ids)) then
    raise exception 'The checklist has changed. Reload and try again.';
  end if;
  update public.onboarding_template_sections s set sort_order = o.n - 1
    from unnest(p_ids) with ordinality as o(id, n)
   where s.id = o.id;
end;
$$;

create function public.onboarding_reorder_tasks(p_section_id uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_company_admin() then
    raise exception 'Only a company admin can change the onboarding checklist.' using errcode = '42501';
  end if;
  if cardinality(p_ids) is distinct from
       (select count(*) from public.onboarding_template_tasks t where t.section_id = p_section_id)::integer
     or exists (select 1 from public.onboarding_template_tasks t
                 where t.section_id = p_section_id and t.id <> all (p_ids)) then
    raise exception 'The checklist has changed. Reload and try again.';
  end if;
  update public.onboarding_template_tasks t set sort_order = o.n - 1
    from unnest(p_ids) with ordinality as o(id, n)
   where t.id = o.id and t.section_id = p_section_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hiring (RPC, HR): the only way to move an application to hired
-- ---------------------------------------------------------------------------
create function public.application_hire(
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

  insert into public.onboarding_tasks (onboarding_id, section, section_order, title, sort_order)
  select v_onboarding, s.name, s.sort_order, t.title, t.sort_order
    from public.onboarding_template_sections s
    join public.onboarding_template_tasks t on t.section_id = s.id;

  update public.job_applications set stage = 'hired', stage_changed_at = now()
   where id = p_application_id;
  insert into public.application_stage_events
    (application_id, kind, from_stage, to_stage, reason, created_by)
  values (p_application_id, 'move', v_app.stage, 'hired', nullif(trim(p_reason), ''), v_me);
  return v_onboarding;
end;
$$;

-- Move an application to one of its next stages (with a reason where one is
-- required). The only way forward, except to hired (application_hire).
create or replace function public.application_move(
  p_application_id uuid, p_stage public.application_stage, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := public.current_employee_id();
  v_app    public.job_applications;
  v_reason text := nullif(trim(p_reason), '');
begin
  select * into v_app from public.job_applications where id = p_application_id for update;
  if not found or v_me is null or not public.can_see_application(v_app.job_opening_id, v_app.stage) then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
  if not public.is_hr() and not public.application_team_movable(v_app.stage) then
    raise exception 'Only HR can move an application on from this stage.' using errcode = '42501';
  end if;
  if not p_stage = any (public.application_next_stages(v_app.stage)) then
    raise exception 'An application can''t move from % to %.', v_app.stage, p_stage;
  end if;
  if p_stage = 'hired' then
    raise exception 'Hire through application_hire, which creates the employee record.';
  end if;
  if public.application_stage_needs_reason(p_stage) and v_reason is null then
    raise exception 'Give a reason for moving this application to %.', p_stage using errcode = '23514';
  end if;

  update public.job_applications set stage = p_stage, stage_changed_at = now()
   where id = p_application_id;
  insert into public.application_stage_events
    (application_id, kind, from_stage, to_stage, reason, created_by)
  values (p_application_id, 'move', v_app.stage, p_stage, v_reason, v_me);
end;
$$;

-- HR only: move an application back to where its last (not yet undone) move
-- came from. Repeated undos walk further back. A hire stays while the
-- employee record it created exists.
create or replace function public.application_undo(p_application_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := public.current_employee_id();
  v_app   public.job_applications;
  v_event public.application_stage_events;
begin
  if not public.is_hr() then
    raise exception 'Only HR can undo a move.' using errcode = '42501';
  end if;
  select * into v_app from public.job_applications where id = p_application_id for update;
  if not found then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
  select * into v_event from public.application_stage_events
   where application_id = p_application_id and kind = 'move' and undone_at is null
   order by id desc limit 1;
  if not found or v_event.to_stage <> v_app.stage then
    raise exception 'There is no move to undo.';
  end if;
  if exists (select 1 from public.onboardings o where o.application_id = p_application_id) then
    raise exception 'This hire created an employee record. A company admin must delete it before the hire can be undone.';
  end if;

  update public.application_stage_events set undone_by = v_me, undone_at = now()
   where id = v_event.id;
  update public.job_applications set stage = v_event.from_stage, stage_changed_at = now()
   where id = p_application_id;
  insert into public.application_stage_events
    (application_id, kind, from_stage, to_stage, reason, created_by)
  values (p_application_id, 'undo', v_app.stage, v_event.from_stage, nullif(trim(p_reason), ''), v_me);
end;
$$;

-- ---------------------------------------------------------------------------
-- Onboarding actions (RPCs, HR): the only way an onboarding changes
-- ---------------------------------------------------------------------------

-- Tick a task off, or untick it, while the onboarding is in progress.
create function public.onboarding_task_set(p_task_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_status public.onboarding_status;
begin
  if not public.is_hr() then
    raise exception 'Only HR can update an onboarding.' using errcode = '42501';
  end if;
  select o.status into v_status
    from public.onboarding_tasks t join public.onboardings o on o.id = t.onboarding_id
   where t.id = p_task_id for update of o;
  if not found then
    raise exception 'Task not found.' using errcode = 'P0002';
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

-- Mark an onboarding complete, whatever is still unticked.
create function public.onboarding_complete(p_onboarding_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_status public.onboarding_status;
begin
  if not public.is_hr() then
    raise exception 'Only HR can complete an onboarding.' using errcode = '42501';
  end if;
  select status into v_status from public.onboardings where id = p_onboarding_id for update;
  if not found then
    raise exception 'Onboarding not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'in_progress' then
    raise exception 'This onboarding is already %.', v_status;
  end if;
  update public.onboardings
     set status = 'completed', completed_by = public.current_employee_id(), completed_at = now()
   where id = p_onboarding_id;
end;
$$;

create function public.onboarding_cancel(p_onboarding_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_status public.onboarding_status;
begin
  if not public.is_hr() then
    raise exception 'Only HR can cancel an onboarding.' using errcode = '42501';
  end if;
  select status into v_status from public.onboardings where id = p_onboarding_id for update;
  if not found then
    raise exception 'Onboarding not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'in_progress' then
    raise exception 'This onboarding is already %.', v_status;
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Give a reason for cancelling this onboarding.' using errcode = '23514';
  end if;
  update public.onboardings
     set status = 'cancelled', cancelled_by = public.current_employee_id(), cancelled_at = now(),
         cancel_reason = trim(p_reason)
   where id = p_onboarding_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on public.onboarding_template_sections, public.onboarding_template_tasks,
              public.onboardings, public.onboarding_tasks
  from anon, authenticated;

-- sort_order is set by the trigger and the reorder functions only.
grant select, delete on public.onboarding_template_sections, public.onboarding_template_tasks
  to authenticated;
grant insert (name), update (name) on public.onboarding_template_sections to authenticated;
grant insert (section_id, title), update (title) on public.onboarding_template_tasks to authenticated;
-- Onboardings change only through the functions above.
grant select on public.onboardings, public.onboarding_tasks to authenticated;

revoke execute on function
  public.onboarding_template_sections_stamp(), public.onboarding_template_tasks_stamp(),
  public.onboarding_reorder_sections(uuid[]), public.onboarding_reorder_tasks(uuid, uuid[]),
  public.application_hire(uuid, text, date, text), public.onboarding_task_set(uuid, boolean),
  public.onboarding_complete(uuid), public.onboarding_cancel(uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.onboarding_reorder_sections(uuid[]), public.onboarding_reorder_tasks(uuid, uuid[]),
  public.application_hire(uuid, text, date, text), public.onboarding_task_set(uuid, boolean),
  public.onboarding_complete(uuid), public.onboarding_cancel(uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.onboarding_template_sections enable row level security;
alter table public.onboarding_template_tasks enable row level security;
alter table public.onboardings enable row level security;
alter table public.onboarding_tasks enable row level security;

-- The checklist: HR reads it, company admins change it.
create policy onboarding_template_sections_select on public.onboarding_template_sections
  for select to authenticated using ((select public.is_hr()));
create policy onboarding_template_sections_insert on public.onboarding_template_sections
  for insert to authenticated with check ((select public.is_company_admin()));
create policy onboarding_template_sections_update on public.onboarding_template_sections
  for update to authenticated
  using ((select public.is_company_admin())) with check ((select public.is_company_admin()));
create policy onboarding_template_sections_delete on public.onboarding_template_sections
  for delete to authenticated using ((select public.is_company_admin()));

create policy onboarding_template_tasks_select on public.onboarding_template_tasks
  for select to authenticated using ((select public.is_hr()));
create policy onboarding_template_tasks_insert on public.onboarding_template_tasks
  for insert to authenticated with check ((select public.is_company_admin()));
create policy onboarding_template_tasks_update on public.onboarding_template_tasks
  for update to authenticated
  using ((select public.is_company_admin())) with check ((select public.is_company_admin()));
create policy onboarding_template_tasks_delete on public.onboarding_template_tasks
  for delete to authenticated using ((select public.is_company_admin()));

-- Onboardings and their tasks: HR only.
create policy onboardings_select on public.onboardings
  for select to authenticated using ((select public.is_hr()));
create policy onboarding_tasks_select on public.onboarding_tasks
  for select to authenticated using ((select public.is_hr()));
