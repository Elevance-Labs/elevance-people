-- Employees get an optional probation end date, set by HR on the record. It
-- can't fall before the date of joining. Writable like the other employment
-- dates; nothing acts on it yet (status stays HR's to change).

alter table public.employees
  add column probation_end_date date,
  add constraint employees_probation_end_check
    check (probation_end_date is null or probation_end_date >= date_of_joining);

grant insert (probation_end_date), update (probation_end_date) on public.employees to authenticated;
