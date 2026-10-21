-- Elevance People: employees, documents, org chart, auth binding.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('company_admin', 'hr_admin', 'member');
create type public.employment_type as enum ('full_time', 'part_time', 'freelance', 'contract');
create type public.employee_status as enum
  ('joining', 'probation', 'active', 'notice_period', 'left', 'terminated');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.employees (
  id                 uuid primary key default gen_random_uuid(),
  employee_number    integer generated always as identity unique,
  user_id            uuid unique references auth.users (id) on delete set null,
  full_name          text not null check (length(trim(full_name)) > 0),
  company_email      text not null unique
                     check (company_email = lower(company_email)
                            and company_email like '%@elevancelabs.com'),
  date_of_joining    date not null,
  date_of_separation date,
  personal_email     text,
  phone              text,
  cnic_number        text,
  cnic_expiry        date,
  dob                date,
  designation        text,
  department         text,
  bank               text,
  iban               text,
  emergency_contact  text,
  employment_type    public.employment_type not null default 'full_time',
  status             public.employee_status not null default 'joining',
  app_role           public.app_role not null default 'member',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

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
  -- Soft delete: hidden in the app, file and row are kept.
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

-- Called by the app right after Google sign-in. Binds the auth user to the
-- employee record with the same company email, if that record may log in.
-- Returns the employee row, or nothing when login must be refused.
create function public.bind_employee()
returns setof public.employees
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_email text := lower(auth.jwt() ->> 'email');
begin
  if v_uid is null or v_email is null
     or v_email not like '%@elevancelabs.com'
     or coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') <> 'google' then
    return;
  end if;

  update public.employees e
     set user_id = v_uid
   where e.company_email = v_email
     and e.user_id is null
     and public.is_login_status(e.status);

  return query
    select * from public.employees e
     where e.user_id = v_uid
       and e.company_email = v_email
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
  if v_email is null or v_email not like '%@elevancelabs.com' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Only @elevancelabs.com accounts can sign in.'));
  end if;
  if not exists (select 1 from public.employees
                  where company_email = v_email and public.is_login_status(status)) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'No active employee record found for this account.'));
  end if;
  return '{}'::jsonb;
end;
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
    if tg_op = 'UPDATE' then
      if new.app_role is distinct from old.app_role then
        raise exception 'Only a company admin can change roles.' using errcode = '42501';
      end if;
      -- Login is bound by company email, so re-pointing an admin's email
      -- would hand their role to someone else.
      if old.app_role <> 'member' and new.company_email is distinct from old.company_email then
        raise exception 'Only a company admin can change an admin''s company email.'
          using errcode = '42501';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.company_email is distinct from old.company_email then
      new.user_id := null; -- rebinds on next login with the new email
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

-- ---------------------------------------------------------------------------
-- Directory view: the non-sensitive columns every logged-in employee may see
-- (needed for the org chart). Runs with owner rights, so it bypasses the
-- employees RLS on purpose and gates on the caller being a bound employee.
-- ---------------------------------------------------------------------------
create view public.employee_directory with (security_invoker = false) as
  select id, employee_number, full_name, company_email, designation, department, status
    from public.employees
   where (select public.current_employee_id()) is not null;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on public.employees, public.employee_documents, public.org_chart_nodes,
              public.employee_directory
  from anon, authenticated;

grant select, delete on public.employees to authenticated;
-- user_id and employee_number are deliberately not writable by clients.
grant insert (full_name, company_email, date_of_joining, date_of_separation, personal_email,
              phone, cnic_number, cnic_expiry, dob, designation, department, bank, iban,
              emergency_contact, employment_type, status, app_role),
      update (full_name, company_email, date_of_joining, date_of_separation, personal_email,
              phone, cnic_number, cnic_expiry, dob, designation, department, bank, iban,
              emergency_contact, employment_type, status, app_role)
  on public.employees to authenticated;

grant select, delete on public.employee_documents to authenticated;
grant insert (employee_id, doc_type, file_name, storage_path, mime_type, size_bytes),
      update (deleted_at)
  on public.employee_documents to authenticated;

grant select, insert, update, delete on public.org_chart_nodes to authenticated;
grant select on public.employee_directory to authenticated;

revoke execute on function
  public.is_login_status(public.employee_status), public.current_employee_id(),
  public.current_app_role(), public.is_hr(), public.is_company_admin(),
  public.bind_employee(), public.org_chart_remove(uuid),
  public.hook_before_user_created(jsonb), public.employees_guard(),
  public.employee_documents_stamp(), public.org_chart_guard()
  from public, anon, authenticated;

grant execute on function
  public.is_login_status(public.employee_status), public.current_employee_id(),
  public.current_app_role(), public.is_hr(), public.is_company_admin(),
  public.bind_employee(), public.org_chart_remove(uuid)
  to authenticated;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.employees enable row level security;
alter table public.employee_documents enable row level security;
alter table public.org_chart_nodes enable row level security;

-- Employees: HR/company admins see and edit all; members see only themselves.
create policy employees_select on public.employees for select to authenticated
  using ((select public.is_hr()) or id = (select public.current_employee_id()));
create policy employees_insert on public.employees for insert to authenticated
  with check ((select public.is_hr()));
create policy employees_update on public.employees for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy employees_delete on public.employees for delete to authenticated
  using ((select public.is_company_admin()));

-- Documents. HR must be able to see soft-deleted rows for the soft-delete
-- UPDATE to pass RLS; the app filters them out.
create policy employee_documents_select on public.employee_documents for select to authenticated
  using ((select public.is_hr())
         or (employee_id = (select public.current_employee_id()) and deleted_at is null));
create policy employee_documents_insert on public.employee_documents for insert to authenticated
  with check ((select public.is_hr()));
create policy employee_documents_update on public.employee_documents for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy employee_documents_delete on public.employee_documents for delete to authenticated
  using ((select public.is_company_admin()));

-- Org chart: every employee can view, HR/company admins can change.
create policy org_chart_select on public.org_chart_nodes for select to authenticated
  using ((select public.current_employee_id()) is not null);
create policy org_chart_insert on public.org_chart_nodes for insert to authenticated
  with check ((select public.is_hr()));
create policy org_chart_update on public.org_chart_nodes for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy org_chart_delete on public.org_chart_nodes for delete to authenticated
  using ((select public.is_hr()));

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
-- Files are only ever removed when a company admin deletes the employee.
create policy employee_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'employee-docs' and (select public.is_company_admin()));
