-- Job applications: HR adds ones received elsewhere.
--
-- CVs for a running job also arrive outside the public page (email,
-- referrals, job boards). HR can now add such an application from the app:
-- the CV and the applicant's details, as on the public form, straight into
-- Screened, Shortlisted, Test or Interview 1 (with remarks, as moving there
-- needs). Only for a job that is open, whether or not its due date has
-- passed. The salaries are optional here (the CV may not say), unlike on the
-- public form.
--
-- application_add (HR only) writes the application with added_by set (null
-- for the public form, which stays the only other writer) and a move from
-- New to the chosen stage in its timeline, so HR can undo it back to New
-- like any move. HR may upload a CV into an open job's folder, and remove
-- one no application points at (an add that failed).

alter table public.job_applications
  add column added_by uuid references public.employees (id) on delete set null;

grant select (added_by) on public.job_applications to authenticated;

-- HR adds an application received elsewhere, for an open job, into one of
-- the early stages. The CV must already be uploaded into that job's folder.
-- Returns the new application's id.
create function public.application_add(
  p_job_opening_id uuid, p_stage public.application_stage, p_reason text,
  p_full_name text, p_email text, p_phone text,
  p_current_salary integer, p_current_salary_currency text, p_expected_salary integer,
  p_current_benefits text, p_switch_reason text, p_notice_period_days integer,
  p_note text, p_resume_path text, p_resume_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := public.current_employee_id();
  v_reason text := nullif(trim(p_reason), '');
  v_id     uuid;
begin
  if v_me is null or not public.is_hr() then
    raise exception 'Only HR can add applications.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.job_openings j where j.id = p_job_opening_id and j.status = 'open') then
    raise exception 'Applications can only be added to an open job.' using errcode = 'P0002';
  end if;
  if p_stage is null or p_stage not in ('screened', 'shortlisted', 'test', 'interview_1') then
    raise exception 'An added application starts at Screened, Shortlisted, Test or Interview 1.' using errcode = '23514';
  end if;
  if public.application_stage_needs_reason(p_stage) and v_reason is null then
    raise exception 'Give remarks for adding this application at %.', p_stage using errcode = '23514';
  end if;
  if split_part(p_resume_path, '/', 1) <> p_job_opening_id::text
     or not exists (select 1 from storage.objects o
                     where o.bucket_id = 'job-applications' and o.name = p_resume_path) then
    raise exception 'Upload the CV before adding the application.';
  end if;

  insert into public.job_applications
    (job_opening_id, full_name, email, phone, current_salary, current_salary_currency, expected_salary,
     current_benefits, switch_reason, notice_period_days, note, resume_path, resume_name,
     stage, added_by)
  values (p_job_opening_id, trim(p_full_name), lower(trim(p_email)), trim(p_phone),
          p_current_salary, coalesce(p_current_salary_currency, 'PKR'), p_expected_salary,
          nullif(trim(p_current_benefits), ''), nullif(trim(p_switch_reason), ''), p_notice_period_days,
          nullif(trim(p_note), ''), p_resume_path, trim(p_resume_name),
          p_stage, v_me)
  returning id into v_id;
  insert into public.application_stage_events (application_id, kind, from_stage, to_stage, reason, created_by)
  values (v_id, 'move', 'new', p_stage, v_reason, v_me);
  return v_id;
end;
$$;

revoke execute on function
  public.application_add(uuid, public.application_stage, text, text, text, text, integer, text, integer,
                         text, text, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function
  public.application_add(uuid, public.application_stage, text, text, text, text, integer, text, integer,
                         text, text, integer, text, text, text)
  to authenticated;

-- HR uploads a CV into an open job's folder, due date or not, and removes
-- one no application points at.
create policy job_application_cvs_hr_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'job-applications'
              and (select public.is_hr())
              and exists (select 1 from public.job_openings j
                           where j.id::text = (storage.foldername(name))[1] and j.status = 'open'));
create policy job_application_cvs_hr_delete on storage.objects for delete to authenticated
  using (bucket_id = 'job-applications'
         and (select public.is_hr())
         and not exists (select 1 from public.job_applications a where a.resume_path = objects.name));
