-- Company admins set password logins' passwords from the app, through the
-- set-password Edge Function (the admin API needs the service role, which
-- never reaches the browser). To replace an existing auth user it has to find
-- it by email, which the admin API can't do; this lookup is for the service
-- role only.

create function public.auth_user_ids_by_email(p_email text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u where lower(u.email) = lower(p_email);
$$;

revoke execute on function public.auth_user_ids_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_ids_by_email(text) to service_role;
