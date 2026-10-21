-- ---------------------------------------------------------------------------
-- Private notes: each manager keeps one running note per direct report —
-- things that happened, to bring up at the next 1:1 — and edits it as they go.
--
-- A note is readable and writable only by the manager who wrote it — not the
-- employee, not HR, not a later manager — and is never part of a review.
-- A note can only be started about the author's current direct reports; the
-- author keeps theirs if the reporting line changes. The author is stamped by
-- trigger.
-- ---------------------------------------------------------------------------

create table public.manager_notes (
  id          uuid primary key default gen_random_uuid(),
  -- Who the note is about.
  employee_id uuid not null,
  -- Who wrote it, and the only one who reads it. Stamped by manager_notes_stamp.
  author_id   uuid not null references public.employees (id) on delete cascade,
  -- Free text; may be emptied.
  body        text not null default '' check (length(body) <= 10000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Named: manager_notes references employees twice.
  constraint manager_notes_employee_id_fkey foreign key (employee_id)
    references public.employees (id) on delete cascade,
  -- One note per manager and report.
  constraint manager_notes_author_employee_key unique (author_id, employee_id)
);

create function public.manager_notes_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := public.current_employee_id();
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger manager_notes_stamp
  before insert or update on public.manager_notes
  for each row execute function public.manager_notes_stamp();

revoke all on public.manager_notes from anon, authenticated;
-- author_id is stamped by the trigger, so it isn't writable.
grant select, delete on public.manager_notes to authenticated;
grant insert (employee_id, body), update (body) on public.manager_notes to authenticated;

revoke execute on function public.manager_notes_stamp() from public, anon, authenticated;

alter table public.manager_notes enable row level security;

-- The author only. A note can only be started about one of their direct reports.
create policy manager_notes_select on public.manager_notes for select to authenticated
  using (author_id = (select public.current_employee_id()));
create policy manager_notes_insert on public.manager_notes for insert to authenticated
  with check (author_id = (select public.current_employee_id()) and public.is_manager_of(employee_id));
create policy manager_notes_update on public.manager_notes for update to authenticated
  using (author_id = (select public.current_employee_id()))
  with check (author_id = (select public.current_employee_id()));
create policy manager_notes_delete on public.manager_notes for delete to authenticated
  using (author_id = (select public.current_employee_id()));
