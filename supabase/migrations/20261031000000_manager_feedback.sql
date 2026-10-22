-- ---------------------------------------------------------------------------
-- Performance, part four: quarterly feedback on one's manager.
--
-- Every quarter, in its last month, everyone with a manager in the org chart
-- gives feedback on them: 3–5 questions rated 1–5 and a free-text box. The
-- form opens on the 1st of that month, is due on the 10th, and can be
-- submitted (late) until the quarter ends; after that it's missed. Nobody
-- sets anything up: the employee's form is made when they first open it
-- (manager_feedback_start), with the manager and HR's questions copied in.
-- Submitting (manager_feedback_submit) is final.
--
-- Only HR (HR admins and company admins) reads the forms, with names — never
-- the manager, and HR not the feedback about themselves. The employee reads
-- and writes only their own. HR keeps the one list of questions.
-- ---------------------------------------------------------------------------

-- The questions every quarter's form copies when it starts.
create table public.manager_feedback_questions (
  id         uuid primary key default gen_random_uuid(),
  prompt     text not null check (prompt = trim(prompt) and prompt <> '' and length(prompt) <= 500),
  -- Set on insert (last) by manager_feedback_questions_guard.
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One per employee and quarter. Created and submitted only by the functions
-- below; the employee writes the feedback box and ratings while a draft.
create table public.manager_feedback (
  id           uuid primary key default gen_random_uuid(),
  -- Who writes it.
  employee_id  uuid not null,
  -- Their manager when the form was started.
  manager_id   uuid,
  year         integer not null check (year between 2000 and 2999),
  quarter      integer not null check (quarter between 1 and 4),
  -- The 10th of the quarter's last month.
  due_date     date not null generated always as (make_date(year, quarter * 3, 10)) stored,
  body         text check (length(body) <= 5000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  submitted_at timestamptz,
  late         boolean not null default false,
  -- Named: manager_feedback references employees twice.
  constraint manager_feedback_employee_id_fkey foreign key (employee_id)
    references public.employees (id) on delete cascade,
  constraint manager_feedback_manager_id_fkey foreign key (manager_id)
    references public.employees (id) on delete set null,
  constraint manager_feedback_quarter_key unique (employee_id, year, quarter)
);
create index manager_feedback_period_idx on public.manager_feedback (year, quarter);
create index manager_feedback_manager_idx on public.manager_feedback (manager_id);

-- The questions as they were when the form started.
create table public.manager_feedback_answers (
  id          uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.manager_feedback (id) on delete cascade,
  prompt      text not null,
  sort_order  integer not null,
  rating      smallint check (rating between 1 and 5)
);
create index manager_feedback_answers_feedback_idx on public.manager_feedback_answers (feedback_id, sort_order);

insert into public.manager_feedback_questions (prompt, sort_order) values
  ('Gives me clear goals and priorities.', 0),
  ('Gives me useful, timely feedback.', 1),
  ('Is available and supportive when I need help.', 2),
  ('Recognises my work and treats me fairly.', 3),
  ('Supports my growth and career development.', 4);

-- The last day of a quarter: after it, its forms can't be submitted.
create function public.quarter_end(p_year integer, p_quarter integer)
returns date language sql immutable set search_path = '' as $$
  select (make_date(p_year, p_quarter * 3, 1) + interval '1 month - 1 day')::date;
$$;

-- Keeps the list at 3 to 5 questions; a new one goes last.
create function public.manager_feedback_questions_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_count integer := (select count(*) from public.manager_feedback_questions);
begin
  if tg_op = 'DELETE' then
    if v_count <= 3 then
      raise exception 'Keep at least 3 questions.' using errcode = '23514';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if v_count >= 5 then
      raise exception 'There can be at most 5 questions.' using errcode = '23514';
    end if;
    select coalesce(max(q.sort_order) + 1, 0) into new.sort_order from public.manager_feedback_questions q;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger manager_feedback_questions_guard
  before insert or update or delete on public.manager_feedback_questions
  for each row execute function public.manager_feedback_questions_guard();

-- The text and ratings change only while the form is unsubmitted and its
-- quarter hasn't ended.
create function public.manager_feedback_guard()
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
  if v_form.submitted_at is not null or public.company_today() > public.quarter_end(v_form.year, v_form.quarter) then
    raise exception 'This feedback can no longer be changed.';
  end if;
  return new;
end;
$$;

create trigger manager_feedback_guard
  before update on public.manager_feedback
  for each row execute function public.manager_feedback_guard();
create trigger manager_feedback_answers_guard
  before update on public.manager_feedback_answers
  for each row execute function public.manager_feedback_guard();

-- ---------------------------------------------------------------------------
-- Manager feedback actions (RPCs). The only way a form is made or submitted.
-- ---------------------------------------------------------------------------

-- The caller's form for this quarter, made the first time they open it: only
-- in the quarter's last month, for someone who may log in, had joined by its
-- first day, and has a manager. Returns its id.
create function public.manager_feedback_start()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me        uuid := public.current_employee_id();
  v_today     date := public.company_today();
  v_year      integer := extract(year from v_today);
  v_quarter   integer := extract(quarter from v_today);
  v_opens     date := make_date(v_year, v_quarter * 3, 1);
  v_manager   uuid;
  v_questions integer;
  v_id        uuid;
begin
  if v_me is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  select id into v_id from public.manager_feedback
   where employee_id = v_me and year = v_year and quarter = v_quarter;
  if found then
    return v_id;
  end if;
  if v_today < v_opens then
    raise exception 'Feedback on your manager opens on %.', to_char(v_opens, 'FMDD Mon YYYY') using errcode = '23514';
  end if;
  if (select date_of_joining from public.employees where id = v_me) > v_opens then
    raise exception 'You joined after this quarter''s feedback opened.' using errcode = '23514';
  end if;
  select manager_id into v_manager from public.org_chart_nodes where employee_id = v_me;
  if v_manager is null then
    raise exception 'You have no manager in the org chart to give feedback on.' using errcode = '23514';
  end if;
  select count(*) into v_questions from public.manager_feedback_questions;
  if v_questions not between 3 and 5 then
    raise exception 'HR hasn''t finished setting up the questions yet.' using errcode = '23514';
  end if;

  insert into public.manager_feedback (employee_id, manager_id, year, quarter)
  values (v_me, v_manager, v_year, v_quarter)
  returning id into v_id;
  insert into public.manager_feedback_answers (feedback_id, prompt, sort_order)
  select v_id, q.prompt, row_number() over (order by q.sort_order) - 1
    from public.manager_feedback_questions q;
  return v_id;
end;
$$;

-- Submit one's own form, every question rated, before the quarter ends.
-- After the 10th it is marked late. Final.
create function public.manager_feedback_submit(p_feedback_id uuid)
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
  if public.company_today() > public.quarter_end(v_form.year, v_form.quarter) then
    raise exception 'Q% % has ended; this feedback can no longer be submitted.', v_form.quarter, v_form.year;
  end if;
  if exists (select 1 from public.manager_feedback_answers where feedback_id = p_feedback_id and rating is null) then
    raise exception 'Rate every question.' using errcode = '23514';
  end if;
  update public.manager_feedback
     set submitted_at = now(), late = public.company_today() > due_date, body = nullif(trim(body), '')
   where id = p_feedback_id;
end;
$$;

-- HR: one quarter's feedback, as a list of who owes it — everyone who may log
-- in, had joined by the first day of the quarter's last month and has a
-- manager — with their form if started (the manager it was started for).
-- Leaves out feedback about the caller.
create function public.manager_feedback_due(p_year integer, p_quarter integer)
returns table (employee_id uuid, full_name text, manager_id uuid, manager_name text, feedback_id uuid,
               due_date date, submitted_at timestamptz, late boolean)
language sql stable security definer set search_path = '' as $$
  select e.id, e.full_name, coalesce(f.manager_id, n.manager_id), m.full_name, f.id,
         make_date(p_year, p_quarter * 3, 10), f.submitted_at, f.late
    from public.employees e
    left join public.org_chart_nodes n on n.employee_id = e.id
    left join public.manager_feedback f on f.employee_id = e.id and f.year = p_year and f.quarter = p_quarter
    left join public.employees m on m.id = coalesce(f.manager_id, n.manager_id)
   where public.is_hr() and p_quarter between 1 and 4
     -- Not who has or hasn't written about the HR person looking.
     and coalesce(f.manager_id, n.manager_id) is distinct from public.current_employee_id()
     and (f.id is not null
          or (public.is_login_status(e.status) and n.manager_id is not null
              and e.date_of_joining <= make_date(p_year, p_quarter * 3, 1)))
   order by e.full_name;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on public.manager_feedback_questions, public.manager_feedback, public.manager_feedback_answers
  from anon, authenticated;

-- sort_order is set by the trigger, which also keeps 3 to 5 questions.
grant select, delete, insert (prompt), update (prompt) on public.manager_feedback_questions to authenticated;
-- Forms are made and submitted only by the functions above.
grant select, update (body) on public.manager_feedback to authenticated;
grant select, update (rating) on public.manager_feedback_answers to authenticated;

revoke execute on function
  public.quarter_end(integer, integer), public.manager_feedback_questions_guard(), public.manager_feedback_guard(),
  public.manager_feedback_start(), public.manager_feedback_submit(uuid), public.manager_feedback_due(integer, integer)
  from public, anon, authenticated;
grant execute on function
  public.quarter_end(integer, integer), public.manager_feedback_start(), public.manager_feedback_submit(uuid),
  public.manager_feedback_due(integer, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.manager_feedback_questions enable row level security;
alter table public.manager_feedback enable row level security;
alter table public.manager_feedback_answers enable row level security;

-- The questions: HR only (each form carries its own copy).
create policy manager_feedback_questions_select on public.manager_feedback_questions
  for select to authenticated using ((select public.is_hr()));
create policy manager_feedback_questions_insert on public.manager_feedback_questions
  for insert to authenticated with check ((select public.is_hr()));
create policy manager_feedback_questions_update on public.manager_feedback_questions
  for update to authenticated using ((select public.is_hr())) with check ((select public.is_hr()));
create policy manager_feedback_questions_delete on public.manager_feedback_questions
  for delete to authenticated using ((select public.is_hr()));

-- The forms: the employee their own; HR all but those about themselves.
-- Never the manager.
create policy manager_feedback_select on public.manager_feedback for select to authenticated
  using (employee_id = (select public.current_employee_id())
         or ((select public.is_hr()) and manager_id is distinct from (select public.current_employee_id())));
create policy manager_feedback_update on public.manager_feedback for update to authenticated
  using (employee_id = (select public.current_employee_id()))
  with check (employee_id = (select public.current_employee_id()));

create policy manager_feedback_answers_select on public.manager_feedback_answers for select to authenticated
  using (exists (select 1 from public.manager_feedback f where f.id = feedback_id));
create policy manager_feedback_answers_update on public.manager_feedback_answers for update to authenticated
  using (exists (select 1 from public.manager_feedback f
                  where f.id = feedback_id and f.employee_id = (select public.current_employee_id())))
  with check (exists (select 1 from public.manager_feedback f
                       where f.id = feedback_id and f.employee_id = (select public.current_employee_id())));
