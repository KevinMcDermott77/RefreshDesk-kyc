-- Slice 9b: Filing History — save Companies House filing PDFs to client records.
--
-- This migration:
-- - Adds 'filing' to the client_documents.document_type check constraint
-- - Updates register_document to accept the new 'filing' document type
-- - Adds approve_filing_document RPC — auto-approves filing PDFs (source documents,
--   no AI extraction review needed) and writes a filing.saved audit event

alter table public.client_documents
  drop constraint client_documents_document_type_check;

alter table public.client_documents
  add constraint client_documents_document_type_check
  check (document_type in (
    'passport', 'proof_of_address', 'incorporation', 'source_of_funds', 'filing'
  ));

create or replace function public.register_document(
  p_client_id uuid,
  p_document_type text,
  p_storage_path text,
  p_file_name text,
  p_file_size_bytes integer,
  p_mime_type text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_firm_id uuid;
  v_document_id uuid := gen_random_uuid();
begin
  if v_user_id is null then
    raise exception 'register_document requires an authenticated user';
  end if;

  select firm_id into v_firm_id
  from public.clients
  where id = p_client_id;

  if not found then
    raise exception 'client not found';
  end if;

  if not public.is_active_member_of_firm(v_firm_id) then
    raise exception 'user is not an active member of this firm';
  end if;

  if p_document_type not in ('passport', 'proof_of_address', 'incorporation', 'source_of_funds', 'filing') then
    raise exception 'invalid document_type';
  end if;

  if p_file_size_bytes > 10485760 then
    raise exception 'file exceeds 10 MB limit';
  end if;

  insert into public.client_documents (
    id,
    firm_id,
    client_id,
    uploaded_by,
    document_type,
    storage_path,
    file_name,
    file_size_bytes,
    mime_type,
    status
  )
  values (
    v_document_id,
    v_firm_id,
    p_client_id,
    v_user_id,
    p_document_type,
    p_storage_path,
    p_file_name,
    p_file_size_bytes,
    p_mime_type,
    'uploaded'
  );

  insert into public.audit_events (
    firm_id, actor_user_id, event_type, entity_type, entity_id, payload
  )
  values (
    v_firm_id,
    v_user_id,
    'document.uploaded',
    'client_document',
    v_document_id,
    jsonb_build_object(
      'document_id', v_document_id,
      'client_id', p_client_id,
      'document_type', p_document_type,
      'file_name', p_file_name,
      'file_size_bytes', p_file_size_bytes,
      'mime_type', p_mime_type
    )
  );

  return v_document_id;
end;
$$;

-- ─── approve_filing_document ──────────────────────────────────────────────────
-- Filing PDFs downloaded from Companies House are source documents, not
-- AI-extracted data — they don't need to go through the extraction review flow.
-- This RPC validates membership, marks the document approved, and writes the
-- filing.saved audit event.

create or replace function public.approve_filing_document(p_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_document public.client_documents%rowtype;
begin
  if v_user_id is null then
    raise exception 'approve_filing_document requires an authenticated user';
  end if;

  select * into v_document
  from public.client_documents
  where id = p_document_id
  for update;

  if not found then
    raise exception 'document not found';
  end if;

  if v_document.document_type <> 'filing' then
    raise exception 'approve_filing_document can only be used on filing documents';
  end if;

  if not public.is_active_member_of_firm(v_document.firm_id) then
    raise exception 'user is not an active member of this firm';
  end if;

  update public.client_documents
  set status = 'approved'
  where id = p_document_id;

  insert into public.audit_events (
    firm_id, actor_user_id, event_type, entity_type, entity_id, payload
  )
  values (
    v_document.firm_id,
    v_user_id,
    'filing.saved',
    'client_document',
    p_document_id,
    jsonb_build_object(
      'document_id', p_document_id,
      'client_id', v_document.client_id,
      'file_name', v_document.file_name
    )
  );

  return p_document_id;
end;
$$;

revoke all on function public.approve_filing_document(uuid) from public;
grant execute on function public.approve_filing_document(uuid) to authenticated;
