-- Job applications: expected salary, and a smaller CV limit.
--
-- Applicants now give their expected monthly salary in PKR, required by
-- submit_application (whose signature changes, so the old one is dropped).
-- Applications sent before this have none, so the column stays nullable.
-- CVs may be at most 6 MB (was 10 MB).

alter table public.job_applications
  add column expected_salary integer check (expected_salary >= 0);

update storage.buckets set file_size_limit = 6291456 where id = 'job-applications';

drop function public.submit_application(uuid, text, text, text, text, text, text);

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

revoke execute on function
  public.submit_application(uuid, text, text, text, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function
  public.submit_application(uuid, text, text, text, integer, text, text, text)
  to anon, authenticated;
