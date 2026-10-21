-- Application stages: the hiring pipeline for job applications.
--
-- Every application has a stage, starting at 'new', and moves only along the
-- allowed transitions (application_next_stages) through application_move.
-- Each move is kept in application_stage_events with who made it and a
-- reason, which is required when shelving, rejecting, or recording that the
-- candidate declined or abandoned. HR can undo the last move
-- (application_undo), which is kept in the timeline too.
--
-- Who sees what:
--   * HR (HR admins and company admins) see and move every application.
--   * A job's hiring manager and its interviewers (the hiring team) see its
--     applications only from shortlisted through cleared, and move them only
--     out of shortlisted, test and the interviews.
--   * Expected salary is hidden from interviewers: clients can't select the
--     column; HR and the hiring manager read it through application_salary.
-- The hiring team also reads its job openings, so it can pick a job.

-- ---------------------------------------------------------------------------
-- Stages
-- ---------------------------------------------------------------------------
create type public.application_stage as enum (
  'new', 'screened', 'shortlisted', 'test', 'interview_1', 'interview_2', 'interview_3',
  'cleared', 'shelf', 'offer_sent', 'hired', 'rejected', 'abandoned', 'declined');

alter table public.job_applications
  add column stage public.application_stage not null default 'new',
  add column stage_changed_at timestamptz not null default now();
create index job_applications_job_stage_idx on public.job_applications (job_opening_id, stage);

-- Where an application may go next. Mirrored in src/lib/hiring.ts.
-- hired, rejected, abandoned and declined are final.
create function public.application_next_stages(p_stage public.application_stage)
returns public.application_stage[] language sql immutable set search_path = '' as $$
  select case p_stage
    when 'new'         then array['screened', 'rejected']
    when 'screened'    then array['shortlisted', 'test', 'rejected']
    when 'shortlisted' then array['test', 'interview_1', 'rejected', 'abandoned']
    when 'test'        then array['interview_1', 'rejected', 'abandoned']
    when 'interview_1' then array['interview_2', 'cleared', 'shelf', 'rejected', 'abandoned']
    when 'interview_2' then array['interview_3', 'cleared', 'shelf', 'rejected', 'abandoned']
    when 'interview_3' then array['cleared', 'shelf', 'rejected', 'abandoned']
    when 'cleared'     then array['shelf', 'offer_sent', 'rejected', 'abandoned']
    when 'shelf'       then array['offer_sent', 'rejected', 'abandoned']
    when 'offer_sent'  then array['hired', 'shelf', 'declined', 'rejected', 'abandoned']
    else '{}'
  end::public.application_stage[];
$$;

-- Moving into these needs a reason.
create function public.application_stage_needs_reason(p_stage public.application_stage)
returns boolean language sql immutable set search_path = '' as $$
  select p_stage in ('shelf', 'rejected', 'declined', 'abandoned');
$$;

-- The stages the hiring team sees.
create function public.application_team_stage(p_stage public.application_stage)
returns boolean language sql immutable set search_path = '' as $$
  select p_stage in ('shortlisted', 'test', 'interview_1', 'interview_2', 'interview_3', 'cleared');
$$;

-- The stages the hiring team may move an application out of.
create function public.application_team_movable(p_stage public.application_stage)
returns boolean language sql immutable set search_path = '' as $$
  select p_stage in ('shortlisted', 'test', 'interview_1', 'interview_2', 'interview_3');
$$;

-- ---------------------------------------------------------------------------
-- Timeline
-- ---------------------------------------------------------------------------

-- One row per move or undo, written only by application_move and
-- application_undo. An undone move keeps its row, marked undone.
create table public.application_stage_events (
  id             bigint generated always as identity primary key,
  application_id uuid not null references public.job_applications (id) on delete cascade,
  kind           text not null check (kind in ('move', 'undo')),
  from_stage     public.application_stage not null,
  to_stage       public.application_stage not null,
  reason         text check (length(reason) <= 2000),
  created_by     uuid references public.employees (id) on delete set null,
  created_at     timestamptz not null default now(),
  undone_by      uuid references public.employees (id) on delete set null,
  undone_at      timestamptz
);
create index application_stage_events_application_idx
  on public.application_stage_events (application_id, id);

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

-- The caller is the job's hiring manager or one of its interviewers.
create function public.is_hiring_team(p_job_opening_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.job_openings j
                  where j.id = p_job_opening_id and j.manager_id = public.current_employee_id())
      or exists (select 1 from public.job_opening_interviewers i
                  where i.job_opening_id = p_job_opening_id
                    and i.employee_id = public.current_employee_id());
$$;

-- The caller is on the hiring team of any job (gates the Applications page).
create function public.on_hiring_team()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.job_openings j where j.manager_id = public.current_employee_id())
      or exists (select 1 from public.job_opening_interviewers i
                  where i.employee_id = public.current_employee_id());
$$;

create function public.can_see_application(p_job_opening_id uuid, p_stage public.application_stage)
returns boolean language sql stable set search_path = '' as $$
  select public.is_hr()
      or (public.application_team_stage(p_stage) and public.is_hiring_team(p_job_opening_id));
$$;

-- Expected salary, for HR and the job's hiring manager. Null for anyone else.
create function public.application_salary(p_application_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select a.expected_salary
    from public.job_applications a
    join public.job_openings j on j.id = a.job_opening_id
   where a.id = p_application_id
     and public.can_see_application(a.job_opening_id, a.stage)
     and (public.is_hr() or j.manager_id = public.current_employee_id());
$$;

-- ---------------------------------------------------------------------------
-- Actions (RPCs): the only way a stage changes
-- ---------------------------------------------------------------------------
create function public.application_move(
  p_application_id uuid, p_stage public.application_stage, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := public.current_employee_id();
  v_app    public.job_applications;
  v_reason text := nullif(trim(p_reason), '');
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
  if public.application_stage_needs_reason(p_stage) and v_reason is null then
    raise exception 'Give a reason for moving this application to %.', p_stage using errcode = '23514';
  end if;

  update public.job_applications set stage = p_stage, stage_changed_at = now()
   where id = p_application_id;
  insert into public.application_stage_events
    (application_id, kind, from_stage, to_stage, reason, created_by)
  values (p_application_id, 'move', v_app.stage, p_stage, v_reason, v_me);
end;
$$;

-- HR only: move an application back to where its last (not yet undone) move
-- came from. Repeated undos walk further back.
create function public.application_undo(p_application_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := public.current_employee_id();
  v_app   public.job_applications;
  v_event public.application_stage_events;
begin
  if not public.is_hr() then
    raise exception 'Only HR can undo a move.' using errcode = '42501';
  end if;
  select * into v_app from public.job_applications where id = p_application_id for update;
  if not found then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
  select * into v_event from public.application_stage_events
   where application_id = p_application_id and kind = 'move' and undone_at is null
   order by id desc limit 1;
  if not found or v_event.to_stage <> v_app.stage then
    raise exception 'There is no move to undo.';
  end if;

  update public.application_stage_events set undone_by = v_me, undone_at = now()
   where id = v_event.id;
  update public.job_applications set stage = v_event.from_stage, stage_changed_at = now()
   where id = p_application_id;
  insert into public.application_stage_events
    (application_id, kind, from_stage, to_stage, reason, created_by)
  values (p_application_id, 'undo', v_app.stage, v_event.from_stage, nullif(trim(p_reason), ''), v_me);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on public.application_stage_events from anon, authenticated;
grant select on public.application_stage_events to authenticated;

-- Every column but expected_salary (see application_salary).
revoke select on public.job_applications from authenticated;
grant select (id, job_opening_id, full_name, email, phone, note, resume_path, resume_name,
              created_at, stage, stage_changed_at)
  on public.job_applications to authenticated;

revoke execute on function
  public.application_next_stages(public.application_stage),
  public.application_stage_needs_reason(public.application_stage),
  public.application_team_stage(public.application_stage),
  public.application_team_movable(public.application_stage),
  public.is_hiring_team(uuid), public.on_hiring_team(),
  public.can_see_application(uuid, public.application_stage), public.application_salary(uuid),
  public.application_move(uuid, public.application_stage, text),
  public.application_undo(uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.application_next_stages(public.application_stage),
  public.application_stage_needs_reason(public.application_stage),
  public.application_team_stage(public.application_stage),
  public.application_team_movable(public.application_stage),
  public.is_hiring_team(uuid), public.on_hiring_team(),
  public.can_see_application(uuid, public.application_stage), public.application_salary(uuid),
  public.application_move(uuid, public.application_stage, text),
  public.application_undo(uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.application_stage_events enable row level security;

-- The hiring team reads the jobs it's on (HR still reads and writes all).
drop policy job_openings_select on public.job_openings;
create policy job_openings_select on public.job_openings for select to authenticated
  using ((select public.is_hr()) or public.is_hiring_team(id));

drop policy job_applications_select on public.job_applications;
create policy job_applications_select on public.job_applications for select to authenticated
  using (public.can_see_application(job_opening_id, stage));

-- An application's timeline is visible to whoever can see the application.
create policy application_stage_events_select on public.application_stage_events
  for select to authenticated
  using (exists (select 1 from public.job_applications a where a.id = application_id));

-- CVs: readable by whoever can see the application (RLS applies inside).
drop policy job_application_cvs_read on storage.objects;
create policy job_application_cvs_read on storage.objects for select to authenticated
  using (bucket_id = 'job-applications'
         and exists (select 1 from public.job_applications a where a.resume_path = objects.name));
