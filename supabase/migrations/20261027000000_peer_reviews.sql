-- ---------------------------------------------------------------------------
-- Performance, part three: quarterly peer reviews.
--
-- HR sets up one cycle per quarter (peer_cycle_create, which copies the last
-- cycle's questions, or starter ones): a due date and 3–5 questions, each
-- answered with a rating of 1–5 and an optional comment, plus open feedback.
-- HR picks who is reviewed (the subject) and by whom, then opens the cycle
-- (peer_cycle_open), which hands each reviewer their form. A reviewer saves
-- as they go and submits (peer_review_submit); a submitted review is final.
-- HR closes the cycle (peer_cycle_close); forms not submitted by then are
-- missed.
--
-- HR reads everything, reviewer names included — except reviews about
-- themselves, and HR can't make themselves a subject. A reviewer reads only
-- their own forms. A subject reads what was written about them only through
-- my_peer_feedback: once the cycle is closed, with at least two responses,
-- without reviewer names, in a shuffled order.
-- ---------------------------------------------------------------------------

create type public.peer_cycle_status as enum ('draft', 'open', 'closed');

create table public.peer_review_cycles (
  id         uuid primary key default gen_random_uuid(),
  year       integer not null check (year between 2000 and 2999),
  quarter    integer not null check (quarter between 1 and 4),
  status     public.peer_cycle_status not null default 'draft',
  due_date   date not null,
  created_by uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now(),
  opened_at  timestamptz,
  closed_at  timestamptz,
  updated_at timestamptz not null default now(),
  constraint peer_review_cycles_period_key unique (year, quarter)
);

create table public.peer_review_questions (
  id         uuid primary key default gen_random_uuid(),
  cycle_id   uuid not null references public.peer_review_cycles (id) on delete cascade,
  prompt     text not null check (prompt = trim(prompt) and prompt <> '' and length(prompt) <= 500),
  -- Set on insert (last) by peer_review_questions_guard.
  sort_order integer not null default 0
);
create index peer_review_questions_cycle_idx on public.peer_review_questions (cycle_id, sort_order);

-- One reviewer writing about one subject in a cycle.
create table public.peer_review_assignments (
  id            uuid primary key default gen_random_uuid(),
  cycle_id      uuid not null references public.peer_review_cycles (id) on delete cascade,
  subject_id    uuid not null,
  reviewer_id   uuid not null,
  open_feedback text check (length(open_feedback) <= 5000),
  created_at    timestamptz not null default now(),
  -- Set only by peer_review_submit; final.
  submitted_at  timestamptz,
  -- Named: peer_review_assignments references employees twice.
  constraint peer_review_assignments_subject_id_fkey foreign key (subject_id)
    references public.employees (id) on delete cascade,
  constraint peer_review_assignments_reviewer_id_fkey foreign key (reviewer_id)
    references public.employees (id) on delete cascade,
  constraint peer_review_assignments_pair_key unique (cycle_id, subject_id, reviewer_id),
  constraint peer_review_assignments_not_self check (subject_id <> reviewer_id)
);
create index peer_review_assignments_reviewer_idx on public.peer_review_assignments (reviewer_id);
create index peer_review_assignments_subject_idx on public.peer_review_assignments (subject_id);

-- One per question of an assignment, made when the cycle opens (or the
-- assignment is added to an open cycle).
create table public.peer_review_answers (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.peer_review_assignments (id) on delete cascade,
  question_id   uuid not null references public.peer_review_questions (id) on delete cascade,
  rating        smallint check (rating between 1 and 5),
  comment       text check (length(comment) <= 2000),
  constraint peer_review_answers_question_key unique (assignment_id, question_id)
);

create trigger peer_review_cycles_touch before update on public.peer_review_cycles
  for each row execute function public.touch_updated_at();

-- For RLS: cycles and assignments refer to each other, so these read past it.
create function public.is_peer_reviewer_in(p_cycle_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.peer_review_assignments
                  where cycle_id = p_cycle_id and reviewer_id = public.current_employee_id());
$$;

create function public.peer_cycle_status_of(p_cycle_id uuid)
returns public.peer_cycle_status language sql stable security definer set search_path = '' as $$
  select status from public.peer_review_cycles where id = p_cycle_id;
$$;

-- Questions change only while their cycle is a draft; a new one goes last.
create function public.peer_review_questions_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status public.peer_cycle_status;
begin
  select status into v_status from public.peer_review_cycles
   where id = case when tg_op = 'DELETE' then old.cycle_id else new.cycle_id end;
  if v_status is distinct from 'draft' then
    raise exception 'Questions can only be changed before the cycle opens.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'INSERT' then
    select coalesce(max(q.sort_order) + 1, 0) into new.sort_order
      from public.peer_review_questions q where q.cycle_id = new.cycle_id;
  elsif new.cycle_id <> old.cycle_id then
    raise exception 'A question can''t move to another cycle.';
  end if;
  return new;
end;
$$;

create trigger peer_review_questions_guard
  before insert or update or delete on public.peer_review_questions
  for each row execute function public.peer_review_questions_guard();

-- Assignments: added and removed until the cycle closes, only between people
-- who may log in; a submitted one stays. Open feedback changes only while the
-- cycle is open and it isn't submitted.
create function public.peer_review_assignments_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_cycle public.peer_review_cycles;
begin
  select * into v_cycle from public.peer_review_cycles
   where id = case when tg_op = 'DELETE' then old.cycle_id else new.cycle_id end;
  if tg_op = 'DELETE' then
    if v_cycle.status = 'closed' or old.submitted_at is not null then
      raise exception 'A submitted review, or one in a closed cycle, can''t be removed.';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if v_cycle.status = 'closed' then
      raise exception 'This cycle is closed.';
    end if;
    if exists (select 1 from public.employees e
                where e.id in (new.subject_id, new.reviewer_id) and not public.is_login_status(e.status)) then
      raise exception 'Only employees on probation, active or on their notice period take part in peer reviews.'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if (new.cycle_id, new.subject_id, new.reviewer_id) is distinct from (old.cycle_id, old.subject_id, old.reviewer_id) then
    raise exception 'Remove the reviewer and add them again instead.';
  end if;
  if new.open_feedback is distinct from old.open_feedback
     and (v_cycle.status <> 'open' or old.submitted_at is not null) then
    raise exception 'This review can no longer be changed.';
  end if;
  return new;
end;
$$;

create trigger peer_review_assignments_guard
  before insert or update or delete on public.peer_review_assignments
  for each row execute function public.peer_review_assignments_guard();

-- An assignment added to an open cycle gets its blank answers at once.
create function public.peer_review_assignments_answers()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select status from public.peer_review_cycles where id = new.cycle_id) = 'open' then
    insert into public.peer_review_answers (assignment_id, question_id)
    select new.id, q.id from public.peer_review_questions q where q.cycle_id = new.cycle_id;
  end if;
  return null;
end;
$$;

create trigger peer_review_assignments_answers
  after insert on public.peer_review_assignments
  for each row execute function public.peer_review_assignments_answers();

-- Answers change only while the cycle is open and the review isn't submitted.
create function public.peer_review_answers_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.assignment_id, new.question_id) is distinct from (old.assignment_id, old.question_id) then
    raise exception 'An answer can''t move.';
  end if;
  if exists (select 1 from public.peer_review_assignments a
               join public.peer_review_cycles c on c.id = a.cycle_id
              where a.id = new.assignment_id and (c.status <> 'open' or a.submitted_at is not null)) then
    raise exception 'This review can no longer be changed.';
  end if;
  return new;
end;
$$;

create trigger peer_review_answers_guard
  before update on public.peer_review_answers
  for each row execute function public.peer_review_answers_guard();

-- ---------------------------------------------------------------------------
-- Peer review actions (RPCs). The only way a cycle is created or changes
-- status, and a review is submitted.
-- ---------------------------------------------------------------------------

-- Start a quarter's cycle as a draft, with the questions of the latest
-- earlier cycle (or starter questions for the first one). Returns its id.
create function public.peer_cycle_create(p_year integer, p_quarter integer, p_due_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id       uuid;
  v_previous uuid;
begin
  if not public.is_hr() then
    raise exception 'Only HR can set up peer reviews.' using errcode = '42501';
  end if;
  if p_year is null or p_quarter is null or p_quarter not between 1 and 4 then
    raise exception 'Pick a quarter.' using errcode = '23514';
  end if;
  if p_due_date is null or p_due_date < public.company_today() then
    raise exception 'Pick a due date, today or later.' using errcode = '23514';
  end if;
  if exists (select 1 from public.peer_review_cycles where year = p_year and quarter = p_quarter) then
    raise exception 'There are already peer reviews for Q% %.', p_quarter, p_year using errcode = '23505';
  end if;

  select id into v_previous from public.peer_review_cycles
   where (year, quarter) < (p_year, p_quarter) order by year desc, quarter desc limit 1;
  insert into public.peer_review_cycles (year, quarter, due_date, created_by)
  values (p_year, p_quarter, p_due_date, public.current_employee_id())
  returning id into v_id;
  if v_previous is not null then
    insert into public.peer_review_questions (cycle_id, prompt)
    select v_id, q.prompt from public.peer_review_questions q
     where q.cycle_id = v_previous order by q.sort_order;
  end if;
  if not exists (select 1 from public.peer_review_questions where cycle_id = v_id) then
    insert into public.peer_review_questions (cycle_id, prompt)
    select v_id, x.prompt from unnest(array[
      'Collaborates well and is easy to work with.',
      'Communicates clearly and keeps others informed.',
      'Delivers reliable, high-quality work.',
      'Takes ownership and follows through.']) with ordinality as x(prompt, n)
     order by x.n;
  end if;
  return v_id;
end;
$$;

-- Open a draft cycle: 3–5 questions and at least one reviewer. Each reviewer
-- gets their form.
create function public.peer_cycle_open(p_cycle_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_cycle     public.peer_review_cycles;
  v_questions integer;
begin
  if not public.is_hr() then
    raise exception 'Only HR can open peer reviews.' using errcode = '42501';
  end if;
  select * into v_cycle from public.peer_review_cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'Peer review cycle not found.' using errcode = 'P0002';
  end if;
  if v_cycle.status <> 'draft' then
    raise exception 'This cycle is already %.', v_cycle.status;
  end if;
  select count(*) into v_questions from public.peer_review_questions where cycle_id = p_cycle_id;
  if v_questions not between 3 and 5 then
    raise exception 'A cycle needs 3 to 5 questions; this one has %.', v_questions using errcode = '23514';
  end if;
  if not exists (select 1 from public.peer_review_assignments where cycle_id = p_cycle_id) then
    raise exception 'Add at least one person and their reviewers first.' using errcode = '23514';
  end if;
  if v_cycle.due_date < public.company_today() then
    raise exception 'The due date has passed. Move it first.' using errcode = '23514';
  end if;

  update public.peer_review_cycles set status = 'open', opened_at = now() where id = p_cycle_id;
  insert into public.peer_review_answers (assignment_id, question_id)
  select a.id, q.id
    from public.peer_review_assignments a
    join public.peer_review_questions q on q.cycle_id = a.cycle_id
   where a.cycle_id = p_cycle_id;
end;
$$;

-- Close an open cycle. Reviews not submitted by then are missed, and the
-- subjects can read what was written about them.
create function public.peer_cycle_close(p_cycle_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_status public.peer_cycle_status;
begin
  if not public.is_hr() then
    raise exception 'Only HR can close peer reviews.' using errcode = '42501';
  end if;
  select status into v_status from public.peer_review_cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'Peer review cycle not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'Only an open cycle can be closed; this one is %.', v_status;
  end if;
  update public.peer_review_cycles set status = 'closed', closed_at = now() where id = p_cycle_id;
end;
$$;

-- Submit one's own review while the cycle is open, every question rated.
-- Final.
create function public.peer_review_submit(p_assignment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_assignment public.peer_review_assignments;
  v_status     public.peer_cycle_status;
begin
  select * into v_assignment from public.peer_review_assignments where id = p_assignment_id for update;
  if not found or v_assignment.reviewer_id is distinct from public.current_employee_id() then
    raise exception 'Peer review not found.' using errcode = 'P0002';
  end if;
  select status into v_status from public.peer_review_cycles where id = v_assignment.cycle_id;
  if v_status <> 'open' then
    raise exception 'This cycle is closed.';
  end if;
  if v_assignment.submitted_at is not null then
    raise exception 'This review is already submitted.';
  end if;
  if exists (select 1 from public.peer_review_answers where assignment_id = p_assignment_id and rating is null) then
    raise exception 'Rate every question.' using errcode = '23514';
  end if;
  update public.peer_review_assignments
     set submitted_at = now(), open_feedback = nullif(trim(open_feedback), '')
   where id = p_assignment_id;
end;
$$;

-- What was written about the caller in closed cycles with at least two
-- responses: one row per response, without who wrote it, in an order that
-- says nothing about who submitted first.
create function public.my_peer_feedback()
returns table (cycle_id uuid, year integer, quarter integer, response integer, open_feedback text, answers jsonb)
language sql stable security definer set search_path = '' as $$
  select c.id, c.year, c.quarter,
         (row_number() over (partition by c.id order by md5(a.id::text || c.id::text)))::integer,
         a.open_feedback,
         (select jsonb_agg(jsonb_build_object('prompt', q.prompt, 'sort_order', q.sort_order,
                                              'rating', r.rating, 'comment', r.comment) order by q.sort_order)
            from public.peer_review_answers r
            join public.peer_review_questions q on q.id = r.question_id
           where r.assignment_id = a.id)
    from public.peer_review_assignments a
    join public.peer_review_cycles c on c.id = a.cycle_id
   where a.subject_id = public.current_employee_id()
     and c.status = 'closed' and a.submitted_at is not null
     and (select count(*) from public.peer_review_assignments s
           where s.cycle_id = c.id and s.subject_id = a.subject_id and s.submitted_at is not null) >= 2
   order by c.year desc, c.quarter desc, 4;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on public.peer_review_cycles, public.peer_review_questions, public.peer_review_assignments,
              public.peer_review_answers
  from anon, authenticated;

-- Cycles are created and move only through the functions above; HR moves
-- the due date and deletes a draft.
grant select, delete, update (due_date) on public.peer_review_cycles to authenticated;
grant select, delete, insert (cycle_id, prompt), update (prompt) on public.peer_review_questions to authenticated;
-- HR adds and removes reviewers; the reviewer writes their open feedback.
grant select, delete, insert (cycle_id, subject_id, reviewer_id), update (open_feedback)
  on public.peer_review_assignments to authenticated;
-- Made by the database; the reviewer writes their ratings and comments.
grant select, update (rating, comment) on public.peer_review_answers to authenticated;

revoke execute on function
  public.peer_review_questions_guard(), public.peer_review_assignments_guard(),
  public.peer_review_assignments_answers(), public.peer_review_answers_guard(),
  public.peer_cycle_create(integer, integer, date), public.peer_cycle_open(uuid), public.peer_cycle_close(uuid),
  public.peer_review_submit(uuid), public.my_peer_feedback(), public.is_peer_reviewer_in(uuid),
  public.peer_cycle_status_of(uuid)
  from public, anon, authenticated;
grant execute on function
  public.peer_cycle_create(integer, integer, date), public.peer_cycle_open(uuid), public.peer_cycle_close(uuid),
  public.peer_review_submit(uuid), public.my_peer_feedback(), public.is_peer_reviewer_in(uuid),
  public.peer_cycle_status_of(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.peer_review_cycles enable row level security;
alter table public.peer_review_questions enable row level security;
alter table public.peer_review_assignments enable row level security;
alter table public.peer_review_answers enable row level security;

-- Cycles: HR, and the reviewers in them once opened.
create policy peer_review_cycles_select on public.peer_review_cycles for select to authenticated
  using ((select public.is_hr()) or (status <> 'draft' and public.is_peer_reviewer_in(id)));
create policy peer_review_cycles_update on public.peer_review_cycles for update to authenticated
  using ((select public.is_hr()) and status <> 'closed') with check ((select public.is_hr()));
create policy peer_review_cycles_delete on public.peer_review_cycles for delete to authenticated
  using ((select public.is_hr()) and status = 'draft');

-- Questions: HR writes (while a draft, by trigger); reviewers read those of
-- an opened cycle they are in.
create policy peer_review_questions_select on public.peer_review_questions for select to authenticated
  using ((select public.is_hr())
         or (public.is_peer_reviewer_in(cycle_id) and public.peer_cycle_status_of(cycle_id) <> 'draft'));
create policy peer_review_questions_insert on public.peer_review_questions for insert to authenticated
  with check ((select public.is_hr()));
create policy peer_review_questions_update on public.peer_review_questions for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy peer_review_questions_delete on public.peer_review_questions for delete to authenticated
  using ((select public.is_hr()));

-- Assignments: HR all but those about themselves; a reviewer their own, once
-- the cycle is open. HR never makes themselves a subject.
create policy peer_review_assignments_select on public.peer_review_assignments for select to authenticated
  using (((select public.is_hr()) and subject_id is distinct from (select public.current_employee_id()))
         or (reviewer_id = (select public.current_employee_id()) and public.peer_cycle_status_of(cycle_id) <> 'draft'));
create policy peer_review_assignments_insert on public.peer_review_assignments for insert to authenticated
  with check ((select public.is_hr()) and subject_id is distinct from (select public.current_employee_id()));
create policy peer_review_assignments_update on public.peer_review_assignments for update to authenticated
  using (reviewer_id = (select public.current_employee_id()))
  with check (reviewer_id = (select public.current_employee_id()));
create policy peer_review_assignments_delete on public.peer_review_assignments for delete to authenticated
  using ((select public.is_hr()) and subject_id is distinct from (select public.current_employee_id()));

-- Answers: seen with their assignment; written by its reviewer.
create policy peer_review_answers_select on public.peer_review_answers for select to authenticated
  using (exists (select 1 from public.peer_review_assignments a where a.id = assignment_id));
create policy peer_review_answers_update on public.peer_review_answers for update to authenticated
  using (exists (select 1 from public.peer_review_assignments a
                  where a.id = assignment_id and a.reviewer_id = (select public.current_employee_id())))
  with check (exists (select 1 from public.peer_review_assignments a
                       where a.id = assignment_id and a.reviewer_id = (select public.current_employee_id())));
