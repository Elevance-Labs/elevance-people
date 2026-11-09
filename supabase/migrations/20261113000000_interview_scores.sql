-- Scores for the test and the interviews.
--
-- Each job keeps its own interview questions (1 to 10; five defaults
-- covering technical skills, problem solving, communication and people
-- skills, culture fit and mindset, which existing jobs get too). Moving an
-- application on from the test now needs a test score (1-5); moving it on
-- from an interview needs a rating (1-5) for each of the job's questions,
-- which are copied onto the move so later edits to the job don't change
-- what was rated. Moving to abandoned takes neither. Remarks and reasons
-- are needed as before. Scores live on the stage event, so they are seen by
-- whoever sees the application's timeline, and an undone move's scores stay
-- in the timeline but drop out of the totals the app shows.

create function public.valid_interview_questions(p text[])
returns boolean language sql immutable set search_path = '' as $$
  select cardinality(p) between 1 and 10
     and not exists (select 1 from unnest(p) q
                      where q is null or q <> trim(q) or q = '' or length(q) > 300);
$$;

alter table public.job_openings
  add column interview_questions text[] not null default array[
    'Technical skills: depth of knowledge and hands-on ability for the role',
    'Problem solving: breaks down unfamiliar problems and reasons to sound solutions',
    'Communication and people skills: explains clearly, listens and works well with others',
    'Culture fit: shares our values and suits how we work',
    'Mindset: ownership, curiosity and a drive to learn and grow'
  ]::text[] check (public.valid_interview_questions(interview_questions));

grant insert (interview_questions), update (interview_questions) on public.job_openings to authenticated;

alter table public.application_stage_events
  add column test_score smallint check (test_score between 1 and 5),
  add column interview_questions text[],
  add column interview_ratings smallint[],
  add constraint application_stage_events_ratings_check check (
    (interview_questions is null) = (interview_ratings is null)
    and cardinality(interview_ratings) = cardinality(interview_questions)
    and array_position(interview_ratings, null) is null
    and 1 <= all (interview_ratings) and 5 >= all (interview_ratings));

drop function public.application_move(uuid, public.application_stage, text);

-- Move an application to one of its next stages (with a reason where one is
-- required). The only way forward, except to hired (application_hire).
-- Moving on from the test takes a test score, and from an interview a rating
-- for each of the job's interview questions; neither when abandoned.
create function public.application_move(
  p_application_id uuid, p_stage public.application_stage, p_reason text default null,
  p_test_score smallint default null, p_ratings smallint[] default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me        uuid := public.current_employee_id();
  v_app       public.job_applications;
  v_reason    text := nullif(trim(p_reason), '');
  v_scored    boolean;
  v_questions text[];
begin
  select * into v_app from public.job_applications where id = p_application_id for update;
  if not found or v_me is null or not public.can_see_application(v_app.job_opening_id, v_app.stage) then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
  if not public.is_hr() and not public.application_team_movable(v_app.stage) then
    raise exception 'Only HR can move an application on from this stage.' using errcode = '42501';
  end if;
  if not p_stage = any (public.application_next_stages(v_app.stage)) then
    raise exception 'An application can''t move from % to %.', v_app.stage, p_stage;
  end if;
  if p_stage = 'hired' then
    raise exception 'Hire through application_hire, which creates the employee record.';
  end if;
  if public.application_stage_needs_reason(p_stage) and v_reason is null then
    raise exception 'Give a reason for moving this application to %.', p_stage using errcode = '23514';
  end if;

  v_scored := p_stage <> 'abandoned';
  if v_app.stage = 'test' and v_scored then
    if p_test_score is null or p_test_score not between 1 and 5 then
      raise exception 'Give the test a score from 1 to 5.' using errcode = '23514';
    end if;
  elsif p_test_score is not null then
    raise exception 'Only a move on from the test takes a test score.' using errcode = '23514';
  end if;
  if v_app.stage in ('interview_1', 'interview_2', 'interview_3') and v_scored then
    select j.interview_questions into v_questions
      from public.job_openings j where j.id = v_app.job_opening_id;
    if p_ratings is null or cardinality(p_ratings) <> cardinality(v_questions)
       or array_position(p_ratings, null) is not null
       or not (1 <= all (p_ratings) and 5 >= all (p_ratings)) then
      raise exception 'Rate every interview question from 1 to 5.' using errcode = '23514';
    end if;
  elsif p_ratings is not null then
    raise exception 'Only a move on from an interview takes ratings.' using errcode = '23514';
  end if;

  update public.job_applications set stage = p_stage, stage_changed_at = now()
   where id = p_application_id;
  insert into public.application_stage_events
    (application_id, kind, from_stage, to_stage, reason, created_by,
     test_score, interview_questions, interview_ratings)
  values (p_application_id, 'move', v_app.stage, p_stage, v_reason, v_me,
          p_test_score, case when p_ratings is not null then v_questions end, p_ratings);
end;
$$;

revoke execute on function
  public.valid_interview_questions(text[]),
  public.application_move(uuid, public.application_stage, text, smallint, smallint[])
  from public, anon, authenticated;
grant execute on function
  public.valid_interview_questions(text[]),
  public.application_move(uuid, public.application_stage, text, smallint, smallint[])
  to authenticated;
