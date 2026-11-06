-- Slice 7f: a client's written confirmation of ownership is the primary kind of client evidence.
--
-- In institutional KYC the client is asked to confirm its ownership in writing (a signed letter, an email or a
-- signed structure chart); a register document is the fallback. See docs/slice7-client-evidence.md.
--
-- 1. A new evidence kind, client_ownership_confirmation, allowed by the evidence_kind check and by
--    create_ownership_evidence. (signed_structure_chart stays valid: it is treated as a confirmation.)
-- 2. certified gains a fourth value, not_applicable, because nobody certifies the client's own statement.
--    The two kinds that are the client's statement (client_ownership_confirmation and signed_structure_chart)
--    must say not_applicable; every other kind keeps yes, no or unclear and may not say not_applicable. This is
--    enforced on the typed column and on the proposal and confirmed payloads, so it cannot drift.
-- 3. The payload check (ownership_evidence_payload_error) accepts not_applicable.
--
-- The matching constraint is added NOT VALID: it is enforced for every new and changed row, and does not
-- re-check rows written before it existed (a signed_structure_chart item saved earlier would say "unclear").
--
-- Depends on Slice 7a and 7e. Everything here can run inside a transaction.

-- 1. The kind.

alter table public.ownership_evidence
  drop constraint if exists ownership_evidence_evidence_kind_check;

alter table public.ownership_evidence
  add constraint ownership_evidence_evidence_kind_check
  check (
    evidence_kind in (
      'client_ownership_confirmation', 'register_extract', 'shareholder_register', 'signed_structure_chart', 'annual_report_page'
    )
  );

-- 2. Certification: not applicable to the client's own statement.

alter table public.ownership_evidence
  drop constraint if exists ownership_evidence_certified_check;

alter table public.ownership_evidence
  add constraint ownership_evidence_certified_check
  check (certified in ('yes', 'no', 'unclear', 'not_applicable'));

alter table public.ownership_evidence
  drop constraint if exists ownership_evidence_certified_matches_kind;

alter table public.ownership_evidence
  add constraint ownership_evidence_certified_matches_kind
  check (
    (certified is null
      or (certified = 'not_applicable') = (evidence_kind in ('client_ownership_confirmation', 'signed_structure_chart')))
    and (proposal is null
      or ((proposal ->> 'certified') = 'not_applicable') = (evidence_kind in ('client_ownership_confirmation', 'signed_structure_chart')))
    and (confirmed is null
      or ((confirmed ->> 'certified') = 'not_applicable') = (evidence_kind in ('client_ownership_confirmation', 'signed_structure_chart')))
  ) not valid;

-- 3. The payload check, with not_applicable accepted.

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
  if (p ->> 'certified') is null or (p ->> 'certified') not in ('yes', 'no', 'unclear', 'not_applicable') then
    return 'certified must be yes, no, unclear or not_applicable';
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

-- 4. The RPC that opens an item, with the new kind (the 7e function plus that one value).

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

  if p_evidence_kind not in ('client_ownership_confirmation', 'register_extract', 'shareholder_register', 'signed_structure_chart', 'annual_report_page') then
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
