-- ---------------------------------------------------------------------------
-- A draft review follows its designation's KPIs and expectations. They were
-- copied in once, by review_start, so a KPI or expectation added (or edited,
-- or removed) after a draft was started never reached it, nor, once
-- submitted, the dashboard's scores. Now review_sync keeps every draft in
-- line: new ones added, edited ones renamed / reweighted (ratings and notes
-- kept), removed ones dropped. It runs on any change to KPIs or expectations
-- and when an employee's designation changes. Submitted reviews are final
-- and never touched.
-- ---------------------------------------------------------------------------

-- Brings a draft review's KPIs and expectations in line with the employee's
-- current designation. Does nothing to a submitted one.
create function public.review_sync(p_review_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_designation uuid;
begin
  select e.designation_id into v_designation
    from public.performance_reviews r join public.employees e on e.id = r.employee_id
   where r.id = p_review_id and r.status = 'draft';
  if not found then
    return;
  end if;

  delete from public.performance_review_kpis l
   where l.review_id = p_review_id
     and not exists (select 1 from public.kpis k where k.id = l.kpi_id and k.designation_id = v_designation);
  update public.performance_review_kpis l
     set name = k.name, description = k.description, target = k.target, weight = k.weight,
         sort_order = k.ord
    from (select k.*, row_number() over (order by lower(k.name)) - 1 as ord
            from public.kpis k where k.designation_id = v_designation) k
   where l.review_id = p_review_id and l.kpi_id = k.id
     and (l.name, l.description, l.target, l.weight, l.sort_order)
         is distinct from (k.name, k.description, k.target, k.weight, k.ord);
  insert into public.performance_review_kpis (review_id, kpi_id, name, description, target, weight, sort_order)
  select p_review_id, k.id, k.name, k.description, k.target, k.weight, k.ord
    from (select k.*, row_number() over (order by lower(k.name)) - 1 as ord
            from public.kpis k where k.designation_id = v_designation) k
   where not exists (select 1 from public.performance_review_kpis l
                      where l.review_id = p_review_id and l.kpi_id = k.id);

  delete from public.performance_review_expectations l
   where l.review_id = p_review_id
     and not exists (select 1 from public.expectations x
                      where x.id = l.expectation_id and x.designation_id = v_designation);
  update public.performance_review_expectations l
     set title = x.title, sort_order = x.ord
    from (select x.*, row_number() over (order by lower(x.title)) - 1 as ord
            from public.expectations x where x.designation_id = v_designation) x
   where l.review_id = p_review_id and l.expectation_id = x.id
     and (l.title, l.sort_order) is distinct from (x.title, x.ord);
  insert into public.performance_review_expectations (review_id, expectation_id, title, sort_order)
  select p_review_id, x.id, x.title, x.ord
    from (select x.*, row_number() over (order by lower(x.title)) - 1 as ord
            from public.expectations x where x.designation_id = v_designation) x
   where not exists (select 1 from public.performance_review_expectations l
                      where l.review_id = p_review_id and l.expectation_id = x.id);
end;
$$;

-- review_start now copies the lines in through review_sync.
create or replace function public.review_start(p_employee_id uuid, p_period date)
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
  perform public.review_sync(v_id);
  return v_id;
end;
$$;

-- Any change to KPIs or expectations reaches every draft.
create function public.review_config_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.review_sync(r.id) from public.performance_reviews r where r.status = 'draft';
  return null;
end;
$$;

create trigger review_config_changed
  after insert or update or delete on public.kpis
  for each statement execute function public.review_config_changed();
create trigger review_config_changed
  after insert or update or delete on public.expectations
  for each statement execute function public.review_config_changed();

-- An employee moved to another designation gets its KPIs and expectations
-- on their drafts.
create function public.employees_reviews()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.review_sync(r.id) from public.performance_reviews r
    where r.employee_id = new.id and r.status = 'draft';
  return null;
end;
$$;

create trigger employees_reviews
  after update of designation_id on public.employees
  for each row when (old.designation_id is distinct from new.designation_id)
  execute function public.employees_reviews();

revoke execute on function public.review_sync(uuid), public.review_config_changed(),
  public.employees_reviews() from public, anon, authenticated;

-- Bring the drafts already open up to date.
select public.review_sync(r.id) from public.performance_reviews r where r.status = 'draft';
