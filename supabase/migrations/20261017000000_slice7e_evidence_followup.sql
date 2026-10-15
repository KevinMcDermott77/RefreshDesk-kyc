-- Slice 7e: follow-up to Slice 7a (client evidence), found in the browser test of 7b.
--
-- 1. A DRAFT (uploaded, no owners entered yet) could not be withdrawn or rejected: the row moves to 'rejected'
--    with no proposal, and ownership_evidence_proposal_present only allowed a missing proposal on a draft.
--    A rejected item may now have no proposal. Proposed, confirmed and superseded items still must have one,
--    and a rejected item is still frozen by the guard trigger. Nothing else changes: the reject RPC already
--    allowed an admin, or the uploader, to reject a draft.
-- 2. The "already open" message said "awaiting confirmation" even for a draft. Only the message changes: the
--    function below is the 7a function with that one line edited. (CREATE OR REPLACE keeps its grants.)
--
-- Depends on Slice 7a. Everything here can run inside a transaction.

-- 1. A rejected item may have no proposal (a rejected draft).

alter table public.ownership_evidence
  drop constraint if exists ownership_evidence_proposal_present;

alter table public.ownership_evidence
  add constraint ownership_evidence_proposal_present
  check (status in ('draft', 'rejected') or proposal is not null);

-- 2. The message.

create or replace function public.create_ownership_evidence(
  p_client_id uuid,
  p_subject_id text,
  p_node_key text,
  p_node_name text,
  p_node_identity jsonb,
  p_evidence_kind text,
  p_storage_path text,
  p_file_name text,
  p_file_size_bytes integer,
  p_mime_type text,
  p_document_sha256 text
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
  v_evidence_id uuid := gen_random_uuid();
begin
  if v_user_id is null then
    raise exception 'create_ownership_evidence requires an authenticated user';
  end if;

  select firm_id into v_firm_id from public.clients where id = p_client_id;
  if not found then
    raise exception 'client not found';
  end if;

  perform public.require_role(v_firm_id, array['admin', 'member']);

  if p_evidence_kind not in ('register_extract', 'shareholder_register', 'signed_structure_chart', 'annual_report_page') then
    raise exception 'invalid evidence kind';
  end if;
  if p_file_size_bytes is null or p_file_size_bytes <= 0 or p_file_size_bytes > 10485760 then
    raise exception 'file exceeds 10 MB limit';
  end if;
  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'file must be PDF, JPEG, or PNG';
  end if;
  if p_storage_path is null or p_storage_path not like (v_firm_id::text || '/' || p_client_id::text || '/%') then
    raise exception 'the document is not in this client''s folder';
  end if;
  if p_storage_path like '%..%' then
    raise exception 'invalid storage path';
  end if;

  if exists (
    select 1 from public.ownership_evidence
    where firm_id = v_firm_id and client_id = p_client_id and subject_id = p_subject_id
      and node_key = p_node_key and status in ('draft', 'proposed')
  ) then
    raise exception 'an evidence item for this node is already open (draft or awaiting confirmation); reject or withdraw it first';
  end if;

  insert into public.client_documents (
    id, firm_id, client_id, uploaded_by, document_type, storage_path, file_name, file_size_bytes, mime_type, status
  )
  values (
    v_document_id, v_firm_id, p_client_id, v_user_id, 'ownership_evidence', p_storage_path, p_file_name,
    p_file_size_bytes, p_mime_type, 'uploaded'
  );

  insert into public.ownership_evidence (
    id, firm_id, client_id, document_id, subject_id, node_key, node_name, node_identity,
    evidence_kind, document_sha256, status, created_by
  )
  values (
    v_evidence_id, v_firm_id, p_client_id, v_document_id, btrim(p_subject_id), btrim(p_node_key), btrim(p_node_name),
    p_node_identity, p_evidence_kind, p_document_sha256, 'draft', v_user_id
  );

  insert into public.audit_events (firm_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (
    v_firm_id, v_user_id, 'ownership_evidence.created', 'ownership_evidence', v_evidence_id,
    jsonb_build_object(
      'evidence_id', v_evidence_id,
      'client_id', p_client_id,
      'document_id', v_document_id,
      'document_sha256', p_document_sha256,
      'subject_id', btrim(p_subject_id),
      'node_key', btrim(p_node_key),
      'evidence_kind', p_evidence_kind
    )
  );

  return v_evidence_id;
end;
$$;
