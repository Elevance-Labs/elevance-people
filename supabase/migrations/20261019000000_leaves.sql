-- Leaves module.
--
-- HR (HR admins and company admins) set up leave types, each with a default
-- yearly quota, and can give one employee a different quota for a year.
-- Employees apply for leave; HR can also record a leave for someone, which
-- carries HR's approval. A leave is granted only once both HR and the
-- employee's manager in the org chart have approved it (HR alone when the
-- employee has no manager), and it keeps who approved it. Either can reject.
-- Only HR can change a leave's dates. Approve, reject and cancel go through
-- functions; clients cannot write the status or approval columns.
--
-- There is no leave policy beyond the quotas: days are Monday–Friday (public
-- holidays still count), a leave can't span two calendar years, and unused
-- quota doesn't carry over.

-- ---------------------------------------------------------------------------
-- Types and tables
-- ---------------------------------------------------------------------------
create type public.leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table public.leave_types (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (name = trim(name) and name <> ''),
  description  text,
  -- Default days per calendar year, in half days. Null = no limit (e.g. unpaid).
  annual_quota numeric(4, 1) check (annual_quota >= 0 and annual_quota % 0.5 = 0),
  -- Inactive types can't be applied for; their leaves are kept.
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index leave_types_name_key on public.leave_types (lower(name));

-- One employee's quota for a type and year, replacing the type's default.
create table public.leave_quotas (
  employee_id   uuid not null references public.employees (id) on delete cascade,
  leave_type_id uuid not null references public.leave_types (id) on delete cascade,
  year          integer not null check (year between 2000 and 2999),
  days          numeric(4, 1) not null check (days >= 0 and days % 0.5 = 0),
  updated_at    timestamptz not null default now(),
  primary key (employee_id, leave_type_id, year)
);
create index leave_quotas_type_idx on public.leave_quotas (leave_type_id);

-- Working days a leave takes: Monday–Friday between the dates, halved for a
-- half day. Mirrored in src/lib/leaves.ts for the form preview.
create function public.leave_days(p_start date, p_end date, p_half_day boolean)
returns numeric language sql immutable set search_path = '' as $$
  select count(*) * case when p_half_day then 0.5 else 1 end
    from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') as d
   where extract(isodow from d) < 6;
$$;

-- A type in use can't be deleted (deactivate it instead).
create table public.leaves (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.employees (id) on delete cascade,
  leave_type_id       uuid not null references public.leave_types (id) on delete restrict,
  start_date          date not null,
  end_date            date not null,
  half_day            boolean not null default false,
  days                numeric(4, 1) not null
                      generated always as (public.leave_days(start_date, end_date, half_day)) stored,
  reason              text,
  status              public.leave_status not null default 'pending',
  -- The employee themself, or the HR person who recorded it.
  created_by          uuid references public.employees (id) on delete set null,
  hr_approved_by      uuid references public.employees (id) on delete set null,
  hr_approved_at      timestamptz,
  manager_approved_by uuid references public.employees (id) on delete set null,
  manager_approved_at timestamptz,
  rejected_by         uuid references public.employees (id) on delete set null,
  rejected_at         timestamptz,
  rejection_reason    text,
  cancelled_by        uuid references public.employees (id) on delete set null,
  cancelled_at        timestamptz,
  -- Last HR change to the dates.
  edited_by           uuid references public.employees (id) on delete set null,
  edited_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint leaves_dates_check check (end_date >= start_date),
  -- A leave counts against the year it falls in, so it can't span two.
  constraint leaves_one_year_check
    check (extract(year from start_date) = extract(year from end_date)),
  constraint leaves_half_day_check check (not half_day or start_date = end_date)
);
create index leaves_employee_idx on public.leaves (employee_id, start_date);
create index leaves_type_idx on public.leaves (leave_type_id);

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- True when the caller is the employee's manager in the org chart.
create function public.is_manager_of(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_chart_nodes
                  where employee_id = p_employee_id
                    and manager_id = public.current_employee_id());
$$;

-- Stamps who did what, validates dates against overlaps and the quota, and
-- grants a pending leave once it has every approval it needs.
create function public.leaves_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_me      uuid := public.current_employee_id();
  v_manager uuid;
  v_year    integer := extract(year from new.start_date);
  v_days    numeric;
  v_name    text;
  v_quota   numeric;
  v_used    numeric;
begin
  select manager_id into v_manager
    from public.org_chart_nodes where employee_id = new.employee_id;

  if tg_op = 'INSERT' then
    new.created_by := v_me;
    -- HR recording a leave for someone else approves it as they record it.
    if new.employee_id <> v_me and public.is_hr() then
      new.hr_approved_by := v_me;
      new.hr_approved_at := now();
      if v_manager = v_me then
        new.manager_approved_by := v_me;
        new.manager_approved_at := now();
      end if;
    end if;
  else
    new.updated_at := now();
  end if;

  if tg_op = 'INSERT' or (new.start_date, new.end_date, new.half_day)
                         is distinct from (old.start_date, old.end_date, old.half_day) then
    if tg_op = 'UPDATE' then
      if new.employee_id = v_me then
        raise exception 'You cannot change the dates of your own leave.' using errcode = '42501';
      end if;
      if old.status not in ('pending', 'approved') then
        raise exception 'Only a pending or approved leave can be changed.';
      end if;
      new.edited_by := v_me;
      new.edited_at := now();
    elsif not (select t.is_active from public.leave_types t where t.id = new.leave_type_id) then
      raise exception 'This leave type is no longer in use.';
    end if;

    v_days := public.leave_days(new.start_date, new.end_date, new.half_day);
    if v_days = 0 then
      raise exception 'A leave must include at least one working day (Monday to Friday).';
    end if;

    if exists (select 1 from public.leaves l
                where l.employee_id = new.employee_id and l.id <> new.id
                  and l.status in ('pending', 'approved')
                  and l.start_date <= new.end_date and l.end_date >= new.start_date) then
      raise exception 'These dates overlap another pending or approved leave.';
    end if;

    select t.name, coalesce(q.days, t.annual_quota) into v_name, v_quota
      from public.leave_types t
      left join public.leave_quotas q
        on q.leave_type_id = t.id and q.employee_id = new.employee_id and q.year = v_year
     where t.id = new.leave_type_id;
    if v_quota is not null then
      select coalesce(sum(l.days), 0) into v_used
        from public.leaves l
       where l.employee_id = new.employee_id and l.leave_type_id = new.leave_type_id
         and l.id <> new.id and l.status in ('pending', 'approved')
         and extract(year from l.start_date) = v_year;
      if v_used + v_days > v_quota then
        raise exception 'Not enough % left for %: % of % day(s) remaining, this leave needs %.',
          v_name, v_year, trim_scale(greatest(v_quota - v_used, 0)), trim_scale(v_quota),
          trim_scale(v_days);
      end if;
    end if;
  end if;

  -- Granted once HR has approved, and the manager too if the employee has one.
  if new.status = 'pending' and new.hr_approved_by is not null
     and (new.manager_approved_by is not null or v_manager is null) then
    new.status := 'approved';
  end if;
  return new;
end;
$$;

create trigger leaves_guard
  before insert or update on public.leaves
  for each row execute function public.leaves_guard();

create trigger leave_types_touch before update on public.leave_types
  for each row execute function public.touch_updated_at();
create trigger leave_quotas_touch before update on public.leave_quotas
  for each row execute function public.touch_updated_at();

-- Approve or reject a pending leave, as HR and/or the employee's manager
-- (both at once when one person is both). Nobody decides their own leave.
-- leaves_guard turns the leave approved once every approval is in.
create function public.leave_decide(p_leave_id uuid, p_approve boolean, p_reason text default null)
returns public.leaves language plpgsql security definer set search_path = '' as $$
declare
  v_me         uuid := public.current_employee_id();
  v_as_hr      boolean := public.is_hr();
  v_as_manager boolean;
  v_leave      public.leaves;
begin
  select * into v_leave from public.leaves where id = p_leave_id for update;
  if not found or v_me is null then
    raise exception 'Leave not found.' using errcode = 'P0002';
  end if;
  v_as_manager := public.is_manager_of(v_leave.employee_id);
  if not (v_as_hr or v_as_manager or v_leave.employee_id = v_me) then
    raise exception 'Leave not found.' using errcode = 'P0002';
  end if;
  if v_leave.employee_id = v_me then
    raise exception 'You cannot approve or reject your own leave.' using errcode = '42501';
  end if;
  if v_leave.status <> 'pending' then
    raise exception 'This leave is already %.', v_leave.status;
  end if;

  if p_approve then
    update public.leaves
       set hr_approved_by      = case when v_as_hr and hr_approved_by is null
                                      then v_me else hr_approved_by end,
           hr_approved_at      = case when v_as_hr and hr_approved_by is null
                                      then now() else hr_approved_at end,
           manager_approved_by = case when v_as_manager and manager_approved_by is null
                                      then v_me else manager_approved_by end,
           manager_approved_at = case when v_as_manager and manager_approved_by is null
                                      then now() else manager_approved_at end
     where id = p_leave_id
    returning * into v_leave;
  else
    update public.leaves
       set status = 'rejected', rejected_by = v_me, rejected_at = now(),
           rejection_reason = nullif(trim(p_reason), '')
     where id = p_leave_id
    returning * into v_leave;
  end if;
  return v_leave;
end;
$$;

-- Cancel a pending or approved leave. HR can cancel any; an employee their
-- own, until an approved leave has started.
create function public.leave_cancel(p_leave_id uuid)
returns public.leaves language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := public.current_employee_id();
  v_as_hr boolean := public.is_hr();
  v_leave public.leaves;
begin
  select * into v_leave from public.leaves where id = p_leave_id for update;
  if not found or v_me is null
     or not (v_as_hr or v_leave.employee_id = v_me or public.is_manager_of(v_leave.employee_id)) then
    raise exception 'Leave not found.' using errcode = 'P0002';
  end if;
  if not v_as_hr then
    if v_leave.employee_id <> v_me then
      raise exception 'Only HR or the employee can cancel a leave.' using errcode = '42501';
    end if;
    if v_leave.status = 'approved' and v_leave.start_date <= current_date then
      raise exception 'This leave has already started. Ask HR to change or cancel it.'
        using errcode = '42501';
    end if;
  end if;
  if v_leave.status not in ('pending', 'approved') then
    raise exception 'This leave is already %.', v_leave.status;
  end if;

  update public.leaves
     set status = 'cancelled', cancelled_by = v_me, cancelled_at = now()
   where id = p_leave_id
  returning * into v_leave;
  return v_leave;
end;
$$;

-- One employee's year, per leave type: quota (null = no limit) and days
-- approved and pending. Active types, plus inactive ones with leave that
-- year. Empty unless the caller is the employee, their manager or HR.
create function public.leave_balances(p_employee_id uuid, p_year integer)
returns table (leave_type_id uuid, name text, quota numeric, approved numeric, pending numeric)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, coalesce(q.days, t.annual_quota),
         coalesce(sum(l.days) filter (where l.status = 'approved'), 0),
         coalesce(sum(l.days) filter (where l.status = 'pending'), 0)
    from public.leave_types t
    left join public.leave_quotas q
      on q.leave_type_id = t.id and q.employee_id = p_employee_id and q.year = p_year
    left join public.leaves l
      on l.leave_type_id = t.id and l.employee_id = p_employee_id
     and l.status in ('pending', 'approved') and extract(year from l.start_date) = p_year
   where (t.is_active or l.id is not null)
     and (p_employee_id = public.current_employee_id() or public.is_hr()
          or public.is_manager_of(p_employee_id))
   group by t.id, t.name, q.days, t.annual_quota
   order by t.name;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on public.leave_types, public.leave_quotas, public.leaves from anon, authenticated;

grant select, delete on public.leave_types, public.leave_quotas to authenticated;
grant insert (name, description, annual_quota, is_active),
      update (name, description, annual_quota, is_active)
  on public.leave_types to authenticated;
grant insert (employee_id, leave_type_id, year, days), update (days)
  on public.leave_quotas to authenticated;
-- Status, approvals and stamps change only through the functions above.
grant select on public.leaves to authenticated;
grant insert (employee_id, leave_type_id, start_date, end_date, half_day, reason),
      update (start_date, end_date, half_day)
  on public.leaves to authenticated;

revoke execute on function
  public.leave_days(date, date, boolean), public.is_manager_of(uuid), public.leaves_guard(),
  public.leave_decide(uuid, boolean, text), public.leave_cancel(uuid),
  public.leave_balances(uuid, integer)
  from public, anon, authenticated;

grant execute on function
  public.leave_days(date, date, boolean), public.is_manager_of(uuid),
  public.leave_decide(uuid, boolean, text), public.leave_cancel(uuid),
  public.leave_balances(uuid, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.leave_types enable row level security;
alter table public.leave_quotas enable row level security;
alter table public.leaves enable row level security;

-- Leave types: every employee reads, HR writes.
create policy leave_types_select on public.leave_types for select to authenticated
  using ((select public.current_employee_id()) is not null);
create policy leave_types_insert on public.leave_types for insert to authenticated
  with check ((select public.is_hr()));
create policy leave_types_update on public.leave_types for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy leave_types_delete on public.leave_types for delete to authenticated
  using ((select public.is_hr()));

-- Quotas: HR reads and writes all; employees read their own.
create policy leave_quotas_select on public.leave_quotas for select to authenticated
  using ((select public.is_hr()) or employee_id = (select public.current_employee_id()));
create policy leave_quotas_insert on public.leave_quotas for insert to authenticated
  with check ((select public.is_hr()));
create policy leave_quotas_update on public.leave_quotas for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy leave_quotas_delete on public.leave_quotas for delete to authenticated
  using ((select public.is_hr()));

-- Leaves: HR sees all, managers their reports', employees their own.
-- Employees apply for themselves, HR for anyone. Only HR edits (dates).
create policy leaves_select on public.leaves for select to authenticated
  using ((select public.is_hr()) or employee_id = (select public.current_employee_id())
         or public.is_manager_of(employee_id));
create policy leaves_insert on public.leaves for insert to authenticated
  with check ((select public.is_hr()) or employee_id = (select public.current_employee_id()));
create policy leaves_update on public.leaves for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
