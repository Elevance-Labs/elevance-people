-- Only a company admin may change an employee's company email.
--
-- Login is bound by company email, so changing it moves that person's login
-- to whoever holds the new address. Until now HR could do that for members
-- (only admins' emails were protected); now nobody but a company admin can,
-- for anyone. HR still sets the email when creating a record or hiring.

create or replace function public.employees_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- auth.uid() is null for the SQL editor / service role: no restrictions.
  if auth.uid() is not null and not public.is_company_admin() then
    if tg_op = 'INSERT' and new.app_role <> 'member' then
      raise exception 'Only a company admin can assign admin roles.' using errcode = '42501';
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
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.company_email is distinct from old.company_email then
      new.user_id := null; -- rebinds on next login with the new email
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
