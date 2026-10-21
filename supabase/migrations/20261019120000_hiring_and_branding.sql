-- Hiring (first step of applicant tracking) and company branding.
--
-- HR (HR admins and company admins) create and manage job openings: a title,
-- the department and designation being hired for, a closing date, a status,
-- a rich-text description, one hiring manager and any number of
-- interviewers. An open job has a public page, reachable without signing in,
-- where anyone can apply with their name, email, phone, a PDF CV and a note.
-- Each submission lands in job_applications, which only HR can read.
-- Application statuses, and access for managers and interviewers, come later.
--
-- The public page never touches a table. anon gets three narrow functions
-- (job_posting, public_branding, submit_application) and may add a PDF to an
-- open job's folder in the private job-applications bucket; it can't read,
-- list, overwrite or delete anything there.
--
-- Branding (company admins only): logo, primary colour, and perks and
-- benefits, in a single row. For now it only styles the public job page.
-- The logo lives in the public branding bucket.

-- ---------------------------------------------------------------------------
-- Job openings
-- ---------------------------------------------------------------------------
create type public.job_opening_status as enum ('draft', 'open', 'on_hold', 'closed');

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
  created_at     timestamptz not null default now()
);
create unique index job_applications_email_key on public.job_applications (job_opening_id, email);

-- ---------------------------------------------------------------------------
-- Branding: exactly one row
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
-- Triggers
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Public functions: the only way in for someone who isn't signed in
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
  p_job_opening_id uuid, p_full_name text, p_email text, p_phone text, p_note text,
  p_resume_path text, p_resume_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.job_accepts_applications(p_job_opening_id::text) then
    raise exception 'This job is no longer taking applications.' using errcode = 'P0002';
  end if;
  if split_part(p_resume_path, '/', 1) <> p_job_opening_id::text
     or not exists (select 1 from storage.objects o
                     where o.bucket_id = 'job-applications' and o.name = p_resume_path) then
    raise exception 'Upload your CV before applying.';
  end if;

  insert into public.job_applications
    (job_opening_id, full_name, email, phone, note, resume_path, resume_name)
  values (p_job_opening_id, trim(p_full_name), lower(trim(p_email)), trim(p_phone),
          nullif(trim(p_note), ''), p_resume_path, trim(p_resume_name));
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on public.job_openings, public.job_opening_interviewers, public.job_applications,
              public.branding
  from anon, authenticated;

grant select, delete on public.job_openings to authenticated;
-- created_by is stamped by the trigger, so it isn't writable.
grant insert (title, department_id, designation_id, status, due_date, description, manager_id),
      update (title, department_id, designation_id, status, due_date, description, manager_id)
  on public.job_openings to authenticated;
grant select, insert, delete on public.job_opening_interviewers to authenticated;
-- Applications are only ever written by submit_application.
grant select on public.job_applications to authenticated;
grant select, update (logo_path, primary_color, perks) on public.branding to authenticated;

revoke execute on function
  public.valid_perks(jsonb), public.job_openings_stamp(), public.job_accepts_applications(text),
  public.job_posting(uuid), public.public_branding(),
  public.submit_application(uuid, text, text, text, text, text, text)
  from public, anon, authenticated;

-- Checked when a client writes perks.
grant execute on function public.valid_perks(jsonb) to authenticated;
grant execute on function
  public.job_accepts_applications(text), public.job_posting(uuid), public.public_branding(),
  public.submit_application(uuid, text, text, text, text, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.job_openings enable row level security;
alter table public.job_opening_interviewers enable row level security;
alter table public.job_applications enable row level security;
alter table public.branding enable row level security;

-- Job openings and their interviewers: HR only, for now.
create policy job_openings_select on public.job_openings for select to authenticated
  using ((select public.is_hr()));
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

create policy job_applications_select on public.job_applications for select to authenticated
  using ((select public.is_hr()));

-- Branding: every employee reads, company admins change.
create policy branding_select on public.branding for select to authenticated
  using ((select public.current_employee_id()) is not null);
create policy branding_update on public.branding for update to authenticated
  using ((select public.is_company_admin())) with check ((select public.is_company_admin()));

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-applications', 'job-applications', false, 10485760, array['application/pdf']),
       -- Public: the logo is shown to people who aren't signed in.
       ('branding', 'branding', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- CVs: anyone may add one to the folder of a job taking applications
-- (<job_opening_id>/…). With no update policy nothing can be overwritten,
-- and only HR can read them.
create policy job_application_cvs_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'job-applications'
              and public.job_accepts_applications((storage.foldername(name))[1]));
create policy job_application_cvs_read on storage.objects for select to authenticated
  using (bucket_id = 'job-applications' and (select public.is_hr()));

-- Logo: anyone can fetch it by its public URL; company admins manage files.
create policy branding_files_read on storage.objects for select to authenticated
  using (bucket_id = 'branding' and (select public.is_company_admin()));
create policy branding_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and (select public.is_company_admin()));
create policy branding_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and (select public.is_company_admin()));
