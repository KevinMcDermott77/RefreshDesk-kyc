-- Slice 3: Document ingestion & AI extraction.
--
-- This migration adds:
-- - client_documents table (uploaded files, status lifecycle)
-- - document_extractions table (Claude output, review state)
-- - private Storage bucket (kyc-documents) with RLS
-- - RLS: read-only via firm_members subquery; all writes via security-definer RPCs
-- - register_document, save_extraction, review_extraction RPCs
-- - Indexes for common query patterns

-- ───────────────────────────────────────────────
-- Tables
-- ───────────────────────────────────────────────

create table public.client_documents (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  document_type text not null check (
    document_type in ('passport', 'proof_of_address', 'incorporation', 'source_of_funds')
  ),
  storage_path text not null,
  file_name text not null,
  file_size_bytes integer not null,
  mime_type text not null,
  status text not null default 'uploaded' check (
    status in ('uploaded', 'extracting', 'pending_review', 'approved', 'rejected')
  ),
  created_at timestamptz not null default now()
);

comment on table public.client_documents is
  'KYC documents uploaded against a client. Status tracks the extraction and review lifecycle.';

create table public.document_extractions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.client_documents(id) on delete cascade,
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  extracted_fields jsonb not null default '{}',
  confidence_score numeric(4,3) check (confidence_score between 0 and 1),
  model_used text not null,
  prompt_version text not null,
  raw_response text,
  status text not null default 'pending_review' check (
    status in ('pending_review', 'approved', 'rejected')
  ),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  reviewer_notes text,
  created_at timestamptz not null default now()
);

comment on table public.document_extractions is
  'Claude extraction output. No extraction row reaches approved status without an explicit human review step.';

-- ───────────────────────────────────────────────
-- Indexes
-- ───────────────────────────────────────────────

create index client_documents_client_id_idx
  on public.client_documents (client_id, created_at desc);

create index client_documents_firm_id_idx
  on public.client_documents (firm_id, created_at desc);

create index client_documents_status_idx
  on public.client_documents (client_id, status);

create index document_extractions_document_id_idx
  on public.document_extractions (document_id);

create index document_extractions_client_id_idx
  on public.document_extractions (client_id, created_at desc);

-- ───────────────────────────────────────────────
-- RLS
-- ───────────────────────────────────────────────

alter table public.client_documents enable row level security;
alter table public.document_extractions enable row level security;

-- Read-only policies: firm members can read their own firm's data.
-- There are intentionally no INSERT/UPDATE/DELETE policies: all writes go
-- through security-definer RPCs that validate membership and write audit
-- events atomically.

create policy "firm members can read their documents"
  on public.client_documents for select
  to authenticated
  using (
    firm_id in (
      select firm_id
      from public.firm_members
      where user_id = auth.uid()
        and status = 'active'
    )
  );

create policy "firm members can read their extractions"
  on public.document_extractions for select
  to authenticated
  using (
    firm_id in (
      select firm_id
      from public.firm_members
      where user_id = auth.uid()
        and status = 'active'
    )
  );

-- ───────────────────────────────────────────────
-- Storage bucket
-- ───────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kyc-documents',
  'kyc-documents',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do nothing;

-- Storage RLS: path pattern is {firm_id}/{client_id}/{document_id}/{filename}
-- Check that the first path segment matches a firm the user belongs to.

create policy "firm members can upload documents"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] in (
      select firm_id::text
      from public.firm_members
      where user_id = auth.uid()
        and status = 'active'
    )
  );

create policy "firm members can read their stored files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] in (
      select firm_id::text
      from public.firm_members
      where user_id = auth.uid()
        and status = 'active'
    )
  );

-- ───────────────────────────────────────────────
-- RPC: register_document
-- ───────────────────────────────────────────────
-- Called immediately after the file lands in Storage.
-- Validates firm membership, inserts client_documents row, writes audit event.

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

  if p_document_type not in ('passport', 'proof_of_address', 'incorporation', 'source_of_funds') then
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

-- ───────────────────────────────────────────────
-- RPC: save_extraction
-- ───────────────────────────────────────────────
-- Called after Claude returns structured output.
-- Validates membership, transitions document to pending_review,
-- inserts extraction row, writes audit event.

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

  if not public.is_active_member_of_firm(v_doc.firm_id) then
    raise exception 'user is not an active member of this firm';
  end if;

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

-- ───────────────────────────────────────────────
-- RPC: review_extraction
-- ───────────────────────────────────────────────
-- Called when a reviewer approves or rejects an extraction.
-- If approved: updates client.last_refreshed_at and recalculates refresh_due_date.
-- No AI output touches last_refreshed_at without this explicit human step.

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

  if not public.is_active_member_of_firm(v_extraction.firm_id) then
    raise exception 'user is not an active member of this firm';
  end if;

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

-- ───────────────────────────────────────────────
-- Grants
-- ───────────────────────────────────────────────

revoke all on function public.register_document(uuid, text, text, text, integer, text) from public;
revoke all on function public.save_extraction(uuid, jsonb, numeric, text, text, text) from public;
revoke all on function public.review_extraction(uuid, text, text) from public;

grant execute on function public.register_document(uuid, text, text, text, integer, text) to authenticated;
grant execute on function public.save_extraction(uuid, jsonb, numeric, text, text, text) to authenticated;
grant execute on function public.review_extraction(uuid, text, text) to authenticated;
