-- Employee documents are never deleted one by one: "delete" in the app only
-- hides a document (deleted_at), and HR can still list and open hidden ones.
-- Until now a company admin could also delete a document row, or its file,
-- directly. Now no client may delete a row (it goes only with its employee,
-- by cascade), and a file may be removed only once no row points at it,
-- i.e. after its employee has been deleted.

drop policy employee_documents_delete on public.employee_documents;
revoke delete on public.employee_documents from authenticated;

drop policy employee_docs_delete on storage.objects;
create policy employee_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'employee-docs'
         and (select public.is_company_admin())
         and not exists (select 1 from public.employee_documents d where d.storage_path = objects.name));
