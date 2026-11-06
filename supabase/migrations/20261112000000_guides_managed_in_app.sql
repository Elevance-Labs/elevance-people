-- ---------------------------------------------------------------------------
-- Guides are managed from the app (Configuration → Guides), not only from the
-- Supabase dashboard: company admins add, edit and delete them. Everyone keeps
-- reading only their own business function's. The slug is set once, on
-- insert, so a guide's address doesn't move when it is renamed.
-- ---------------------------------------------------------------------------

grant insert (slug, title, description, business_function, doc_url, sort_order) on public.guides to authenticated;
grant update (title, description, business_function, doc_url, sort_order) on public.guides to authenticated;
grant delete on public.guides to authenticated;

create policy guides_insert on public.guides for insert to authenticated
  with check ((select public.is_company_admin()));
create policy guides_update on public.guides for update to authenticated
  using ((select public.is_company_admin())) with check ((select public.is_company_admin()));
create policy guides_delete on public.guides for delete to authenticated
  using ((select public.is_company_admin()));
