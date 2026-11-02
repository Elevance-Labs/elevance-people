-- Extended probation is still employment: it may log in, like probation. Every
-- rule built on is_login_status follows (binding, payroll, reviews, peer and
-- manager feedback, claims, and going back from notice period cancelling an
-- offboarding).

create or replace function public.is_login_status(s public.employee_status)
returns boolean language sql immutable set search_path = '' as $$
  select s in ('probation', 'extended_probation', 'active', 'notice_period');
$$;
