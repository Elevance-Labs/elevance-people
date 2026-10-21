-- Application stages: remarks are now required when moving to an interview
-- or to cleared too, as well as the existing reason for shelf, rejected,
-- declined and abandoned. application_move already refuses a move without
-- text when this says so.
create or replace function public.application_stage_needs_reason(p_stage public.application_stage)
returns boolean language sql immutable set search_path = '' as $$
  select p_stage in ('interview_1', 'interview_2', 'interview_3', 'cleared',
                     'shelf', 'rejected', 'declined', 'abandoned');
$$;
