-- ===========================================================================
-- Elevance People — complete database schema
--
-- The whole database as it stands after every file in supabase/migrations/:
-- types, tables, functions, triggers, privileges, row level security and the
-- storage bucket. Read this to know the database; read the migrations to know
-- how it got here.
--
-- Kept in step with the migrations: a change to the database is a new
-- migration AND the matching edit here, in the same commit. Only the end
-- state lives here — one-off data moves (backfills, renames) stay in their
-- migration.
--
-- Running it in the SQL editor of a fresh project gives the same database as
-- `supabase db push`. Use one or the other, not both: this file does not
-- record migration history, so a later `db push` would try to replay it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('company_admin', 'hr_admin', 'finance_admin', 'member');
create type public.employment_type as enum ('full_time', 'part_time', 'freelance', 'contract');
create type public.employee_status as enum
  ('joining', 'probation', 'active', 'notice_period', 'left', 'terminated');
-- How a person signs in: their @elevancelabs.com Google account, or (for
-- someone without one) an outside address with email and password.
create type public.login_method as enum ('google', 'password');
create type public.leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.job_opening_status as enum ('draft', 'open', 'on_hold', 'closed');
create type public.application_stage as enum (
  'new', 'screened', 'shortlisted', 'test', 'interview_1', 'interview_2', 'interview_3',
  'cleared', 'shelf', 'offer_sent', 'hired', 'rejected', 'abandoned', 'declined');
create type public.onboarding_status as enum ('in_progress', 'completed', 'cancelled');
create type public.offboarding_status as enum ('in_progress', 'completed', 'cancelled');
create type public.offboarding_reason as enum ('resigned', 'terminated', 'contract_ended', 'other');
create type public.payroll_status as enum ('draft', 'review', 'approved', 'processed', 'disbursed');
create type public.salary_revision_status as enum ('draft', 'review', 'approved');
create type public.equipment_status as enum ('requested', 'active', 'faulty', 'retired', 'sold');
create type public.review_status as enum ('draft', 'submitted');
create type public.feedback_kind as enum ('appreciation', 'improvement', 'general');
create type public.peer_cycle_status as enum ('draft', 'open', 'closed');
-- What a department does for the company; groups the Resources page's guides.
create type public.business_function as enum ('production', 'growth', 'operations');

-- ---------------------------------------------------------------------------
-- Company configuration: departments, designations (each in a department),
-- and KPIs and expectations (each for a designation). Every logged-in
-- employee reads them; only company admins write.
-- ---------------------------------------------------------------------------
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (name = trim(name) and name <> ''),
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Null only for departments made before functions existed; the app asks
  -- for one on every save.
  business_function public.business_function
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
  -- Named explicitly: the app embeds departments through this exact FK
  -- (src/lib/company.ts), because employees also references departments.
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

-- Short statements of what the designation is expected to do; each is marked
-- met or not in a monthly review.
create table public.expectations (
  id             uuid primary key default gen_random_uuid(),
  designation_id uuid not null,
  title          text not null check (title = trim(title) and title <> '' and length(title) <= 300),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint expectations_designation_id_fkey foreign key (designation_id)
    references public.designations (id) on delete cascade
);
create unique index expectations_title_key on public.expectations (designation_id, lower(title));

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- The employee record is also the login: a Google user (or, for a password
-- login, an email user) is bound to the row with the same company_email and
-- login_method (see bind_employee). Column order matches the
-- migrated database (department_id / designation_id were added last).
create table public.employees (
  id                 uuid primary key default gen_random_uuid(),
  -- From a sequence: never repeats, but a failed insert can skip a number.
  employee_number    integer generated always as identity unique,
  user_id            uuid unique references auth.users (id) on delete set null,
  full_name          text not null check (length(trim(full_name)) > 0),
  company_email      text not null unique,
  date_of_joining    date not null,
  date_of_separation date,
  personal_email     text,
  phone              text,
  cnic_number        text,
  cnic_expiry        date,
  dob                date,
  bank               text,
  iban               text,
  emergency_contact  text,
  employment_type    public.employment_type not null default 'full_time',
  status             public.employee_status not null default 'joining',
  app_role           public.app_role not null default 'member',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  department_id      uuid,
  designation_id     uuid,
  login_method       public.login_method not null default 'google',
  -- Company addresses always sign in with Google; anything else only by password.
  constraint employees_company_email_check
    check (company_email = lower(company_email)
           and case login_method
                 when 'google' then company_email like '%@elevancelabs.com'
                 else company_email like '_%@_%._%' and company_email not like '%@elevancelabs.com'
               end),
  constraint employees_department_id_fkey foreign key (department_id)
    references public.departments (id) on delete restrict,
  -- Moving a designation to another department moves its employees with it.
  constraint employees_designation_fkey foreign key (designation_id, department_id)
    references public.designations (id, department_id) on update cascade on delete restrict,
  constraint employees_designation_needs_department
    check (designation_id is null or department_id is not null)
);
create index employees_department_idx on public.employees (department_id);
create index employees_designation_idx on public.employees (designation_id, department_id);

create table public.employee_documents (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (id) on delete cascade,
  doc_type     text not null,
  file_name    text not null,
  storage_path text not null unique,
  mime_type    text not null,
  size_bytes   bigint not null,
  uploaded_by  uuid references public.employees (id) on delete set null,
  created_at   timestamptz not null default now(),
  -- Soft delete only: hidden in the app, file and row are kept. Neither goes
  -- until the employee is deleted.
  deleted_at   timestamptz,
  deleted_by   uuid references public.employees (id) on delete set null
);
create index employee_documents_employee_idx on public.employee_documents (employee_id);

-- One row per person placed in the chart. manager_id null = top level.
create table public.org_chart_nodes (
  employee_id uuid primary key references public.employees (id) on delete cascade,
  manager_id  uuid references public.org_chart_nodes (employee_id) on delete set null,
  updated_at  timestamptz not null default now(),
  check (manager_id is distinct from employee_id)
);
create index org_chart_nodes_manager_idx on public.org_chart_nodes (manager_id);

-- ---------------------------------------------------------------------------
-- Leaves: types with a default yearly quota, per-employee quota overrides,
-- and the leaves themselves. Granted once HR and the employee's org chart
-- manager have both approved (HR alone when there is no manager).
-- ---------------------------------------------------------------------------
create table public.leave_types (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (name = trim(name) and name <> ''),
  description  text,
  -- Default days per calendar year, in half days. Null = no limit (e.g. unpaid).
  annual_quota numeric(4, 1) check (annual_quota >= 0 and annual_quota % 0.5 = 0),
  -- Inactive types can't be applied for; their leaves are kept.
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index leave_types_name_key on public.leave_types (lower(name));

-- One employee's quota for a type and year, replacing the type's default.
create table public.leave_quotas (
  employee_id   uuid not null references public.employees (id) on delete cascade,
  leave_type_id uuid not null references public.leave_types (id) on delete cascade,
  year          integer not null check (year between 2000 and 2999),
  days          numeric(4, 1) not null check (days >= 0 and days % 0.5 = 0),
  updated_at    timestamptz not null default now(),
  primary key (employee_id, leave_type_id, year)
);
create index leave_quotas_type_idx on public.leave_quotas (leave_type_id);

-- The company's public holidays: a name and a date range within one year.
-- HR keeps them; everyone reads them. A leave doesn't count them.
create table public.holidays (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (name = trim(name) and name <> '' and length(name) <= 100),
  start_date date not null,
  end_date   date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint holidays_dates_check check (end_date >= start_date),
  -- A holiday belongs to the year it falls in, so it can't span two.
  constraint holidays_one_year_check
    check (extract(year from start_date) = extract(year from end_date))
);
-- One holiday of a name per year.
create unique index holidays_name_key
  on public.holidays ((extract(year from start_date)), lower(name));
create index holidays_dates_idx on public.holidays (start_date, end_date);

-- Working days a leave takes: Monday–Friday between the dates that aren't a
-- holiday, halved for a half day. Mirrored in src/lib/leaves.ts for the form
-- preview.
create function public.leave_days(p_start date, p_end date, p_half_day boolean)
returns numeric language sql stable set search_path = '' as $$
  select count(*) * case when p_half_day then 0.5 else 1 end
    from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') as d
   where extract(isodow from d) < 6
     and not exists (select 1 from public.holidays h
                      where d::date between h.start_date and h.end_date);
$$;

-- A type in use can't be deleted (deactivate it instead).
create table public.leaves (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.employees (id) on delete cascade,
  leave_type_id       uuid not null references public.leave_types (id) on delete restrict,
  start_date          date not null,
  end_date            date not null,
  half_day            boolean not null default false,
  -- Working days (leave_days), set by leaves_guard on every write and
  -- recounted when a holiday over the dates changes.
  days                numeric(4, 1) not null,
  reason              text,
  status              public.leave_status not null default 'pending',
  -- The employee themself, or the HR person who recorded it.
  created_by          uuid references public.employees (id) on delete set null,
  hr_approved_by      uuid references public.employees (id) on delete set null,
  hr_approved_at      timestamptz,
  manager_approved_by uuid references public.employees (id) on delete set null,
  manager_approved_at timestamptz,
  rejected_by         uuid references public.employees (id) on delete set null,
  rejected_at         timestamptz,
  rejection_reason    text,
  cancelled_by        uuid references public.employees (id) on delete set null,
  cancelled_at        timestamptz,
  -- Last HR change to the dates.
  edited_by           uuid references public.employees (id) on delete set null,
  edited_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint leaves_dates_check check (end_date >= start_date),
  -- A leave counts against the year it falls in, so it can't span two.
  constraint leaves_one_year_check
    check (extract(year from start_date) = extract(year from end_date)),
  constraint leaves_half_day_check check (not half_day or start_date = end_date)
);
create index leaves_employee_idx on public.leaves (employee_id, start_date);
create index leaves_type_idx on public.leaves (leave_type_id);

-- ---------------------------------------------------------------------------
-- Hiring: job openings (HR), their interviewers, and the applications people
-- send from an open job's public page. The public page reaches none of these
-- tables directly; it goes through job_posting and submit_application.
-- ---------------------------------------------------------------------------

-- Only an open job is shown publicly, and it takes applications until its
-- due date. Deleting one is refused while it has applications (close it).
create table public.job_openings (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (title = trim(title) and title <> ''),
  department_id  uuid not null,
  designation_id uuid not null,
  status         public.job_opening_status not null default 'draft',
  -- Last day applications are accepted. Null = until the job is closed.
  due_date       date,
  -- HTML from the app's editor, sanitised before it's saved and again
  -- wherever it's shown.
  description    text,
  manager_id     uuid,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint job_openings_department_id_fkey foreign key (department_id)
    references public.departments (id) on delete restrict,
  -- Keeps the designation inside the department, as for employees.
  constraint job_openings_designation_fkey foreign key (designation_id, department_id)
    references public.designations (id, department_id) on update cascade on delete restrict,
  constraint job_openings_manager_id_fkey foreign key (manager_id)
    references public.employees (id) on delete set null,
  constraint job_openings_created_by_fkey foreign key (created_by)
    references public.employees (id) on delete set null
);
create index job_openings_department_idx on public.job_openings (department_id);
create index job_openings_designation_idx on public.job_openings (designation_id, department_id);
create index job_openings_manager_idx on public.job_openings (manager_id);

create table public.job_opening_interviewers (
  job_opening_id uuid not null references public.job_openings (id) on delete cascade,
  employee_id    uuid not null references public.employees (id) on delete cascade,
  primary key (job_opening_id, employee_id)
);
create index job_opening_interviewers_employee_idx on public.job_opening_interviewers (employee_id);

-- One per person per job (by email). Written only by submit_application.
create table public.job_applications (
  id             uuid primary key default gen_random_uuid(),
  job_opening_id uuid not null references public.job_openings (id) on delete restrict,
  full_name      text not null
                 check (full_name = trim(full_name) and full_name <> '' and length(full_name) <= 200),
  email          text not null
                 check (email = lower(trim(email)) and length(email) <= 320
                        and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone          text not null check (phone = trim(phone) and phone <> '' and length(phone) <= 50),
  note           text check (length(note) <= 5000),
  -- PDF in the job-applications bucket at <job_opening_id>/<uuid>.pdf.
  resume_path    text not null unique,
  resume_name    text not null check (length(resume_name) <= 255),
  created_at     timestamptz not null default now(),
  -- Monthly, in PKR. Required by submit_application; null only on
  -- applications sent before it was asked for.
  expected_salary integer check (expected_salary >= 0),
  -- Changed only by application_move / application_undo.
  stage            public.application_stage not null default 'new',
  stage_changed_at timestamptz not null default now(),
  -- HR's: monthly, in PKR, and their notes. Set only by
  -- application_set_hr_details; hidden like expected_salary.
  current_salary integer check (current_salary >= 0),
  hr_notes       text check (length(hr_notes) <= 5000)
);
create unique index job_applications_email_key on public.job_applications (job_opening_id, email);
create index job_applications_job_stage_idx on public.job_applications (job_opening_id, stage);

-- An application's moves between stages, written only by application_move and
-- application_undo. An undone move keeps its row, marked undone.
create table public.application_stage_events (
  id             bigint generated always as identity primary key,
  application_id uuid not null references public.job_applications (id) on delete cascade,
  kind           text not null check (kind in ('move', 'undo')),
  from_stage     public.application_stage not null,
  to_stage       public.application_stage not null,
  reason         text check (length(reason) <= 2000),
  created_by     uuid references public.employees (id) on delete set null,
  created_at     timestamptz not null default now(),
  undone_by      uuid references public.employees (id) on delete set null,
  undone_at      timestamptz
);
create index application_stage_events_application_idx
  on public.application_stage_events (application_id, id);

-- ---------------------------------------------------------------------------
-- Branding: logo, primary colour, perks and benefits. Exactly one row; every
-- employee reads it, company admins change it, and the public job page gets
-- it through public_branding.
-- ---------------------------------------------------------------------------

-- Perks are [{ "title": "…", "description": "…" | null }, …] in display order.
create function public.valid_perks(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 30 then false
         else not exists (
           select 1 from jsonb_array_elements(p) e
            where jsonb_typeof(e) <> 'object'
               or jsonb_typeof(e -> 'title') is distinct from 'string'
               or trim(e ->> 'title') = '' or length(e ->> 'title') > 120
               or jsonb_typeof(coalesce(e -> 'description', 'null')) not in ('string', 'null')
               or length(e ->> 'description') > 1000)
         end;
$$;

create table public.branding (
  id            boolean primary key default true check (id),
  -- Object in the public branding bucket. Null = the app's default mark.
  logo_path     text,
  primary_color text not null default '#3f51b5' check (primary_color ~ '^#[0-9a-f]{6}$'),
  perks         jsonb not null default '[]' check (public.valid_perks(perks)),
  updated_at    timestamptz not null default now()
);
insert into public.branding default values;

-- ---------------------------------------------------------------------------
-- Announcements: a rich-text body, nothing else. HR writes them, everyone
-- reads them; while one is pinned it leads every employee's dashboard.
-- ---------------------------------------------------------------------------

-- The body is HTML from the app's editor, sanitised before it's saved and
-- again wherever it's shown.
create table public.announcements (
  id           uuid primary key default gen_random_uuid(),
  body         text not null check (btrim(body) <> '' and length(body) <= 20000),
  -- On dashboards through this date. Null = not pinned.
  pinned_until date,
  created_by   uuid references public.employees (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Guides: the per-function docs on the Resources page. An employee reads only
-- those of their own department's business function; company admins read all.
-- Kept from the Supabase dashboard; the app only reads them.
-- ---------------------------------------------------------------------------
create table public.guides (
  id                uuid primary key default gen_random_uuid(),
  -- Its address on the Resources page: /resources/guides/<slug>.
  slug              text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title             text not null check (title = trim(title) and title <> ''),
  description       text,
  business_function public.business_function not null,
  -- A Google Docs, Sheets or Slides link. Null = coming soon.
  doc_url           text check (doc_url ~ '^https://docs\.google\.com/'),
  -- Order within the function.
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Onboarding: the checklist company admins keep (sections of tasks, in their
-- order), and one onboarding per hire, with its own copy of the checklist.
-- HR ticks tasks off, then completes or cancels it.
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

-- Onboardings: written only by application_hire and the onboarding functions.
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
-- Offboarding: the checklist company admins keep (like onboarding's), and an
-- offboarding per departure with its own copy of it. Started when an employee
-- is put on notice; HR and their manager tick tasks off and sign off, and the
-- last sign-off marks them as left.
-- ---------------------------------------------------------------------------
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


-- ---------------------------------------------------------------------------
-- Payroll: one per month, with a line per employee. HR, finance and company
-- admins work on it. It moves draft → review → approved → processed →
-- disbursed through payroll_move, is never deleted, and its lines change only
-- while a draft. Employees see their payslips once it's disbursed.
-- ---------------------------------------------------------------------------

-- Written only by payroll_create and payroll_move.
create table public.payrolls (
  id           uuid primary key default gen_random_uuid(),
  year         integer not null check (year between 2000 and 2999),
  month        integer not null check (month between 1 and 12),
  status       public.payroll_status not null default 'draft',
  created_by   uuid references public.employees (id) on delete set null,
  created_at   timestamptz not null default now(),
  -- The last move to review, approved, processed and disbursed. Going back
  -- to draft clears the review and approval. Disbursed was added later, so
  -- its columns come last.
  submitted_by uuid references public.employees (id) on delete set null,
  submitted_at timestamptz,
  approved_by  uuid references public.employees (id) on delete set null,
  approved_at  timestamptz,
  processed_by uuid references public.employees (id) on delete set null,
  processed_at timestamptz,
  updated_at   timestamptz not null default now(),
  disbursed_by uuid references public.employees (id) on delete set null,
  disbursed_at timestamptz,
  constraint payrolls_period_key unique (year, month)
);
-- At most one payroll not yet disbursed.
create unique index payrolls_one_open on public.payrolls ((true)) where status <> 'disbursed';

-- Money is in PKR. Column order matches the migrated database (arrears was
-- added later, and gross and net re-added after it).
create table public.payroll_items (
  id                 uuid primary key default gen_random_uuid(),
  payroll_id         uuid not null references public.payrolls (id) on delete cascade,
  -- Null once the employee record is deleted; the name and number stay.
  employee_id        uuid references public.employees (id) on delete set null,
  -- Copied from the employee by payroll_items_guard.
  employee_number    integer not null,
  full_name          text not null,
  basic_salary       numeric(12, 2) not null default 0 check (basic_salary >= 0),
  contractual_amount numeric(12, 2) not null default 0 check (contractual_amount >= 0),
  -- An amount, or a percentage of basic salary.
  bonus_type         text not null default 'amount' check (bonus_type in ('amount', 'percent')),
  bonus_value        numeric(12, 2) not null default 0 check (bonus_value >= 0),
  -- The generated columns are mirrored in src/lib/payroll.ts.
  bonus              numeric(12, 2) not null generated always as (
                       case when bonus_type = 'percent' then round(basic_salary * bonus_value / 100, 2)
                            else bonus_value end) stored,
  -- In half days.
  absent_days        numeric(3, 1) not null default 0
                     check (absent_days between 0 and 31 and absent_days % 0.5 = 0),
  absent_deduction   numeric(12, 2) not null default 0 check (absent_deduction >= 0),
  allowance          numeric(12, 2) not null default 0 check (allowance >= 0),
  advance_salary     numeric(12, 2) not null default 0 check (advance_salary >= 0),
  loan_deduction     numeric(12, 2) not null default 0 check (loan_deduction >= 0),
  tax_amount         numeric(12, 2) not null default 0 check (tax_amount >= 0),
  hr_remarks         text check (length(hr_remarks) <= 1000),
  finance_remarks    text check (length(finance_remarks) <= 1000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Pay owed from earlier months.
  arrears            numeric(12, 2) not null default 0 check (arrears >= 0),
  gross_salary       numeric(12, 2) not null generated always as (
                       basic_salary + contractual_amount
                       + case when bonus_type = 'percent' then round(basic_salary * bonus_value / 100, 2)
                              else bonus_value end
                       + allowance + arrears - absent_deduction) stored,
  net_salary         numeric(12, 2) not null generated always as (
                       basic_salary + contractual_amount
                       + case when bonus_type = 'percent' then round(basic_salary * bonus_value / 100, 2)
                              else bonus_value end
                       + allowance + arrears - absent_deduction
                       - advance_salary - loan_deduction - tax_amount) stored,
  constraint payroll_items_employee_key unique (payroll_id, employee_id)
);
create index payroll_items_employee_idx on public.payroll_items (employee_id);

-- ---------------------------------------------------------------------------
-- Salary history: appraisals, written by HR as drafts, sent for review and
-- approved (or rejected back to draft) by a company admin. Approved ones are
-- the history; the active salary is the latest approved one whose month has
-- come. New payroll lines take their basic salary and contractual amount
-- from it.
-- ---------------------------------------------------------------------------
create table public.salary_revisions (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null,
  -- The first day of the month the salary applies from.
  effective_from     date not null check (extract(day from effective_from) = 1),
  basic_salary       numeric(12, 2) not null check (basic_salary >= 0),
  contractual_amount numeric(12, 2) not null default 0 check (contractual_amount >= 0),
  note               text check (length(note) <= 2000),
  status             public.salary_revision_status not null default 'draft',
  -- Stamped by salary_revisions_guard and salary_revision_move.
  created_by         uuid references public.employees (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  submitted_by       uuid references public.employees (id) on delete set null,
  submitted_at       timestamptz,
  approved_by        uuid references public.employees (id) on delete set null,
  approved_at        timestamptz,
  -- The last rejection, kept on the draft it went back to.
  rejected_by        uuid references public.employees (id) on delete set null,
  rejected_at        timestamptz,
  rejection_reason   text check (length(rejection_reason) <= 2000),
  -- Named: salary_revisions references employees several times.
  constraint salary_revisions_employee_id_fkey foreign key (employee_id)
    references public.employees (id) on delete cascade
);
create unique index salary_revisions_one_open_key
  on public.salary_revisions (employee_id) where status <> 'approved';
create unique index salary_revisions_month_key
  on public.salary_revisions (employee_id, effective_from) where status = 'approved';
create index salary_revisions_employee_idx on public.salary_revisions (employee_id, effective_from);

-- The approved salary in force for an employee in a month.
create function public.salary_on(p_employee_id uuid, p_month date)
returns public.salary_revisions language sql stable security definer set search_path = '' as $$
  select r.* from public.salary_revisions r
   where r.employee_id = p_employee_id and r.status = 'approved' and r.effective_from <= p_month
   order by r.effective_from desc limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Operations: equipment, its assignment history, and the vendors it comes
-- from. HR, finance and company admins manage them. Who has a piece of
-- equipment changes only through equipment_assign / equipment_unassign.
-- ---------------------------------------------------------------------------
create table public.vendors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (name = trim(name) and name <> ''),
  description text,
  bank_name   text,
  -- Without spaces, upper case.
  iban        text check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index vendors_name_key on public.vendors (lower(name));

create table public.equipment (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (name = trim(name) and name <> ''),
  -- A serial or asset tag, typed in by hand.
  identifier    text not null check (identifier = trim(identifier) and identifier <> ''),
  status        public.equipment_status not null default 'active',
  purchase_date date,
  vendor_id     uuid,
  -- Files in the equipment bucket.
  invoice_path  text,
  photo_path    text,
  -- Set only by equipment_assign / equipment_unassign. Deleting the employee
  -- unassigns it.
  assigned_to   uuid references public.employees (id) on delete set null,
  assigned_on   date,
  created_by    uuid references public.employees (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Named explicitly: the app embeds the vendor through this FK.
  constraint equipment_vendor_id_fkey foreign key (vendor_id)
    references public.vendors (id) on delete restrict
);
create unique index equipment_identifier_key on public.equipment (lower(identifier));
create index equipment_vendor_idx on public.equipment (vendor_id);
create index equipment_assigned_to_idx on public.equipment (assigned_to);

-- Who has had each piece of equipment. The open row (no unassigned_on) is
-- the current holder. Goes with the equipment, and with the employee.
create table public.equipment_assignments (
  id            uuid primary key default gen_random_uuid(),
  equipment_id  uuid not null references public.equipment (id) on delete cascade,
  employee_id   uuid not null references public.employees (id) on delete cascade,
  assigned_on   date not null,
  assigned_by   uuid references public.employees (id) on delete set null,
  unassigned_on date,
  unassigned_by uuid references public.employees (id) on delete set null,
  created_at    timestamptz not null default now(),
  check (unassigned_on >= assigned_on)
);
create unique index equipment_assignments_open
  on public.equipment_assignments (equipment_id) where unassigned_on is null;
create index equipment_assignments_employee_idx on public.equipment_assignments (employee_id);

-- ---------------------------------------------------------------------------
-- Performance: monthly reviews. In the first ten days of each month, every
-- employee's org chart manager reviews the month before: KPIs rated 1–5,
-- expectations met or not, an evaluation, feedback and the quarterly goal.
-- The manager saves a draft and submits it by the 10th (later = late); the
-- employee then reads and acknowledges it. Once submitted it is final.
-- ---------------------------------------------------------------------------

-- One per employee and reviewed month. Written only by the review functions,
-- apart from the draft's text and ratings.
create table public.performance_reviews (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null,
  -- The month reviewed, as its first day.
  period          date not null check (period = date_trunc('month', period)::date),
  -- The 10th of the month after.
  due_date        date not null generated always as ((period + interval '1 month 9 days')::date) stored,
  status          public.review_status not null default 'draft',
  evaluation      text check (length(evaluation) <= 5000),
  feedback        text check (length(feedback) <= 5000),
  -- The goal this review sets, for the quarter it is held in (the month after
  -- the reviewed one), when that quarter has none yet. Kept by review_submit
  -- only when it does.
  goal_set        text check (length(goal_set) <= 2000),
  -- The goal of the reviewed month's quarter, copied in by review_submit, and
  -- its progress out of 10.
  goal_rated      text,
  goal_progress   smallint check (goal_progress between 0 and 10),
  created_by      uuid references public.employees (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- When it was submitted, and whether that was after the due date.
  submitted_by    uuid references public.employees (id) on delete set null,
  submitted_at    timestamptz,
  late            boolean not null default false,
  acknowledged_at timestamptz,
  -- Named: performance_reviews references employees several times.
  constraint performance_reviews_employee_id_fkey foreign key (employee_id)
    references public.employees (id) on delete cascade,
  constraint performance_reviews_period_key unique (employee_id, period)
);

-- The KPIs and expectations as they were when the review started.
create table public.performance_review_kpis (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.performance_reviews (id) on delete cascade,
  kpi_id      uuid references public.kpis (id) on delete set null,
  name        text not null,
  description text,
  target      text,
  weight      numeric(5, 2),
  sort_order  integer not null,
  rating      smallint check (rating between 1 and 5),
  note        text check (length(note) <= 2000)
);
create index performance_review_kpis_review_idx on public.performance_review_kpis (review_id, sort_order);

create table public.performance_review_expectations (
  id             uuid primary key default gen_random_uuid(),
  review_id      uuid not null references public.performance_reviews (id) on delete cascade,
  expectation_id uuid references public.expectations (id) on delete set null,
  title          text not null,
  sort_order     integer not null,
  met            boolean,
  note           text check (length(note) <= 2000)
);
create index performance_review_expectations_review_idx
  on public.performance_review_expectations (review_id, sort_order);

-- Each manager's one running note per direct report, to raise at 1:1s. Only
-- the author reads or writes it (RLS); never part of a review.
create table public.manager_notes (
  id          uuid primary key default gen_random_uuid(),
  -- Who the note is about.
  employee_id uuid not null,
  -- Who wrote it, and the only one who reads it. Stamped by manager_notes_stamp.
  author_id   uuid not null references public.employees (id) on delete cascade,
  -- Free text; may be emptied.
  body        text not null default '' check (length(body) <= 10000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Named: manager_notes references employees twice.
  constraint manager_notes_employee_id_fkey foreign key (employee_id)
    references public.employees (id) on delete cascade,
  -- One note per manager and report.
  constraint manager_notes_author_employee_key unique (author_id, employee_id)
);

-- Feedback from HR to one employee. Only HR and that employee read it; once
-- sent it isn't edited (no update grant), HR can delete it.
create table public.hr_feedback (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null,
  kind            public.feedback_kind not null default 'general',
  body            text not null check (body = trim(body) and body <> '' and length(body) <= 5000),
  -- Stamped by hr_feedback_stamp.
  author_id       uuid references public.employees (id) on delete set null,
  created_at      timestamptz not null default now(),
  acknowledged_at timestamptz,
  -- Named: hr_feedback references employees twice.
  constraint hr_feedback_employee_id_fkey foreign key (employee_id)
    references public.employees (id) on delete cascade
);
create index hr_feedback_employee_idx on public.hr_feedback (employee_id, created_at);

-- Quarterly peer reviews: a cycle per quarter with 3–5 questions, who reviews
-- whom, and the answers. Set up and run by HR; each reviewer writes their own;
-- the subject reads them anonymised once the cycle closes (my_peer_feedback).
create table public.peer_review_cycles (
  id         uuid primary key default gen_random_uuid(),
  year       integer not null check (year between 2000 and 2999),
  quarter    integer not null check (quarter between 1 and 4),
  status     public.peer_cycle_status not null default 'draft',
  due_date   date not null,
  created_by uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now(),
  opened_at  timestamptz,
  closed_at  timestamptz,
  updated_at timestamptz not null default now(),
  constraint peer_review_cycles_period_key unique (year, quarter)
);

create table public.peer_review_questions (
  id         uuid primary key default gen_random_uuid(),
  cycle_id   uuid not null references public.peer_review_cycles (id) on delete cascade,
  prompt     text not null check (prompt = trim(prompt) and prompt <> '' and length(prompt) <= 500),
  -- Set on insert (last) by peer_review_questions_guard.
  sort_order integer not null default 0
);
create index peer_review_questions_cycle_idx on public.peer_review_questions (cycle_id, sort_order);

-- One reviewer writing about one subject in a cycle.
create table public.peer_review_assignments (
  id            uuid primary key default gen_random_uuid(),
  cycle_id      uuid not null references public.peer_review_cycles (id) on delete cascade,
  subject_id    uuid not null,
  reviewer_id   uuid not null,
  open_feedback text check (length(open_feedback) <= 5000),
  created_at    timestamptz not null default now(),
  -- Set only by peer_review_submit; final.
  submitted_at  timestamptz,
  -- Named: peer_review_assignments references employees twice.
  constraint peer_review_assignments_subject_id_fkey foreign key (subject_id)
    references public.employees (id) on delete cascade,
  constraint peer_review_assignments_reviewer_id_fkey foreign key (reviewer_id)
    references public.employees (id) on delete cascade,
  constraint peer_review_assignments_pair_key unique (cycle_id, subject_id, reviewer_id),
  constraint peer_review_assignments_not_self check (subject_id <> reviewer_id)
);
create index peer_review_assignments_reviewer_idx on public.peer_review_assignments (reviewer_id);
create index peer_review_assignments_subject_idx on public.peer_review_assignments (subject_id);

-- One per question of an assignment, made when the cycle opens (or the
-- assignment is added to an open cycle).
create table public.peer_review_answers (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.peer_review_assignments (id) on delete cascade,
  question_id   uuid not null references public.peer_review_questions (id) on delete cascade,
  rating        smallint check (rating between 1 and 5),
  comment       text check (length(comment) <= 2000),
  constraint peer_review_answers_question_key unique (assignment_id, question_id)
);

-- Quarterly feedback on one's manager: one form per employee and quarter,
-- made when they open it in the quarter's last month (manager_feedback_start),
-- with HR's questions copied in. Only HR reads them; never the manager.
-- The questions every quarter's form copies when it starts.
create table public.manager_feedback_questions (
  id         uuid primary key default gen_random_uuid(),
  prompt     text not null check (prompt = trim(prompt) and prompt <> '' and length(prompt) <= 500),
  -- Set on insert (last) by manager_feedback_questions_guard.
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One per employee and quarter. Created and submitted only by the functions
-- below; the employee writes the feedback box and ratings while a draft.
create table public.manager_feedback (
  id           uuid primary key default gen_random_uuid(),
  -- Who writes it.
  employee_id  uuid not null,
  -- Their manager when the form was started.
  manager_id   uuid,
  year         integer not null check (year between 2000 and 2999),
  quarter      integer not null check (quarter between 1 and 4),
  -- The 10th of the quarter's last month.
  due_date     date not null generated always as (make_date(year, quarter * 3, 10)) stored,
  body         text check (length(body) <= 5000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  submitted_at timestamptz,
  late         boolean not null default false,
  -- Named: manager_feedback references employees twice.
  constraint manager_feedback_employee_id_fkey foreign key (employee_id)
    references public.employees (id) on delete cascade,
  constraint manager_feedback_manager_id_fkey foreign key (manager_id)
    references public.employees (id) on delete set null,
  constraint manager_feedback_quarter_key unique (employee_id, year, quarter)
);
create index manager_feedback_period_idx on public.manager_feedback (year, quarter);
create index manager_feedback_manager_idx on public.manager_feedback (manager_id);

-- The questions as they were when the form started.
create table public.manager_feedback_answers (
  id          uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.manager_feedback (id) on delete cascade,
  prompt      text not null,
  sort_order  integer not null,
  rating      smallint check (rating between 1 and 5)
);
create index manager_feedback_answers_feedback_idx on public.manager_feedback_answers (feedback_id, sort_order);

insert into public.manager_feedback_questions (prompt, sort_order) values
  ('Gives me clear goals and priorities.', 0),
  ('Gives me useful, timely feedback.', 1),
  ('Is available and supportive when I need help.', 2),
  ('Recognises my work and treats me fairly.', 3),
  ('Supports my growth and career development.', 4);

-- ---------------------------------------------------------------------------
-- Identity helpers (used by RLS)
-- ---------------------------------------------------------------------------

-- Statuses that are allowed to log in. Change here to widen/narrow access.
create function public.is_login_status(s public.employee_status)
returns boolean language sql immutable set search_path = '' as $$
  select s in ('probation', 'active', 'notice_period');
$$;

create function public.current_employee_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.employees
  where user_id = (select auth.uid()) and public.is_login_status(status);
$$;

create function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select app_role from public.employees
  where user_id = (select auth.uid()) and public.is_login_status(status);
$$;

create function public.is_hr()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(public.current_app_role() in ('hr_admin', 'company_admin'), false);
$$;

create function public.is_company_admin()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(public.current_app_role() = 'company_admin', false);
$$;

-- Finance admin or company admin, as HR is HR admin or company admin.
create function public.is_finance()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(public.current_app_role() in ('finance_admin', 'company_admin'), false);
$$;

create function public.can_manage_payroll()
returns boolean language sql stable set search_path = '' as $$
  select public.is_hr() or public.is_finance();
$$;

-- Equipment and vendors: the same people as payroll.
create function public.can_manage_operations()
returns boolean language sql stable set search_path = '' as $$
  select public.is_hr() or public.is_finance();
$$;

-- The caller's department's business function, if any.
create function public.current_business_function()
returns public.business_function language sql stable security definer set search_path = '' as $$
  select d.business_function
    from public.employees e
    join public.departments d on d.id = e.department_id
   where e.id = public.current_employee_id();
$$;

-- True when the caller is the employee's manager in the org chart.
create function public.is_manager_of(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_chart_nodes
                  where employee_id = p_employee_id
                    and manager_id = public.current_employee_id());
$$;

-- Called by the app right after Google sign-in. Binds the auth user to the
-- employee record with the same company email, if that record may log in.
-- Returns the employee row, or nothing when login must be refused.
create function public.bind_employee()
returns setof public.employees
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text := lower(auth.jwt() ->> 'email');
  v_provider text := coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '');
  v_method   public.login_method;
begin
  if v_uid is null or v_email is null then
    return;
  end if;
  -- The session's provider must match the row's method, so a Google account
  -- never claims a password row nor a password account a Google one.
  if v_provider = 'google' and v_email like '%@elevancelabs.com' then
    v_method := 'google';
  elsif v_provider = 'email'
        and exists (select 1 from auth.users u
                     where u.id = v_uid and u.email_confirmed_at is not null) then
    v_method := 'password';
  else
    return;
  end if;

  update public.employees e
     set user_id = v_uid
   where e.company_email = v_email
     and e.login_method = v_method
     and e.user_id is null
     and public.is_login_status(e.status);

  return query
    select * from public.employees e
     where e.user_id = v_uid
       and e.company_email = v_email
       and e.login_method = v_method
       and public.is_login_status(e.status);
end;
$$;

-- Optional hardening: enable as the "Before User Created" auth hook so that
-- people without a matching employee record never get an auth user at all.
create function public.hook_before_user_created(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(event -> 'user' ->> 'email');
begin
  -- An outside address passes only with a row, and its email check makes
  -- that a password one; bind_employee still checks the method.
  if v_email is null or not exists (select 1 from public.employees
                                     where company_email = v_email and public.is_login_status(status)) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'No active employee record found for this account.'));
  end if;
  return '{}'::jsonb;
end;
$$;

-- For the set-password Edge Function (service role only): the auth users with
-- this email, which it replaces with one that has the new password.
create function public.auth_user_ids_by_email(p_email text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u where lower(u.email) = lower(p_email);
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create function public.employees_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- auth.uid() is null for the SQL editor / service role: no restrictions.
  if auth.uid() is not null and not public.is_company_admin() then
    if tg_op = 'INSERT' and new.app_role <> 'member' then
      raise exception 'Only a company admin can assign admin roles.' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' and new.login_method <> 'google' then
      raise exception 'Only a company admin can set up a password login.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      if new.app_role is distinct from old.app_role then
        raise exception 'Only a company admin can change roles.' using errcode = '42501';
      end if;
      -- Login is bound by company email, so changing it would hand this
      -- person's login to whoever holds the new address.
      if new.company_email is distinct from old.company_email then
        raise exception 'Only a company admin can change a company email.' using errcode = '42501';
      end if;
      if new.login_method is distinct from old.login_method then
        raise exception 'Only a company admin can change how someone signs in.' using errcode = '42501';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.company_email is distinct from old.company_email
       or new.login_method is distinct from old.login_method then
      new.user_id := null; -- rebinds on next login with the new email / method
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger employees_guard
  before insert or update on public.employees
  for each row execute function public.employees_guard();

create function public.employee_documents_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.uploaded_by := public.current_employee_id();
  elsif new.deleted_at is not null and old.deleted_at is null then
    new.deleted_by := public.current_employee_id();
  end if;
  return new;
end;
$$;

create trigger employee_documents_stamp
  before insert or update on public.employee_documents
  for each row execute function public.employee_documents_stamp();

create function public.org_chart_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.manager_id is not null and exists (
    with recursive up as (
      select n.employee_id, n.manager_id
        from public.org_chart_nodes n where n.employee_id = new.manager_id
      union all
      select n.employee_id, n.manager_id
        from public.org_chart_nodes n join up on n.employee_id = up.manager_id
    )
    select 1 from up where up.employee_id = new.employee_id
  ) then
    raise exception 'A person cannot report to someone below them in the chart.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger org_chart_guard
  before insert or update on public.org_chart_nodes
  for each row execute function public.org_chart_guard();

-- Remove a person from the chart; their reports move up to their manager.
create function public.org_chart_remove(p_employee_id uuid)
returns void language plpgsql set search_path = '' as $$
declare
  v_manager uuid;
begin
  select manager_id into v_manager
    from public.org_chart_nodes where employee_id = p_employee_id;
  if not found then
    return;
  end if;
  update public.org_chart_nodes set manager_id = v_manager where manager_id = p_employee_id;
  delete from public.org_chart_nodes where employee_id = p_employee_id;
end;
$$;

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
create trigger expectations_touch before update on public.expectations
  for each row execute function public.touch_updated_at();
create trigger guides_touch before update on public.guides
  for each row execute function public.touch_updated_at();

-- Stamps who did what, counts the working days, validates dates against
-- overlaps and the quota, and grants a pending leave once it has every
-- approval it needs.
create function public.leaves_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_me      uuid := public.current_employee_id();
  v_manager uuid;
  v_year    integer := extract(year from new.start_date);
  v_name    text;
  v_quota   numeric;
  v_used    numeric;
begin
  select manager_id into v_manager
    from public.org_chart_nodes where employee_id = new.employee_id;

  if tg_op = 'INSERT' then
    new.created_by := v_me;
    -- HR recording a leave for someone else approves it as they record it.
    if new.employee_id <> v_me and public.is_hr() then
      new.hr_approved_by := v_me;
      new.hr_approved_at := now();
      if v_manager = v_me then
        new.manager_approved_by := v_me;
        new.manager_approved_at := now();
      end if;
    end if;
  else
    new.updated_at := now();
  end if;

  -- Counted on every write, so it follows the holidays.
  new.days := public.leave_days(new.start_date, new.end_date, new.half_day);

  if tg_op = 'INSERT' or (new.start_date, new.end_date, new.half_day)
                         is distinct from (old.start_date, old.end_date, old.half_day) then
    if tg_op = 'UPDATE' then
      if new.employee_id = v_me then
        raise exception 'You cannot change the dates of your own leave.' using errcode = '42501';
      end if;
      if old.status not in ('pending', 'approved') then
        raise exception 'Only a pending or approved leave can be changed.';
      end if;
      new.edited_by := v_me;
      new.edited_at := now();
    elsif not (select t.is_active from public.leave_types t where t.id = new.leave_type_id) then
      raise exception 'This leave type is no longer in use.';
    end if;

    if new.days = 0 then
      raise exception 'A leave must include at least one working day (Monday to Friday, not a holiday).';
    end if;

    if exists (select 1 from public.leaves l
                where l.employee_id = new.employee_id and l.id <> new.id
                  and l.status in ('pending', 'approved')
                  and l.start_date <= new.end_date and l.end_date >= new.start_date) then
      raise exception 'These dates overlap another pending or approved leave.';
    end if;

    select t.name, coalesce(q.days, t.annual_quota) into v_name, v_quota
      from public.leave_types t
      left join public.leave_quotas q
        on q.leave_type_id = t.id and q.employee_id = new.employee_id and q.year = v_year
     where t.id = new.leave_type_id;
    if v_quota is not null then
      select coalesce(sum(l.days), 0) into v_used
        from public.leaves l
       where l.employee_id = new.employee_id and l.leave_type_id = new.leave_type_id
         and l.id <> new.id and l.status in ('pending', 'approved')
         and extract(year from l.start_date) = v_year;
      if v_used + new.days > v_quota then
        raise exception 'Not enough % left for %: % of % day(s) remaining, this leave needs %.',
          v_name, v_year, trim_scale(greatest(v_quota - v_used, 0)), trim_scale(v_quota),
          trim_scale(new.days);
      end if;
    end if;
  end if;

  -- Granted once HR has approved, and the manager too if the employee has one.
  if new.status = 'pending' and new.hr_approved_by is not null
     and (new.manager_approved_by is not null or v_manager is null) then
    new.status := 'approved';
  end if;
  return new;
end;
$$;

create trigger leaves_guard
  before insert or update on public.leaves
  for each row execute function public.leaves_guard();

-- A holiday added, moved or removed recounts the leaves over its dates
-- (old and new). The quota isn't checked again: the dates didn't change.
create function public.holidays_recount()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.leaves l
     set days = public.leave_days(l.start_date, l.end_date, l.half_day)
   where ((tg_op <> 'INSERT' and l.start_date <= old.end_date and l.end_date >= old.start_date)
          or (tg_op <> 'DELETE' and l.start_date <= new.end_date and l.end_date >= new.start_date))
     and l.days is distinct from public.leave_days(l.start_date, l.end_date, l.half_day);
  return null;
end;
$$;

create trigger holidays_recount
  after insert or update or delete on public.holidays
  for each row execute function public.holidays_recount();

create trigger holidays_touch before update on public.holidays
  for each row execute function public.touch_updated_at();

create trigger leave_types_touch before update on public.leave_types
  for each row execute function public.touch_updated_at();
create trigger leave_quotas_touch before update on public.leave_quotas
  for each row execute function public.touch_updated_at();

create function public.job_openings_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := public.current_employee_id();
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger job_openings_stamp
  before insert or update on public.job_openings
  for each row execute function public.job_openings_stamp();

create trigger branding_touch before update on public.branding
  for each row execute function public.touch_updated_at();

create function public.announcements_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := public.current_employee_id();
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger announcements_stamp
  before insert or update on public.announcements
  for each row execute function public.announcements_stamp();

-- A new checklist section or task goes last.
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

-- A new offboarding checklist section or task goes last.
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

create trigger payrolls_touch before update on public.payrolls
  for each row execute function public.touch_updated_at();

-- Lines change only while their payroll is a draft; HR's columns only by HR
-- and the rest only by finance. A new line takes the employee's name and
-- number, basic salary and contractual amount from their salary for the
-- payroll's month (else their latest earlier payroll), and the allowance from
-- their latest earlier payroll.
create function public.payroll_items_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_payroll  public.payrolls;
  v_employee public.employees;
  v_previous public.payroll_items;
  v_salary   public.salary_revisions;
  v_hr       boolean := false;
  v_finance  boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_hr := (new.basic_salary, new.contractual_amount, new.absent_days, new.hr_remarks)
            is distinct from (old.basic_salary, old.contractual_amount, old.absent_days, old.hr_remarks);
    v_finance := (new.bonus_type, new.bonus_value, new.absent_deduction, new.allowance, new.arrears,
                  new.advance_salary, new.loan_deduction, new.tax_amount, new.finance_remarks)
                 is distinct from (old.bonus_type, old.bonus_value, old.absent_deduction, old.allowance,
                                   old.arrears, old.advance_salary, old.loan_deduction, old.tax_amount,
                                   old.finance_remarks);
    -- Nothing a person edits (e.g. employee_id cleared as the record is deleted).
    if not (v_hr or v_finance) then
      return new;
    end if;
    -- auth.uid() is null for the SQL editor / service role.
    if auth.uid() is not null then
      if v_hr and not public.is_hr() then
        raise exception 'Only HR can change basic salary, contractual amount, absent days and HR remarks.'
          using errcode = '42501';
      end if;
      if v_finance and not public.is_finance() then
        raise exception 'Only finance can change bonus, arrears, deductions, allowance, tax and finance remarks.'
          using errcode = '42501';
      end if;
    end if;
  end if;

  select * into v_payroll from public.payrolls
   where id = case when tg_op = 'DELETE' then old.payroll_id else new.payroll_id end
     for share;
  if not found then
    raise exception 'Payroll not found.' using errcode = 'P0002';
  end if;
  if v_payroll.status <> 'draft' then
    raise exception 'This payroll is %. Only a draft payroll can be changed.',
      case v_payroll.status when 'review' then 'in review' else v_payroll.status::text end;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    return new;
  end if;

  select * into v_employee from public.employees where id = new.employee_id;
  if not found or not public.is_login_status(v_employee.status) then
    raise exception 'Only employees on probation, active or on their notice period can be on a payroll.';
  end if;
  new.employee_number := v_employee.employee_number;
  new.full_name := v_employee.full_name;

  select i.* into v_previous
    from public.payroll_items i join public.payrolls p on p.id = i.payroll_id
   where i.employee_id = new.employee_id and (p.year, p.month) < (v_payroll.year, v_payroll.month)
   order by p.year desc, p.month desc limit 1;
  if found then
    new.basic_salary := v_previous.basic_salary;
    new.contractual_amount := v_previous.contractual_amount;
    new.allowance := v_previous.allowance;
  end if;

  v_salary := public.salary_on(new.employee_id, make_date(v_payroll.year, v_payroll.month, 1));
  if v_salary.id is not null then
    new.basic_salary := v_salary.basic_salary;
    new.contractual_amount := v_salary.contractual_amount;
  end if;
  return new;
end;
$$;

create trigger payroll_items_guard
  before insert or update or delete on public.payroll_items
  for each row execute function public.payroll_items_guard();

create trigger vendors_touch before update on public.vendors
  for each row execute function public.touch_updated_at();

-- Stamps the creator; keeps assigned_on with assigned_to (also when the
-- employee is deleted); refuses retired or sold equipment with a holder.
create function public.equipment_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := public.current_employee_id();
  else
    new.updated_at := now();
  end if;
  if new.assigned_to is null then
    new.assigned_on := null;
  end if;
  if new.status in ('retired', 'sold') and new.assigned_to is not null then
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      raise exception 'Unassign it before marking it %.', new.status using errcode = '23514';
    end if;
    raise exception 'Retired or sold equipment can''t be assigned.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger equipment_guard
  before insert or update on public.equipment
  for each row execute function public.equipment_guard();

-- ---------------------------------------------------------------------------
-- Leave actions (RPCs). The only way a leave's status or approvals change.
-- ---------------------------------------------------------------------------

-- Approve or reject a pending leave, as HR and/or the employee's manager
-- (both at once when one person is both). Nobody decides their own leave.
-- leaves_guard turns the leave approved once every approval is in.
create function public.leave_decide(p_leave_id uuid, p_approve boolean, p_reason text default null)
returns public.leaves language plpgsql security definer set search_path = '' as $$
declare
  v_me         uuid := public.current_employee_id();
  v_as_hr      boolean := public.is_hr();
  v_as_manager boolean;
  v_leave      public.leaves;
begin
  select * into v_leave from public.leaves where id = p_leave_id for update;
  if not found or v_me is null then
    raise exception 'Leave not found.' using errcode = 'P0002';
  end if;
  v_as_manager := public.is_manager_of(v_leave.employee_id);
  if not (v_as_hr or v_as_manager or v_leave.employee_id = v_me) then
    raise exception 'Leave not found.' using errcode = 'P0002';
  end if;
  if v_leave.employee_id = v_me then
    raise exception 'You cannot approve or reject your own leave.' using errcode = '42501';
  end if;
  if v_leave.status <> 'pending' then
    raise exception 'This leave is already %.', v_leave.status;
  end if;

  if p_approve then
    update public.leaves
       set hr_approved_by      = case when v_as_hr and hr_approved_by is null
                                      then v_me else hr_approved_by end,
           hr_approved_at      = case when v_as_hr and hr_approved_by is null
                                      then now() else hr_approved_at end,
           manager_approved_by = case when v_as_manager and manager_approved_by is null
                                      then v_me else manager_approved_by end,
           manager_approved_at = case when v_as_manager and manager_approved_by is null
                                      then now() else manager_approved_at end
     where id = p_leave_id
    returning * into v_leave;
  else
    update public.leaves
       set status = 'rejected', rejected_by = v_me, rejected_at = now(),
           rejection_reason = nullif(trim(p_reason), '')
     where id = p_leave_id
    returning * into v_leave;
  end if;
  return v_leave;
end;
$$;

-- Cancel a pending or approved leave. HR can cancel any; an employee their
-- own, until an approved leave has started.
create function public.leave_cancel(p_leave_id uuid)
returns public.leaves language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := public.current_employee_id();
  v_as_hr boolean := public.is_hr();
  v_leave public.leaves;
begin
  select * into v_leave from public.leaves where id = p_leave_id for update;
  if not found or v_me is null
     or not (v_as_hr or v_leave.employee_id = v_me or public.is_manager_of(v_leave.employee_id)) then
    raise exception 'Leave not found.' using errcode = 'P0002';
  end if;
  if not v_as_hr then
    if v_leave.employee_id <> v_me then
      raise exception 'Only HR or the employee can cancel a leave.' using errcode = '42501';
    end if;
    if v_leave.status = 'approved' and v_leave.start_date <= current_date then
      raise exception 'This leave has already started. Ask HR to change or cancel it.'
        using errcode = '42501';
    end if;
  end if;
  if v_leave.status not in ('pending', 'approved') then
    raise exception 'This leave is already %.', v_leave.status;
  end if;

  update public.leaves
     set status = 'cancelled', cancelled_by = v_me, cancelled_at = now()
   where id = p_leave_id
  returning * into v_leave;
  return v_leave;
end;
$$;

-- One employee's year, per leave type: quota (null = no limit) and days
-- approved and pending. Active types, plus inactive ones with leave that
-- year. Empty unless the caller is the employee, their manager or HR.
create function public.leave_balances(p_employee_id uuid, p_year integer)
returns table (leave_type_id uuid, name text, quota numeric, approved numeric, pending numeric)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, coalesce(q.days, t.annual_quota),
         coalesce(sum(l.days) filter (where l.status = 'approved'), 0),
         coalesce(sum(l.days) filter (where l.status = 'pending'), 0)
    from public.leave_types t
    left join public.leave_quotas q
      on q.leave_type_id = t.id and q.employee_id = p_employee_id and q.year = p_year
    left join public.leaves l
      on l.leave_type_id = t.id and l.employee_id = p_employee_id
     and l.status in ('pending', 'approved') and extract(year from l.start_date) = p_year
   where (t.is_active or l.id is not null)
     and (p_employee_id = public.current_employee_id() or public.is_hr()
          or public.is_manager_of(p_employee_id))
   group by t.id, t.name, q.days, t.annual_quota
   order by t.name;
$$;

-- ---------------------------------------------------------------------------
-- Public functions: the only way in for someone who isn't signed in (the
-- public job page). Executable by anon.
-- ---------------------------------------------------------------------------

-- Takes text so a storage policy can pass a folder name that isn't a uuid.
create function public.job_accepts_applications(p_job_opening_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.job_openings j
                  where j.id::text = p_job_opening_id and j.status = 'open'
                    and (j.due_date is null or j.due_date >= current_date));
$$;

-- An open job as the public page shows it. Nothing for any other status.
create function public.job_posting(p_id uuid)
returns table (id uuid, title text, department text, designation text, due_date date,
               description text, accepting boolean)
language sql stable security definer set search_path = '' as $$
  select j.id, j.title, d.name, g.title, j.due_date, j.description,
         j.due_date is null or j.due_date >= current_date
    from public.job_openings j
    join public.departments d on d.id = j.department_id
    join public.designations g on g.id = j.designation_id
   where j.id = p_id and j.status = 'open';
$$;

create function public.public_branding()
returns table (logo_path text, primary_color text, perks jsonb)
language sql stable security definer set search_path = '' as $$
  select b.logo_path, b.primary_color, b.perks from public.branding b;
$$;

-- Apply for an open job. The CV must already be uploaded into that job's
-- folder (the storage policy only allows that for a job taking applications).
create function public.submit_application(
  p_job_opening_id uuid, p_full_name text, p_email text, p_phone text, p_expected_salary integer,
  p_note text, p_resume_path text, p_resume_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.job_accepts_applications(p_job_opening_id::text) then
    raise exception 'This job is no longer taking applications.' using errcode = 'P0002';
  end if;
  if p_expected_salary is null then
    raise exception 'Enter your expected salary.' using errcode = '23514';
  end if;
  if split_part(p_resume_path, '/', 1) <> p_job_opening_id::text
     or not exists (select 1 from storage.objects o
                     where o.bucket_id = 'job-applications' and o.name = p_resume_path) then
    raise exception 'Upload your CV before applying.';
  end if;

  insert into public.job_applications
    (job_opening_id, full_name, email, phone, expected_salary, note, resume_path, resume_name)
  values (p_job_opening_id, trim(p_full_name), lower(trim(p_email)), trim(p_phone), p_expected_salary,
          nullif(trim(p_note), ''), p_resume_path, trim(p_resume_name));
end;
$$;

-- ---------------------------------------------------------------------------
-- Application stages. HR sees and moves every application. A job's hiring
-- manager and interviewers (its hiring team) see its applications from
-- shortlisted through cleared, and move them out of shortlisted, test and
-- the interviews. Only HR and the hiring manager see the salaries and HR's
-- notes; only HR writes the current salary and the notes.
-- ---------------------------------------------------------------------------

-- Where an application may go next. Mirrored in src/lib/hiring.ts.
-- hired, rejected, abandoned and declined are final.
create function public.application_next_stages(p_stage public.application_stage)
returns public.application_stage[] language sql immutable set search_path = '' as $$
  select case p_stage
    when 'new'         then array['screened', 'rejected']
    when 'screened'    then array['shortlisted', 'test', 'rejected']
    when 'shortlisted' then array['test', 'interview_1', 'rejected', 'abandoned']
    when 'test'        then array['interview_1', 'rejected', 'abandoned']
    when 'interview_1' then array['interview_2', 'cleared', 'shelf', 'rejected', 'abandoned']
    when 'interview_2' then array['interview_3', 'cleared', 'shelf', 'rejected', 'abandoned']
    when 'interview_3' then array['cleared', 'shelf', 'rejected', 'abandoned']
    when 'cleared'     then array['shelf', 'offer_sent', 'rejected', 'abandoned']
    when 'shelf'       then array['offer_sent', 'rejected', 'abandoned']
    when 'offer_sent'  then array['hired', 'shelf', 'declined', 'rejected', 'abandoned']
    else '{}'
  end::public.application_stage[];
$$;

-- Moving into these needs text: remarks for an interview or cleared, a
-- reason for shelf, rejected, declined or abandoned.
create function public.application_stage_needs_reason(p_stage public.application_stage)
returns boolean language sql immutable set search_path = '' as $$
  select p_stage in ('interview_1', 'interview_2', 'interview_3', 'cleared',
                     'shelf', 'rejected', 'declined', 'abandoned');
$$;

-- The stages the hiring team sees.
create function public.application_team_stage(p_stage public.application_stage)
returns boolean language sql immutable set search_path = '' as $$
  select p_stage in ('shortlisted', 'test', 'interview_1', 'interview_2', 'interview_3', 'cleared');
$$;

-- The stages the hiring team may move an application out of.
create function public.application_team_movable(p_stage public.application_stage)
returns boolean language sql immutable set search_path = '' as $$
  select p_stage in ('shortlisted', 'test', 'interview_1', 'interview_2', 'interview_3');
$$;

-- The caller is the job's hiring manager or one of its interviewers.
create function public.is_hiring_team(p_job_opening_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.job_openings j
                  where j.id = p_job_opening_id and j.manager_id = public.current_employee_id())
      or exists (select 1 from public.job_opening_interviewers i
                  where i.job_opening_id = p_job_opening_id
                    and i.employee_id = public.current_employee_id());
$$;

-- The caller is on the hiring team of any job (gates the Applications page).
create function public.on_hiring_team()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.job_openings j where j.manager_id = public.current_employee_id())
      or exists (select 1 from public.job_opening_interviewers i
                  where i.employee_id = public.current_employee_id());
$$;

create function public.can_see_application(p_job_opening_id uuid, p_stage public.application_stage)
returns boolean language sql stable set search_path = '' as $$
  select public.is_hr()
      or (public.application_team_stage(p_stage) and public.is_hiring_team(p_job_opening_id));
$$;

-- A job's applications that the caller can see. A computed field
-- (select=…,application_count): PostgREST's embedded count would be a
-- whole-row reference, refused because the hidden columns aren't selectable.
create function public.application_count(p_job public.job_openings)
returns integer language sql stable set search_path = '' as $$
  select count(*)::integer from public.job_applications a where a.job_opening_id = p_job.id;
$$;

-- Current and expected salary and HR's notes, for HR and the job's hiring
-- manager. No row for anyone else.
create function public.application_hr_details(p_application_id uuid)
returns table (current_salary integer, expected_salary integer, hr_notes text)
language sql stable security definer set search_path = '' as $$
  select a.current_salary, a.expected_salary, a.hr_notes
    from public.job_applications a
    join public.job_openings j on j.id = a.job_opening_id
   where a.id = p_application_id
     and public.can_see_application(a.job_opening_id, a.stage)
     and (public.is_hr() or j.manager_id = public.current_employee_id());
$$;

-- HR sets an application's current salary and notes (empty notes clear them).
create function public.application_set_hr_details(
  p_application_id uuid, p_current_salary integer, p_hr_notes text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_hr() then
    raise exception 'Only HR can change these details.' using errcode = '42501';
  end if;
  update public.job_applications
     set current_salary = p_current_salary, hr_notes = nullif(trim(p_hr_notes), '')
   where id = p_application_id;
  if not found then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
end;
$$;

-- Move an application to one of its next stages (with a reason where one is
-- required). The only way forward, except to hired (application_hire).
create function public.application_move(
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
create function public.application_undo(p_application_id uuid, p_reason text default null)
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

-- HR only: hire an applicant who has an offer. Creates their employee record
-- (status joining) and their onboarding, due the day after joining, with the
-- checklist copied in, then moves the application to hired.
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

-- ---------------------------------------------------------------------------
-- Onboarding actions (RPCs). The checklist's order changes only through the
-- reorder functions (company admins); an onboarding only through the rest (HR).
-- ---------------------------------------------------------------------------

-- Each reorder takes every id, in the new order, so a stale list is refused
-- rather than half applied.
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

-- ---------------------------------------------------------------------------
-- Payroll actions (RPCs). The only way a payroll is created or moves status.
-- ---------------------------------------------------------------------------

-- Start a month's payroll with everyone who may log in (probation, active,
-- notice period). Refused while another payroll is open.
create function public.payroll_create(p_year integer, p_month integer)
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

create function public.payroll_move(p_payroll_id uuid, p_status public.payroll_status)
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

-- ---------------------------------------------------------------------------
-- Equipment actions (RPCs). The only way equipment changes hands; each keeps
-- the assignment history.
-- ---------------------------------------------------------------------------

-- Assign to an employee from a date (today or earlier), ending the current
-- holder's assignment that day. The date can't go back past the equipment's
-- history.
create function public.equipment_assign(p_equipment_id uuid, p_employee_id uuid, p_assigned_on date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := public.current_employee_id();
  v_item   public.equipment;
  v_status public.employee_status;
  v_since  date;
begin
  if not public.can_manage_operations() then
    raise exception 'Only HR and finance can assign equipment.' using errcode = '42501';
  end if;
  select * into v_item from public.equipment where id = p_equipment_id for update;
  if not found then
    raise exception 'Equipment not found.' using errcode = 'P0002';
  end if;
  if p_assigned_on is null or p_assigned_on > current_date then
    raise exception 'Pick an assignment date, today or earlier.' using errcode = '23514';
  end if;
  select status into v_status from public.employees where id = p_employee_id;
  if not found or v_status in ('left', 'terminated') then
    raise exception 'Equipment can only be assigned to a current employee.' using errcode = '23514';
  end if;
  if v_item.assigned_to = p_employee_id then
    raise exception 'It is already assigned to them.' using errcode = '23514';
  end if;
  select max(coalesce(unassigned_on, assigned_on)) into v_since
    from public.equipment_assignments where equipment_id = p_equipment_id;
  if p_assigned_on < v_since then
    raise exception 'Its assignment history runs to %. Pick that day or later.', to_char(v_since, 'FMDD Mon YYYY')
      using errcode = '23514';
  end if;

  update public.equipment_assignments set unassigned_on = p_assigned_on, unassigned_by = v_me
   where equipment_id = p_equipment_id and unassigned_on is null;
  insert into public.equipment_assignments (equipment_id, employee_id, assigned_on, assigned_by)
  values (p_equipment_id, p_employee_id, p_assigned_on, v_me);
  update public.equipment set assigned_to = p_employee_id, assigned_on = p_assigned_on
   where id = p_equipment_id;
end;
$$;

-- End the current assignment on a date (today or earlier, not before it began).
create function public.equipment_unassign(p_equipment_id uuid, p_unassigned_on date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_item public.equipment;
begin
  if not public.can_manage_operations() then
    raise exception 'Only HR and finance can unassign equipment.' using errcode = '42501';
  end if;
  select * into v_item from public.equipment where id = p_equipment_id for update;
  if not found then
    raise exception 'Equipment not found.' using errcode = 'P0002';
  end if;
  if v_item.assigned_to is null then
    raise exception 'It isn''t assigned to anyone.' using errcode = '23514';
  end if;
  if p_unassigned_on is null or p_unassigned_on > current_date or p_unassigned_on < v_item.assigned_on then
    raise exception 'Pick a date from % to today.', to_char(v_item.assigned_on, 'FMDD Mon YYYY')
      using errcode = '23514';
  end if;

  update public.equipment_assignments set unassigned_on = p_unassigned_on, unassigned_by = public.current_employee_id()
   where equipment_id = p_equipment_id and unassigned_on is null;
  update public.equipment set assigned_to = null where id = p_equipment_id;
end;
$$;

-- The caller's own equipment, as their profile shows it: no vendor, files or
-- history.
create function public.my_equipment()
returns table (name text, identifier text, assigned_on date)
language sql stable security definer set search_path = '' as $$
  select e.name, e.identifier, e.assigned_on
    from public.equipment e
   where e.assigned_to = public.current_employee_id()
   order by e.assigned_on desc, e.name;
$$;

-- ---------------------------------------------------------------------------
-- Payslips: an employee's own lines once a payroll is disbursed. The payroll
-- tables stay HR and finance only.
-- ---------------------------------------------------------------------------

-- The caller's own lines on disbursed payrolls, newest first. No remarks.
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

-- Drafts only: stamps the creator, refuses someone's own, someone who has
-- left, and a month not after their latest approved salary. Status isn't
-- client-writable, so a status change is salary_revision_move's, and passes.
create function public.salary_revisions_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status public.employee_status;
  v_latest date;
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    return new;
  end if;
  -- Deleting the employee cascades to all of their appraisals.
  if tg_op = 'DELETE' and not exists (select 1 from public.employees e where e.id = old.employee_id) then
    return old;
  end if;
  if tg_op <> 'INSERT' and old.status <> 'draft' then
    raise exception 'Only a draft appraisal can be changed.';
  end if;
  if (case when tg_op = 'DELETE' then old.employee_id else new.employee_id end)
     = public.current_employee_id() then
    raise exception 'You cannot write an appraisal for yourself.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := public.current_employee_id();
    select status into v_status from public.employees where id = new.employee_id;
    if v_status in ('left', 'terminated') then
      raise exception 'This employee has left.';
    end if;
  else
    if new.employee_id <> old.employee_id then
      raise exception 'An appraisal can''t be moved to another employee.';
    end if;
    new.updated_at := now();
  end if;

  select max(r.effective_from) into v_latest
    from public.salary_revisions r
   where r.employee_id = new.employee_id and r.status = 'approved' and r.id <> new.id;
  if new.effective_from <= v_latest then
    raise exception 'An appraisal must start after the current salary, from %.', to_char(v_latest, 'FMMonth YYYY');
  end if;
  return new;
end;
$$;

create trigger salary_revisions_guard
  before insert or update or delete on public.salary_revisions
  for each row execute function public.salary_revisions_guard();

-- Moves an appraisal: draft → review (HR), review → approved (a company
-- admin), review → draft (a company admin, rejecting it with a reason).
-- Nobody moves their own.
create function public.salary_revision_move(
  p_revision_id uuid, p_status public.salary_revision_status, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me       uuid := public.current_employee_id();
  v_revision public.salary_revisions;
  v_latest   date;
begin
  select * into v_revision from public.salary_revisions where id = p_revision_id for update;
  if not found or not public.is_hr() or v_revision.employee_id = v_me then
    raise exception 'Appraisal not found.' using errcode = 'P0002';
  end if;

  if v_revision.status = 'draft' and p_status = 'review' then
    update public.salary_revisions
       set status = 'review', submitted_by = v_me, submitted_at = now(), updated_at = now()
     where id = p_revision_id;
  elsif v_revision.status = 'review' and p_status in ('approved', 'draft') then
    if not public.is_company_admin() then
      raise exception 'Only a company admin can approve or reject an appraisal.' using errcode = '42501';
    end if;
    if p_status = 'draft' then
      if nullif(trim(p_reason), '') is null then
        raise exception 'Give a reason for rejecting this appraisal.' using errcode = '23514';
      end if;
      update public.salary_revisions
         set status = 'draft', rejected_by = v_me, rejected_at = now(), rejection_reason = trim(p_reason),
             updated_at = now()
       where id = p_revision_id;
    else
      -- Another may have been approved since this one was written.
      select max(r.effective_from) into v_latest
        from public.salary_revisions r
       where r.employee_id = v_revision.employee_id and r.status = 'approved';
      if v_revision.effective_from <= v_latest then
        raise exception 'An appraisal must start after the current salary, from %. Reject it to change the month.',
          to_char(v_latest, 'FMMonth YYYY');
      end if;
      update public.salary_revisions
         set status = 'approved', approved_by = v_me, approved_at = now(), updated_at = now()
       where id = p_revision_id;
    end if;
  else
    raise exception 'An appraisal % can''t be moved to %.',
      case v_revision.status when 'review' then 'in review' else 'that is ' || v_revision.status::text end,
      p_status;
  end if;
end;
$$;

-- The caller's own approved salaries, newest first: the month each applies
-- from, the figures and when it was approved. No notes.
create function public.my_salaries()
returns table (id uuid, effective_from date, basic_salary numeric, contractual_amount numeric,
               approved_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.effective_from, r.basic_salary, r.contractual_amount, r.approved_at
    from public.salary_revisions r
   where r.employee_id = public.current_employee_id() and r.status = 'approved'
   order by r.effective_from desc;
$$;

-- ---------------------------------------------------------------------------
-- Performance helpers
-- ---------------------------------------------------------------------------

-- Today where the company is. Review months and due dates follow it.
create function public.company_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Karachi')::date;
$$;

-- The quarter (its first day) a review of this month sets its goal for: the
-- quarter of the month it is held in. Mirrored in src/lib/performance.ts.
create function public.review_goal_quarter(p_period date)
returns date language sql immutable set search_path = '' as $$
  select date_trunc('quarter', p_period + interval '1 month')::date;
$$;

-- At most one goal per person and quarter.
create unique index performance_reviews_one_goal
  on public.performance_reviews (employee_id, public.review_goal_quarter(period))
  where status = 'submitted' and goal_set is not null;

create trigger performance_reviews_touch before update on public.performance_reviews
  for each row execute function public.touch_updated_at();

create function public.manager_notes_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := public.current_employee_id();
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger manager_notes_stamp
  before insert or update on public.manager_notes
  for each row execute function public.manager_notes_stamp();

create function public.hr_feedback_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.author_id := public.current_employee_id();
  return new;
end;
$$;

create trigger hr_feedback_stamp
  before insert on public.hr_feedback
  for each row execute function public.hr_feedback_stamp();

-- The employee confirms they have read feedback sent to them.
create function public.hr_feedback_acknowledge(p_feedback_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_feedback public.hr_feedback;
begin
  select * into v_feedback from public.hr_feedback where id = p_feedback_id for update;
  if not found or v_feedback.employee_id is distinct from public.current_employee_id() then
    raise exception 'Feedback not found.' using errcode = 'P0002';
  end if;
  if v_feedback.acknowledged_at is null then
    update public.hr_feedback set acknowledged_at = now() where id = p_feedback_id;
  end if;
end;
$$;

create trigger peer_review_cycles_touch before update on public.peer_review_cycles
  for each row execute function public.touch_updated_at();

-- For RLS: cycles and assignments refer to each other, so these read past it.
create function public.is_peer_reviewer_in(p_cycle_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.peer_review_assignments
                  where cycle_id = p_cycle_id and reviewer_id = public.current_employee_id());
$$;

create function public.peer_cycle_status_of(p_cycle_id uuid)
returns public.peer_cycle_status language sql stable security definer set search_path = '' as $$
  select status from public.peer_review_cycles where id = p_cycle_id;
$$;

-- Questions change only while their cycle is a draft; a new one goes last.
create function public.peer_review_questions_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status public.peer_cycle_status;
begin
  select status into v_status from public.peer_review_cycles
   where id = case when tg_op = 'DELETE' then old.cycle_id else new.cycle_id end;
  -- Its cycle is being deleted (only a draft can be), taking it along.
  if tg_op = 'DELETE' and v_status is null then
    return old;
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'Questions can only be changed before the cycle opens.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'INSERT' then
    select coalesce(max(q.sort_order) + 1, 0) into new.sort_order
      from public.peer_review_questions q where q.cycle_id = new.cycle_id;
  elsif new.cycle_id <> old.cycle_id then
    raise exception 'A question can''t move to another cycle.';
  end if;
  return new;
end;
$$;

create trigger peer_review_questions_guard
  before insert or update or delete on public.peer_review_questions
  for each row execute function public.peer_review_questions_guard();

-- Assignments: added and removed until the cycle closes, only between people
-- who may log in; a submitted one stays. Open feedback changes only while the
-- cycle is open and it isn't submitted.
create function public.peer_review_assignments_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_cycle public.peer_review_cycles;
begin
  select * into v_cycle from public.peer_review_cycles
   where id = case when tg_op = 'DELETE' then old.cycle_id else new.cycle_id end;
  if tg_op = 'DELETE' then
    -- Deleting the subject or reviewer's employee record takes it along.
    if (select count(*) from public.employees e where e.id in (old.subject_id, old.reviewer_id)) < 2 then
      return old;
    end if;
    if v_cycle.status = 'closed' or old.submitted_at is not null then
      raise exception 'A submitted review, or one in a closed cycle, can''t be removed.';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if v_cycle.status = 'closed' then
      raise exception 'This cycle is closed.';
    end if;
    if exists (select 1 from public.employees e
                where e.id in (new.subject_id, new.reviewer_id) and not public.is_login_status(e.status)) then
      raise exception 'Only employees on probation, active or on their notice period take part in peer reviews.'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if (new.cycle_id, new.subject_id, new.reviewer_id) is distinct from (old.cycle_id, old.subject_id, old.reviewer_id) then
    raise exception 'Remove the reviewer and add them again instead.';
  end if;
  if new.open_feedback is distinct from old.open_feedback
     and (v_cycle.status <> 'open' or old.submitted_at is not null) then
    raise exception 'This review can no longer be changed.';
  end if;
  return new;
end;
$$;

create trigger peer_review_assignments_guard
  before insert or update or delete on public.peer_review_assignments
  for each row execute function public.peer_review_assignments_guard();

-- An assignment added to an open cycle gets its blank answers at once.
create function public.peer_review_assignments_answers()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select status from public.peer_review_cycles where id = new.cycle_id) = 'open' then
    insert into public.peer_review_answers (assignment_id, question_id)
    select new.id, q.id from public.peer_review_questions q where q.cycle_id = new.cycle_id;
  end if;
  return null;
end;
$$;

create trigger peer_review_assignments_answers
  after insert on public.peer_review_assignments
  for each row execute function public.peer_review_assignments_answers();

-- Answers change only while the cycle is open and the review isn't submitted.
create function public.peer_review_answers_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.assignment_id, new.question_id) is distinct from (old.assignment_id, old.question_id) then
    raise exception 'An answer can''t move.';
  end if;
  if exists (select 1 from public.peer_review_assignments a
               join public.peer_review_cycles c on c.id = a.cycle_id
              where a.id = new.assignment_id and (c.status <> 'open' or a.submitted_at is not null)) then
    raise exception 'This review can no longer be changed.';
  end if;
  return new;
end;
$$;

create trigger peer_review_answers_guard
  before update on public.peer_review_answers
  for each row execute function public.peer_review_answers_guard();

-- ---------------------------------------------------------------------------
-- Peer review actions (RPCs). The only way a cycle is created or changes
-- status, and a review is submitted.
-- ---------------------------------------------------------------------------

-- Start a quarter's cycle as a draft, with the questions of the latest
-- earlier cycle (or starter questions for the first one). Returns its id.
create function public.peer_cycle_create(p_year integer, p_quarter integer, p_due_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id       uuid;
  v_previous uuid;
begin
  if not public.is_hr() then
    raise exception 'Only HR can set up peer reviews.' using errcode = '42501';
  end if;
  if p_year is null or p_quarter is null or p_quarter not between 1 and 4 then
    raise exception 'Pick a quarter.' using errcode = '23514';
  end if;
  if p_due_date is null or p_due_date < public.company_today() then
    raise exception 'Pick a due date, today or later.' using errcode = '23514';
  end if;
  if exists (select 1 from public.peer_review_cycles where year = p_year and quarter = p_quarter) then
    raise exception 'There are already peer reviews for Q% %.', p_quarter, p_year using errcode = '23505';
  end if;

  select id into v_previous from public.peer_review_cycles
   where (year, quarter) < (p_year, p_quarter) order by year desc, quarter desc limit 1;
  insert into public.peer_review_cycles (year, quarter, due_date, created_by)
  values (p_year, p_quarter, p_due_date, public.current_employee_id())
  returning id into v_id;
  if v_previous is not null then
    insert into public.peer_review_questions (cycle_id, prompt)
    select v_id, q.prompt from public.peer_review_questions q
     where q.cycle_id = v_previous order by q.sort_order;
  end if;
  if not exists (select 1 from public.peer_review_questions where cycle_id = v_id) then
    insert into public.peer_review_questions (cycle_id, prompt)
    select v_id, x.prompt from unnest(array[
      'Collaborates well and is easy to work with.',
      'Communicates clearly and keeps others informed.',
      'Delivers reliable, high-quality work.',
      'Takes ownership and follows through.']) with ordinality as x(prompt, n)
     order by x.n;
  end if;
  return v_id;
end;
$$;

-- Open a draft cycle: 3–5 questions and at least one reviewer. Each reviewer
-- gets their form.
create function public.peer_cycle_open(p_cycle_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_cycle     public.peer_review_cycles;
  v_questions integer;
begin
  if not public.is_hr() then
    raise exception 'Only HR can open peer reviews.' using errcode = '42501';
  end if;
  select * into v_cycle from public.peer_review_cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'Peer review cycle not found.' using errcode = 'P0002';
  end if;
  if v_cycle.status <> 'draft' then
    raise exception 'This cycle is already %.', v_cycle.status;
  end if;
  select count(*) into v_questions from public.peer_review_questions where cycle_id = p_cycle_id;
  if v_questions not between 3 and 5 then
    raise exception 'A cycle needs 3 to 5 questions; this one has %.', v_questions using errcode = '23514';
  end if;
  if not exists (select 1 from public.peer_review_assignments where cycle_id = p_cycle_id) then
    raise exception 'Add at least one person and their reviewers first.' using errcode = '23514';
  end if;
  if v_cycle.due_date < public.company_today() then
    raise exception 'The due date has passed. Move it first.' using errcode = '23514';
  end if;

  update public.peer_review_cycles set status = 'open', opened_at = now() where id = p_cycle_id;
  insert into public.peer_review_answers (assignment_id, question_id)
  select a.id, q.id
    from public.peer_review_assignments a
    join public.peer_review_questions q on q.cycle_id = a.cycle_id
   where a.cycle_id = p_cycle_id;
end;
$$;

-- Close an open cycle. Reviews not submitted by then are missed, and the
-- subjects can read what was written about them.
create function public.peer_cycle_close(p_cycle_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_status public.peer_cycle_status;
begin
  if not public.is_hr() then
    raise exception 'Only HR can close peer reviews.' using errcode = '42501';
  end if;
  select status into v_status from public.peer_review_cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'Peer review cycle not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'Only an open cycle can be closed; this one is %.', v_status;
  end if;
  update public.peer_review_cycles set status = 'closed', closed_at = now() where id = p_cycle_id;
end;
$$;

-- Submit one's own review while the cycle is open, every question rated.
-- Final.
create function public.peer_review_submit(p_assignment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_assignment public.peer_review_assignments;
  v_status     public.peer_cycle_status;
begin
  select * into v_assignment from public.peer_review_assignments where id = p_assignment_id for update;
  if not found or v_assignment.reviewer_id is distinct from public.current_employee_id() then
    raise exception 'Peer review not found.' using errcode = 'P0002';
  end if;
  select status into v_status from public.peer_review_cycles where id = v_assignment.cycle_id;
  if v_status <> 'open' then
    raise exception 'This cycle is closed.';
  end if;
  if v_assignment.submitted_at is not null then
    raise exception 'This review is already submitted.';
  end if;
  if exists (select 1 from public.peer_review_answers where assignment_id = p_assignment_id and rating is null) then
    raise exception 'Rate every question.' using errcode = '23514';
  end if;
  update public.peer_review_assignments
     set submitted_at = now(), open_feedback = nullif(trim(open_feedback), '')
   where id = p_assignment_id;
end;
$$;

-- What was written about the caller in closed cycles with at least two
-- responses: one row per response, without who wrote it, in an order that
-- says nothing about who submitted first.
create function public.my_peer_feedback()
returns table (cycle_id uuid, year integer, quarter integer, response integer, open_feedback text, answers jsonb)
language sql stable security definer set search_path = '' as $$
  select c.id, c.year, c.quarter,
         (row_number() over (partition by c.id order by md5(a.id::text || c.id::text)))::integer,
         a.open_feedback,
         (select jsonb_agg(jsonb_build_object('prompt', q.prompt, 'sort_order', q.sort_order,
                                              'rating', r.rating, 'comment', r.comment) order by q.sort_order)
            from public.peer_review_answers r
            join public.peer_review_questions q on q.id = r.question_id
           where r.assignment_id = a.id)
    from public.peer_review_assignments a
    join public.peer_review_cycles c on c.id = a.cycle_id
   where a.subject_id = public.current_employee_id()
     and c.status = 'closed' and a.submitted_at is not null
     and (select count(*) from public.peer_review_assignments s
           where s.cycle_id = c.id and s.subject_id = a.subject_id and s.submitted_at is not null) >= 2
   order by c.year desc, c.quarter desc, 4;
$$;

-- The last day of a quarter: after it, its forms can't be submitted.
create function public.quarter_end(p_year integer, p_quarter integer)
returns date language sql immutable set search_path = '' as $$
  select (make_date(p_year, p_quarter * 3, 1) + interval '1 month - 1 day')::date;
$$;

-- Keeps the list at 3 to 5 questions; a new one goes last.
create function public.manager_feedback_questions_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_count integer := (select count(*) from public.manager_feedback_questions);
begin
  if tg_op = 'DELETE' then
    if v_count <= 3 then
      raise exception 'Keep at least 3 questions.' using errcode = '23514';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if v_count >= 5 then
      raise exception 'There can be at most 5 questions.' using errcode = '23514';
    end if;
    select coalesce(max(q.sort_order) + 1, 0) into new.sort_order from public.manager_feedback_questions q;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger manager_feedback_questions_guard
  before insert or update or delete on public.manager_feedback_questions
  for each row execute function public.manager_feedback_questions_guard();

-- The text and ratings change only while the form is unsubmitted and its
-- quarter hasn't ended.
create function public.manager_feedback_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_form public.manager_feedback;
begin
  if tg_table_name = 'manager_feedback' then
    -- Only the text is the employee's; other changes are the database's own
    -- (manager_id cleared as that employee is deleted, the submit itself).
    if new.body is not distinct from old.body then
      return new;
    end if;
    v_form := old;
    new.updated_at := now();
  else
    if (new.feedback_id, new.prompt, new.sort_order) is distinct from (old.feedback_id, old.prompt, old.sort_order) then
      raise exception 'Only the rating can change.';
    end if;
    select * into v_form from public.manager_feedback where id = new.feedback_id;
  end if;
  if v_form.submitted_at is not null or public.company_today() > public.quarter_end(v_form.year, v_form.quarter) then
    raise exception 'This feedback can no longer be changed.';
  end if;
  return new;
end;
$$;

create trigger manager_feedback_guard
  before update on public.manager_feedback
  for each row execute function public.manager_feedback_guard();
create trigger manager_feedback_answers_guard
  before update on public.manager_feedback_answers
  for each row execute function public.manager_feedback_guard();

-- ---------------------------------------------------------------------------
-- Manager feedback actions (RPCs). The only way a form is made or submitted.
-- ---------------------------------------------------------------------------

-- The caller's form for this quarter, made the first time they open it: only
-- in the quarter's last month, for someone who may log in, had joined by its
-- first day, and has a manager. Returns its id.
create function public.manager_feedback_start()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me        uuid := public.current_employee_id();
  v_today     date := public.company_today();
  v_year      integer := extract(year from v_today);
  v_quarter   integer := extract(quarter from v_today);
  v_opens     date := make_date(v_year, v_quarter * 3, 1);
  v_manager   uuid;
  v_questions integer;
  v_id        uuid;
begin
  if v_me is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  select id into v_id from public.manager_feedback
   where employee_id = v_me and year = v_year and quarter = v_quarter;
  if found then
    return v_id;
  end if;
  if v_today < v_opens then
    raise exception 'Feedback on your manager opens on %.', to_char(v_opens, 'FMDD Mon YYYY') using errcode = '23514';
  end if;
  if (select date_of_joining from public.employees where id = v_me) > v_opens then
    raise exception 'You joined after this quarter''s feedback opened.' using errcode = '23514';
  end if;
  select manager_id into v_manager from public.org_chart_nodes where employee_id = v_me;
  if v_manager is null then
    raise exception 'You have no manager in the org chart to give feedback on.' using errcode = '23514';
  end if;
  select count(*) into v_questions from public.manager_feedback_questions;
  if v_questions not between 3 and 5 then
    raise exception 'HR hasn''t finished setting up the questions yet.' using errcode = '23514';
  end if;

  insert into public.manager_feedback (employee_id, manager_id, year, quarter)
  values (v_me, v_manager, v_year, v_quarter)
  returning id into v_id;
  insert into public.manager_feedback_answers (feedback_id, prompt, sort_order)
  select v_id, q.prompt, row_number() over (order by q.sort_order) - 1
    from public.manager_feedback_questions q;
  return v_id;
end;
$$;

-- Submit one's own form, every question rated, before the quarter ends.
-- After the 10th it is marked late. Final.
create function public.manager_feedback_submit(p_feedback_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_form public.manager_feedback;
begin
  select * into v_form from public.manager_feedback where id = p_feedback_id for update;
  if not found or v_form.employee_id is distinct from public.current_employee_id() then
    raise exception 'Feedback not found.' using errcode = 'P0002';
  end if;
  if v_form.submitted_at is not null then
    raise exception 'This feedback is already submitted.';
  end if;
  if public.company_today() > public.quarter_end(v_form.year, v_form.quarter) then
    raise exception 'Q% % has ended; this feedback can no longer be submitted.', v_form.quarter, v_form.year;
  end if;
  if exists (select 1 from public.manager_feedback_answers where feedback_id = p_feedback_id and rating is null) then
    raise exception 'Rate every question.' using errcode = '23514';
  end if;
  update public.manager_feedback
     set submitted_at = now(), late = public.company_today() > due_date, body = nullif(trim(body), '')
   where id = p_feedback_id;
end;
$$;

-- HR: one quarter's feedback, as a list of who owes it — everyone who may log
-- in, had joined by the first day of the quarter's last month and has a
-- manager — with their form if started (the manager it was started for).
-- Leaves out feedback about the caller.
create function public.manager_feedback_due(p_year integer, p_quarter integer)
returns table (employee_id uuid, full_name text, manager_id uuid, manager_name text, feedback_id uuid,
               due_date date, submitted_at timestamptz, late boolean)
language sql stable security definer set search_path = '' as $$
  select e.id, e.full_name, coalesce(f.manager_id, n.manager_id), m.full_name, f.id,
         make_date(p_year, p_quarter * 3, 10), f.submitted_at, f.late
    from public.employees e
    left join public.org_chart_nodes n on n.employee_id = e.id
    left join public.manager_feedback f on f.employee_id = e.id and f.year = p_year and f.quarter = p_quarter
    left join public.employees m on m.id = coalesce(f.manager_id, n.manager_id)
   where public.is_hr() and p_quarter between 1 and 4
     -- Not who has or hasn't written about the HR person looking.
     and coalesce(f.manager_id, n.manager_id) is distinct from public.current_employee_id()
     and (f.id is not null
          or (public.is_login_status(e.status) and n.manager_id is not null
              and e.date_of_joining <= make_date(p_year, p_quarter * 3, 1)))
   order by e.full_name;
$$;

-- ---------------------------------------------------------------------------
-- Review actions (RPCs). The only way a review is created or changes status.
-- ---------------------------------------------------------------------------

-- Start the review of a month that is over, as the employee's manager, with
-- their designation's KPIs and expectations copied in. Only someone who may
-- log in and had joined by the month's first day is reviewed.
create function public.review_start(p_employee_id uuid, p_period date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_period   date := date_trunc('month', p_period)::date;
  v_employee public.employees;
  v_id       uuid;
begin
  if p_employee_id is null or not public.is_manager_of(p_employee_id) then
    raise exception 'Only their manager can start a review.' using errcode = '42501';
  end if;
  if v_period is null or v_period >= date_trunc('month', public.company_today())::date then
    raise exception 'A month can be reviewed once it is over.' using errcode = '23514';
  end if;
  select * into v_employee from public.employees where id = p_employee_id;
  if not public.is_login_status(v_employee.status) then
    raise exception 'Only employees on probation, active or on their notice period are reviewed.'
      using errcode = '23514';
  end if;
  if v_employee.date_of_joining > v_period then
    raise exception '% joined after % began.', v_employee.full_name, to_char(v_period, 'FMMonth YYYY')
      using errcode = '23514';
  end if;
  if exists (select 1 from public.performance_reviews where employee_id = p_employee_id and period = v_period) then
    raise exception '% already has a review for %.', v_employee.full_name, to_char(v_period, 'FMMonth YYYY')
      using errcode = '23505';
  end if;

  insert into public.performance_reviews (employee_id, period, created_by)
  values (p_employee_id, v_period, public.current_employee_id())
  returning id into v_id;
  insert into public.performance_review_kpis (review_id, kpi_id, name, description, target, weight, sort_order)
  select v_id, k.id, k.name, k.description, k.target, k.weight, row_number() over (order by lower(k.name)) - 1
    from public.kpis k where k.designation_id = v_employee.designation_id;
  insert into public.performance_review_expectations (review_id, expectation_id, title, sort_order)
  select v_id, x.id, x.title, row_number() over (order by lower(x.title)) - 1
    from public.expectations x where x.designation_id = v_employee.designation_id;
  return v_id;
end;
$$;

-- Submit a draft, as the employee's manager, once everything is filled in:
-- every KPI rated (a note for 1 or 2), every expectation met or not (a note
-- when not), the evaluation and feedback, progress on the quarter's goal if
-- it has one, and the next goal if its quarter has none yet. Earlier drafts
-- of the same person go first.
create function public.review_submit(p_review_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_review  public.performance_reviews;
  v_earlier date;
  v_rated   text;
  v_sets    boolean;
begin
  select * into v_review from public.performance_reviews where id = p_review_id for update;
  if not found or not (public.is_manager_of(v_review.employee_id) or public.is_hr()) then
    raise exception 'Review not found.' using errcode = 'P0002';
  end if;
  if not public.is_manager_of(v_review.employee_id) then
    raise exception 'Only their manager can submit a review.' using errcode = '42501';
  end if;
  if v_review.status <> 'draft' then
    raise exception 'This review is already submitted.';
  end if;
  select min(period) into v_earlier from public.performance_reviews
   where employee_id = v_review.employee_id and period < v_review.period and status = 'draft';
  if v_earlier is not null then
    raise exception 'Submit the % review first.', to_char(v_earlier, 'FMMonth YYYY');
  end if;

  if exists (select 1 from public.performance_review_kpis where review_id = p_review_id and rating is null) then
    raise exception 'Rate every KPI.' using errcode = '23514';
  end if;
  if exists (select 1 from public.performance_review_kpis
              where review_id = p_review_id and rating <= 2 and nullif(trim(note), '') is null) then
    raise exception 'Add a note to every KPI rated 1 or 2.' using errcode = '23514';
  end if;
  if exists (select 1 from public.performance_review_expectations where review_id = p_review_id and met is null) then
    raise exception 'Mark every expectation met or not met.' using errcode = '23514';
  end if;
  if exists (select 1 from public.performance_review_expectations
              where review_id = p_review_id and not met and nullif(trim(note), '') is null) then
    raise exception 'Add a note to every expectation not met.' using errcode = '23514';
  end if;
  if nullif(trim(v_review.evaluation), '') is null then
    raise exception 'Write the evaluation.' using errcode = '23514';
  end if;
  if nullif(trim(v_review.feedback), '') is null then
    raise exception 'Write the feedback.' using errcode = '23514';
  end if;

  -- The goal of the reviewed month's quarter, and whether the quarter the
  -- review is held in still needs one.
  select r.goal_set into v_rated from public.performance_reviews r
   where r.employee_id = v_review.employee_id and r.id <> p_review_id and r.status = 'submitted'
     and r.goal_set is not null
     and public.review_goal_quarter(r.period) = date_trunc('quarter', v_review.period::timestamp)::date;
  v_sets := not exists (
    select 1 from public.performance_reviews r
     where r.employee_id = v_review.employee_id and r.id <> p_review_id and r.status = 'submitted'
       and r.goal_set is not null
       and public.review_goal_quarter(r.period) = public.review_goal_quarter(v_review.period));
  if v_rated is not null and v_review.goal_progress is null then
    raise exception 'Rate progress on the goal out of 10.' using errcode = '23514';
  end if;
  if v_sets and nullif(trim(v_review.goal_set), '') is null then
    raise exception 'Set the goal for Q% %.', extract(quarter from public.review_goal_quarter(v_review.period)),
      extract(year from public.review_goal_quarter(v_review.period))
      using errcode = '23514';
  end if;

  update public.performance_reviews
     set status = 'submitted', submitted_by = public.current_employee_id(), submitted_at = now(),
         late = case when submitted_at is null then public.company_today() > due_date else late end,
         evaluation = trim(evaluation), feedback = trim(feedback),
         goal_set = case when v_sets then trim(goal_set) end,
         goal_rated = v_rated,
         goal_progress = case when v_rated is not null then goal_progress end
   where id = p_review_id;
end;
$$;

-- The employee confirms they have read their submitted review.
create function public.review_acknowledge(p_review_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_review public.performance_reviews;
begin
  select * into v_review from public.performance_reviews where id = p_review_id for update;
  if not found or v_review.employee_id is distinct from public.current_employee_id()
     or v_review.status <> 'submitted' then
    raise exception 'Review not found.' using errcode = 'P0002';
  end if;
  if v_review.acknowledged_at is null then
    update public.performance_reviews set acknowledged_at = now() where id = p_review_id;
  end if;
end;
$$;

-- One month's reviews, as a list of who is due one: everyone who may log in
-- and had joined by the month's first day, with their manager and their
-- review if started. HR sees everyone (those without a manager too, who
-- can't be reviewed); a manager sees their direct reports.
create function public.performance_due(p_period date)
returns table (employee_id uuid, full_name text, designation text, manager_id uuid, manager_name text,
               review_id uuid, status public.review_status, due_date date, submitted_at timestamptz,
               late boolean, acknowledged_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select e.id, e.full_name, g.title, n.manager_id, m.full_name, r.id, r.status,
         (date_trunc('month', p_period)::date + interval '1 month 9 days')::date,
         r.submitted_at, r.late, r.acknowledged_at
    from public.employees e
    left join public.designations g on g.id = e.designation_id
    left join public.org_chart_nodes n on n.employee_id = e.id
    left join public.employees m on m.id = n.manager_id
    left join public.performance_reviews r
      on r.employee_id = e.id and r.period = date_trunc('month', p_period)::date
   where public.is_login_status(e.status) and e.date_of_joining <= date_trunc('month', p_period)::date
     and (public.is_hr() or n.manager_id = public.current_employee_id())
   order by e.full_name;
$$;

-- ---------------------------------------------------------------------------
-- Directory view: the non-sensitive columns every logged-in employee may see
-- (needed for the org chart). Runs with owner rights, so it bypasses the
-- employees RLS on purpose and gates on the caller being a bound employee.
-- Department and designation are exposed as names, not ids.
-- ---------------------------------------------------------------------------
create view public.employee_directory with (security_invoker = false) as
  select e.id, e.employee_number, e.full_name, e.company_email,
         g.title as designation, d.name as department, e.status
    from public.employees e
    left join public.departments d on d.id = e.department_id
    left join public.designations g on g.id = e.designation_id
   where (select public.current_employee_id()) is not null;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on public.employees, public.employee_documents, public.org_chart_nodes,
              public.departments, public.designations, public.kpis,
              public.leave_types, public.leave_quotas, public.leaves, public.holidays,
              public.job_openings, public.job_opening_interviewers, public.job_applications,
              public.application_stage_events, public.branding, public.announcements, public.employee_directory,
              public.onboarding_template_sections, public.onboarding_template_tasks,
              public.onboardings, public.onboarding_tasks, public.payrolls, public.payroll_items,
              public.offboarding_template_sections, public.offboarding_template_tasks,
              public.offboardings, public.offboarding_tasks, public.salary_revisions,
              public.vendors, public.equipment, public.equipment_assignments,
              public.expectations, public.performance_reviews, public.performance_review_kpis,
              public.performance_review_expectations, public.manager_notes, public.guides,
              public.hr_feedback, public.peer_review_cycles, public.peer_review_questions,
              public.peer_review_assignments, public.peer_review_answers,
              public.manager_feedback_questions, public.manager_feedback, public.manager_feedback_answers
  from anon, authenticated;

grant select, delete on public.employees to authenticated;
-- user_id and employee_number are deliberately not writable by clients.
grant insert (full_name, company_email, date_of_joining, date_of_separation, personal_email,
              phone, cnic_number, cnic_expiry, dob, department_id, designation_id, bank, iban,
              emergency_contact, employment_type, status, app_role, login_method),
      update (full_name, company_email, date_of_joining, date_of_separation, personal_email,
              phone, cnic_number, cnic_expiry, dob, department_id, designation_id, bank, iban,
              emergency_contact, employment_type, status, app_role, login_method)
  on public.employees to authenticated;

grant select on public.employee_documents to authenticated;
grant insert (employee_id, doc_type, file_name, storage_path, mime_type, size_bytes),
      update (deleted_at)
  on public.employee_documents to authenticated;

grant select, insert, update, delete on public.org_chart_nodes to authenticated;

grant select, delete on public.departments, public.designations, public.kpis to authenticated;
grant insert (name, description, business_function), update (name, description, business_function)
  on public.departments to authenticated;
grant insert (department_id, title, description), update (department_id, title, description)
  on public.designations to authenticated;
grant insert (designation_id, name, description, target, weight),
      update (designation_id, name, description, target, weight)
  on public.kpis to authenticated;
grant select, delete on public.expectations to authenticated;
grant insert (designation_id, title), update (designation_id, title) on public.expectations to authenticated;

grant select, delete on public.leave_types, public.leave_quotas to authenticated;
grant insert (name, description, annual_quota, is_active),
      update (name, description, annual_quota, is_active)
  on public.leave_types to authenticated;
grant insert (employee_id, leave_type_id, year, days), update (days)
  on public.leave_quotas to authenticated;
-- Status, approvals and stamps change only through the functions above.
grant select on public.leaves to authenticated;
grant insert (employee_id, leave_type_id, start_date, end_date, half_day, reason),
      update (start_date, end_date, half_day)
  on public.leaves to authenticated;
grant select, delete on public.holidays to authenticated;
grant insert (name, start_date, end_date), update (name, start_date, end_date)
  on public.holidays to authenticated;

grant select, delete on public.job_openings to authenticated;
-- created_by is stamped by the trigger, so it isn't writable.
grant insert (title, department_id, designation_id, status, due_date, description, manager_id),
      update (title, department_id, designation_id, status, due_date, description, manager_id)
  on public.job_openings to authenticated;
grant select, insert, delete on public.job_opening_interviewers to authenticated;
-- Applications are only ever written by submit_application and the stage
-- functions. Every column but the salaries and HR's notes (see
-- application_hr_details).
grant select (id, job_opening_id, full_name, email, phone, note, resume_path, resume_name,
              created_at, stage, stage_changed_at)
  on public.job_applications to authenticated;
grant select on public.application_stage_events to authenticated;
grant select, update (logo_path, primary_color, perks) on public.branding to authenticated;

grant select, delete on public.announcements to authenticated;
-- created_by is stamped by the trigger, so it isn't writable.
grant insert (body, pinned_until), update (body, pinned_until)
  on public.announcements to authenticated;

-- sort_order is set by the trigger and the reorder functions only.
grant select, delete on public.onboarding_template_sections, public.onboarding_template_tasks
  to authenticated;
grant insert (name), update (name) on public.onboarding_template_sections to authenticated;
grant insert (section_id, title), update (title) on public.onboarding_template_tasks to authenticated;
-- Onboardings change only through application_hire and the onboarding functions.
grant select on public.onboardings, public.onboarding_tasks to authenticated;

grant select, delete on public.offboarding_template_sections, public.offboarding_template_tasks
  to authenticated;
grant insert (name), update (name) on public.offboarding_template_sections to authenticated;
grant insert (section_id, title), update (title) on public.offboarding_template_tasks to authenticated;
-- Offboardings change only through employees_offboarding and the offboarding functions.
grant select on public.offboardings, public.offboarding_tasks to authenticated;

-- Payrolls change only through the functions above.
grant select on public.payrolls to authenticated;
-- Name, number and the worked-out columns aren't writable; the trigger
-- decides who may change which of the rest.
grant select, delete on public.payroll_items to authenticated;
grant insert (payroll_id, employee_id),
      update (basic_salary, contractual_amount, absent_days, hr_remarks, bonus_type, bonus_value,
              absent_deduction, allowance, advance_salary, loan_deduction, tax_amount, finance_remarks,
              arrears)
  on public.payroll_items to authenticated;

-- Appraisals: status and stamps change only through the guard and
-- salary_revision_move.
grant select, delete on public.salary_revisions to authenticated;
grant insert (employee_id, effective_from, basic_salary, contractual_amount, note),
      update (effective_from, basic_salary, contractual_amount, note)
  on public.salary_revisions to authenticated;

grant select, delete on public.vendors to authenticated;
grant insert (name, description, bank_name, iban), update (name, description, bank_name, iban)
  on public.vendors to authenticated;
-- Who has it changes only through the functions above; created_by is stamped.
grant select, delete on public.equipment to authenticated;
grant insert (name, identifier, status, purchase_date, vendor_id, invoice_path, photo_path),
      update (name, identifier, status, purchase_date, vendor_id, invoice_path, photo_path)
  on public.equipment to authenticated;
grant select on public.equipment_assignments to authenticated;

-- Reviews are created and change status only through the functions above;
-- while a draft, the manager writes these columns (RLS).
grant select, update (evaluation, feedback, goal_set, goal_progress) on public.performance_reviews to authenticated;
grant select, update (rating, note) on public.performance_review_kpis to authenticated;
grant select, update (met, note) on public.performance_review_expectations to authenticated;
-- author_id is stamped by the trigger, so it isn't writable.
grant select, delete on public.manager_notes to authenticated;
grant insert (employee_id, body), update (body) on public.manager_notes to authenticated;
-- Sent feedback isn't editable: no update grant. author_id and
-- acknowledged_at are set by the database.
grant select, delete on public.hr_feedback to authenticated;
grant insert (employee_id, kind, body) on public.hr_feedback to authenticated;
-- Cycles are created and move only through the functions above; HR moves
-- the due date and deletes a draft.
grant select, delete, update (due_date) on public.peer_review_cycles to authenticated;
grant select, delete, insert (cycle_id, prompt), update (prompt) on public.peer_review_questions to authenticated;
-- HR adds and removes reviewers; the reviewer writes their open feedback.
grant select, delete, insert (cycle_id, subject_id, reviewer_id), update (open_feedback)
  on public.peer_review_assignments to authenticated;
-- Made by the database; the reviewer writes their ratings and comments.
grant select, update (rating, comment) on public.peer_review_answers to authenticated;
-- sort_order is set by the trigger, which also keeps 3 to 5 questions.
grant select, delete, insert (prompt), update (prompt) on public.manager_feedback_questions to authenticated;
-- Forms are made and submitted only by the functions above.
grant select, update (body) on public.manager_feedback to authenticated;
grant select, update (rating) on public.manager_feedback_answers to authenticated;

grant select on public.employee_directory to authenticated;

-- Read only: the guides are kept from the Supabase dashboard.
grant select on public.guides to authenticated;

revoke execute on function
  public.is_login_status(public.employee_status), public.current_employee_id(),
  public.current_app_role(), public.is_hr(), public.is_company_admin(),
  public.bind_employee(), public.org_chart_remove(uuid),
  public.hook_before_user_created(jsonb), public.employees_guard(),
  public.employee_documents_stamp(), public.org_chart_guard(), public.touch_updated_at(),
  public.leave_days(date, date, boolean), public.is_manager_of(uuid), public.leaves_guard(),
  public.holidays_recount(),
  public.leave_decide(uuid, boolean, text), public.leave_cancel(uuid),
  public.leave_balances(uuid, integer), public.valid_perks(jsonb), public.job_openings_stamp(),
  public.job_accepts_applications(text), public.job_posting(uuid), public.public_branding(),
  public.submit_application(uuid, text, text, text, integer, text, text, text),
  public.announcements_stamp(),
  public.application_next_stages(public.application_stage),
  public.application_stage_needs_reason(public.application_stage),
  public.application_team_stage(public.application_stage),
  public.application_team_movable(public.application_stage),
  public.is_hiring_team(uuid), public.on_hiring_team(),
  public.can_see_application(uuid, public.application_stage), public.application_hr_details(uuid),
  public.application_set_hr_details(uuid, integer, text),
  public.application_move(uuid, public.application_stage, text),
  public.application_undo(uuid, text), public.application_count(public.job_openings),
  public.onboarding_template_sections_stamp(), public.onboarding_template_tasks_stamp(),
  public.onboarding_reorder_sections(uuid[]), public.onboarding_reorder_tasks(uuid, uuid[]),
  public.application_hire(uuid, text, date, text), public.onboarding_task_set(uuid, boolean),
  public.onboarding_complete(uuid), public.onboarding_cancel(uuid, text),
  public.offboarding_template_sections_stamp(), public.offboarding_template_tasks_stamp(),
  public.can_work_offboarding(uuid), public.employees_offboarding(),
  public.offboarding_reorder_sections(uuid[]), public.offboarding_reorder_tasks(uuid, uuid[]),
  public.offboarding_set_details(uuid, public.offboarding_reason, date),
  public.offboarding_task_set(uuid, boolean), public.offboarding_sign_off(uuid),
  public.offboarding_cancel(uuid, text),
  public.is_finance(), public.can_manage_payroll(), public.payroll_items_guard(),
  public.payroll_create(integer, integer), public.payroll_move(uuid, public.payroll_status),
  public.salary_on(uuid, date), public.salary_revisions_guard(),
  public.salary_revision_move(uuid, public.salary_revision_status, text), public.my_salaries(),
  public.can_manage_operations(), public.equipment_guard(),
  public.equipment_assign(uuid, uuid, date), public.equipment_unassign(uuid, date), public.my_equipment(),
  public.company_today(), public.review_goal_quarter(date), public.review_start(uuid, date),
  public.review_submit(uuid), public.review_acknowledge(uuid),
  public.performance_due(date), public.manager_notes_stamp(), public.current_business_function(),
  public.hr_feedback_stamp(), public.hr_feedback_acknowledge(uuid),
  public.peer_review_questions_guard(), public.peer_review_assignments_guard(),
  public.peer_review_assignments_answers(), public.peer_review_answers_guard(),
  public.peer_cycle_create(integer, integer, date), public.peer_cycle_open(uuid), public.peer_cycle_close(uuid),
  public.peer_review_submit(uuid), public.my_peer_feedback(), public.is_peer_reviewer_in(uuid),
  public.peer_cycle_status_of(uuid),
  public.quarter_end(integer, integer), public.manager_feedback_questions_guard(), public.manager_feedback_guard(),
  public.manager_feedback_start(), public.manager_feedback_submit(uuid), public.manager_feedback_due(integer, integer)
  from public, anon, authenticated;

grant execute on function
  public.is_login_status(public.employee_status), public.current_employee_id(),
  public.current_app_role(), public.is_hr(), public.is_company_admin(),
  public.bind_employee(), public.org_chart_remove(uuid),
  public.leave_days(date, date, boolean), public.is_manager_of(uuid),
  public.leave_decide(uuid, boolean, text), public.leave_cancel(uuid),
  public.leave_balances(uuid, integer), public.valid_perks(jsonb),
  public.application_next_stages(public.application_stage),
  public.application_stage_needs_reason(public.application_stage),
  public.application_team_stage(public.application_stage),
  public.application_team_movable(public.application_stage),
  public.is_hiring_team(uuid), public.on_hiring_team(),
  public.can_see_application(uuid, public.application_stage), public.application_hr_details(uuid),
  public.application_set_hr_details(uuid, integer, text),
  public.application_move(uuid, public.application_stage, text),
  public.application_undo(uuid, text), public.application_count(public.job_openings),
  public.onboarding_reorder_sections(uuid[]), public.onboarding_reorder_tasks(uuid, uuid[]),
  public.application_hire(uuid, text, date, text), public.onboarding_task_set(uuid, boolean),
  public.onboarding_complete(uuid), public.onboarding_cancel(uuid, text),
  public.can_work_offboarding(uuid),
  public.offboarding_reorder_sections(uuid[]), public.offboarding_reorder_tasks(uuid, uuid[]),
  public.offboarding_set_details(uuid, public.offboarding_reason, date),
  public.offboarding_task_set(uuid, boolean), public.offboarding_sign_off(uuid),
  public.offboarding_cancel(uuid, text),
  public.is_finance(), public.can_manage_payroll(),
  public.payroll_create(integer, integer), public.payroll_move(uuid, public.payroll_status),
  public.salary_revision_move(uuid, public.salary_revision_status, text), public.my_salaries(),
  public.can_manage_operations(),
  public.equipment_assign(uuid, uuid, date), public.equipment_unassign(uuid, date), public.my_equipment(),
  public.company_today(), public.review_goal_quarter(date), public.review_start(uuid, date),
  public.review_submit(uuid), public.review_acknowledge(uuid),
  public.performance_due(date), public.current_business_function(), public.hr_feedback_acknowledge(uuid),
  public.peer_cycle_create(integer, integer, date), public.peer_cycle_open(uuid), public.peer_cycle_close(uuid),
  public.peer_review_submit(uuid), public.my_peer_feedback(), public.is_peer_reviewer_in(uuid),
  public.peer_cycle_status_of(uuid),
  public.quarter_end(integer, integer), public.manager_feedback_start(), public.manager_feedback_submit(uuid),
  public.manager_feedback_due(integer, integer)
  to authenticated;

-- An employee's own payslips.
revoke execute on function public.my_payslips() from public, anon, authenticated;
grant execute on function public.my_payslips() to authenticated;

-- The public job page, for people who aren't signed in.
grant execute on function
  public.job_accepts_applications(text), public.job_posting(uuid), public.public_branding(),
  public.submit_application(uuid, text, text, text, integer, text, text, text)
  to anon, authenticated;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

-- The set-password Edge Function's lookup.
revoke execute on function public.auth_user_ids_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_ids_by_email(text) to service_role;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.employees enable row level security;
alter table public.employee_documents enable row level security;
alter table public.org_chart_nodes enable row level security;
alter table public.departments enable row level security;
alter table public.designations enable row level security;
alter table public.kpis enable row level security;
alter table public.leave_types enable row level security;
alter table public.leave_quotas enable row level security;
alter table public.leaves enable row level security;
alter table public.holidays enable row level security;
alter table public.job_openings enable row level security;
alter table public.job_opening_interviewers enable row level security;
alter table public.job_applications enable row level security;
alter table public.application_stage_events enable row level security;
alter table public.branding enable row level security;
alter table public.announcements enable row level security;
alter table public.onboarding_template_sections enable row level security;
alter table public.onboarding_template_tasks enable row level security;
alter table public.onboardings enable row level security;
alter table public.onboarding_tasks enable row level security;
alter table public.offboarding_template_sections enable row level security;
alter table public.offboarding_template_tasks enable row level security;
alter table public.offboardings enable row level security;
alter table public.offboarding_tasks enable row level security;
alter table public.payrolls enable row level security;
alter table public.payroll_items enable row level security;
alter table public.salary_revisions enable row level security;
alter table public.vendors enable row level security;
alter table public.equipment enable row level security;
alter table public.equipment_assignments enable row level security;
alter table public.expectations enable row level security;
alter table public.performance_reviews enable row level security;
alter table public.performance_review_kpis enable row level security;
alter table public.performance_review_expectations enable row level security;
alter table public.manager_notes enable row level security;
alter table public.hr_feedback enable row level security;
alter table public.peer_review_cycles enable row level security;
alter table public.peer_review_questions enable row level security;
alter table public.peer_review_assignments enable row level security;
alter table public.peer_review_answers enable row level security;
alter table public.manager_feedback_questions enable row level security;
alter table public.manager_feedback enable row level security;
alter table public.manager_feedback_answers enable row level security;
alter table public.guides enable row level security;

-- Employees: HR/company admins see and edit all; members see only themselves.
create policy employees_select on public.employees for select to authenticated
  using ((select public.is_hr()) or id = (select public.current_employee_id()));
create policy employees_insert on public.employees for insert to authenticated
  with check ((select public.is_hr()));
create policy employees_update on public.employees for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy employees_delete on public.employees for delete to authenticated
  using ((select public.is_company_admin()));

-- Documents. HR sees soft-deleted rows (the app shows them on request, and
-- the soft-delete UPDATE needs them to pass RLS); the employee doesn't.
create policy employee_documents_select on public.employee_documents for select to authenticated
  using ((select public.is_hr())
         or (employee_id = (select public.current_employee_id()) and deleted_at is null));
create policy employee_documents_insert on public.employee_documents for insert to authenticated
  with check ((select public.is_hr()));
create policy employee_documents_update on public.employee_documents for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
-- No delete: a document row goes only with its employee (cascade).

-- Org chart: every employee can view, HR/company admins can change.
create policy org_chart_select on public.org_chart_nodes for select to authenticated
  using ((select public.current_employee_id()) is not null);
create policy org_chart_insert on public.org_chart_nodes for insert to authenticated
  with check ((select public.is_hr()));
create policy org_chart_update on public.org_chart_nodes for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy org_chart_delete on public.org_chart_nodes for delete to authenticated
  using ((select public.is_hr()));

-- Company configuration: every employee reads, company admins write.
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

create policy expectations_select on public.expectations for select to authenticated
  using ((select public.current_employee_id()) is not null);
create policy expectations_insert on public.expectations for insert to authenticated
  with check ((select public.is_company_admin()));
create policy expectations_update on public.expectations for update to authenticated
  using ((select public.is_company_admin())) with check ((select public.is_company_admin()));
create policy expectations_delete on public.expectations for delete to authenticated
  using ((select public.is_company_admin()));

-- Leave types: every employee reads, HR writes.
create policy leave_types_select on public.leave_types for select to authenticated
  using ((select public.current_employee_id()) is not null);
create policy leave_types_insert on public.leave_types for insert to authenticated
  with check ((select public.is_hr()));
create policy leave_types_update on public.leave_types for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy leave_types_delete on public.leave_types for delete to authenticated
  using ((select public.is_hr()));

-- Quotas: HR reads and writes all; employees read their own.
create policy leave_quotas_select on public.leave_quotas for select to authenticated
  using ((select public.is_hr()) or employee_id = (select public.current_employee_id()));
create policy leave_quotas_insert on public.leave_quotas for insert to authenticated
  with check ((select public.is_hr()));
create policy leave_quotas_update on public.leave_quotas for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy leave_quotas_delete on public.leave_quotas for delete to authenticated
  using ((select public.is_hr()));

-- Holidays: every employee reads, HR writes.
create policy holidays_select on public.holidays for select to authenticated
  using ((select public.current_employee_id()) is not null);
create policy holidays_insert on public.holidays for insert to authenticated
  with check ((select public.is_hr()));
create policy holidays_update on public.holidays for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy holidays_delete on public.holidays for delete to authenticated
  using ((select public.is_hr()));

-- Leaves: HR sees all, managers their reports', employees their own.
-- Employees apply for themselves, HR for anyone. Only HR edits (dates).
create policy leaves_select on public.leaves for select to authenticated
  using ((select public.is_hr()) or employee_id = (select public.current_employee_id())
         or public.is_manager_of(employee_id));
create policy leaves_insert on public.leaves for insert to authenticated
  with check ((select public.is_hr()) or employee_id = (select public.current_employee_id()));
create policy leaves_update on public.leaves for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));

-- Job openings and their interviewers: HR manages; a job's hiring team reads
-- the job.
create policy job_openings_select on public.job_openings for select to authenticated
  using ((select public.is_hr()) or public.is_hiring_team(id));
create policy job_openings_insert on public.job_openings for insert to authenticated
  with check ((select public.is_hr()));
create policy job_openings_update on public.job_openings for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy job_openings_delete on public.job_openings for delete to authenticated
  using ((select public.is_hr()));

create policy job_opening_interviewers_select on public.job_opening_interviewers
  for select to authenticated using ((select public.is_hr()));
create policy job_opening_interviewers_insert on public.job_opening_interviewers
  for insert to authenticated with check ((select public.is_hr()));
create policy job_opening_interviewers_delete on public.job_opening_interviewers
  for delete to authenticated using ((select public.is_hr()));

-- Applications: HR sees all; the hiring team its job's, from shortlisted
-- through cleared. Their timeline follows the application.
create policy job_applications_select on public.job_applications for select to authenticated
  using (public.can_see_application(job_opening_id, stage));
create policy application_stage_events_select on public.application_stage_events
  for select to authenticated
  using (exists (select 1 from public.job_applications a where a.id = application_id));

-- Branding: every employee reads, company admins change.
create policy branding_select on public.branding for select to authenticated
  using ((select public.current_employee_id()) is not null);
create policy branding_update on public.branding for update to authenticated
  using ((select public.is_company_admin())) with check ((select public.is_company_admin()));

-- Announcements: every employee reads all of them; HR manages them.
create policy announcements_select on public.announcements for select to authenticated
  using ((select public.current_employee_id()) is not null);
create policy announcements_insert on public.announcements for insert to authenticated
  with check ((select public.is_hr()));
create policy announcements_update on public.announcements for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy announcements_delete on public.announcements for delete to authenticated
  using ((select public.is_hr()));

-- Guides: an employee's own business function; company admins all.
create policy guides_select on public.guides for select to authenticated
  using ((select public.is_company_admin())
         or business_function = (select public.current_business_function()));

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

-- The offboarding checklist: HR reads it, company admins change it.
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

-- Payrolls and their lines: HR and finance only. payroll_items_guard decides
-- who may change which columns, and only while the payroll is a draft.
create policy payrolls_select on public.payrolls
  for select to authenticated using ((select public.can_manage_payroll()));
create policy payroll_items_select on public.payroll_items
  for select to authenticated using ((select public.can_manage_payroll()));
create policy payroll_items_insert on public.payroll_items
  for insert to authenticated with check ((select public.can_manage_payroll()));
create policy payroll_items_update on public.payroll_items
  for update to authenticated
  using ((select public.can_manage_payroll())) with check ((select public.can_manage_payroll()));
create policy payroll_items_delete on public.payroll_items
  for delete to authenticated using ((select public.can_manage_payroll()));

-- Appraisals: HR (and company admins) see and write everyone's but their own.
-- Writes are drafts only (salary_revisions_guard). Employees read their own
-- approved salaries through my_salaries.
create policy salary_revisions_select on public.salary_revisions for select to authenticated
  using ((select public.is_hr()) and employee_id is distinct from (select public.current_employee_id()));
create policy salary_revisions_insert on public.salary_revisions for insert to authenticated
  with check ((select public.is_hr()));
create policy salary_revisions_update on public.salary_revisions for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy salary_revisions_delete on public.salary_revisions for delete to authenticated
  using ((select public.is_hr()));

-- Vendors and equipment: HR, finance and company admins only; only a company
-- admin deletes a vendor. Employees see their own equipment through
-- my_equipment. The history is written only by the equipment functions.
create policy vendors_select on public.vendors
  for select to authenticated using ((select public.can_manage_operations()));
create policy vendors_insert on public.vendors
  for insert to authenticated with check ((select public.can_manage_operations()));
create policy vendors_update on public.vendors
  for update to authenticated
  using ((select public.can_manage_operations())) with check ((select public.can_manage_operations()));
create policy vendors_delete on public.vendors
  for delete to authenticated using ((select public.is_company_admin()));

create policy equipment_select on public.equipment
  for select to authenticated using ((select public.can_manage_operations()));
create policy equipment_insert on public.equipment
  for insert to authenticated with check ((select public.can_manage_operations()));
create policy equipment_update on public.equipment
  for update to authenticated
  using ((select public.can_manage_operations())) with check ((select public.can_manage_operations()));
create policy equipment_delete on public.equipment
  for delete to authenticated using ((select public.can_manage_operations()));

create policy equipment_assignments_select on public.equipment_assignments
  for select to authenticated using ((select public.can_manage_operations()));

-- HR reads every review but drafts of their own; the employee's current
-- manager reads all of theirs and edits drafts; the employee reads their own
-- once submitted.
create policy performance_reviews_select on public.performance_reviews for select to authenticated
  using (((select public.is_hr()) and employee_id is distinct from (select public.current_employee_id()))
         or public.is_manager_of(employee_id)
         or (status = 'submitted' and employee_id = (select public.current_employee_id())));
create policy performance_reviews_update on public.performance_reviews for update to authenticated
  using (status = 'draft' and public.is_manager_of(employee_id))
  with check (status = 'draft' and public.is_manager_of(employee_id));

-- A review's lines: seen with the review, edited with its draft.
create policy performance_review_kpis_select on public.performance_review_kpis for select to authenticated
  using (exists (select 1 from public.performance_reviews r where r.id = review_id));
create policy performance_review_kpis_update on public.performance_review_kpis for update to authenticated
  using (exists (select 1 from public.performance_reviews r
                  where r.id = review_id and r.status = 'draft' and public.is_manager_of(r.employee_id)))
  with check (exists (select 1 from public.performance_reviews r
                       where r.id = review_id and r.status = 'draft' and public.is_manager_of(r.employee_id)));
create policy performance_review_expectations_select on public.performance_review_expectations
  for select to authenticated
  using (exists (select 1 from public.performance_reviews r where r.id = review_id));
create policy performance_review_expectations_update on public.performance_review_expectations
  for update to authenticated
  using (exists (select 1 from public.performance_reviews r
                  where r.id = review_id and r.status = 'draft' and public.is_manager_of(r.employee_id)))
  with check (exists (select 1 from public.performance_reviews r
                       where r.id = review_id and r.status = 'draft' and public.is_manager_of(r.employee_id)));

-- Private notes: the author only. A note can only be started about one of
-- their direct reports.
create policy manager_notes_select on public.manager_notes for select to authenticated
  using (author_id = (select public.current_employee_id()));
create policy manager_notes_insert on public.manager_notes for insert to authenticated
  with check (author_id = (select public.current_employee_id()) and public.is_manager_of(employee_id));
create policy manager_notes_update on public.manager_notes for update to authenticated
  using (author_id = (select public.current_employee_id()))
  with check (author_id = (select public.current_employee_id()));
create policy manager_notes_delete on public.manager_notes for delete to authenticated
  using (author_id = (select public.current_employee_id()));

-- HR reads and deletes all; the employee reads their own. HR writes to
-- anyone but themselves.
create policy hr_feedback_select on public.hr_feedback for select to authenticated
  using ((select public.is_hr()) or employee_id = (select public.current_employee_id()));
create policy hr_feedback_insert on public.hr_feedback for insert to authenticated
  with check ((select public.is_hr()) and employee_id is distinct from (select public.current_employee_id()));
create policy hr_feedback_delete on public.hr_feedback for delete to authenticated
  using ((select public.is_hr()));

-- Cycles: HR, and the reviewers in them once opened.
create policy peer_review_cycles_select on public.peer_review_cycles for select to authenticated
  using ((select public.is_hr()) or (status <> 'draft' and public.is_peer_reviewer_in(id)));
create policy peer_review_cycles_update on public.peer_review_cycles for update to authenticated
  using ((select public.is_hr()) and status <> 'closed') with check ((select public.is_hr()));
create policy peer_review_cycles_delete on public.peer_review_cycles for delete to authenticated
  using ((select public.is_hr()) and status = 'draft');

-- Questions: HR writes (while a draft, by trigger); reviewers read those of
-- an opened cycle they are in.
create policy peer_review_questions_select on public.peer_review_questions for select to authenticated
  using ((select public.is_hr())
         or (public.is_peer_reviewer_in(cycle_id) and public.peer_cycle_status_of(cycle_id) <> 'draft'));
create policy peer_review_questions_insert on public.peer_review_questions for insert to authenticated
  with check ((select public.is_hr()));
create policy peer_review_questions_update on public.peer_review_questions for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy peer_review_questions_delete on public.peer_review_questions for delete to authenticated
  using ((select public.is_hr()));

-- Assignments: HR all but those about themselves; a reviewer their own, once
-- the cycle is open. HR never makes themselves a subject.
create policy peer_review_assignments_select on public.peer_review_assignments for select to authenticated
  using (((select public.is_hr()) and subject_id is distinct from (select public.current_employee_id()))
         or (reviewer_id = (select public.current_employee_id()) and public.peer_cycle_status_of(cycle_id) <> 'draft'));
create policy peer_review_assignments_insert on public.peer_review_assignments for insert to authenticated
  with check ((select public.is_hr()) and subject_id is distinct from (select public.current_employee_id()));
create policy peer_review_assignments_update on public.peer_review_assignments for update to authenticated
  using (reviewer_id = (select public.current_employee_id()))
  with check (reviewer_id = (select public.current_employee_id()));
create policy peer_review_assignments_delete on public.peer_review_assignments for delete to authenticated
  using ((select public.is_hr()) and subject_id is distinct from (select public.current_employee_id()));

-- Answers: seen with their assignment; written by its reviewer.
create policy peer_review_answers_select on public.peer_review_answers for select to authenticated
  using (exists (select 1 from public.peer_review_assignments a where a.id = assignment_id));
create policy peer_review_answers_update on public.peer_review_answers for update to authenticated
  using (exists (select 1 from public.peer_review_assignments a
                  where a.id = assignment_id and a.reviewer_id = (select public.current_employee_id())))
  with check (exists (select 1 from public.peer_review_assignments a
                       where a.id = assignment_id and a.reviewer_id = (select public.current_employee_id())));

-- The questions: HR only (each form carries its own copy).
create policy manager_feedback_questions_select on public.manager_feedback_questions
  for select to authenticated using ((select public.is_hr()));
create policy manager_feedback_questions_insert on public.manager_feedback_questions
  for insert to authenticated with check ((select public.is_hr()));
create policy manager_feedback_questions_update on public.manager_feedback_questions
  for update to authenticated using ((select public.is_hr())) with check ((select public.is_hr()));
create policy manager_feedback_questions_delete on public.manager_feedback_questions
  for delete to authenticated using ((select public.is_hr()));

-- The forms: the employee their own; HR all but those about themselves.
-- Never the manager.
create policy manager_feedback_select on public.manager_feedback for select to authenticated
  using (employee_id = (select public.current_employee_id())
         or ((select public.is_hr()) and manager_id is distinct from (select public.current_employee_id())));
create policy manager_feedback_update on public.manager_feedback for update to authenticated
  using (employee_id = (select public.current_employee_id()))
  with check (employee_id = (select public.current_employee_id()));

create policy manager_feedback_answers_select on public.manager_feedback_answers for select to authenticated
  using (exists (select 1 from public.manager_feedback f where f.id = feedback_id));
create policy manager_feedback_answers_update on public.manager_feedback_answers for update to authenticated
  using (exists (select 1 from public.manager_feedback f
                  where f.id = feedback_id and f.employee_id = (select public.current_employee_id())))
  with check (exists (select 1 from public.manager_feedback f
                       where f.id = feedback_id and f.employee_id = (select public.current_employee_id())));

-- ---------------------------------------------------------------------------
-- Storage: private bucket, files live at <employee_id>/<uuid>.<ext>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-docs', 'employee-docs', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
on conflict (id) do nothing;

create policy employee_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'employee-docs'
         and ((select public.is_hr())
              or (storage.foldername(name))[1] = (select public.current_employee_id())::text));
create policy employee_docs_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-docs' and (select public.is_hr()));
-- Files are only ever removed when a company admin deletes the employee:
-- once no document row points at the file any more.
create policy employee_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'employee-docs'
         and (select public.is_company_admin())
         and not exists (select 1 from public.employee_documents d where d.storage_path = objects.name));

-- ---------------------------------------------------------------------------
-- Storage: job application CVs (private, <job_opening_id>/<uuid>.pdf) and the
-- branding logo (public bucket, so the public job page can show it)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-applications', 'job-applications', false, 6291456, array['application/pdf']),
       ('branding', 'branding', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- CVs: anyone may add one to the folder of a job taking applications. With
-- no update policy nothing can be overwritten. Whoever can see an application
-- can read its CV (job_applications RLS applies inside the policy).
create policy job_application_cvs_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'job-applications'
              and public.job_accepts_applications((storage.foldername(name))[1]));
create policy job_application_cvs_read on storage.objects for select to authenticated
  using (bucket_id = 'job-applications'
         and exists (select 1 from public.job_applications a where a.resume_path = objects.name));

-- Logo: anyone can fetch it by its public URL; company admins manage files.
create policy branding_files_read on storage.objects for select to authenticated
  using (bucket_id = 'branding' and (select public.is_company_admin()));
create policy branding_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and (select public.is_company_admin()));
create policy branding_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and (select public.is_company_admin()));

-- ---------------------------------------------------------------------------
-- Storage: equipment invoices and photos (private, <uuid>.<ext>), for
-- whoever manages equipment
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('equipment', 'equipment', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy equipment_files_read on storage.objects for select to authenticated
  using (bucket_id = 'equipment' and (select public.can_manage_operations()));
create policy equipment_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'equipment' and (select public.can_manage_operations()));
create policy equipment_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'equipment' and (select public.can_manage_operations()));
