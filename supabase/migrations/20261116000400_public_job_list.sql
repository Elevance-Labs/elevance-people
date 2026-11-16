-- Hiring: a public list of open jobs.
--
-- The careers page (#/careers) now lists every job that is open and still
-- taking applications, as cards that lead to each job's page. Like the job
-- page, it is reached without signing in, so anon reads it only through
-- job_postings: the same columns job_posting gives one job (title, names of
-- department and designation, due date, description), newest first. Open
-- jobs whose due date has passed stay reachable by their own link, as
-- before, but aren't listed.

create function public.job_postings()
returns table (id uuid, title text, department text, designation text, due_date date, description text)
language sql stable security definer set search_path = '' as $$
  select j.id, j.title, d.name, g.title, j.due_date, j.description
    from public.job_openings j
    join public.departments d on d.id = j.department_id
    join public.designations g on g.id = j.designation_id
   where j.status = 'open' and (j.due_date is null or j.due_date >= current_date)
   order by j.created_at desc, j.title;
$$;

revoke execute on function public.job_postings() from public;
grant execute on function public.job_postings() to anon, authenticated;
