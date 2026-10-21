-- Every employee can read every announcement, not just the pinned ones.
--
-- Pinned announcements still lead the dashboard; the rest (unpinned, or whose
-- pin has ended) are now readable by everyone signed in, from a drawer on the
-- dashboard. Writing stays with HR (HR admins and company admins).

drop policy announcements_select on public.announcements;

create policy announcements_select on public.announcements for select to authenticated
  using ((select public.current_employee_id()) is not null);
