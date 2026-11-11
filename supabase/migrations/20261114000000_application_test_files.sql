-- Submitted tests attached to job applications.
--
-- HR (and company admins) and a job's hiring manager can attach up to three
-- files (PDFs or images, 5 MB each) to an application, at any stage they can
-- see it in. Files live in a new private bucket, application-tests, at
-- <application_id>/<uuid>.<ext>, and are recorded in application_test_files,
-- written only by application_add_test_file / application_remove_test_file.
-- Whoever can see the application can read its files. Moving an application
-- on from the test (to anything but rejected or abandoned) now needs at least
-- one, and once it has moved on the last one can't be removed.

create table public.application_test_files (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.job_applications (id) on delete cascade,
  -- In the application-tests bucket at <application_id>/<uuid>.<ext>.
  storage_path   text not null unique,
  file_name      text not null
                 check (file_name = trim(file_name) and file_name <> '' and length(file_name) <= 255),
  uploaded_by    uuid references public.employees (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index application_test_files_application_idx
  on public.application_test_files (application_id, created_at);

-- HR, or the job's hiring manager while the application is in a stage the
-- hiring team sees. Takes text so the storage policies can pass a folder name.
create function public.can_attach_test_files(p_application_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.job_applications a
      join public.job_openings j on j.id = a.job_opening_id
     where a.id::text = p_application_id
       and (public.is_hr()
            or (j.manager_id = public.current_employee_id() and public.application_team_stage(a.stage))));
$$;

-- The application has a standing move on from the test (not to rejected or
-- abandoned): it must keep at least one test file.
create function public.application_passed_test(p_application_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.application_stage_events e
                  where e.application_id = p_application_id and e.kind = 'move' and e.undone_at is null
                    and e.from_stage = 'test' and e.to_stage not in ('rejected', 'abandoned'));
$$;

-- Attach a file already uploaded into the application's folder. Up to three.
create function public.application_add_test_file(p_application_id uuid, p_path text, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_app public.job_applications;
  v_id  uuid;
begin
  select * into v_app from public.job_applications where id = p_application_id for update;
  if not found or public.current_employee_id() is null
     or not public.can_see_application(v_app.job_opening_id, v_app.stage) then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
  if not public.can_attach_test_files(p_application_id::text) then
    raise exception 'Only HR and the hiring manager can attach test files.' using errcode = '42501';
  end if;
  if split_part(p_path, '/', 1) <> p_application_id::text
     or not exists (select 1 from storage.objects o
                     where o.bucket_id = 'application-tests' and o.name = p_path) then
    raise exception 'Upload the file before attaching it.';
  end if;
  if (select count(*) from public.application_test_files f where f.application_id = p_application_id) >= 3 then
    raise exception 'An application takes up to 3 test files.' using errcode = '23514';
  end if;
  insert into public.application_test_files (application_id, storage_path, file_name, uploaded_by)
  values (p_application_id, p_path, left(trim(p_name), 255), public.current_employee_id())
  returning id into v_id;
  return v_id;
end;
$$;

-- Detach a file; returns its path so the caller can remove it from storage.
-- Once the application has moved on from the test, its last file stays.
create function public.application_remove_test_file(p_file_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_file public.application_test_files;
  v_app  public.job_applications;
begin
  select * into v_file from public.application_test_files where id = p_file_id;
  if found then
    select * into v_app from public.job_applications where id = v_file.application_id for update;
  end if;
  if v_file.id is null or public.current_employee_id() is null
     or not public.can_see_application(v_app.job_opening_id, v_app.stage) then
    raise exception 'Test file not found.' using errcode = 'P0002';
  end if;
  if not public.can_attach_test_files(v_app.id::text) then
    raise exception 'Only HR and the hiring manager can remove test files.' using errcode = '42501';
  end if;
  if public.application_passed_test(v_app.id)
     and (select count(*) from public.application_test_files f where f.application_id = v_app.id) <= 1 then
    raise exception 'The application has moved on from the test, so it keeps at least one test file.'
      using errcode = '23514';
  end if;
  delete from public.application_test_files where id = p_file_id;
  return v_file.storage_path;
end;
$$;

-- Move an application to one of its next stages (with a reason where one is
-- required). The only way forward, except to hired (application_hire).
-- Moving on from the test takes a test score, and from an interview a rating
-- for each of the job's interview questions; neither when abandoned. Moving
-- on from the test, except to rejected or abandoned, needs a test file.
create or replace function public.application_move(
  p_application_id uuid, p_stage public.application_stage, p_reason text default null,
  p_test_score smallint default null, p_ratings smallint[] default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me        uuid := public.current_employee_id();
  v_app       public.job_applications;
  v_reason    text := nullif(trim(p_reason), '');
  v_scored    boolean;
  v_questions text[];
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

  v_scored := p_stage <> 'abandoned';
  if v_app.stage = 'test' and v_scored then
    if p_test_score is null or p_test_score not between 1 and 5 then
      raise exception 'Give the test a score from 1 to 5.' using errcode = '23514';
    end if;
  elsif p_test_score is not null then
    raise exception 'Only a move on from the test takes a test score.' using errcode = '23514';
  end if;
  if v_app.stage = 'test' and p_stage not in ('rejected', 'abandoned')
     and not exists (select 1 from public.application_test_files f where f.application_id = p_application_id) then
    raise exception 'Attach the submitted test before moving the application on.' using errcode = '23514';
  end if;
  if v_app.stage in ('interview_1', 'interview_2', 'interview_3') and v_scored then
    select j.interview_questions into v_questions
      from public.job_openings j where j.id = v_app.job_opening_id;
    if p_ratings is null or cardinality(p_ratings) <> cardinality(v_questions)
       or array_position(p_ratings, null) is not null
       or not (1 <= all (p_ratings) and 5 >= all (p_ratings)) then
      raise exception 'Rate every interview question from 1 to 5.' using errcode = '23514';
    end if;
  elsif p_ratings is not null then
    raise exception 'Only a move on from an interview takes ratings.' using errcode = '23514';
  end if;

  update public.job_applications set stage = p_stage, stage_changed_at = now()
   where id = p_application_id;
  insert into public.application_stage_events
    (application_id, kind, from_stage, to_stage, reason, created_by,
     test_score, interview_questions, interview_ratings)
  values (p_application_id, 'move', v_app.stage, p_stage, v_reason, v_me,
          p_test_score, case when p_ratings is not null then v_questions end, p_ratings);
end;
$$;

-- Privileges: read only; rows change through the functions above.
revoke all on public.application_test_files from anon, authenticated;
grant select on public.application_test_files to authenticated;

revoke execute on function
  public.can_attach_test_files(text), public.application_passed_test(uuid),
  public.application_add_test_file(uuid, text, text), public.application_remove_test_file(uuid)
  from public, anon, authenticated;
grant execute on function
  public.can_attach_test_files(text), public.application_passed_test(uuid),
  public.application_add_test_file(uuid, text, text), public.application_remove_test_file(uuid)
  to authenticated;

-- The files follow the application: whoever can see it reads them.
alter table public.application_test_files enable row level security;
create policy application_test_files_select on public.application_test_files
  for select to authenticated
  using (exists (select 1 from public.job_applications a where a.id = application_id));

-- Storage: private, 5 MB, PDFs and images. HR and the hiring manager upload
-- into the application's folder; whoever can see a file's row reads it; a
-- file goes only once no row points at it. Nothing is overwritten.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('application-tests', 'application-tests', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy application_test_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'application-tests'
              and public.can_attach_test_files((storage.foldername(name))[1]));
create policy application_test_files_read on storage.objects for select to authenticated
  using (bucket_id = 'application-tests'
         and exists (select 1 from public.application_test_files f where f.storage_path = objects.name));
create policy application_test_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'application-tests'
         and public.can_attach_test_files((storage.foldername(name))[1])
         and not exists (select 1 from public.application_test_files f where f.storage_path = objects.name));
