-- A Disbursed payroll status, after Processed (next migration uses it).
--
-- Its own migration because Postgres won't let a new enum value be used in
-- the transaction that adds it.

alter type public.payroll_status add value 'disbursed' after 'processed';
