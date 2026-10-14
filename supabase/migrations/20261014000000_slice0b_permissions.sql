-- Slice 0b: enforce permissions in the database.
--
-- Until now only the app checked roles; every write RPC accepted any active member, so a
-- read_only user could call them directly (BUILT_STATE §6 bugs 1 and 2). This migration:
--
-- 1. adds require_role(firm_id, roles[]) and calls it at the top of every write RPC that
--    previously only checked active membership. read_only can no longer write. Reviewing
--    (entity CDD records, document extractions) and approving saved filings need admin:
--    admin is the reviewer, there is no separate reviewer role.
--    Saving a filing is maker-checker: a member or admin saves it (status 'pending'); an admin
--    approves it, and with four_eyes on, not the person who saved it.
-- 2. adds entity_cdd_records.fetched_by, set by save_entity_cdd from auth.uid(), backfilled
--    from the entity_cdd.fetched audit event.
-- 3. adds firms.four_eyes (default true) and enforces it in review_entity_cdd and
--    approve_filing_document (client_documents.uploaded_by is the person who saved the filing).
--    review_extraction has no four-eyes check: no preparer is recorded for extractions.
-- 4. repairs is_admin_or_analyst_of_firm, which still looked for the 'analyst' role that Slice 6
--    removed, so only admins could update or archive clients. Admins and members can again.
--
-- Roles are admin, member and read_only (firm_members_role_check).
-- CREATE OR REPLACE keeps each function's existing grants.
-- Everything here can run inside a transaction (no CONCURRENTLY, no ALTER TYPE ... ADD VALUE).

-- 1. Columns

alter table public.entity_cdd_records
  add column if not exists fetched_by uuid references auth.users(id) on delete set null;

comment on column public.entity_cdd_records.fetched_by is
  'User who fetched this record (auth.uid() in save_entity_cdd). Null for records from before this column existed.';

alter table public.firms
  add column if not exists four_eyes boolean not null default true;

comment on column public.firms.four_eyes is
  'When true, the person who fetched an entity CDD record cannot approve it.';

-- Saved filings wait for approval in a 'pending' state (members save, admins approve).
-- client_documents.uploaded_by is NOT NULL, so the person who saved each filing is already known.
alter table public.client_documents
  drop constraint if exists client_documents_status_check;

alter table public.client_documents
  add constraint client_documents_status_check
  check (status in ('uploaded', 'extracting', 'pending_review', 'approved', 'rejected', 'pending'));

-- Filings saved before this change that never got approved are waiting for approval too.
update public.client_documents
set status = 'pending'
where document_type = 'filing' and status = 'uploaded';

-- Backfill fetched_by from the audit trail where the actor is known.
update public.entity_cdd_records r
set fetched_by = e.actor_user_id
from public.audit_events e
where r.fetched_by is null
  and e.event_type = 'entity_cdd.fetched'
  and e.payload ->> 'record_id' = r.id::text
  and e.actor_user_id is not null;

-- 2. Helper

create or replace function public.require_role(p_firm_id uuid, p_roles text[])
returns text
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select role into v_role
  from public.firm_members
  where firm_id = p_firm_id
    and user_id = auth.uid()
    and status = 'active';

  if v_role is null then
    raise exception 'user is not an active member of this firm' using errcode = '42501';
  end if;

  if not (v_role = any (p_roles)) then
    raise exception 'permission denied: role % cannot do this (requires one of: %)',
      v_role, array_to_string(p_roles, ', ')
      using errcode = '42501';
  end if;

  return v_role;
end;
$$;

revoke all on function public.require_role(uuid, text[]) from public;
grant execute on function public.require_role(uuid, text[]) to authenticated;

-- 3. Client-edit gate (update_client and archive_client)

create or replace function public.is_admin_or_analyst_of_firm(p_firm_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.firm_members
    where firm_id = p_firm_id
      and user_id = auth.uid()
      and role in ('admin', 'member')
      and status = 'active'
  );
$$;

comment on function public.is_admin_or_analyst_of_firm(uuid) is
  'True for an active admin or member of the firm: the roles that may update and archive clients. The name predates Slice 6, which removed the analyst role.';

-- 4. Write RPCs (each is its latest definition with the membership check replaced)

-- ─── create_client ─────────────────────────────────────────────────────────

create or replace function public.create_client(
  p_firm_id uuid,
  p_client_type text,
  p_display_name text,
  p_risk_rating text,
  p_details jsonb,
  p_external_ref text default null,
  p_refresh_due_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_client_id uuid := gen_random_uuid();
  v_due_date date;
  v_plan text;
  v_client_count integer;
begin
  if v_user_id is null then
    raise exception 'create_client requires an authenticated user';
  end if;

  perform public.require_role(p_firm_id, array['admin', 'member']);

  select plan into v_plan from public.firms where id = p_firm_id;

  if v_plan = 'starter' then
    select count(*) into v_client_count
    from public.clients
    where firm_id = p_firm_id and status = 'active';

    if v_client_count >= 10 then
      raise exception 'client limit reached — upgrade to Pro';
    end if;
  end if;

  if p_client_type not in ('individual', 'entity') then
    raise exception 'client_type must be individual or entity';
  end if;

  if p_risk_rating not in ('low', 'standard', 'high') then
    raise exception 'risk_rating must be low, standard, or high';
  end if;

  if nullif(trim(p_display_name), '') is null then
    raise exception 'display_name is required';
  end if;

  v_due_date := public.slice2_compute_refresh_due_date(
    p_firm_id,
    p_risk_rating,
    p_refresh_due_date
  );

  insert into public.clients (
    id,
    firm_id,
    client_type,
    display_name,
    risk_rating,
    refresh_due_date,
    details,
    external_ref,
    created_by
  )
  values (
    v_client_id,
    p_firm_id,
    p_client_type,
    trim(p_display_name),
    p_risk_rating,
    v_due_date,
    coalesce(p_details, '{}'::jsonb),
    nullif(trim(p_external_ref), ''),
    v_user_id
  );

  insert into public.audit_events (
    firm_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  )
  values (
    p_firm_id,
    v_user_id,
    'client.created',
    'client',
    v_client_id,
    jsonb_build_object(
      'client_id', v_client_id,
      'client_type', p_client_type,
      'display_name', trim(p_display_name),
      'risk_rating', p_risk_rating,
      'refresh_due_date', v_due_date,
      'external_ref', nullif(trim(p_external_ref), '')
    )
  );

  return v_client_id;
exception
  when unique_violation then
    raise exception 'external_ref must be unique per firm';
end;
$$;

-- ─── import_clients ────────────────────────────────────────────────────────

create or replace function public.import_clients(
  p_firm_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_row jsonb;
  v_index integer := 0;
  v_inserted_count integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_client_id uuid;
begin
  if v_user_id is null then
    raise exception 'import_clients requires an authenticated user';
  end if;

  perform public.require_role(p_firm_id, array['admin', 'member']);

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  -- This RPC intentionally allows partial import success because the Slice 2
  -- CSV workflow requires "5 valid rows + 2 invalid rows" to insert 5 clients
  -- and return 2 row-level errors. Each successful row is still atomic via
  -- create_client, and the batch itself is summarized in client.bulk_imported.
  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    begin
      v_client_id := public.create_client(
        p_firm_id,
        v_row->>'client_type',
        v_row->>'display_name',
        v_row->>'risk_rating',
        coalesce(v_row->'details', '{}'::jsonb),
        v_row->>'external_ref',
        nullif(v_row->>'refresh_due_date', '')::date
      );

      v_inserted_count := v_inserted_count + 1;
    exception
      when others then
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object(
            'row_index', v_index,
            'error_message', sqlerrm
          )
        );
    end;

    v_index := v_index + 1;
  end loop;

  insert into public.audit_events (
    firm_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  )
  values (
    p_firm_id,
    v_user_id,
    'client.bulk_imported',
    'client_import',
    null,
    jsonb_build_object(
      'inserted_count', v_inserted_count,
      'error_count', jsonb_array_length(v_errors)
    )
  );

  return jsonb_build_object(
    'inserted_count', v_inserted_count,
    'errors', v_errors
  );
end;
$$;

-- ─── register_document ─────────────────────────────────────────────────────

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

  perform public.require_role(v_firm_id, array['admin', 'member']);

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
    -- A saved filing waits for an admin to approve it; other documents are just uploaded.
    case when p_document_type = 'filing' then 'pending' else 'uploaded' end
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

-- ─── save_extraction ───────────────────────────────────────────────────────

create or replace function public.save_extraction(
  p_document_id uuid,
  p_extracted_fields jsonb,
  p_confidence_score numeric,
  p_model_used text,
  p_prompt_version text,
  p_raw_response text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_doc public.client_documents%rowtype;
  v_extraction_id uuid := gen_random_uuid();
begin
  if v_user_id is null then
    raise exception 'save_extraction requires an authenticated user';
  end if;

  select * into v_doc
  from public.client_documents
  where id = p_document_id
  for update;

  if not found then
    raise exception 'document not found';
  end if;

  perform public.require_role(v_doc.firm_id, array['admin', 'member']);

  update public.client_documents
  set status = 'pending_review'
  where id = p_document_id;

  insert into public.document_extractions (
    id,
    document_id,
    firm_id,
    client_id,
    extracted_fields,
    confidence_score,
    model_used,
    prompt_version,
    raw_response,
    status
  )
  values (
    v_extraction_id,
    p_document_id,
    v_doc.firm_id,
    v_doc.client_id,
    coalesce(p_extracted_fields, '{}'),
    p_confidence_score,
    p_model_used,
    p_prompt_version,
    p_raw_response,
    'pending_review'
  );

  insert into public.audit_events (
    firm_id, actor_user_id, event_type, entity_type, entity_id, payload
  )
  values (
    v_doc.firm_id,
    v_user_id,
    'document.extraction_complete',
    'client_document',
    p_document_id,
    jsonb_build_object(
      'document_id', p_document_id,
      'extraction_id', v_extraction_id,
      'client_id', v_doc.client_id,
      'model_used', p_model_used,
      'prompt_version', p_prompt_version,
      'confidence_score', p_confidence_score
    )
  );

  return v_extraction_id;
end;
$$;

-- ─── review_extraction ─────────────────────────────────────────────────────

create or replace function public.review_extraction(
  p_extraction_id uuid,
  p_decision text,
  p_reviewer_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_extraction public.document_extractions%rowtype;
  v_client public.clients%rowtype;
  v_new_due_date date;
  v_event_type text;
begin
  if v_user_id is null then
    raise exception 'review_extraction requires an authenticated user';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected';
  end if;

  select * into v_extraction
  from public.document_extractions
  where id = p_extraction_id
  for update;

  if not found then
    raise exception 'extraction not found';
  end if;

  if v_extraction.status <> 'pending_review' then
    raise exception 'extraction has already been reviewed';
  end if;

  perform public.require_role(v_extraction.firm_id, array['admin']);

  update public.document_extractions
  set
    status       = p_decision,
    reviewed_by  = v_user_id,
    reviewed_at  = now(),
    reviewer_notes = p_reviewer_notes
  where id = p_extraction_id;

  update public.client_documents
  set status = p_decision
  where id = v_extraction.document_id;

  v_event_type := case p_decision
    when 'approved' then 'document.approved'
    else 'document.rejected'
  end;

  insert into public.audit_events (
    firm_id, actor_user_id, event_type, entity_type, entity_id, payload
  )
  values (
    v_extraction.firm_id,
    v_user_id,
    v_event_type,
    'client_document',
    v_extraction.document_id,
    jsonb_build_object(
      'document_id', v_extraction.document_id,
      'extraction_id', p_extraction_id,
      'client_id', v_extraction.client_id,
      'decision', p_decision,
      'reviewer_notes', p_reviewer_notes
    )
  );

  if p_decision = 'approved' then
    select * into v_client
    from public.clients
    where id = v_extraction.client_id
    for update;

    v_new_due_date := public.slice2_compute_refresh_due_date(
      v_extraction.firm_id,
      v_client.risk_rating,
      null
    );

    update public.clients
    set
      last_refreshed_at = now(),
      refresh_due_date  = v_new_due_date
    where id = v_extraction.client_id;

    insert into public.audit_events (
      firm_id, actor_user_id, event_type, entity_type, entity_id, payload
    )
    values (
      v_extraction.firm_id,
      v_user_id,
      'client.refreshed',
      'client',
      v_extraction.client_id,
      jsonb_build_object(
        'client_id', v_extraction.client_id,
        'triggered_by_document', v_extraction.document_id,
        'new_refresh_due_date', v_new_due_date
      )
    );
  end if;

  return p_extraction_id;
end;
$$;

-- ─── approve_filing_document ───────────────────────────────────────────────

create or replace function public.approve_filing_document(p_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_document public.client_documents%rowtype;
  v_four_eyes boolean;
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

  perform public.require_role(v_document.firm_id, array['admin']);

  if v_document.status = 'approved' then
    raise exception 'filing has already been approved';
  end if;

  -- Maker-checker: the person who saved the filing (uploaded_by) cannot approve it.
  select four_eyes into v_four_eyes
  from public.firms
  where id = v_document.firm_id;

  if v_four_eyes and v_document.uploaded_by = v_user_id then
    raise exception 'Four-eyes rule: the person who saved this filing cannot approve it'
      using errcode = '42501';
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
      'file_name', v_document.file_name,
      'saved_by', v_document.uploaded_by,
      'four_eyes', v_four_eyes
    )
  );

  return p_document_id;
end;
$$;

-- ─── upsert_client_embedding ───────────────────────────────────────────────

create or replace function public.upsert_client_embedding(
  p_client_id uuid,
  p_content_hash text,
  p_embedding vector(512)
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_firm_id uuid;
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'upsert_client_embedding requires an authenticated user';
  end if;

  select firm_id into v_firm_id
  from public.clients
  where id = p_client_id;

  if not found then
    raise exception 'client not found';
  end if;

  perform public.require_role(v_firm_id, array['admin', 'member']);

  insert into public.client_embeddings (firm_id, client_id, content_hash, embedding)
  values (v_firm_id, p_client_id, p_content_hash, p_embedding)
  on conflict (client_id)
  do update set
    content_hash = excluded.content_hash,
    embedding = excluded.embedding,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- ─── upsert_extraction_embedding ───────────────────────────────────────────

create or replace function public.upsert_extraction_embedding(
  p_extraction_id uuid,
  p_content_hash text,
  p_embedding vector(512)
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_extraction public.document_extractions%rowtype;
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'upsert_extraction_embedding requires an authenticated user';
  end if;

  select * into v_extraction
  from public.document_extractions
  where id = p_extraction_id;

  if not found then
    raise exception 'extraction not found';
  end if;

  perform public.require_role(v_extraction.firm_id, array['admin', 'member']);

  insert into public.extraction_embeddings (firm_id, client_id, extraction_id, content_hash, embedding)
  values (v_extraction.firm_id, v_extraction.client_id, p_extraction_id, p_content_hash, p_embedding)
  on conflict (extraction_id)
  do update set
    content_hash = excluded.content_hash,
    embedding = excluded.embedding,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- ─── upsert_entity_cdd_embedding ───────────────────────────────────────────

create or replace function public.upsert_entity_cdd_embedding(
  p_entity_cdd_id uuid,
  p_content_hash text,
  p_embedding vector(512)
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_record public.entity_cdd_records%rowtype;
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'upsert_entity_cdd_embedding requires an authenticated user';
  end if;

  select * into v_record
  from public.entity_cdd_records
  where id = p_entity_cdd_id;

  if not found then
    raise exception 'entity CDD record not found';
  end if;

  perform public.require_role(v_record.firm_id, array['admin', 'member']);

  insert into public.extraction_embeddings (firm_id, client_id, entity_cdd_id, content_hash, embedding)
  values (v_record.firm_id, v_record.client_id, p_entity_cdd_id, p_content_hash, p_embedding)
  on conflict (entity_cdd_id)
  do update set
    content_hash = excluded.content_hash,
    embedding = excluded.embedding,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- ─── save_entity_cdd ───────────────────────────────────────────────────────

create or replace function public.save_entity_cdd(
  p_client_id uuid,
  p_company_number text,
  p_source_document_id uuid,
  p_company_profile jsonb,
  p_officers jsonb,
  p_pscs jsonb,
  p_ownership_chain jsonb,
  p_ubo_list jsonb,
  p_psc_data_quality text,
  p_psc_warning text default null,
  p_extraction_model_used text default null,
  p_extraction_prompt_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_client public.clients%rowtype;
  v_record_id uuid := gen_random_uuid();
begin
  if v_user_id is null then
    raise exception 'save_entity_cdd requires an authenticated user';
  end if;

  select * into v_client
  from public.clients
  where id = p_client_id;

  if not found then
    raise exception 'client not found';
  end if;

  perform public.require_role(v_client.firm_id, array['admin', 'member']);

  if v_client.client_type <> 'entity' then
    raise exception 'entity CDD can only be fetched for entity clients';
  end if;

  if p_psc_data_quality not in ('full', 'partial', 'none') then
    raise exception 'psc_data_quality must be full, partial, or none';
  end if;

  insert into public.entity_cdd_records (
    id,
    firm_id,
    client_id,
    company_number,
    source_document_id,
    company_profile,
    officers,
    pscs,
    ownership_chain,
    ubo_list,
    psc_data_quality,
    psc_warning,
    status,
    fetched_by
  )
  values (
    v_record_id,
    v_client.firm_id,
    p_client_id,
    p_company_number,
    p_source_document_id,
    coalesce(p_company_profile, '{}'),
    coalesce(p_officers, '[]'),
    coalesce(p_pscs, '[]'),
    coalesce(p_ownership_chain, '[]'),
    coalesce(p_ubo_list, '[]'),
    p_psc_data_quality,
    p_psc_warning,
    'pending_review',
    v_user_id
  );

  insert into public.audit_events (
    firm_id, actor_user_id, event_type, entity_type, entity_id, payload
  )
  values (
    v_client.firm_id,
    v_user_id,
    'entity_cdd.fetched',
    'client',
    p_client_id,
    jsonb_build_object(
      'client_id', p_client_id,
      'record_id', v_record_id,
      'company_number', p_company_number,
      'psc_data_quality', p_psc_data_quality,
      'extraction_model_used', p_extraction_model_used,
      'extraction_prompt_version', p_extraction_prompt_version
    )
  );

  return v_record_id;
end;
$$;

-- ─── review_entity_cdd ─────────────────────────────────────────────────────

create or replace function public.review_entity_cdd(
  p_record_id uuid,
  p_decision text,
  p_reviewer_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_record public.entity_cdd_records%rowtype;
  v_client public.clients%rowtype;
  v_new_due_date date;
  v_event_type text;
  v_profile jsonb;
  v_new_details jsonb;
  v_four_eyes boolean;
  v_note text;
begin
  if v_user_id is null then
    raise exception 'review_entity_cdd requires an authenticated user';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected';
  end if;

  select * into v_record
  from public.entity_cdd_records
  where id = p_record_id
  for update;

  if not found then
    raise exception 'entity CDD record not found';
  end if;

  if v_record.status <> 'pending_review' then
    raise exception 'entity CDD record has already been reviewed';
  end if;

  -- Reviewing needs a reviewing role; read_only and member cannot, whatever the app shows.
  perform public.require_role(v_record.firm_id, array['admin']);

  select four_eyes into v_four_eyes
  from public.firms
  where id = v_record.firm_id;

  if p_decision = 'approved' and v_four_eyes then
    if v_record.fetched_by is not null and v_record.fetched_by = v_user_id then
      raise exception 'Four-eyes rule: the person who fetched this record cannot approve it'
        using errcode = '42501';
    end if;
    if v_record.fetched_by is null then
      -- Records from before fetched_by existed: allowed, but the audit event says it could not be checked.
      v_note := 'Four-eyes could not be checked: fetched_by is unknown for this record';
    end if;
  end if;

  update public.entity_cdd_records
  set
    status         = p_decision,
    reviewed_by    = v_user_id,
    reviewed_at    = now(),
    reviewer_notes = p_reviewer_notes
  where id = p_record_id;

  v_event_type := case p_decision
    when 'approved' then 'entity_cdd.approved'
    else 'entity_cdd.rejected'
  end;

  insert into public.audit_events (
    firm_id, actor_user_id, event_type, entity_type, entity_id, payload
  )
  values (
    v_record.firm_id,
    v_user_id,
    v_event_type,
    'client',
    v_record.client_id,
    jsonb_build_object(
      'client_id', v_record.client_id,
      'record_id', p_record_id,
      'company_number', v_record.company_number,
      'decision', p_decision,
      'reviewer_notes', p_reviewer_notes,
      'four_eyes', v_four_eyes,
      'fetched_by', v_record.fetched_by,
      'note', v_note
    )
  );

  if p_decision = 'approved' then
    select * into v_client
    from public.clients
    where id = v_record.client_id
    for update;

    v_profile := v_record.company_profile;

    v_new_details := v_client.details
      || jsonb_build_object(
        'company_number', v_record.company_number,
        'registered_name', v_profile->>'company_name',
        'registered_address', v_profile->'registered_office_address',
        'incorporation_date', v_profile->>'date_of_creation'
      );

    v_new_due_date := public.slice2_compute_refresh_due_date(
      v_record.firm_id,
      v_client.risk_rating,
      null
    );

    update public.clients
    set
      details           = v_new_details,
      last_refreshed_at = now(),
      refresh_due_date  = v_new_due_date
    where id = v_record.client_id;

    insert into public.audit_events (
      firm_id, actor_user_id, event_type, entity_type, entity_id, payload
    )
    values (
      v_record.firm_id,
      v_user_id,
      'client.refreshed',
      'client',
      v_record.client_id,
      jsonb_build_object(
        'client_id', v_record.client_id,
        'triggered_by_entity_cdd', p_record_id,
        'new_refresh_due_date', v_new_due_date
      )
    );
  end if;

  return p_record_id;
end;
$$;
