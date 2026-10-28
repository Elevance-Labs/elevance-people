-- Job applications: HR's current salary and notes.
--
-- HR records the applicant's current monthly salary in PKR and keeps one
-- block of notes on each application. Applicants don't give either. Both
-- are hidden from clients (not in the column grant), like expected_salary:
-- HR (company admins included) and the job's hiring manager read them with
-- the expected salary through application_hr_details, which replaces
-- application_salary; only HR writes them, through
-- application_set_hr_details.

alter table public.job_applications
  add column current_salary integer check (current_salary >= 0),
  add column hr_notes       text check (length(hr_notes) <= 5000);

drop function public.application_salary(uuid);

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

revoke execute on function
  public.application_hr_details(uuid), public.application_set_hr_details(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function
  public.application_hr_details(uuid), public.application_set_hr_details(uuid, integer, text)
  to authenticated;
