-- Slice 7a: client-provided ownership evidence (data model, RPCs, audit). See docs/slice7-client-evidence.md.
--
-- A member uploads a document against an unresolved foreign node (register extract, shareholder
-- register, signed structure chart, annual report page). A proposal of owners is stored (extracted
-- by Claude if the firm allows it, or typed in by hand). A DIFFERENT admin confirms or edits it;
-- only then is the evidence usable. Confirmed evidence is never deleted: a newer confirmation
-- supersedes it (status 'superseded'), rejected and superseded rows stay, and the audit trail
-- keeps every step.
--
-- Depends on Slice 0b (public.require_role, firms.four_eyes). Rows are written only by the RPCs
-- below (no insert, update or delete policy). Nothing here needs more than one transaction.
--
-- Personal data: owners' names live only in ownership_evidence.proposal / .confirmed /
-- .raw_response, readable by admins and members of the firm. Individuals also carry initials, set
-- by the app, which is all that read_only users and every other output see. Audit payloads hold
-- ids, kinds, counts and hashes, never names.

-- ─── 1. Firm setting: document extraction (default OFF) ──────────────────────

alter table public.firms
  add column if not exists evidence_extraction_enabled boolean not null default false;

comment on column public.firms.evidence_extraction_enabled is
  'When true, client-evidence documents may be sent to the Anthropic API for extraction. Default false; without it, owners are entered by hand and confirmed the same way.';

-- Extraction is switched on for the demo firm only, by slug (a no-op where that firm does not
-- exist, such as a fresh database); every other firm stays off. Others are switched on by an
-- admin with set_evidence_extraction.
update public.firms
set evidence_extraction_enabled = true
where slug = 'refreshdesk-sql-test-1778359800';

-- ─── 2. Documents: a new document type ───────────────────────────────────────

alter table public.client_documents
  drop constraint if exists client_documents_document_type_check;

alter table public.client_documents
  add constraint client_documents_document_type_check
  check (document_type in ('passport', 'proof_of_address', 'incorporation', 'source_of_funds', 'filing', 'ownership_evidence'));

-- register_document is deliberately not changed: it still refuses 'ownership_evidence', so such a
-- document can only be registered by create_ownership_evidence, together with its evidence row.

-- ─── 3. Payload validation ───────────────────────────────────────────────────

-- Returns why a proposal / confirmed payload is not acceptable, or null if it is. p_for_confirm
-- also requires a date to measure age from. Dates are ISO yyyy-mm-dd; "not in the future" is
-- checked by the RPCs (it cannot be in a CHECK).
create or replace function public.ownership_evidence_payload_error(p jsonb, p_for_confirm boolean default false)
returns text
language plpgsql
immutable
as $$
declare
  v_owner jsonb;
  v_holding jsonb;
  v_reg jsonb;
  v_override jsonb;
  v_reason jsonb;
  v_low numeric;
  v_high numeric;
  v_i int := 0;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return 'the payload must be a JSON object';
  end if;

  -- Data minimisation: no personal-data keys beyond the owner's name as shown.
  if p::text ~* '"(date_of_birth|dateofbirth|dob|nationality|country_of_residence|countryofresidence|occupation)"\s*:' then
    return 'personal-data keys (date of birth, nationality, residence, occupation) are not allowed';
  end if;

  if jsonb_typeof(p -> 'owners') is distinct from 'array' then
    return 'owners must be an array';
  end if;
  if jsonb_typeof(p -> 'owners_complete') is distinct from 'boolean' then
    return 'owners_complete must be true or false';
  end if;
  if (p ->> 'certified') is null or (p ->> 'certified') not in ('yes', 'no', 'unclear') then
    return 'certified must be yes, no or unclear';
  end if;
  if (p -> 'certified_by') is not null and jsonb_typeof(p -> 'certified_by') not in ('string', 'null') then
    return 'certified_by must be text';
  end if;

  foreach v_reason in array array[p -> 'as_at', p -> 'document_date'] loop
    if v_reason is not null and jsonb_typeof(v_reason) <> 'null'
      and (jsonb_typeof(v_reason) <> 'string' or (v_reason #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$') then
      return 'as_at and document_date must be yyyy-mm-dd or null';
    end if;
  end loop;
  if p_for_confirm
    and coalesce(nullif(p -> 'as_at', 'null'::jsonb), nullif(p -> 'document_date', 'null'::jsonb)) is null then
    return 'as_at or document_date is needed to measure the evidence''s age';
  end if;

  for v_owner in select * from jsonb_array_elements(p -> 'owners') loop
    v_i := v_i + 1;
    if jsonb_typeof(v_owner) <> 'object' then
      return format('owner %s must be an object', v_i);
    end if;
    if (v_owner ->> 'kind') is null or (v_owner ->> 'kind') not in ('individual', 'entity') then
      return format('owner %s: kind must be individual or entity', v_i);
    end if;
    if nullif(btrim(coalesce(v_owner ->> 'name_as_shown', '')), '') is null then
      return format('owner %s: name_as_shown is required', v_i);
    end if;
    if nullif(btrim(coalesce(v_owner ->> 'page_ref', '')), '') is null then
      return format('owner %s: page_ref is required', v_i);
    end if;
    if (v_owner ->> 'kind') = 'individual'
      -- Any letter followed by a dot (Ø.Å. is as valid as J.P.), or "?" when no initial could be read.
      and coalesce(v_owner ->> 'initials', '') !~ '^(([^[:space:].]\.)+|\?)$' then
      return format('owner %s: an individual needs initials such as J.P.S.', v_i);
    end if;

    v_holding := nullif(v_owner -> 'holding', 'null'::jsonb);
    if v_holding is not null then
      if jsonb_typeof(v_holding) <> 'object' then
        return format('owner %s: holding must be an object', v_i);
      end if;
      if (v_holding ->> 'type') = 'percent' then
        if jsonb_typeof(v_holding -> 'value') is distinct from 'number' then
          return format('owner %s: a percent holding needs a numeric value', v_i);
        end if;
        v_low := (v_holding ->> 'value')::numeric;
        if v_low < 0 or v_low > 100 then
          return format('owner %s: a holding must be between 0 and 100', v_i);
        end if;
      elsif (v_holding ->> 'type') = 'band' then
        if jsonb_typeof(v_holding -> 'low') is distinct from 'number' or jsonb_typeof(v_holding -> 'high') is distinct from 'number' then
          return format('owner %s: a band needs numeric low and high', v_i);
        end if;
        v_low := (v_holding ->> 'low')::numeric;
        v_high := (v_holding ->> 'high')::numeric;
        if v_low < 0 or v_high > 100 or v_low > v_high then
          return format('owner %s: a band must satisfy 0 <= low <= high <= 100', v_i);
        end if;
      else
        return format('owner %s: holding type must be percent or band', v_i);
      end if;
    end if;

    v_reg := nullif(v_owner -> 'registration', 'null'::jsonb);
    if v_reg is not null then
      if jsonb_typeof(v_reg) <> 'object'
        or nullif(btrim(coalesce(v_reg ->> 'number', '')), '') is null
        or coalesce(v_reg ->> 'country', '') !~ '^[A-Z]{2}$' then
        return format('owner %s: a registration needs a number and a two-letter country code', v_i);
      end if;
    end if;

    if nullif(v_owner -> 'lei_shown', 'null'::jsonb) is not null
      and coalesce(v_owner ->> 'lei_shown', '') !~ '^[A-Z0-9]{20}$' then
      return format('owner %s: lei_shown must be 20 letters and digits', v_i);
    end if;
  end loop;

  v_override := nullif(p -> 'override', 'null'::jsonb);
  if v_override is not null then
    if jsonb_typeof(v_override) <> 'object' then
      return 'override must be an object';
    end if;
    if jsonb_typeof(v_override -> 'reasons') is distinct from 'array'
      or jsonb_array_length(v_override -> 'reasons') = 0
      or exists (
        select 1 from jsonb_array_elements(v_override -> 'reasons') r
        where r not in ('"stale"'::jsonb, '"uncertified"'::jsonb)
      ) then
      return 'an override needs reasons: stale and/or uncertified';
    end if;
    if nullif(btrim(coalesce(v_override ->> 'note', '')), '') is null then
      return 'an override needs a note';
    end if;
  end if;

  return null;
end;
$$;

-- ─── 4. The evidence table ───────────────────────────────────────────────────

create table public.ownership_evidence (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  document_id uuid not null references public.client_documents(id),
  -- The walk's root (company number, overseas entity number or LEI) and the node the evidence is about.
  subject_id text not null check (length(btrim(subject_id)) > 0),
  node_key text not null check (length(btrim(node_key)) > 0),
  node_name text not null check (length(btrim(node_name)) > 0),
  -- What the reviewer saw: { "lei": "..." } and/or { "country": "NO", "registration_number": "..." }.
  node_identity jsonb not null check (
    jsonb_typeof(node_identity) = 'object'
    and (
      coalesce(node_identity ->> 'lei', '') ~ '^[A-Z0-9]{20}$'
      or (
        coalesce(node_identity ->> 'country', '') ~ '^[A-Z]{2}$'
        and length(btrim(coalesce(node_identity ->> 'registration_number', ''))) > 0
      )
    )
  ),
  -- A text list, so a later migration can add signed_client_declaration.
  evidence_kind text not null check (
    evidence_kind in ('register_extract', 'shareholder_register', 'signed_structure_chart', 'annual_report_page')
  ),
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),

  status text not null default 'draft' check (
    status in ('draft', 'proposed', 'confirmed', 'rejected', 'superseded')
  ),
  -- 'extraction' (Claude, only if the firm allows it) or 'manual'. Null until a proposal exists.
  proposal_source text check (proposal_source in ('extraction', 'manual')),
  proposal jsonb check (proposal is null or public.ownership_evidence_payload_error(proposal, false) is null),
  confirmed jsonb check (confirmed is null or public.ownership_evidence_payload_error(confirmed, true) is null),
  model_used text,
  prompt_version text,
  confidence numeric(4, 3) check (confidence between 0 and 1),
  raw_response text,

  -- Typed copies of the document facts: from the proposal, then from what was confirmed.
  as_at date,
  document_date date,
  certified text check (certified in ('yes', 'no', 'unclear')),
  certified_by text,
  edited boolean,

  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  proposed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  superseded_by uuid references public.ownership_evidence(id),
  superseded_at timestamptz,

  constraint ownership_evidence_proposal_present check (status = 'draft' or proposal is not null),
  constraint ownership_evidence_confirmed_present check (
    (status in ('confirmed', 'superseded')) = (confirmed is not null)
  ),
  constraint ownership_evidence_reviewed check (
    status in ('draft', 'proposed') or (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint ownership_evidence_superseded check (
    (status = 'superseded') = (superseded_by is not null and superseded_at is not null)
  ),
  constraint ownership_evidence_extraction_fields check (
    proposal_source is distinct from 'extraction' or (model_used is not null and prompt_version is not null)
  )
);

comment on table public.ownership_evidence is
  'Client-provided ownership evidence for an unresolved foreign node. Written only by RPCs; never deleted. Holds owners'' names: admins and members only.';

create index ownership_evidence_client_idx on public.ownership_evidence (firm_id, client_id, subject_id);
create index ownership_evidence_open_idx on public.ownership_evidence (firm_id, status) where status in ('draft', 'proposed');

-- One confirmed item per node; a newer confirmation supersedes it.
create unique index ownership_evidence_one_confirmed
  on public.ownership_evidence (firm_id, client_id, subject_id, node_key)
  where status = 'confirmed';

-- One item awaiting confirmation per node.
create unique index ownership_evidence_one_open
  on public.ownership_evidence (firm_id, client_id, subject_id, node_key)
  where status in ('draft', 'proposed');

-- ─── 5. Row-level security and the names-free overview ───────────────────────

alter table public.ownership_evidence enable row level security;

-- Admins and members read the table (it holds names). read_only users get the overview view below.
create policy "admins and members can read ownership evidence"
  on public.ownership_evidence for select
  to authenticated
  using (
    exists (
      select 1 from public.firm_members m
      where m.firm_id = ownership_evidence.firm_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('admin', 'member')
    )
  );

revoke all on table public.ownership_evidence from anon, authenticated;
grant select on table public.ownership_evidence to authenticated;

-- No names, no payloads, no file names: what a read_only user may see about evidence.
create or replace view public.ownership_evidence_overview
with (security_barrier = true) as
select
  e.id, e.firm_id, e.client_id, e.subject_id, e.node_key, e.node_name, e.evidence_kind, e.status,
  e.proposal_source, e.as_at, e.document_date, e.certified, e.edited,
  coalesce(nullif(e.confirmed -> 'override', 'null'::jsonb) is not null, false) as has_override,
  e.created_by, e.created_at, e.reviewed_by, e.reviewed_at, e.superseded_by, e.superseded_at
from public.ownership_evidence e
where e.firm_id in (
  select firm_id from public.firm_members where user_id = auth.uid() and status = 'active'
);

revoke all on table public.ownership_evidence_overview from anon, authenticated;
grant select on table public.ownership_evidence_overview to authenticated;

-- ─── 6. Guard: identity is fixed, status only moves forward, nothing is deleted ──

create or replace function public.ownership_evidence_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ownership evidence % is never deleted', old.id using errcode = '42501';
  end if;

  if new.id is distinct from old.id
    or new.firm_id is distinct from old.firm_id
    or new.client_id is distinct from old.client_id
    or new.document_id is distinct from old.document_id
    or new.subject_id is distinct from old.subject_id
    or new.node_key is distinct from old.node_key
    or new.node_name is distinct from old.node_name
    or new.node_identity is distinct from old.node_identity
    or new.evidence_kind is distinct from old.evidence_kind
    or new.document_sha256 is distinct from old.document_sha256
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'ownership evidence % is immutable: its node, document and creator cannot change', old.id
      using errcode = '42501';
  end if;

  if old.status in ('rejected', 'superseded') then
    raise exception 'ownership evidence % is % and cannot change', old.id, old.status
      using errcode = '42501';
  end if;

  if old.status = 'confirmed' then
    -- Only one move is allowed: to superseded, which touches nothing but status and the two superseded_* columns.
    if new.status <> 'superseded'
      or (to_jsonb(new) - 'status' - 'superseded_by' - 'superseded_at')
         is distinct from (to_jsonb(old) - 'status' - 'superseded_by' - 'superseded_at')
    then
      raise exception 'ownership evidence % is confirmed and cannot change except to be superseded', old.id
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
    and not (
      (old.status = 'draft' and new.status in ('proposed', 'rejected'))
      or (old.status = 'proposed' and new.status in ('confirmed', 'rejected'))
    )
  then
    raise exception 'invalid ownership evidence status change: % to %', old.status, new.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger ownership_evidence_guard
  before update or delete on public.ownership_evidence
  for each row execute function public.ownership_evidence_guard();

-- ─── 7. create_ownership_evidence ────────────────────────────────────────────

-- Registers the uploaded file (already in Storage under <firm>/<client>/...) as a client document
-- and opens an evidence item for one node. Admin or member.
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
    raise exception 'evidence for this node is already awaiting confirmation; reject or withdraw it first';
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

-- ─── 8. save_evidence_proposal ───────────────────────────────────────────────

-- Stores (or replaces) the proposal. Only the person who uploaded can. 'extraction' needs the firm
-- setting and the model details; 'manual' is always allowed. Admin or member.
create or replace function public.save_evidence_proposal(
  p_evidence_id uuid,
  p_source text,
  p_proposal jsonb,
  p_model_used text default null,
  p_prompt_version text default null,
  p_confidence numeric default null,
  p_raw_response text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_ev public.ownership_evidence%rowtype;
  v_enabled boolean;
  v_err text;
  v_as_at date;
  v_doc_date date;
begin
  if v_user_id is null then
    raise exception 'save_evidence_proposal requires an authenticated user';
  end if;

  select * into v_ev from public.ownership_evidence where id = p_evidence_id for update;
  if not found then
    raise exception 'ownership evidence not found';
  end if;

  perform public.require_role(v_ev.firm_id, array['admin', 'member']);

  if v_ev.created_by <> v_user_id then
    raise exception 'only the person who uploaded this evidence can save its proposal' using errcode = '42501';
  end if;
  if v_ev.status not in ('draft', 'proposed') then
    raise exception 'ownership evidence is not open (it is %)', v_ev.status;
  end if;
  if p_source not in ('extraction', 'manual') then
    raise exception 'source must be extraction or manual';
  end if;

  if p_source = 'extraction' then
    select evidence_extraction_enabled into v_enabled from public.firms where id = v_ev.firm_id;
    if not coalesce(v_enabled, false) then
      raise exception 'document extraction is switched off for this firm; enter the owners by hand instead';
    end if;
    if nullif(btrim(coalesce(p_model_used, '')), '') is null or nullif(btrim(coalesce(p_prompt_version, '')), '') is null then
      raise exception 'an extraction needs the model and prompt version';
    end if;
  end if;

  v_err := public.ownership_evidence_payload_error(p_proposal, false);
  if v_err is not null then
    raise exception 'invalid proposal: %', v_err;
  end if;

  v_as_at := (nullif(p_proposal -> 'as_at', 'null'::jsonb) #>> '{}')::date;
  v_doc_date := (nullif(p_proposal -> 'document_date', 'null'::jsonb) #>> '{}')::date;
  if v_as_at > current_date or v_doc_date > current_date then
    raise exception 'as_at and document_date cannot be in the future';
  end if;

  update public.ownership_evidence
  set
    status = 'proposed',
    proposal_source = p_source,
    proposal = p_proposal,
    model_used = case when p_source = 'extraction' then p_model_used end,
    prompt_version = case when p_source = 'extraction' then p_prompt_version end,
    confidence = case when p_source = 'extraction' then p_confidence end,
    raw_response = case when p_source = 'extraction' then p_raw_response end,
    as_at = v_as_at,
    document_date = v_doc_date,
    certified = p_proposal ->> 'certified',
    certified_by = nullif(btrim(coalesce(p_proposal ->> 'certified_by', '')), ''),
    proposed_at = now()
  where id = p_evidence_id;

  insert into public.audit_events (firm_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (
    v_ev.firm_id, v_user_id, 'ownership_evidence.proposed', 'ownership_evidence', p_evidence_id,
    jsonb_build_object(
      'evidence_id', p_evidence_id,
      'source', p_source,
      'model_used', case when p_source = 'extraction' then p_model_used end,
      'prompt_version', case when p_source = 'extraction' then p_prompt_version end,
      'confidence', case when p_source = 'extraction' then p_confidence end,
      'owner_count', jsonb_array_length(p_proposal -> 'owners')
    )
  );

  return p_evidence_id;
end;
$$;

-- ─── 9. confirm_ownership_evidence ───────────────────────────────────────────

-- An admin confirms the proposal as it is, or with edits (p_confirmed). With firms.four_eyes on,
-- not the person who uploaded it. Supersedes the node's previously confirmed item, which is kept.
create or replace function public.confirm_ownership_evidence(
  p_evidence_id uuid,
  p_confirmed jsonb,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_ev public.ownership_evidence%rowtype;
  v_four_eyes boolean;
  v_err text;
  v_as_at date;
  v_doc_date date;
  v_old uuid;
  v_edited boolean;
  v_override jsonb;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_user_id is null then
    raise exception 'confirm_ownership_evidence requires an authenticated user';
  end if;

  select * into v_ev from public.ownership_evidence where id = p_evidence_id for update;
  if not found then
    raise exception 'ownership evidence not found';
  end if;

  -- Admin is the reviewer.
  perform public.require_role(v_ev.firm_id, array['admin']);

  if v_ev.status <> 'proposed' then
    raise exception 'ownership evidence is not awaiting confirmation (it is %)', v_ev.status;
  end if;

  select four_eyes into v_four_eyes from public.firms where id = v_ev.firm_id;
  if v_four_eyes and v_ev.created_by = v_user_id then
    raise exception 'Four-eyes rule: the person who uploaded this evidence cannot confirm it'
      using errcode = '42501';
  end if;

  v_err := public.ownership_evidence_payload_error(p_confirmed, true);
  if v_err is not null then
    raise exception 'invalid evidence: %', v_err;
  end if;

  v_as_at := (nullif(p_confirmed -> 'as_at', 'null'::jsonb) #>> '{}')::date;
  v_doc_date := (nullif(p_confirmed -> 'document_date', 'null'::jsonb) #>> '{}')::date;
  if v_as_at > current_date or v_doc_date > current_date then
    raise exception 'as_at and document_date cannot be in the future';
  end if;

  v_override := nullif(p_confirmed -> 'override', 'null'::jsonb);
  -- An uncertified override only makes sense for a document that is not certified.
  if v_override is not null and (v_override -> 'reasons') ? 'uncertified' and (p_confirmed ->> 'certified') = 'yes' then
    raise exception 'invalid evidence: an uncertified override cannot be given for a certified document';
  end if;

  v_edited := (p_confirmed - 'override') is distinct from (v_ev.proposal - 'override');

  -- The node's earlier confirmed item is superseded first (and kept), so the unique index holds.
  select id into v_old
  from public.ownership_evidence
  where firm_id = v_ev.firm_id and client_id = v_ev.client_id and subject_id = v_ev.subject_id
    and node_key = v_ev.node_key and status = 'confirmed' and id <> p_evidence_id
  for update;

  if found then
    update public.ownership_evidence
    set status = 'superseded', superseded_by = p_evidence_id, superseded_at = now()
    where id = v_old;

    insert into public.audit_events (firm_id, actor_user_id, event_type, entity_type, entity_id, payload)
    values (
      v_ev.firm_id, v_user_id, 'ownership_evidence.superseded', 'ownership_evidence', v_old,
      jsonb_build_object('evidence_id', v_old, 'superseded_by', p_evidence_id, 'node_key', v_ev.node_key)
    );
  end if;

  update public.ownership_evidence
  set
    status = 'confirmed',
    confirmed = p_confirmed,
    as_at = v_as_at,
    document_date = v_doc_date,
    certified = p_confirmed ->> 'certified',
    certified_by = nullif(btrim(coalesce(p_confirmed ->> 'certified_by', '')), ''),
    edited = v_edited,
    reviewed_by = v_user_id,
    reviewed_at = now(),
    review_note = v_note
  where id = p_evidence_id;

  insert into public.audit_events (firm_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (
    v_ev.firm_id, v_user_id, 'ownership_evidence.confirmed', 'ownership_evidence', p_evidence_id,
    jsonb_build_object(
      'evidence_id', p_evidence_id,
      'confirmed_by', v_user_id,
      'uploaded_by', v_ev.created_by,
      'edited', v_edited,
      'override_reasons', coalesce(v_override -> 'reasons', '[]'::jsonb),
      'override_note_given', v_override is not null,
      'note_given', v_note is not null,
      'owner_count', jsonb_array_length(p_confirmed -> 'owners'),
      'confirmed_sha256', encode(sha256(convert_to(p_confirmed::text, 'UTF8')), 'hex'),
      'document_id', v_ev.document_id,
      'document_sha256', v_ev.document_sha256,
      'four_eyes', v_four_eyes,
      'superseded', v_old
    )
  );

  return p_evidence_id;
end;
$$;

-- ─── 10. reject_ownership_evidence ───────────────────────────────────────────

-- An admin rejects open evidence, or its uploader withdraws it. A note is required. The row is kept.
create or replace function public.reject_ownership_evidence(p_evidence_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_ev public.ownership_evidence%rowtype;
  v_role text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_user_id is null then
    raise exception 'reject_ownership_evidence requires an authenticated user';
  end if;

  select * into v_ev from public.ownership_evidence where id = p_evidence_id for update;
  if not found then
    raise exception 'ownership evidence not found';
  end if;

  v_role := public.require_role(v_ev.firm_id, array['admin', 'member']);

  if v_role <> 'admin' and v_ev.created_by <> v_user_id then
    raise exception 'permission denied: only an admin, or the person who uploaded it, can reject this evidence'
      using errcode = '42501';
  end if;
  if v_ev.status not in ('draft', 'proposed') then
    raise exception 'ownership evidence is not open (it is %)', v_ev.status;
  end if;
  if v_note is null then
    raise exception 'a note is required to reject ownership evidence';
  end if;

  update public.ownership_evidence
  set status = 'rejected', reviewed_by = v_user_id, reviewed_at = now(), review_note = v_note
  where id = p_evidence_id;

  insert into public.audit_events (firm_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (
    v_ev.firm_id, v_user_id, 'ownership_evidence.rejected', 'ownership_evidence', p_evidence_id,
    jsonb_build_object(
      'evidence_id', p_evidence_id,
      'rejected_by', v_user_id,
      'uploaded_by', v_ev.created_by,
      'withdrawn', v_ev.created_by = v_user_id,
      'note_given', true,
      'status_before', v_ev.status
    )
  );

  return p_evidence_id;
end;
$$;

-- ─── 11. set_evidence_extraction ─────────────────────────────────────────────

create or replace function public.set_evidence_extraction(p_firm_id uuid, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_before boolean;
begin
  if v_user_id is null then
    raise exception 'set_evidence_extraction requires an authenticated user';
  end if;

  perform public.require_role(p_firm_id, array['admin']);

  if p_enabled is null then
    raise exception 'enabled must be true or false';
  end if;

  select evidence_extraction_enabled into v_before from public.firms where id = p_firm_id for update;

  update public.firms set evidence_extraction_enabled = p_enabled where id = p_firm_id;

  insert into public.audit_events (firm_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (
    p_firm_id, v_user_id, 'firm.evidence_extraction_changed', 'firm', p_firm_id,
    jsonb_build_object('from', v_before, 'to', p_enabled)
  );

  return p_enabled;
end;
$$;

-- ─── 12. confirmed_evidence_for ──────────────────────────────────────────────

-- The confirmed items for a client's walk, for the app to apply. Any active member of the firm can
-- call it, read_only included, but only admins and members receive the names of individuals: for
-- read_only the names are removed and the initials the app set are all that is left. Staleness and
-- policy are applied by the app, not here.
create or replace function public.confirmed_evidence_for(p_client_id uuid, p_subject_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_firm_id uuid;
  v_role text;
  v_result jsonb;
begin
  select firm_id into v_firm_id from public.clients where id = p_client_id;
  if not found then
    raise exception 'client not found';
  end if;

  v_role := public.require_role(v_firm_id, array['admin', 'member', 'read_only']);

  select coalesce(jsonb_agg(item order by created_at), '[]'::jsonb) into v_result
  from (
    select
      e.created_at,
      jsonb_build_object(
        'id', e.id,
        'node_key', e.node_key,
        'node_identity', e.node_identity,
        'evidence_kind', e.evidence_kind,
        'as_at', e.as_at,
        'document_date', e.document_date,
        'certified', e.certified,
        'certified_by', e.certified_by,
        'edited', e.edited,
        'confirmed_at', e.reviewed_at,
        'confirmed_by', e.reviewed_by,
        'uploaded_by', e.created_by,
        'document_id', e.document_id,
        'document_sha256', e.document_sha256,
        'payload',
          case
            when v_role = 'read_only' then
              jsonb_set(
                e.confirmed,
                '{owners}',
                coalesce((
                  select jsonb_agg(
                    case when o ->> 'kind' = 'individual'
                      then (o - 'name_as_shown' - 'lei_shown')
                      else o
                    end
                    order by ord
                  )
                  from jsonb_array_elements(e.confirmed -> 'owners') with ordinality as t(o, ord)
                ), '[]'::jsonb)
              )
            else e.confirmed
          end
      ) as item
    from public.ownership_evidence e
    where e.firm_id = v_firm_id
      and e.client_id = p_client_id
      and e.subject_id = p_subject_id
      and e.status = 'confirmed'
  ) s;

  return v_result;
end;
$$;

-- ─── 13. Privileges ──────────────────────────────────────────────────────────

revoke all on function public.ownership_evidence_payload_error(jsonb, boolean) from public;
revoke all on function public.ownership_evidence_guard() from public;
revoke all on function public.create_ownership_evidence(uuid, text, text, text, jsonb, text, text, text, integer, text, text) from public;
revoke all on function public.save_evidence_proposal(uuid, text, jsonb, text, text, numeric, text) from public;
revoke all on function public.confirm_ownership_evidence(uuid, jsonb, text) from public;
revoke all on function public.reject_ownership_evidence(uuid, text) from public;
revoke all on function public.set_evidence_extraction(uuid, boolean) from public;
revoke all on function public.confirmed_evidence_for(uuid, text) from public;

-- The check constraints call the validator as the inserting role.
grant execute on function public.ownership_evidence_payload_error(jsonb, boolean) to authenticated;
grant execute on function public.create_ownership_evidence(uuid, text, text, text, jsonb, text, text, text, integer, text, text) to authenticated;
grant execute on function public.save_evidence_proposal(uuid, text, jsonb, text, text, numeric, text) to authenticated;
grant execute on function public.confirm_ownership_evidence(uuid, jsonb, text) to authenticated;
grant execute on function public.reject_ownership_evidence(uuid, text) to authenticated;
grant execute on function public.set_evidence_extraction(uuid, boolean) to authenticated;
grant execute on function public.confirmed_evidence_for(uuid, text) to authenticated;
