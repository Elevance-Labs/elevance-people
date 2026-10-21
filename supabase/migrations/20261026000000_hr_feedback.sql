-- ---------------------------------------------------------------------------
-- Performance, part two: feedback from HR to an employee.
--
-- HR writes a plain-text message to one employee, optionally labelled
-- appreciation, improvement or general. The employee reads it and
-- acknowledges it (hr_feedback_acknowledge). Nobody else sees it — not their
-- manager — apart from HR. Once sent it can't be edited; HR can delete it.
-- HR can't write feedback to themselves. The author is stamped by trigger.
-- ---------------------------------------------------------------------------

create type public.feedback_kind as enum ('appreciation', 'improvement', 'general');

create table public.hr_feedback (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null,
  kind            public.feedback_kind not null default 'general',
  body            text not null check (body = trim(body) and body <> '' and length(body) <= 5000),
  -- Stamped by hr_feedback_stamp.
  author_id       uuid references public.employees (id) on delete set null,
  created_at      timestamptz not null default now(),
  acknowledged_at timestamptz,
  -- Named: hr_feedback references employees twice.
  constraint hr_feedback_employee_id_fkey foreign key (employee_id)
    references public.employees (id) on delete cascade
);
create index hr_feedback_employee_idx on public.hr_feedback (employee_id, created_at);

create function public.hr_feedback_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.author_id := public.current_employee_id();
  return new;
end;
$$;

create trigger hr_feedback_stamp
  before insert on public.hr_feedback
  for each row execute function public.hr_feedback_stamp();

-- The employee confirms they have read feedback sent to them.
create function public.hr_feedback_acknowledge(p_feedback_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_feedback public.hr_feedback;
begin
  select * into v_feedback from public.hr_feedback where id = p_feedback_id for update;
  if not found or v_feedback.employee_id is distinct from public.current_employee_id() then
    raise exception 'Feedback not found.' using errcode = 'P0002';
  end if;
  if v_feedback.acknowledged_at is null then
    update public.hr_feedback set acknowledged_at = now() where id = p_feedback_id;
  end if;
end;
$$;

revoke all on public.hr_feedback from anon, authenticated;
-- Sent feedback isn't editable: no update grant. author_id and
-- acknowledged_at are set by the database.
grant select, delete on public.hr_feedback to authenticated;
grant insert (employee_id, kind, body) on public.hr_feedback to authenticated;

revoke execute on function public.hr_feedback_stamp(), public.hr_feedback_acknowledge(uuid)
  from public, anon, authenticated;
grant execute on function public.hr_feedback_acknowledge(uuid) to authenticated;

alter table public.hr_feedback enable row level security;

-- HR reads and deletes all; the employee reads their own. HR writes to
-- anyone but themselves.
create policy hr_feedback_select on public.hr_feedback for select to authenticated
  using ((select public.is_hr()) or employee_id = (select public.current_employee_id()));
create policy hr_feedback_insert on public.hr_feedback for insert to authenticated
  with check ((select public.is_hr()) and employee_id is distinct from (select public.current_employee_id()));
create policy hr_feedback_delete on public.hr_feedback for delete to authenticated
  using ((select public.is_hr()));
