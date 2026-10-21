-- ---------------------------------------------------------------------------
-- Performance, part one: designation expectations and monthly reviews.
--
-- Expectations: short statements of what a designation is expected to do,
-- kept next to its KPIs. Everyone signed in reads them; company admins write.
--
-- Monthly reviews: in the first ten days of each month, every employee's org
-- chart manager reviews the month before — each KPI rated 1–5, each
-- expectation met or not, an evaluation, feedback, and the quarterly goal
-- (set in the first review of a quarter, its progress rated out of 10 in the
-- others). The manager saves a draft as they go and submits it by the 10th;
-- a later submission is marked late. Once submitted the employee reads it and
-- acknowledges it, and only HR can reopen it.
--
-- A review is started and moves only through review_start / review_submit /
-- review_reopen / review_acknowledge. While a draft, the employee's current
-- manager edits its text and ratings (RLS, column grants). HR reads every
-- review but drafts of their own; the employee only their own submitted ones.
-- ---------------------------------------------------------------------------

create type public.review_status as enum ('draft', 'submitted');

create table public.expectations (
  id             uuid primary key default gen_random_uuid(),
  designation_id uuid not null,
  title          text not null check (title = trim(title) and title <> '' and length(title) <= 300),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint expectations_designation_id_fkey foreign key (designation_id)
    references public.designations (id) on delete cascade
);
create unique index expectations_title_key on public.expectations (designation_id, lower(title));

-- One per employee and reviewed month. Written only by the review functions,
-- apart from the draft's text and ratings.
create table public.performance_reviews (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null,
  -- The month reviewed, as its first day.
  period          date not null check (period = date_trunc('month', period)::date),
  -- The 10th of the month after.
  due_date        date not null generated always as ((period + interval '1 month 9 days')::date) stored,
  status          public.review_status not null default 'draft',
  evaluation      text check (length(evaluation) <= 5000),
  feedback        text check (length(feedback) <= 5000),
  -- The goal this review sets, for the quarter it is held in (the month after
  -- the reviewed one), when that quarter has none yet. Kept by review_submit
  -- only when it does.
  goal_set        text check (length(goal_set) <= 2000),
  -- The goal of the reviewed month's quarter, copied in by review_submit, and
  -- its progress out of 10.
  goal_rated      text,
  goal_progress   smallint check (goal_progress between 0 and 10),
  created_by      uuid references public.employees (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- The last submission. late is decided by the first one, after the due date.
  submitted_by    uuid references public.employees (id) on delete set null,
  submitted_at    timestamptz,
  late            boolean not null default false,
  acknowledged_at timestamptz,
  reopened_by     uuid references public.employees (id) on delete set null,
  reopened_at     timestamptz,
  reopen_reason   text check (length(reopen_reason) <= 2000),
  -- Named: performance_reviews references employees several times.
  constraint performance_reviews_employee_id_fkey foreign key (employee_id)
    references public.employees (id) on delete cascade,
  constraint performance_reviews_period_key unique (employee_id, period)
);

-- The KPIs and expectations as they were when the review started.
create table public.performance_review_kpis (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.performance_reviews (id) on delete cascade,
  kpi_id      uuid references public.kpis (id) on delete set null,
  name        text not null,
  description text,
  target      text,
  weight      numeric(5, 2),
  sort_order  integer not null,
  rating      smallint check (rating between 1 and 5),
  note        text check (length(note) <= 2000)
);
create index performance_review_kpis_review_idx on public.performance_review_kpis (review_id, sort_order);

create table public.performance_review_expectations (
  id             uuid primary key default gen_random_uuid(),
  review_id      uuid not null references public.performance_reviews (id) on delete cascade,
  expectation_id uuid references public.expectations (id) on delete set null,
  title          text not null,
  sort_order     integer not null,
  met            boolean,
  note           text check (length(note) <= 2000)
);
create index performance_review_expectations_review_idx
  on public.performance_review_expectations (review_id, sort_order);

-- Today where the company is. Review months and due dates follow it.
create function public.company_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Karachi')::date;
$$;

-- The quarter (its first day) a review of this month sets its goal for: the
-- quarter of the month it is held in. Mirrored in src/lib/performance.ts.
create function public.review_goal_quarter(p_period date)
returns date language sql immutable set search_path = '' as $$
  select date_trunc('quarter', p_period + interval '1 month')::date;
$$;

-- At most one goal per person and quarter.
create unique index performance_reviews_one_goal
  on public.performance_reviews (employee_id, public.review_goal_quarter(period))
  where status = 'submitted' and goal_set is not null;

create trigger expectations_touch before update on public.expectations
  for each row execute function public.touch_updated_at();
create trigger performance_reviews_touch before update on public.performance_reviews
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Review actions (RPCs). The only way a review is created or changes status.
-- ---------------------------------------------------------------------------

-- Start the review of a month that is over, as the employee's manager, with
-- their designation's KPIs and expectations copied in. Only someone who may
-- log in and had joined by the month's first day is reviewed.
create function public.review_start(p_employee_id uuid, p_period date)
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
  insert into public.performance_review_kpis (review_id, kpi_id, name, description, target, weight, sort_order)
  select v_id, k.id, k.name, k.description, k.target, k.weight, row_number() over (order by lower(k.name)) - 1
    from public.kpis k where k.designation_id = v_employee.designation_id;
  insert into public.performance_review_expectations (review_id, expectation_id, title, sort_order)
  select v_id, x.id, x.title, row_number() over (order by lower(x.title)) - 1
    from public.expectations x where x.designation_id = v_employee.designation_id;
  return v_id;
end;
$$;

-- Submit a draft, as the employee's manager, once everything is filled in:
-- every KPI rated (a note for 1 or 2), every expectation met or not (a note
-- when not), the evaluation and feedback, progress on the quarter's goal if
-- it has one, and the next goal if its quarter has none yet. Earlier drafts
-- of the same person go first.
create function public.review_submit(p_review_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_review  public.performance_reviews;
  v_earlier date;
  v_rated   text;
  v_sets    boolean;
begin
  select * into v_review from public.performance_reviews where id = p_review_id for update;
  if not found or not (public.is_manager_of(v_review.employee_id) or public.is_hr()) then
    raise exception 'Review not found.' using errcode = 'P0002';
  end if;
  if not public.is_manager_of(v_review.employee_id) then
    raise exception 'Only their manager can submit a review.' using errcode = '42501';
  end if;
  if v_review.status <> 'draft' then
    raise exception 'This review is already submitted.';
  end if;
  select min(period) into v_earlier from public.performance_reviews
   where employee_id = v_review.employee_id and period < v_review.period and status = 'draft';
  if v_earlier is not null then
    raise exception 'Submit the % review first.', to_char(v_earlier, 'FMMonth YYYY');
  end if;

  if exists (select 1 from public.performance_review_kpis where review_id = p_review_id and rating is null) then
    raise exception 'Rate every KPI.' using errcode = '23514';
  end if;
  if exists (select 1 from public.performance_review_kpis
              where review_id = p_review_id and rating <= 2 and nullif(trim(note), '') is null) then
    raise exception 'Add a note to every KPI rated 1 or 2.' using errcode = '23514';
  end if;
  if exists (select 1 from public.performance_review_expectations where review_id = p_review_id and met is null) then
    raise exception 'Mark every expectation met or not met.' using errcode = '23514';
  end if;
  if exists (select 1 from public.performance_review_expectations
              where review_id = p_review_id and not met and nullif(trim(note), '') is null) then
    raise exception 'Add a note to every expectation not met.' using errcode = '23514';
  end if;
  if nullif(trim(v_review.evaluation), '') is null then
    raise exception 'Write the evaluation.' using errcode = '23514';
  end if;
  if nullif(trim(v_review.feedback), '') is null then
    raise exception 'Write the feedback.' using errcode = '23514';
  end if;

  -- The goal of the reviewed month's quarter, and whether the quarter the
  -- review is held in still needs one.
  select r.goal_set into v_rated from public.performance_reviews r
   where r.employee_id = v_review.employee_id and r.id <> p_review_id and r.status = 'submitted'
     and r.goal_set is not null
     and public.review_goal_quarter(r.period) = date_trunc('quarter', v_review.period::timestamp)::date;
  v_sets := not exists (
    select 1 from public.performance_reviews r
     where r.employee_id = v_review.employee_id and r.id <> p_review_id and r.status = 'submitted'
       and r.goal_set is not null
       and public.review_goal_quarter(r.period) = public.review_goal_quarter(v_review.period));
  if v_rated is not null and v_review.goal_progress is null then
    raise exception 'Rate progress on the goal out of 10.' using errcode = '23514';
  end if;
  if v_sets and nullif(trim(v_review.goal_set), '') is null then
    raise exception 'Set the goal for Q% %.', extract(quarter from public.review_goal_quarter(v_review.period)),
      extract(year from public.review_goal_quarter(v_review.period))
      using errcode = '23514';
  end if;

  update public.performance_reviews
     set status = 'submitted', submitted_by = public.current_employee_id(), submitted_at = now(),
         late = case when submitted_at is null then public.company_today() > due_date else late end,
         evaluation = trim(evaluation), feedback = trim(feedback),
         goal_set = case when v_sets then trim(goal_set) end,
         goal_rated = v_rated,
         goal_progress = case when v_rated is not null then goal_progress end
   where id = p_review_id;
end;
$$;

-- HR sends a submitted review back to draft, with a reason, so the manager
-- can change it. The employee no longer sees it until it is submitted again.
create function public.review_reopen(p_review_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_review public.performance_reviews;
begin
  if not public.is_hr() then
    raise exception 'Only HR can reopen a review.' using errcode = '42501';
  end if;
  select * into v_review from public.performance_reviews where id = p_review_id for update;
  if not found then
    raise exception 'Review not found.' using errcode = 'P0002';
  end if;
  if v_review.employee_id = public.current_employee_id() then
    raise exception 'You cannot reopen your own review.' using errcode = '42501';
  end if;
  if v_review.status <> 'submitted' then
    raise exception 'This review is still a draft.';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Give a reason for reopening this review.' using errcode = '23514';
  end if;
  update public.performance_reviews
     set status = 'draft', acknowledged_at = null, reopened_by = public.current_employee_id(),
         reopened_at = now(), reopen_reason = trim(p_reason)
   where id = p_review_id;
end;
$$;

-- The employee confirms they have read their submitted review.
create function public.review_acknowledge(p_review_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_review public.performance_reviews;
begin
  select * into v_review from public.performance_reviews where id = p_review_id for update;
  if not found or v_review.employee_id is distinct from public.current_employee_id()
     or v_review.status <> 'submitted' then
    raise exception 'Review not found.' using errcode = 'P0002';
  end if;
  if v_review.acknowledged_at is null then
    update public.performance_reviews set acknowledged_at = now() where id = p_review_id;
  end if;
end;
$$;

-- One month's reviews, as a list of who is due one: everyone who may log in
-- and had joined by the month's first day, with their manager and their
-- review if started. HR sees everyone (those without a manager too, who
-- can't be reviewed); a manager sees their direct reports.
create function public.performance_due(p_period date)
returns table (employee_id uuid, full_name text, designation text, manager_id uuid, manager_name text,
               review_id uuid, status public.review_status, due_date date, submitted_at timestamptz,
               late boolean, acknowledged_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select e.id, e.full_name, g.title, n.manager_id, m.full_name, r.id, r.status,
         (date_trunc('month', p_period)::date + interval '1 month 9 days')::date,
         r.submitted_at, r.late, r.acknowledged_at
    from public.employees e
    left join public.designations g on g.id = e.designation_id
    left join public.org_chart_nodes n on n.employee_id = e.id
    left join public.employees m on m.id = n.manager_id
    left join public.performance_reviews r
      on r.employee_id = e.id and r.period = date_trunc('month', p_period)::date
   where public.is_login_status(e.status) and e.date_of_joining <= date_trunc('month', p_period)::date
     and (public.is_hr() or n.manager_id = public.current_employee_id())
   order by e.full_name;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on public.expectations, public.performance_reviews, public.performance_review_kpis,
              public.performance_review_expectations
  from anon, authenticated;

grant select, delete on public.expectations to authenticated;
grant insert (designation_id, title), update (designation_id, title) on public.expectations to authenticated;
-- Reviews are created and change status only through the functions above;
-- while a draft, the manager writes these columns (RLS).
grant select, update (evaluation, feedback, goal_set, goal_progress) on public.performance_reviews to authenticated;
grant select, update (rating, note) on public.performance_review_kpis to authenticated;
grant select, update (met, note) on public.performance_review_expectations to authenticated;

revoke execute on function
  public.company_today(), public.review_goal_quarter(date), public.review_start(uuid, date),
  public.review_submit(uuid), public.review_reopen(uuid, text), public.review_acknowledge(uuid),
  public.performance_due(date)
  from public, anon, authenticated;
grant execute on function
  public.company_today(), public.review_goal_quarter(date), public.review_start(uuid, date),
  public.review_submit(uuid), public.review_reopen(uuid, text), public.review_acknowledge(uuid),
  public.performance_due(date)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.expectations enable row level security;
alter table public.performance_reviews enable row level security;
alter table public.performance_review_kpis enable row level security;
alter table public.performance_review_expectations enable row level security;

create policy expectations_select on public.expectations for select to authenticated
  using ((select public.current_employee_id()) is not null);
create policy expectations_insert on public.expectations for insert to authenticated
  with check ((select public.is_company_admin()));
create policy expectations_update on public.expectations for update to authenticated
  using ((select public.is_company_admin())) with check ((select public.is_company_admin()));
create policy expectations_delete on public.expectations for delete to authenticated
  using ((select public.is_company_admin()));

-- HR reads every review but drafts of their own; the employee's current
-- manager reads all of theirs and edits drafts; the employee reads their own
-- once submitted.
create policy performance_reviews_select on public.performance_reviews for select to authenticated
  using (((select public.is_hr()) and employee_id is distinct from (select public.current_employee_id()))
         or public.is_manager_of(employee_id)
         or (status = 'submitted' and employee_id = (select public.current_employee_id())));
create policy performance_reviews_update on public.performance_reviews for update to authenticated
  using (status = 'draft' and public.is_manager_of(employee_id))
  with check (status = 'draft' and public.is_manager_of(employee_id));

-- A review's lines: seen with the review, edited with its draft.
create policy performance_review_kpis_select on public.performance_review_kpis for select to authenticated
  using (exists (select 1 from public.performance_reviews r where r.id = review_id));
create policy performance_review_kpis_update on public.performance_review_kpis for update to authenticated
  using (exists (select 1 from public.performance_reviews r
                  where r.id = review_id and r.status = 'draft' and public.is_manager_of(r.employee_id)))
  with check (exists (select 1 from public.performance_reviews r
                       where r.id = review_id and r.status = 'draft' and public.is_manager_of(r.employee_id)));
create policy performance_review_expectations_select on public.performance_review_expectations
  for select to authenticated
  using (exists (select 1 from public.performance_reviews r where r.id = review_id));
create policy performance_review_expectations_update on public.performance_review_expectations
  for update to authenticated
  using (exists (select 1 from public.performance_reviews r
                  where r.id = review_id and r.status = 'draft' and public.is_manager_of(r.employee_id)))
  with check (exists (select 1 from public.performance_reviews r
                       where r.id = review_id and r.status = 'draft' and public.is_manager_of(r.employee_id)));
