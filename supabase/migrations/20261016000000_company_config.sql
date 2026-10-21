-- Company configuration: departments, designations (each in a department) and
-- KPIs (each for a designation). Employees link to a department and
-- designation instead of holding free text. Only company admins manage these;
-- every logged-in employee can read them.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (name = trim(name) and name <> ''),
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index departments_name_key on public.departments (lower(name));

-- Deleting a department deletes its designations (and their KPIs), but is
-- refused while any employee is still linked to it.
create table public.designations (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  title         text not null check (title = trim(title) and title <> ''),
  description   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint designations_department_id_fkey foreign key (department_id)
    references public.departments (id) on delete cascade,
  -- Target of employees (designation_id, department_id), which keeps an
  -- employee's designation inside their department.
  constraint designations_id_department_key unique (id, department_id)
);
create unique index designations_title_key on public.designations (department_id, lower(title));

create table public.kpis (
  id             uuid primary key default gen_random_uuid(),
  designation_id uuid not null,
  name           text not null check (name = trim(name) and name <> ''),
  description    text,
  target         text,
  -- Percentage share of the designation's KPIs. Optional; not forced to sum to 100.
  weight         numeric(5, 2) check (weight > 0 and weight <= 100),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint kpis_designation_id_fkey foreign key (designation_id)
    references public.designations (id) on delete cascade
);
create unique index kpis_name_key on public.kpis (designation_id, lower(name));

-- ---------------------------------------------------------------------------
-- Link employees, carrying over existing free-text values
-- ---------------------------------------------------------------------------
alter table public.employees
  add column department_id  uuid,
  add column designation_id uuid;

insert into public.departments (name)
select distinct on (lower(trim(department))) trim(department)
  from public.employees
 where nullif(trim(department), '') is not null
 order by lower(trim(department)), trim(department);

-- A designation needs a department; park department-less ones here.
insert into public.departments (name)
select 'Unassigned'
 where exists (select 1 from public.employees
                where nullif(trim(designation), '') is not null
                  and nullif(trim(department), '') is null)
on conflict do nothing;

update public.employees e
   set department_id = d.id
  from public.departments d
 where lower(d.name) = lower(coalesce(
         nullif(trim(e.department), ''),
         case when nullif(trim(e.designation), '') is not null then 'Unassigned' end));

insert into public.designations (department_id, title)
select distinct on (department_id, lower(trim(designation))) department_id, trim(designation)
  from public.employees
 where department_id is not null and nullif(trim(designation), '') is not null
 order by department_id, lower(trim(designation)), trim(designation);

update public.employees e
   set designation_id = g.id
  from public.designations g
 where g.department_id = e.department_id
   and lower(g.title) = lower(trim(e.designation));

alter table public.employees
  add constraint employees_department_id_fkey foreign key (department_id)
    references public.departments (id) on delete restrict,
  -- Moving a designation to another department moves its employees with it.
  add constraint employees_designation_fkey foreign key (designation_id, department_id)
    references public.designations (id, department_id) on update cascade on delete restrict,
  add constraint employees_designation_needs_department
    check (designation_id is null or department_id is not null);
create index employees_department_idx on public.employees (department_id);
create index employees_designation_idx on public.employees (designation_id, department_id);

-- The directory keeps its column names so the org chart is unaffected.
drop view public.employee_directory;
alter table public.employees drop column department, drop column designation;

create view public.employee_directory with (security_invoker = false) as
  select e.id, e.employee_number, e.full_name, e.company_email,
         g.title as designation, d.name as department, e.status
    from public.employees e
    left join public.departments d on d.id = e.department_id
    left join public.designations g on g.id = e.designation_id
   where (select public.current_employee_id()) is not null;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger departments_touch before update on public.departments
  for each row execute function public.touch_updated_at();
create trigger designations_touch before update on public.designations
  for each row execute function public.touch_updated_at();
create trigger kpis_touch before update on public.kpis
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on public.departments, public.designations, public.kpis, public.employee_directory
  from anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

grant select, delete on public.departments, public.designations, public.kpis to authenticated;
grant insert (name, description), update (name, description)
  on public.departments to authenticated;
grant insert (department_id, title, description), update (department_id, title, description)
  on public.designations to authenticated;
grant insert (designation_id, name, description, target, weight),
      update (designation_id, name, description, target, weight)
  on public.kpis to authenticated;

grant insert (department_id, designation_id), update (department_id, designation_id)
  on public.employees to authenticated;
grant select on public.employee_directory to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security: every employee reads, company admins write.
-- ---------------------------------------------------------------------------
alter table public.departments enable row level security;
alter table public.designations enable row level security;
alter table public.kpis enable row level security;

create policy departments_select on public.departments for select to authenticated
  using ((select public.current_employee_id()) is not null);
create policy departments_insert on public.departments for insert to authenticated
  with check ((select public.is_company_admin()));
create policy departments_update on public.departments for update to authenticated
  using ((select public.is_company_admin())) with check ((select public.is_company_admin()));
create policy departments_delete on public.departments for delete to authenticated
  using ((select public.is_company_admin()));

create policy designations_select on public.designations for select to authenticated
  using ((select public.current_employee_id()) is not null);
create policy designations_insert on public.designations for insert to authenticated
  with check ((select public.is_company_admin()));
create policy designations_update on public.designations for update to authenticated
  using ((select public.is_company_admin())) with check ((select public.is_company_admin()));
create policy designations_delete on public.designations for delete to authenticated
  using ((select public.is_company_admin()));

create policy kpis_select on public.kpis for select to authenticated
  using ((select public.current_employee_id()) is not null);
create policy kpis_insert on public.kpis for insert to authenticated
  with check ((select public.is_company_admin()));
create policy kpis_update on public.kpis for update to authenticated
  using ((select public.is_company_admin())) with check ((select public.is_company_admin()));
create policy kpis_delete on public.kpis for delete to authenticated
  using ((select public.is_company_admin()));
