-- ---------------------------------------------------------------------------
-- Holidays: the company's public holidays, a name and a date range within
-- one year. HR (HR admins and company admins) keeps them; everyone signed in
-- reads them.
--
-- A leave no longer counts a holiday as a working day. leave_days now reads
-- this table, so it can't be immutable, and leaves.days stops being a
-- generated column: leaves_guard sets it on every write, and adding,
-- changing or removing a holiday recounts the leaves it overlaps.
-- ---------------------------------------------------------------------------

create table public.holidays (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (name = trim(name) and name <> '' and length(name) <= 100),
  start_date date not null,
  end_date   date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint holidays_dates_check check (end_date >= start_date),
  -- A holiday belongs to the year it falls in, so it can't span two.
  constraint holidays_one_year_check
    check (extract(year from start_date) = extract(year from end_date))
);
-- One holiday of a name per year.
create unique index holidays_name_key
  on public.holidays ((extract(year from start_date)), lower(name));
create index holidays_dates_idx on public.holidays (start_date, end_date);

-- Kept as they are: no holidays exist yet, so every count stays the same.
alter table public.leaves alter column days drop expression;

-- Working days a leave takes: Monday–Friday between the dates that aren't a
-- holiday, halved for a half day. Mirrored in src/lib/leaves.ts for the form
-- preview.
create or replace function public.leave_days(p_start date, p_end date, p_half_day boolean)
returns numeric language sql stable set search_path = '' as $$
  select count(*) * case when p_half_day then 0.5 else 1 end
    from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') as d
   where extract(isodow from d) < 6
     and not exists (select 1 from public.holidays h
                      where d::date between h.start_date and h.end_date);
$$;

-- Stamps who did what, counts the working days, validates dates against
-- overlaps and the quota, and grants a pending leave once it has every
-- approval it needs.
create or replace function public.leaves_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_me      uuid := public.current_employee_id();
  v_manager uuid;
  v_year    integer := extract(year from new.start_date);
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

  -- Counted on every write, so it follows the holidays.
  new.days := public.leave_days(new.start_date, new.end_date, new.half_day);

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

    if new.days = 0 then
      raise exception 'A leave must include at least one working day (Monday to Friday, not a holiday).';
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
      if v_used + new.days > v_quota then
        raise exception 'Not enough % left for %: % of % day(s) remaining, this leave needs %.',
          v_name, v_year, trim_scale(greatest(v_quota - v_used, 0)), trim_scale(v_quota),
          trim_scale(new.days);
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

-- A holiday added, moved or removed recounts the leaves over its dates
-- (old and new). The quota isn't checked again: the dates didn't change.
create function public.holidays_recount()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.leaves l
     set days = public.leave_days(l.start_date, l.end_date, l.half_day)
   where ((tg_op <> 'INSERT' and l.start_date <= old.end_date and l.end_date >= old.start_date)
          or (tg_op <> 'DELETE' and l.start_date <= new.end_date and l.end_date >= new.start_date))
     and l.days is distinct from public.leave_days(l.start_date, l.end_date, l.half_day);
  return null;
end;
$$;

create trigger holidays_recount
  after insert or update or delete on public.holidays
  for each row execute function public.holidays_recount();

create trigger holidays_touch before update on public.holidays
  for each row execute function public.touch_updated_at();

revoke all on public.holidays from anon, authenticated;
grant select, delete on public.holidays to authenticated;
grant insert (name, start_date, end_date), update (name, start_date, end_date)
  on public.holidays to authenticated;

revoke execute on function public.holidays_recount() from public, anon, authenticated;

alter table public.holidays enable row level security;

-- Holidays: every employee reads, HR writes.
create policy holidays_select on public.holidays for select to authenticated
  using ((select public.current_employee_id()) is not null);
create policy holidays_insert on public.holidays for insert to authenticated
  with check ((select public.is_hr()));
create policy holidays_update on public.holidays for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy holidays_delete on public.holidays for delete to authenticated
  using ((select public.is_hr()));
