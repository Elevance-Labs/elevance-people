-- ---------------------------------------------------------------------------
-- Peer reviews: let the database's own cascades through two guards.
--
-- peer_review_questions_guard refused deleting a question unless its cycle
-- was a draft, so deleting a draft cycle failed: its questions are deleted
-- after the cycle row is gone. peer_review_assignments_guard refused
-- deleting a submitted assignment, so a company admin couldn't delete an
-- employee who had been a subject or reviewer in a submitted peer review.
-- Both now let a delete through when the row's parent is already gone.
-- ---------------------------------------------------------------------------

create or replace function public.peer_review_questions_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status public.peer_cycle_status;
begin
  select status into v_status from public.peer_review_cycles
   where id = case when tg_op = 'DELETE' then old.cycle_id else new.cycle_id end;
  -- Its cycle is being deleted (only a draft can be), taking it along.
  if tg_op = 'DELETE' and v_status is null then
    return old;
  end if;
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

create or replace function public.peer_review_assignments_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_cycle public.peer_review_cycles;
begin
  select * into v_cycle from public.peer_review_cycles
   where id = case when tg_op = 'DELETE' then old.cycle_id else new.cycle_id end;
  if tg_op = 'DELETE' then
    -- Deleting the subject or reviewer's employee record takes it along.
    if (select count(*) from public.employees e where e.id in (old.subject_id, old.reviewer_id)) < 2 then
      return old;
    end if;
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
