-- ---------------------------------------------------------------------------
-- Employee numbers become editable by HR (HR admins and company admins, via
-- the existing employees RLS), so records backfilled from before the app can
-- carry their real numbers. They stay unique (the existing unique
-- constraint) and positive. The identity sequence goes: a new record without
-- a number now gets the highest number in use plus one (employees_guard), so
-- numbering continues from the backfilled ones instead of the old sequence.
-- ---------------------------------------------------------------------------

alter table public.employees alter column employee_number drop identity;
alter table public.employees
  add constraint employees_employee_number_check check (employee_number > 0);

create or replace function public.employees_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- auth.uid() is null for the SQL editor / service role: no restrictions.
  if auth.uid() is not null and not public.is_company_admin() then
    if tg_op = 'INSERT' and new.app_role <> 'member' then
      raise exception 'Only a company admin can assign admin roles.' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' and new.login_method <> 'google' then
      raise exception 'Only a company admin can set up a password login.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      if new.app_role is distinct from old.app_role then
        raise exception 'Only a company admin can change roles.' using errcode = '42501';
      end if;
      -- Login is bound by company email, so changing it would hand this
      -- person's login to whoever holds the new address.
      if new.company_email is distinct from old.company_email then
        raise exception 'Only a company admin can change a company email.' using errcode = '42501';
      end if;
      if new.login_method is distinct from old.login_method then
        raise exception 'Only a company admin can change how someone signs in.' using errcode = '42501';
      end if;
    end if;
  end if;

  -- No number given: the next after the highest in use. The lock keeps two
  -- inserts at once from picking the same one (the unique constraint would
  -- refuse the second anyway).
  if tg_op = 'INSERT' and new.employee_number is null then
    perform pg_advisory_xact_lock(hashtext('public.employees.employee_number'));
    select coalesce(max(e.employee_number), 0) + 1 into new.employee_number from public.employees e;
  end if;

  if tg_op = 'UPDATE' then
    if new.company_email is distinct from old.company_email
       or new.login_method is distinct from old.login_method then
      new.user_id := null; -- rebinds on next login with the new email / method
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

grant insert (employee_number), update (employee_number) on public.employees to authenticated;
