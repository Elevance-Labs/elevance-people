-- A Finance Admin role, for payroll (next migration).
--
-- Its own migration because Postgres won't let a new enum value be used in
-- the transaction that adds it. Finance admins are members everywhere else:
-- they are not HR. As with every role but member, only a company admin can
-- assign it (employees_guard).

alter type public.app_role add value 'finance_admin' after 'hr_admin';
