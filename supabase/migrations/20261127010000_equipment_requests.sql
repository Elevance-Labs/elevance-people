-- Equipment requests: employees ask for equipment from their profile.
--
-- An employee's request is an equipment row in status requested, made only by
-- equipment_request (a one-line description; the request date and requester
-- stamped). HR, finance and company admins fill in the rest; declining a
-- request deletes the row. So that a request can exist before the item does:
--
-- * name becomes description: one line, up to 150 characters.
-- * identifier is optional, but equipment_assign needs it, and a purchase
--   date, before the item goes to anyone (and the guard keeps both on
--   whatever someone has). Assigning a request makes it active.
-- * request_date (optional) and requested_by (not client-writable) are new.
--
-- name stays, kept equal to description by equipment_guard, so the previous
-- build (which reads and writes name, and reads name from my_equipment) keeps
-- working; a later change drops it.

alter table public.equipment add column description text;
update public.equipment set description = trim(left(name, 150));
alter table public.equipment
  alter column description set not null,
  add constraint equipment_description_check
    check (description = trim(description) and description <> '' and length(description) <= 150
           and description !~ '[\r\n]'),
  alter column identifier drop not null,
  add column request_date date,
  add column requested_by uuid references public.employees (id) on delete set null;

grant insert (description, request_date), update (description, request_date)
  on public.equipment to authenticated;

-- Stamps the creator; keeps name equal to description (whichever the caller
-- changed); keeps assigned_on with assigned_to (also when the employee is
-- deleted); refuses retired or sold equipment with a holder, and a holder on
-- equipment with no identifier or purchase date, or still a request.
create or replace function public.equipment_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := public.current_employee_id();
    new.description := coalesce(new.description, new.name);
  else
    new.updated_at := now();
    if new.description is not distinct from old.description and new.name is distinct from old.name then
      new.description := new.name;
    end if;
  end if;
  new.name := new.description;
  if new.assigned_to is null then
    new.assigned_on := null;
  end if;
  if new.status in ('retired', 'sold') and new.assigned_to is not null then
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      raise exception 'Unassign it before marking it %.', new.status using errcode = '23514';
    end if;
    raise exception 'Retired or sold equipment can''t be assigned.' using errcode = '23514';
  end if;
  if new.assigned_to is not null then
    if new.identifier is null or new.purchase_date is null then
      raise exception 'Equipment someone has needs an identifier and a purchase date.' using errcode = '23514';
    end if;
    if new.status = 'requested' then
      raise exception 'Equipment someone has can''t be a request.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- Assign to an employee from a date (today or earlier), ending the current
-- holder's assignment that day. The date can't go back past the equipment's
-- history. Needs an identifier and a purchase date; a request becomes active.
create or replace function public.equipment_assign(p_equipment_id uuid, p_employee_id uuid, p_assigned_on date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := public.current_employee_id();
  v_item   public.equipment;
  v_status public.employee_status;
  v_since  date;
begin
  if not public.can_manage_operations() then
    raise exception 'Only HR and finance can assign equipment.' using errcode = '42501';
  end if;
  select * into v_item from public.equipment where id = p_equipment_id for update;
  if not found then
    raise exception 'Equipment not found.' using errcode = 'P0002';
  end if;
  if v_item.identifier is null or v_item.purchase_date is null then
    raise exception 'Add its identifier and purchase date before assigning it.' using errcode = '23514';
  end if;
  if p_assigned_on is null or p_assigned_on > current_date then
    raise exception 'Pick an assignment date, today or earlier.' using errcode = '23514';
  end if;
  select status into v_status from public.employees where id = p_employee_id;
  if not found or v_status in ('left', 'terminated') then
    raise exception 'Equipment can only be assigned to a current employee.' using errcode = '23514';
  end if;
  if v_item.assigned_to = p_employee_id then
    raise exception 'It is already assigned to them.' using errcode = '23514';
  end if;
  select max(coalesce(unassigned_on, assigned_on)) into v_since
    from public.equipment_assignments where equipment_id = p_equipment_id;
  if p_assigned_on < v_since then
    raise exception 'Its assignment history runs to %. Pick that day or later.', to_char(v_since, 'FMDD Mon YYYY')
      using errcode = '23514';
  end if;

  update public.equipment_assignments set unassigned_on = p_assigned_on, unassigned_by = v_me
   where equipment_id = p_equipment_id and unassigned_on is null;
  insert into public.equipment_assignments (equipment_id, employee_id, assigned_on, assigned_by)
  values (p_equipment_id, p_employee_id, p_assigned_on, v_me);
  update public.equipment
     set assigned_to = p_employee_id, assigned_on = p_assigned_on,
         status = case when status = 'requested' then 'active'::public.equipment_status else status end
   where id = p_equipment_id;
end;
$$;

-- The caller's own equipment, as their profile shows it: no vendor, files or
-- history. name is the previous build's copy of description.
drop function public.my_equipment();
create function public.my_equipment()
returns table (description text, identifier text, assigned_on date, name text)
language sql stable security definer set search_path = '' as $$
  select e.description, e.identifier, e.assigned_on, e.description
    from public.equipment e
   where e.assigned_to = public.current_employee_id()
   order by e.assigned_on desc, e.description;
$$;

-- The caller asks for equipment: a one-line description, up to 150
-- characters. Requested today, by them. Returns its id.
create function public.equipment_request(p_description text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me          uuid := public.current_employee_id();
  v_description text := trim(p_description);
  v_id          uuid;
begin
  if v_me is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if v_description is null or v_description = '' or length(v_description) > 150 or v_description ~ '[\r\n]' then
    raise exception 'Describe what you need in one line, up to 150 characters.' using errcode = '23514';
  end if;
  insert into public.equipment (description, status, request_date, requested_by)
  values (v_description, 'requested', public.company_today(), v_me)
  returning id into v_id;
  return v_id;
end;
$$;

-- The caller's requests still waiting: never assigned to anyone yet. A
-- declined one is gone; an assigned one is in my_equipment.
create function public.my_equipment_requests()
returns table (id uuid, description text, request_date date)
language sql stable security definer set search_path = '' as $$
  select e.id, e.description, e.request_date
    from public.equipment e
   where e.requested_by = public.current_employee_id()
     and e.assigned_to is null
     and not exists (select 1 from public.equipment_assignments a where a.equipment_id = e.id)
   order by e.request_date desc nulls last, e.created_at desc;
$$;

revoke execute on function
  public.my_equipment(), public.equipment_request(text), public.my_equipment_requests()
  from public, anon, authenticated;
grant execute on function
  public.my_equipment(), public.equipment_request(text), public.my_equipment_requests()
  to authenticated;
