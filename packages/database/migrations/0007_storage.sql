-- 0007 — private Storage buckets and object policies (research R11).
-- Object paths: org-assets/{tenant_id}/logo-{uuid}; pr-attachments/{tenant_id}/{pr_id}/{attachment_id}.
-- Folder segments are compared as text so a malformed path simply matches nothing.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'pr-attachments', 'pr-attachments', false, 10485760,
    array[
      'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv', 'text/plain'
    ]
  ),
  (
    'org-assets', 'org-assets', false, 2097152,
    array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
  )
on conflict (id) do nothing;

-- org-assets: members read their organization's files; settings:manage writes them.
create policy org_assets_select on storage.objects for select to authenticated
  using (
    bucket_id = 'org-assets'
    and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  );
create policy org_assets_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'org-assets'
    and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
    and (select app.has_permission('settings:manage'))
  );
-- Logos are versioned and never overwritten or deleted (they are referenced by print snapshots),
-- so there are no update/delete policies for org-assets.

-- pr-attachments: tenant folder, and the PR in segment 2 must be readable by the caller (the
-- PR's own RLS applies the office scope).
create policy pr_attachments_select on storage.objects for select to authenticated
  using (
    bucket_id = 'pr-attachments'
    and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
    and exists (
      select 1 from public.purchase_requisition p
      where p.id::text = (storage.foldername(name))[2]
    )
  );
create policy pr_attachments_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pr-attachments'
    and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
    and exists (
      select 1 from public.purchase_requisition p
      where p.id::text = (storage.foldername(name))[2]
        and p.status in ('draft', 'returned')
    )
  );
-- Attachments are soft-deleted in pr_attachment; objects are kept for the audit trail.
