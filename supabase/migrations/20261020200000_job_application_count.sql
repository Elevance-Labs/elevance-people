-- Fix: counting a job's applications.
--
-- The app counted them with PostgREST's embedded count, job_applications(count),
-- which PostgREST turns into a whole-row reference to job_applications. Since
-- expected_salary stopped being selectable, that's refused for everyone
-- ("permission denied for table job_applications"), so the job list and form
-- failed. This computed field (select=…,application_count) counts instead,
-- under the caller's row level security.
create function public.application_count(p_job public.job_openings)
returns integer language sql stable set search_path = '' as $$
  select count(*)::integer from public.job_applications a where a.job_opening_id = p_job.id;
$$;

revoke execute on function public.application_count(public.job_openings) from public, anon, authenticated;
grant execute on function public.application_count(public.job_openings) to authenticated;
