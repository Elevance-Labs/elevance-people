-- Announcements, for the new dashboard.
--
-- HR (HR admins and company admins) write announcements: a rich-text body and
-- nothing else (no title). One can be pinned until a date; while pinned it
-- shows on every employee's dashboard, as the body alone. Other employees read
-- only announcements pinned today, never the rest. HR reads and manages all.
--
-- The body is HTML from the app's editor, sanitised before it's saved and
-- again wherever it's shown.

create table public.announcements (
  id           uuid primary key default gen_random_uuid(),
  body         text not null check (btrim(body) <> '' and length(body) <= 20000),
  -- On dashboards through this date. Null = not pinned.
  pinned_until date,
  created_by   uuid references public.employees (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create function public.announcements_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := public.current_employee_id();
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger announcements_stamp
  before insert or update on public.announcements
  for each row execute function public.announcements_stamp();

revoke all on public.announcements from anon, authenticated;
grant select, delete on public.announcements to authenticated;
-- created_by is stamped by the trigger, so it isn't writable.
grant insert (body, pinned_until), update (body, pinned_until)
  on public.announcements to authenticated;

revoke execute on function public.announcements_stamp() from public, anon, authenticated;

alter table public.announcements enable row level security;

-- HR sees every announcement; other employees only those pinned today.
create policy announcements_select on public.announcements for select to authenticated
  using ((select public.is_hr())
         or (pinned_until >= current_date and (select public.current_employee_id()) is not null));
create policy announcements_insert on public.announcements for insert to authenticated
  with check ((select public.is_hr()));
create policy announcements_update on public.announcements for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy announcements_delete on public.announcements for delete to authenticated
  using ((select public.is_hr()));
