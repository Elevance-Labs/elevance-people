-- Operations → Equipment, and Configuration → Vendors.
--
-- HR admins, finance admins and company admins (can_manage_operations) see
-- and manage both; nobody else reads them. They add, change and delete
-- equipment and vendors, except that only a company admin deletes a vendor,
-- and not while equipment is linked to it.
--
-- Equipment has a name, a unique identifier typed in by hand, a status, a
-- purchase date, a vendor, and an invoice and a photo in the private
-- equipment bucket. It may be assigned to one employee at a time; who has it
-- changes only through equipment_assign / equipment_unassign, which keep its
-- assignment history. Retired or sold equipment can't be assigned.
--
-- Everyone sees what is assigned to them, through my_equipment: only the
-- name, identifier and assignment date.

create type public.equipment_status as enum ('requested', 'active', 'faulty', 'retired', 'sold');

create function public.can_manage_operations()
returns boolean language sql stable set search_path = '' as $$
  select public.is_hr() or public.is_finance();
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.vendors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (name = trim(name) and name <> ''),
  description text,
  bank_name   text,
  -- Without spaces, upper case.
  iban        text check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index vendors_name_key on public.vendors (lower(name));

create table public.equipment (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (name = trim(name) and name <> ''),
  -- A serial or asset tag, typed in by hand.
  identifier    text not null check (identifier = trim(identifier) and identifier <> ''),
  status        public.equipment_status not null default 'active',
  purchase_date date,
  vendor_id     uuid,
  -- Files in the equipment bucket.
  invoice_path  text,
  photo_path    text,
  -- Set only by equipment_assign / equipment_unassign. Deleting the employee
  -- unassigns it.
  assigned_to   uuid references public.employees (id) on delete set null,
  assigned_on   date,
  created_by    uuid references public.employees (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Named explicitly: the app embeds the vendor through this FK.
  constraint equipment_vendor_id_fkey foreign key (vendor_id)
    references public.vendors (id) on delete restrict
);
create unique index equipment_identifier_key on public.equipment (lower(identifier));
create index equipment_vendor_idx on public.equipment (vendor_id);
create index equipment_assigned_to_idx on public.equipment (assigned_to);

-- Who has had each piece of equipment. The open row (no unassigned_on) is
-- the current holder. Goes with the equipment, and with the employee.
create table public.equipment_assignments (
  id            uuid primary key default gen_random_uuid(),
  equipment_id  uuid not null references public.equipment (id) on delete cascade,
  employee_id   uuid not null references public.employees (id) on delete cascade,
  assigned_on   date not null,
  assigned_by   uuid references public.employees (id) on delete set null,
  unassigned_on date,
  unassigned_by uuid references public.employees (id) on delete set null,
  created_at    timestamptz not null default now(),
  check (unassigned_on >= assigned_on)
);
create unique index equipment_assignments_open
  on public.equipment_assignments (equipment_id) where unassigned_on is null;
create index equipment_assignments_employee_idx on public.equipment_assignments (employee_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger vendors_touch before update on public.vendors
  for each row execute function public.touch_updated_at();

-- Stamps the creator; keeps assigned_on with assigned_to (also when the
-- employee is deleted); refuses retired or sold equipment with a holder.
create function public.equipment_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := public.current_employee_id();
  else
    new.updated_at := now();
  end if;
  if new.assigned_to is null then
    new.assigned_on := null;
  end if;
  if new.status in ('retired', 'sold') and new.assigned_to is not null then
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      raise exception 'Unassign it before marking it %.', new.status using errcode = '23514';
    end if;
    raise exception 'Retired or sold equipment can''t be assigned.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger equipment_guard
  before insert or update on public.equipment
  for each row execute function public.equipment_guard();

-- ---------------------------------------------------------------------------
-- Equipment actions (RPCs). The only way equipment changes hands.
-- ---------------------------------------------------------------------------

-- Assign to an employee from a date (today or earlier), ending the current
-- holder's assignment that day. The date can't go back past the equipment's
-- history.
create function public.equipment_assign(p_equipment_id uuid, p_employee_id uuid, p_assigned_on date)
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
  update public.equipment set assigned_to = p_employee_id, assigned_on = p_assigned_on
   where id = p_equipment_id;
end;
$$;

-- End the current assignment on a date (today or earlier, not before it began).
create function public.equipment_unassign(p_equipment_id uuid, p_unassigned_on date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_item public.equipment;
begin
  if not public.can_manage_operations() then
    raise exception 'Only HR and finance can unassign equipment.' using errcode = '42501';
  end if;
  select * into v_item from public.equipment where id = p_equipment_id for update;
  if not found then
    raise exception 'Equipment not found.' using errcode = 'P0002';
  end if;
  if v_item.assigned_to is null then
    raise exception 'It isn''t assigned to anyone.' using errcode = '23514';
  end if;
  if p_unassigned_on is null or p_unassigned_on > current_date or p_unassigned_on < v_item.assigned_on then
    raise exception 'Pick a date from % to today.', to_char(v_item.assigned_on, 'FMDD Mon YYYY')
      using errcode = '23514';
  end if;

  update public.equipment_assignments set unassigned_on = p_unassigned_on, unassigned_by = public.current_employee_id()
   where equipment_id = p_equipment_id and unassigned_on is null;
  update public.equipment set assigned_to = null where id = p_equipment_id;
end;
$$;

-- The caller's own equipment, as their profile shows it.
create function public.my_equipment()
returns table (name text, identifier text, assigned_on date)
language sql stable security definer set search_path = '' as $$
  select e.name, e.identifier, e.assigned_on
    from public.equipment e
   where e.assigned_to = public.current_employee_id()
   order by e.assigned_on desc, e.name;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row level security
-- ---------------------------------------------------------------------------
revoke all on public.vendors, public.equipment, public.equipment_assignments from anon, authenticated;

grant select, delete on public.vendors to authenticated;
grant insert (name, description, bank_name, iban), update (name, description, bank_name, iban)
  on public.vendors to authenticated;
-- Who has it changes only through the functions above; created_by is stamped.
grant select, delete on public.equipment to authenticated;
grant insert (name, identifier, status, purchase_date, vendor_id, invoice_path, photo_path),
      update (name, identifier, status, purchase_date, vendor_id, invoice_path, photo_path)
  on public.equipment to authenticated;
grant select on public.equipment_assignments to authenticated;

revoke execute on function
  public.can_manage_operations(), public.equipment_guard(),
  public.equipment_assign(uuid, uuid, date), public.equipment_unassign(uuid, date), public.my_equipment()
  from public, anon, authenticated;
grant execute on function
  public.can_manage_operations(),
  public.equipment_assign(uuid, uuid, date), public.equipment_unassign(uuid, date), public.my_equipment()
  to authenticated;

alter table public.vendors enable row level security;
alter table public.equipment enable row level security;
alter table public.equipment_assignments enable row level security;

-- HR, finance and company admins; only a company admin deletes a vendor.
create policy vendors_select on public.vendors
  for select to authenticated using ((select public.can_manage_operations()));
create policy vendors_insert on public.vendors
  for insert to authenticated with check ((select public.can_manage_operations()));
create policy vendors_update on public.vendors
  for update to authenticated
  using ((select public.can_manage_operations())) with check ((select public.can_manage_operations()));
create policy vendors_delete on public.vendors
  for delete to authenticated using ((select public.is_company_admin()));

create policy equipment_select on public.equipment
  for select to authenticated using ((select public.can_manage_operations()));
create policy equipment_insert on public.equipment
  for insert to authenticated with check ((select public.can_manage_operations()));
create policy equipment_update on public.equipment
  for update to authenticated
  using ((select public.can_manage_operations())) with check ((select public.can_manage_operations()));
create policy equipment_delete on public.equipment
  for delete to authenticated using ((select public.can_manage_operations()));

create policy equipment_assignments_select on public.equipment_assignments
  for select to authenticated using ((select public.can_manage_operations()));

-- ---------------------------------------------------------------------------
-- Storage: invoices and photos (private, <uuid>.<ext>), for whoever manages
-- equipment.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('equipment', 'equipment', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy equipment_files_read on storage.objects for select to authenticated
  using (bucket_id = 'equipment' and (select public.can_manage_operations()));
create policy equipment_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'equipment' and (select public.can_manage_operations()));
create policy equipment_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'equipment' and (select public.can_manage_operations()));
