-- Job applications: the applicant's current salary, and more about them.
--
-- The public form now asks for the applicant's current monthly salary, in
-- PKR or USD (required, before the expected salary), and after the CV,
-- optionally, their current employer's benefits, why they want to switch
-- and their notice period in days (the note stays, now labelled Notes).
--
-- The current salary is the column HR used to fill in by hand: the
-- applicant now gives it, HR can still correct it, and it gains a currency
-- (the ones already recorded are PKR). It and the benefits are hidden like
-- the expected salary (not in the column grant): HR and the job's hiring
-- manager read them through application_hr_details. The reason for
-- switching and the notice period are read by whoever sees the application.
-- HR can fill in or correct all of these but the expected salary, through
-- application_set_hr_details, alongside their notes.
-- submit_application, application_hr_details and application_set_hr_details
-- change signature, so they are dropped and made again.

alter table public.job_applications
  add column current_salary_currency text not null default 'PKR'
    check (current_salary_currency in ('PKR', 'USD')),
  add column current_benefits   text check (length(current_benefits) <= 2000),
  add column switch_reason      text check (length(switch_reason) <= 2000),
  add column notice_period_days smallint check (notice_period_days between 0 and 365);

grant select (switch_reason, notice_period_days) on public.job_applications to authenticated;

drop function public.submit_application(uuid, text, text, text, integer, text, text, text);
drop function public.application_hr_details(uuid);
drop function public.application_set_hr_details(uuid, integer, text);

-- Apply for an open job. The CV must already be uploaded into that job's
-- folder (the storage policy only allows that for a job taking applications).
create function public.submit_application(
  p_job_opening_id uuid, p_full_name text, p_email text, p_phone text,
  p_current_salary integer, p_current_salary_currency text, p_expected_salary integer,
  p_current_benefits text, p_switch_reason text, p_notice_period_days integer,
  p_note text, p_resume_path text, p_resume_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.job_accepts_applications(p_job_opening_id::text) then
    raise exception 'This job is no longer taking applications.' using errcode = 'P0002';
  end if;
  if p_current_salary is null or p_current_salary_currency is null then
    raise exception 'Enter your current salary.' using errcode = '23514';
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
    (job_opening_id, full_name, email, phone, current_salary, current_salary_currency, expected_salary,
     current_benefits, switch_reason, notice_period_days, note, resume_path, resume_name)
  values (p_job_opening_id, trim(p_full_name), lower(trim(p_email)), trim(p_phone),
          p_current_salary, p_current_salary_currency, p_expected_salary,
          nullif(trim(p_current_benefits), ''), nullif(trim(p_switch_reason), ''), p_notice_period_days,
          nullif(trim(p_note), ''), p_resume_path, trim(p_resume_name));
end;
$$;

-- Current salary (with its currency), expected salary, the current
-- employer's benefits and HR's notes, for HR and the job's hiring manager.
-- No row for anyone else.
create function public.application_hr_details(p_application_id uuid)
returns table (current_salary integer, current_salary_currency text, expected_salary integer,
               current_benefits text, hr_notes text)
language sql stable security definer set search_path = '' as $$
  select a.current_salary, a.current_salary_currency, a.expected_salary, a.current_benefits, a.hr_notes
    from public.job_applications a
    join public.job_openings j on j.id = a.job_opening_id
   where a.id = p_application_id
     and public.can_see_application(a.job_opening_id, a.stage)
     and (public.is_hr() or j.manager_id = public.current_employee_id());
$$;

-- HR fills in or corrects what the applicant gave (current salary and its
-- currency, current benefits, reason for switching, notice period) and sets
-- their notes. Empty text clears; no currency keeps the one there.
create function public.application_set_hr_details(
  p_application_id uuid, p_current_salary integer, p_current_salary_currency text,
  p_current_benefits text, p_switch_reason text, p_notice_period_days integer, p_hr_notes text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_hr() then
    raise exception 'Only HR can change these details.' using errcode = '42501';
  end if;
  update public.job_applications
     set current_salary = p_current_salary,
         current_salary_currency = coalesce(p_current_salary_currency, current_salary_currency),
         current_benefits = nullif(trim(p_current_benefits), ''),
         switch_reason = nullif(trim(p_switch_reason), ''),
         notice_period_days = p_notice_period_days,
         hr_notes = nullif(trim(p_hr_notes), '')
   where id = p_application_id;
  if not found then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function
  public.submit_application(uuid, text, text, text, integer, text, integer, text, text, integer, text, text, text),
  public.application_hr_details(uuid), public.application_set_hr_details(uuid, integer, text, text, text, integer, text)
  from public, anon, authenticated;
grant execute on function
  public.application_hr_details(uuid), public.application_set_hr_details(uuid, integer, text, text, text, integer, text)
  to authenticated;
grant execute on function
  public.submit_application(uuid, text, text, text, integer, text, integer, text, text, integer, text, text, text)
  to anon, authenticated;
