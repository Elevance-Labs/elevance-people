-- ---------------------------------------------------------------------------
-- Feedback on one's manager moves from quarterly to the monthly 1:1, and the
-- employee sees their 1:1 as soon as it's due.
--
-- Manager feedback: one form per employee and reviewed month (period, the
-- month's first day), held at the same 1:1 as the monthly review: open from
-- the 1st of the month after, due on the 10th (late after), and submittable
-- until that month ends (missed after). Who owes it is the same as who is due
-- a review. year / quarter become period; existing forms keep their place
-- (a quarter's form becomes the month before its last month, the month its
-- 1:1 reviewed). quarter_end goes; manager_feedback_closes replaces it.
--
-- my_one_on_one: the caller's current 1:1 (last month's), with the state of
-- their manager's review — not its contents, which they read once submitted
-- — and of their own feedback form.
-- ---------------------------------------------------------------------------

-- The last day a reviewed month's feedback can be submitted: the end of the
-- month after it.
create function public.manager_feedback_closes(p_period date)
returns date language sql immutable set search_path = '' as $$
  select (date_trunc('month', p_period) + interval '2 months - 1 day')::date;
$$;

alter table public.manager_feedback add column period date;
update public.manager_feedback
   set period = (make_date(year, quarter * 3, 1) - interval '1 month')::date;
alter table public.manager_feedback
  drop constraint manager_feedback_quarter_key,
  drop column due_date,
  drop column year,
  drop column quarter;
alter table public.manager_feedback
  alter column period set not null,
  add constraint manager_feedback_period_check check (period = date_trunc('month', period)::date),
  -- The 10th of the month after the one reviewed, as for the monthly review.
  add column due_date date not null generated always as ((period + interval '1 month 9 days')::date) stored,
  add constraint manager_feedback_period_key unique (employee_id, period);
create index manager_feedback_period_idx on public.manager_feedback (period);

-- As before, with the month's window.
create or replace function public.manager_feedback_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_form public.manager_feedback;
begin
  if tg_table_name = 'manager_feedback' then
    -- Only the text is the employee's; other changes are the database's own
    -- (manager_id cleared as that employee is deleted, the submit itself).
    if new.body is not distinct from old.body then
      return new;
    end if;
    v_form := old;
    new.updated_at := now();
  else
    if (new.feedback_id, new.prompt, new.sort_order) is distinct from (old.feedback_id, old.prompt, old.sort_order) then
      raise exception 'Only the rating can change.';
    end if;
    select * into v_form from public.manager_feedback where id = new.feedback_id;
  end if;
  if v_form.submitted_at is not null or public.company_today() > public.manager_feedback_closes(v_form.period) then
    raise exception 'This feedback can no longer be changed.';
  end if;
  return new;
end;
$$;

drop function public.quarter_end(integer, integer);

-- The caller's form for their current 1:1 (last month's), made the first time
-- they open it: for someone who may log in, had joined by that month's first
-- day and has a manager — whoever is due a review. Returns its id.
create or replace function public.manager_feedback_start()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me        uuid := public.current_employee_id();
  v_period    date := (date_trunc('month', public.company_today()) - interval '1 month')::date;
  v_employee  public.employees;
  v_manager   uuid;
  v_questions integer;
  v_id        uuid;
begin
  if v_me is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  select id into v_id from public.manager_feedback where employee_id = v_me and period = v_period;
  if found then
    return v_id;
  end if;
  select * into v_employee from public.employees where id = v_me;
  if v_employee.date_of_joining > v_period then
    raise exception 'You joined after % began, so there''s no feedback for it.', to_char(v_period, 'FMMonth YYYY')
      using errcode = '23514';
  end if;
  select manager_id into v_manager from public.org_chart_nodes where employee_id = v_me;
  if v_manager is null then
    raise exception 'You have no manager in the org chart to give feedback on.' using errcode = '23514';
  end if;
  select count(*) into v_questions from public.manager_feedback_questions;
  if v_questions not between 3 and 5 then
    raise exception 'HR hasn''t finished setting up the questions yet.' using errcode = '23514';
  end if;

  insert into public.manager_feedback (employee_id, manager_id, period)
  values (v_me, v_manager, v_period)
  returning id into v_id;
  insert into public.manager_feedback_answers (feedback_id, prompt, sort_order)
  select v_id, q.prompt, row_number() over (order by q.sort_order) - 1
    from public.manager_feedback_questions q;
  return v_id;
end;
$$;

-- Submit one's own form, every question rated, before its month's window
-- closes. After the 10th it is marked late. Final.
create or replace function public.manager_feedback_submit(p_feedback_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_form public.manager_feedback;
begin
  select * into v_form from public.manager_feedback where id = p_feedback_id for update;
  if not found or v_form.employee_id is distinct from public.current_employee_id() then
    raise exception 'Feedback not found.' using errcode = 'P0002';
  end if;
  if v_form.submitted_at is not null then
    raise exception 'This feedback is already submitted.';
  end if;
  if public.company_today() > public.manager_feedback_closes(v_form.period) then
    raise exception 'The 1:1 for % has passed; this feedback can no longer be submitted.',
      to_char(v_form.period, 'FMMonth YYYY');
  end if;
  if exists (select 1 from public.manager_feedback_answers where feedback_id = p_feedback_id and rating is null) then
    raise exception 'Rate every question.' using errcode = '23514';
  end if;
  update public.manager_feedback
     set submitted_at = now(), late = public.company_today() > due_date, body = nullif(trim(body), '')
   where id = p_feedback_id;
end;
$$;

-- HR: one reviewed month's feedback, as a list of who owes it — whoever is
-- due a review that month (may log in, had joined by its first day, has a
-- manager) — with their form if started (the manager it was started for).
-- Leaves out feedback about the caller.
drop function public.manager_feedback_due(integer, integer);
create function public.manager_feedback_due(p_period date)
returns table (employee_id uuid, full_name text, manager_id uuid, manager_name text, feedback_id uuid,
               due_date date, submitted_at timestamptz, late boolean)
language sql stable security definer set search_path = '' as $$
  select e.id, e.full_name, coalesce(f.manager_id, n.manager_id), m.full_name, f.id,
         (date_trunc('month', p_period)::date + interval '1 month 9 days')::date, f.submitted_at, f.late
    from public.employees e
    left join public.org_chart_nodes n on n.employee_id = e.id
    left join public.manager_feedback f
      on f.employee_id = e.id and f.period = date_trunc('month', p_period)::date
    left join public.employees m on m.id = coalesce(f.manager_id, n.manager_id)
   where public.is_hr()
     -- Not who has or hasn't written about the HR person looking.
     and coalesce(f.manager_id, n.manager_id) is distinct from public.current_employee_id()
     and (f.id is not null
          or (public.is_login_status(e.status) and n.manager_id is not null
              and e.date_of_joining <= date_trunc('month', p_period)::date))
   order by e.full_name;
$$;

-- The caller's current 1:1 — last month's — if they are due one: its due
-- date, their manager, the state of the review of them (not its contents
-- until submitted, which they read from performance_reviews) and of their
-- feedback on the manager. No row when they aren't due one.
create function public.my_one_on_one()
returns table (period date, due_date date, manager_id uuid, manager_name text, review_id uuid,
               review_status public.review_status, review_submitted_at timestamptz,
               feedback_id uuid, feedback_submitted_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with c as (select (date_trunc('month', public.company_today()) - interval '1 month')::date as period)
  select c.period, (c.period + interval '1 month 9 days')::date, coalesce(f.manager_id, n.manager_id),
         m.full_name, r.id, r.status, r.submitted_at, f.id, f.submitted_at
    from c
    join public.employees e on e.id = public.current_employee_id()
    left join public.org_chart_nodes n on n.employee_id = e.id
    left join public.performance_reviews r on r.employee_id = e.id and r.period = c.period
    left join public.manager_feedback f on f.employee_id = e.id and f.period = c.period
    left join public.employees m on m.id = coalesce(f.manager_id, n.manager_id)
   where r.id is not null or f.id is not null
      or (public.is_login_status(e.status) and n.manager_id is not null and e.date_of_joining <= c.period);
$$;

revoke execute on function
  public.manager_feedback_closes(date), public.manager_feedback_due(date), public.my_one_on_one()
  from public, anon, authenticated;
grant execute on function
  public.manager_feedback_closes(date), public.manager_feedback_due(date), public.my_one_on_one()
  to authenticated;
