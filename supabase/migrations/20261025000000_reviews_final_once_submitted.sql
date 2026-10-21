-- ---------------------------------------------------------------------------
-- A submitted monthly review is final: nobody can reopen it, HR included.
-- The manager confirms before submitting instead (in the app).
--
-- Drops review_reopen and the columns that recorded a reopening.
-- ---------------------------------------------------------------------------

drop function public.review_reopen(uuid, text);

alter table public.performance_reviews
  drop column reopened_by,
  drop column reopened_at,
  drop column reopen_reason;
