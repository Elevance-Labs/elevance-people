-- ---------------------------------------------------------------------------
-- Offboarding: the checklist company admins keep (sections of tasks, in their
-- order, like onboarding's), and an offboarding per departure with its own
-- copy of it.
--
-- An offboarding starts by itself when an employee's status becomes notice
-- period, and is cancelled by itself if they go back to working. HR and the
-- employee's org-chart manager tick tasks off. Once every task is ticked, the
-- reason and last working day are set and that day has come, HR and the
-- manager each sign off (HR alone if there's no manager); the last sign-off
-- completes it and marks the employee as left (or terminated) from their last
-- working day. Unticking a task, or changing the reason or last day, clears
-- the sign-offs given. Nobody works on their own offboarding.
--
-- Seeds a starter checklist, and starts an offboarding for everyone already
-- on notice.
-- ---------------------------------------------------------------------------

create type public.offboarding_status as enum ('in_progress', 'completed', 'cancelled');
create type public.offboarding_reason as enum ('resigned', 'terminated', 'contract_ended', 'other');

create table public.offboarding_template_sections (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (name = trim(name) and name <> '' and length(name) <= 200),
  -- Set on insert (last), changed only by offboarding_reorder_sections.
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index offboarding_template_sections_name_key on public.offboarding_template_sections (lower(name));

create table public.offboarding_template_tasks (
  id         uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.offboarding_template_sections (id) on delete cascade,
  title      text not null check (title = trim(title) and title <> '' and length(title) <= 500),
  -- Within the section. Set on insert (last), changed only by offboarding_reorder_tasks.
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index offboarding_template_tasks_section_idx on public.offboarding_template_tasks (section_id, sort_order);

-- Offboardings: written only by employees_offboarding and the offboarding
-- functions. At most one in progress per employee; closed ones are kept.
create table public.offboardings (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null,
  status            public.offboarding_status not null default 'in_progress',
  -- Set by HR; both are needed before anyone signs off.
  reason            public.offboarding_reason,
  last_working_day  date,
  -- Whoever put the employee on notice.
  started_by        uuid references public.employees (id) on delete set null,
  started_at        timestamptz not null default now(),
  hr_signed_by      uuid references public.employees (id) on delete set null,
  hr_signed_at      timestamptz,
  manager_signed_by uuid references public.employees (id) on delete set null,
  manager_signed_at timestamptz,
  completed_at      timestamptz,
  cancelled_by      uuid references public.employees (id) on delete set null,
  cancelled_at      timestamptz,
  cancel_reason     text check (length(cancel_reason) <= 2000),
  -- Named: offboardings references employees several times.
  constraint offboardings_employee_id_fkey foreign key (employee_id)
    references public.employees (id) on delete cascade,
  constraint offboardings_cancel_needs_reason check (status <> 'cancelled' or cancel_reason is not null),
  constraint offboardings_complete_needs_details
    check (status <> 'completed' or (reason is not null and last_working_day is not null))
);
create unique index offboardings_one_open_key on public.offboardings (employee_id) where status = 'in_progress';
create index offboardings_employee_idx on public.offboardings (employee_id);

-- The checklist as it was when the offboarding started.
create table public.offboarding_tasks (
  id             uuid primary key default gen_random_uuid(),
  offboarding_id uuid not null references public.offboardings (id) on delete cascade,
  section        text not null,
  section_order  integer not null,
  title          text not null,
  sort_order     integer not null,
  done_by        uuid references public.employees (id) on delete set null,
  done_at        timestamptz
);
create index offboarding_tasks_offboarding_idx
  on public.offboarding_tasks (offboarding_id, section_order, sort_order);

-- A new checklist section or task goes last.
create function public.offboarding_template_sections_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select coalesce(max(s.sort_order) + 1, 0) into new.sort_order
      from public.offboarding_template_sections s;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger offboarding_template_sections_stamp
  before insert or update on public.offboarding_template_sections
  for each row execute function public.offboarding_template_sections_stamp();

create function public.offboarding_template_tasks_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select coalesce(max(t.sort_order) + 1, 0) into new.sort_order
      from public.offboarding_template_tasks t where t.section_id = new.section_id;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger offboarding_template_tasks_stamp
  before insert or update on public.offboarding_template_tasks
  for each row execute function public.offboarding_template_tasks_stamp();

-- ---------------------------------------------------------------------------
-- Offboarding actions. The checklist's order changes only through the
-- reorder functions (company admins); an offboarding only through the rest.
-- ---------------------------------------------------------------------------

-- HR, or the employee's manager in the org chart — never the employee.
create function public.can_work_offboarding(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_employee_id is distinct from public.current_employee_id()
     and (public.is_hr() or public.is_manager_of(p_employee_id));
$$;

-- Starts an offboarding, with a copy of the checklist, when someone is put on
-- notice; cancels the one under way if they go back to working.
create function public.employees_offboarding()
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

    insert into public.offboarding_tasks (offboarding_id, section, section_order, title, sort_order)
    select v_offboarding, s.name, s.sort_order, t.title, t.sort_order
      from public.offboarding_template_sections s
      join public.offboarding_template_tasks t on t.section_id = s.id;
  elsif tg_op = 'UPDATE' and old.status = 'notice_period' and public.is_login_status(new.status) then
    update public.offboardings
       set status = 'cancelled', cancelled_by = public.current_employee_id(), cancelled_at = now(),
           cancel_reason = 'Back to ' || replace(new.status::text, '_', ' ') || ' from notice period.'
     where employee_id = new.id and status = 'in_progress';
  end if;
  return null;
end;
$$;

create trigger employees_offboarding
  after insert or update of status on public.employees
  for each row execute function public.employees_offboarding();

-- Each reorder takes every id, in the new order, so a stale list is refused
-- rather than half applied.
create function public.offboarding_reorder_sections(p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_company_admin() then
    raise exception 'Only a company admin can change the offboarding checklist.' using errcode = '42501';
  end if;
  if cardinality(p_ids) is distinct from (select count(*) from public.offboarding_template_sections)::integer
     or exists (select 1 from public.offboarding_template_sections s where s.id <> all (p_ids)) then
    raise exception 'The checklist has changed. Reload and try again.';
  end if;
  update public.offboarding_template_sections s set sort_order = o.n - 1
    from unnest(p_ids) with ordinality as o(id, n)
   where s.id = o.id;
end;
$$;

create function public.offboarding_reorder_tasks(p_section_id uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_company_admin() then
    raise exception 'Only a company admin can change the offboarding checklist.' using errcode = '42501';
  end if;
  if cardinality(p_ids) is distinct from
       (select count(*) from public.offboarding_template_tasks t where t.section_id = p_section_id)::integer
     or exists (select 1 from public.offboarding_template_tasks t
                 where t.section_id = p_section_id and t.id <> all (p_ids)) then
    raise exception 'The checklist has changed. Reload and try again.';
  end if;
  update public.offboarding_template_tasks t set sort_order = o.n - 1
    from unnest(p_ids) with ordinality as o(id, n)
   where t.id = o.id and t.section_id = p_section_id;
end;
$$;

-- HR sets why the employee is leaving and their last working day. Changing
-- either clears the sign-offs given.
create function public.offboarding_set_details(
  p_offboarding_id uuid, p_reason public.offboarding_reason, p_last_working_day date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_offboarding public.offboardings;
begin
  select * into v_offboarding from public.offboardings where id = p_offboarding_id for update;
  if not found or not public.can_work_offboarding(v_offboarding.employee_id) then
    raise exception 'Offboarding not found.' using errcode = 'P0002';
  end if;
  if not public.is_hr() then
    raise exception 'Only HR can change the reason and last working day.' using errcode = '42501';
  end if;
  if v_offboarding.status <> 'in_progress' then
    raise exception 'This offboarding is already %.', v_offboarding.status;
  end if;
  if (p_reason, p_last_working_day)
     is distinct from (v_offboarding.reason, v_offboarding.last_working_day) then
    update public.offboardings
       set reason = p_reason, last_working_day = p_last_working_day,
           hr_signed_by = null, hr_signed_at = null, manager_signed_by = null, manager_signed_at = null
     where id = p_offboarding_id;
  end if;
end;
$$;

-- Tick a task off, or untick it, while the offboarding is in progress.
-- Unticking clears the sign-offs given.
create function public.offboarding_task_set(p_task_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_offboarding public.offboardings;
begin
  select o.* into v_offboarding
    from public.offboarding_tasks t join public.offboardings o on o.id = t.offboarding_id
   where t.id = p_task_id for update of o;
  if not found or not public.can_work_offboarding(v_offboarding.employee_id) then
    raise exception 'Task not found.' using errcode = 'P0002';
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

-- HR and the manager sign off, as whichever they are (both, for a manager
-- who is HR). The manager is resolved now, from the org chart; with none, HR
-- alone. The last sign-off completes the offboarding and marks the employee
-- as left, or terminated, from their last working day.
create function public.offboarding_sign_off(p_offboarding_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me          uuid := public.current_employee_id();
  v_offboarding public.offboardings;
  v_manager     uuid;
  v_as_hr       boolean;
  v_as_manager  boolean;
begin
  select * into v_offboarding from public.offboardings where id = p_offboarding_id for update;
  if not found or not public.can_work_offboarding(v_offboarding.employee_id) then
    raise exception 'Offboarding not found.' using errcode = 'P0002';
  end if;
  if v_offboarding.status <> 'in_progress' then
    raise exception 'This offboarding is already %.', v_offboarding.status;
  end if;
  if v_offboarding.reason is null or v_offboarding.last_working_day is null then
    raise exception 'HR has to set the reason and last working day first.';
  end if;
  if exists (select 1 from public.offboarding_tasks t
              where t.offboarding_id = p_offboarding_id and t.done_at is null) then
    raise exception 'Every task has to be ticked off first.';
  end if;
  if v_offboarding.last_working_day > public.company_today() then
    raise exception 'Sign-off opens on the last working day, %.', to_char(v_offboarding.last_working_day, 'DD Mon YYYY');
  end if;

  select n.manager_id into v_manager
    from public.org_chart_nodes n where n.employee_id = v_offboarding.employee_id;
  v_as_hr := public.is_hr() and v_offboarding.hr_signed_by is null;
  v_as_manager := v_manager is not distinct from v_me and v_offboarding.manager_signed_by is null;
  if not v_as_hr and not v_as_manager then
    raise exception 'You have already signed off.';
  end if;

  update public.offboardings
     set hr_signed_by = case when v_as_hr then v_me else hr_signed_by end,
         hr_signed_at = case when v_as_hr then now() else hr_signed_at end,
         manager_signed_by = case when v_as_manager then v_me else manager_signed_by end,
         manager_signed_at = case when v_as_manager then now() else manager_signed_at end
   where id = p_offboarding_id
  returning * into v_offboarding;

  if v_offboarding.hr_signed_by is not null
     and (v_offboarding.manager_signed_by is not null or v_manager is null) then
    update public.offboardings set status = 'completed', completed_at = now() where id = p_offboarding_id;
    update public.employees
       set status = case when v_offboarding.reason = 'terminated' then 'terminated' else 'left' end::public.employee_status,
           date_of_separation = v_offboarding.last_working_day
     where id = v_offboarding.employee_id;
  end if;
end;
$$;

-- HR closes an offboarding that won't go ahead. The employee's status stays
-- as it is.
create function public.offboarding_cancel(p_offboarding_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_offboarding public.offboardings;
begin
  select * into v_offboarding from public.offboardings where id = p_offboarding_id for update;
  if not found or not public.can_work_offboarding(v_offboarding.employee_id) then
    raise exception 'Offboarding not found.' using errcode = 'P0002';
  end if;
  if not public.is_hr() then
    raise exception 'Only HR can cancel an offboarding.' using errcode = '42501';
  end if;
  if v_offboarding.status <> 'in_progress' then
    raise exception 'This offboarding is already %.', v_offboarding.status;
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Give a reason for cancelling this offboarding.' using errcode = '23514';
  end if;
  update public.offboardings
     set status = 'cancelled', cancelled_by = public.current_employee_id(), cancelled_at = now(),
         cancel_reason = trim(p_reason)
   where id = p_offboarding_id;
end;
$$;

revoke all on public.offboarding_template_sections, public.offboarding_template_tasks,
              public.offboardings, public.offboarding_tasks
  from anon, authenticated;

-- sort_order is set by the trigger and the reorder functions only.
grant select, delete on public.offboarding_template_sections, public.offboarding_template_tasks
  to authenticated;
grant insert (name), update (name) on public.offboarding_template_sections to authenticated;
grant insert (section_id, title), update (title) on public.offboarding_template_tasks to authenticated;
-- Offboardings change only through employees_offboarding and the offboarding functions.
grant select on public.offboardings, public.offboarding_tasks to authenticated;

revoke execute on function
  public.offboarding_template_sections_stamp(), public.offboarding_template_tasks_stamp(),
  public.can_work_offboarding(uuid), public.employees_offboarding(),
  public.offboarding_reorder_sections(uuid[]), public.offboarding_reorder_tasks(uuid, uuid[]),
  public.offboarding_set_details(uuid, public.offboarding_reason, date),
  public.offboarding_task_set(uuid, boolean), public.offboarding_sign_off(uuid),
  public.offboarding_cancel(uuid, text)
  from public, anon, authenticated;

grant execute on function
  public.can_work_offboarding(uuid),
  public.offboarding_reorder_sections(uuid[]), public.offboarding_reorder_tasks(uuid, uuid[]),
  public.offboarding_set_details(uuid, public.offboarding_reason, date),
  public.offboarding_task_set(uuid, boolean), public.offboarding_sign_off(uuid),
  public.offboarding_cancel(uuid, text)
  to authenticated;

alter table public.offboarding_template_sections enable row level security;
alter table public.offboarding_template_tasks enable row level security;
alter table public.offboardings enable row level security;
alter table public.offboarding_tasks enable row level security;

-- The checklist: HR reads it, company admins change it.
create policy offboarding_template_sections_select on public.offboarding_template_sections
  for select to authenticated using ((select public.is_hr()));
create policy offboarding_template_sections_insert on public.offboarding_template_sections
  for insert to authenticated with check ((select public.is_company_admin()));
create policy offboarding_template_sections_update on public.offboarding_template_sections
  for update to authenticated
  using ((select public.is_company_admin())) with check ((select public.is_company_admin()));
create policy offboarding_template_sections_delete on public.offboarding_template_sections
  for delete to authenticated using ((select public.is_company_admin()));

create policy offboarding_template_tasks_select on public.offboarding_template_tasks
  for select to authenticated using ((select public.is_hr()));
create policy offboarding_template_tasks_insert on public.offboarding_template_tasks
  for insert to authenticated with check ((select public.is_company_admin()));
create policy offboarding_template_tasks_update on public.offboarding_template_tasks
  for update to authenticated
  using ((select public.is_company_admin())) with check ((select public.is_company_admin()));
create policy offboarding_template_tasks_delete on public.offboarding_template_tasks
  for delete to authenticated using ((select public.is_company_admin()));

-- Offboardings and their tasks: HR and the employee's manager, not the employee.
create policy offboardings_select on public.offboardings
  for select to authenticated using (public.can_work_offboarding(employee_id));
create policy offboarding_tasks_select on public.offboarding_tasks
  for select to authenticated
  using (exists (select 1 from public.offboardings o
                  where o.id = offboarding_id and public.can_work_offboarding(o.employee_id)));

-- ---------------------------------------------------------------------------
-- Data: a starter checklist (company admins change it under Configuration →
-- Offboarding), then an offboarding for everyone already on notice.
-- ---------------------------------------------------------------------------
with sections (name, n) as (
  values ('Handover', 0), ('Equipment and access', 1), ('Final settlement', 2), ('Exit', 3)
), inserted as (
  insert into public.offboarding_template_sections (name)
  select name from sections order by n
  returning id, name
)
insert into public.offboarding_template_tasks (section_id, title)
select i.id, t.title
  from inserted i
  join (values
    ('Handover', 1, 'Agree a handover plan with their manager'),
    ('Handover', 2, 'Hand over open work, documents and accounts they own'),
    ('Equipment and access', 1, 'Collect their company equipment'),
    ('Equipment and access', 2, 'Remove access to Google Workspace and other tools'),
    ('Final settlement', 1, 'Settle their leave balance'),
    ('Final settlement', 2, 'Clear advances and loans'),
    ('Final settlement', 3, 'Add the final settlement to payroll'),
    ('Exit', 1, 'Hold an exit interview'),
    ('Exit', 2, 'Issue an experience letter')
  ) as t (section, n, title) on t.section = i.name
 order by t.n;

insert into public.offboardings (employee_id, last_working_day)
select e.id, e.date_of_separation from public.employees e where e.status = 'notice_period';

insert into public.offboarding_tasks (offboarding_id, section, section_order, title, sort_order)
select o.id, s.name, s.sort_order, t.title, t.sort_order
  from public.offboardings o
  cross join public.offboarding_template_sections s
  join public.offboarding_template_tasks t on t.section_id = s.id;
