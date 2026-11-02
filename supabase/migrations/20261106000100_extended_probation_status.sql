-- A new employee status, Extended probation, for someone whose probation HR
-- has extended. On its own because a new enum value can't be used in the
-- transaction that adds it; the next migration lets it log in.

alter type public.employee_status add value 'extended_probation' after 'probation';
