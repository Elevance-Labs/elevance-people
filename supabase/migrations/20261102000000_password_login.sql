-- Password sign-in for people without an @elevancelabs.com Google account
-- (e.g. a part-time finance person). Each employee row now says how its
-- person signs in: 'google' (as before, company domain only) or 'password'
-- (an outside address, email + password through Supabase Auth). The method
-- has to match the session's provider, so a Google account can never claim a
-- password row, nor a password account a Google one. Only a company admin
-- may set or change the method, as with roles and company emails.

create type public.login_method as enum ('google', 'password');

alter table public.employees
  add column login_method public.login_method not null default 'google';

-- Company addresses always sign in with Google; anything else only by password.
alter table public.employees drop constraint employees_company_email_check;
alter table public.employees add constraint employees_company_email_check
  check (company_email = lower(company_email)
         and case login_method
               when 'google' then company_email like '%@elevancelabs.com'
               else company_email like '_%@_%._%' and company_email not like '%@elevancelabs.com'
             end);

grant insert (login_method), update (login_method) on public.employees to authenticated;

create or replace function public.bind_employee()
returns setof public.employees
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text := lower(auth.jwt() ->> 'email');
  v_provider text := coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '');
  v_method   public.login_method;
begin
  if v_uid is null or v_email is null then
    return;
  end if;
  -- The session's provider must match the row's method, so a Google account
  -- never claims a password row nor a password account a Google one.
  if v_provider = 'google' and v_email like '%@elevancelabs.com' then
    v_method := 'google';
  elsif v_provider = 'email'
        and exists (select 1 from auth.users u
                     where u.id = v_uid and u.email_confirmed_at is not null) then
    v_method := 'password';
  else
    return;
  end if;

  update public.employees e
     set user_id = v_uid
   where e.company_email = v_email
     and e.login_method = v_method
     and e.user_id is null
     and public.is_login_status(e.status);

  return query
    select * from public.employees e
     where e.user_id = v_uid
       and e.company_email = v_email
       and e.login_method = v_method
       and public.is_login_status(e.status);
end;
$$;

-- An outside address may now get an auth user too, if a login-eligible row
-- has it.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(event -> 'user' ->> 'email');
begin
  -- An outside address passes only with a row, and its email check makes
  -- that a password one; bind_employee still checks the method.
  if v_email is null or not exists (select 1 from public.employees
                                     where company_email = v_email and public.is_login_status(status)) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'No active employee record found for this account.'));
  end if;
  return '{}'::jsonb;
end;
$$;

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
