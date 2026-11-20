-- Hiring: the hiring team sees Screened.
--
-- A job's hiring manager and interviewers now see its applications from
-- Screened (was Shortlisted) through Cleared, with their CVs, so they can
-- pick who goes forward. From Screened they may only shortlist or reject
-- (application_team_next_stages); HR then sets up the test or interview.
-- application_move checks that for anyone who isn't HR. Everything else
-- that follows application_team_stage (CV reads, hiring manager's salary
-- view, attaching tests) now covers Screened too.

create or replace function public.application_team_stage(p_stage public.application_stage)
returns boolean language sql immutable set search_path = '' as $$
  select p_stage in ('screened', 'shortlisted', 'test', 'interview_1', 'interview_2', 'interview_3', 'cleared');
$$;

create or replace function public.application_team_movable(p_stage public.application_stage)
returns boolean language sql immutable set search_path = '' as $$
  select p_stage in ('screened', 'shortlisted', 'test', 'interview_1', 'interview_2', 'interview_3');
$$;

-- Where the hiring team may move an application from a stage: the next
-- stages, except that from screened they only shortlist or reject (HR then
-- sets up the test or interview).
create function public.application_team_next_stages(p_stage public.application_stage)
returns public.application_stage[] language sql immutable set search_path = '' as $$
  select case p_stage
    when 'screened' then array['shortlisted', 'rejected']::public.application_stage[]
    else public.application_next_stages(p_stage)
  end;
$$;

create or replace function public.application_move(
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
  if not public.is_hr() and not p_stage = any (public.application_team_next_stages(v_app.stage)) then
    raise exception 'Only HR can move an application from % to %.', v_app.stage, p_stage using errcode = '42501';
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
  if v_app.stage = 'test' and p_stage not in ('rejected', 'abandoned')
     and not exists (select 1 from public.application_test_files f where f.application_id = p_application_id) then
    raise exception 'Attach the submitted test before moving the application on.' using errcode = '23514';
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

revoke execute on function public.application_team_next_stages(public.application_stage)
  from public, anon, authenticated;
grant execute on function public.application_team_next_stages(public.application_stage) to authenticated;
