-- ---------------------------------------------------------------------------
-- HR admins manage KPIs and expectations too, not only company admins: they
-- run the performance reviews these feed. Departments and designations stay
-- company-admin only.
-- ---------------------------------------------------------------------------

drop policy kpis_insert on public.kpis;
drop policy kpis_update on public.kpis;
drop policy kpis_delete on public.kpis;
create policy kpis_insert on public.kpis for insert to authenticated
  with check ((select public.is_hr()));
create policy kpis_update on public.kpis for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy kpis_delete on public.kpis for delete to authenticated
  using ((select public.is_hr()));

drop policy expectations_insert on public.expectations;
drop policy expectations_update on public.expectations;
drop policy expectations_delete on public.expectations;
create policy expectations_insert on public.expectations for insert to authenticated
  with check ((select public.is_hr()));
create policy expectations_update on public.expectations for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy expectations_delete on public.expectations for delete to authenticated
  using ((select public.is_hr()));
