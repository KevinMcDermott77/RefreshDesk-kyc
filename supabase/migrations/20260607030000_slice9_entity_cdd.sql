-- Slice 9: Automated Entity CDD via Companies House (kyc-search)

-- Store fetched Companies House data per entity client
create table public.entity_cdd_records (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  company_number text not null,
  source_document_id uuid references public.client_documents(id),

  -- Raw Companies House data
  company_profile jsonb not null default '{}',
  officers jsonb not null default '[]',
  pscs jsonb not null default '[]',

  -- Computed ownership chain
  ownership_chain jsonb not null default '[]',
  ubo_list jsonb not null default '[]',

  -- PSC data quality flag
  psc_data_quality text not null default 'full'
    check (psc_data_quality in ('full', 'partial', 'none')),
  psc_warning text,    -- shown on review screen if partial/none

  -- Review state (same pattern as document_extractions)
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  reviewer_notes text,

  -- Provenance
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.entity_cdd_records is
  'Companies House CDD data fetched for entity clients, pending human review before it updates the client record.';

alter table public.entity_cdd_records enable row level security;

create policy "firm members can read entity cdd records"
  on public.entity_cdd_records for select
  to authenticated
  using (
    firm_id in (
      select firm_id from public.firm_members
      where user_id = auth.uid() and status = 'active'
    )
  );

create index entity_cdd_records_client_id_idx
  on public.entity_cdd_records (client_id, created_at desc);

-- ─── save_entity_cdd ──────────────────────────────────────────────────────────

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

  if not public.is_active_member_of_firm(v_client.firm_id) then
    raise exception 'user is not an active member of this firm';
  end if;

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
    status
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
    'pending_review'
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

-- ─── review_entity_cdd ────────────────────────────────────────────────────────

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

  if not public.is_active_member_of_firm(v_record.firm_id) then
    raise exception 'user is not an active member of this firm';
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
      'reviewer_notes', p_reviewer_notes
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
