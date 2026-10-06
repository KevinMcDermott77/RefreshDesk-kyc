-- Slice 2: Client management.
--
-- This migration adds:
-- - clients table
-- - firm_refresh_rules table
-- - updated_at triggers
-- - tenant-scoped RLS policies
-- - client CRUD/import RPCs with audit logging
-- - default refresh-rule seeding in create_firm_with_admin
--
-- JSONB is used for clients.details because Slice 2 supports two client shapes
-- (individual and entity) without creating premature subtype tables. The app
-- validates details with Zod and the RPCs keep all writes tenant-scoped and
-- audit-backed.

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_type text not null check (client_type in ('individual', 'entity')),
  display_name text not null,
  risk_rating text not null check (risk_rating in ('low', 'standard', 'high')),
  refresh_due_date date,
  last_refreshed_at timestamptz,
  status text not null default 'active' check (status in ('active', 'archived')),
  details jsonb not null default '{}'::jsonb,
  external_ref text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.clients is
  'Firm-scoped KYC refresh clients. Type-specific fields are stored in details JSONB and validated at application/RPC boundaries.';

comment on column public.clients.details is
  'Type-specific structured fields for individual/entity clients. JSONB keeps Slice 2 flexible while preserving one tenant-scoped client table.';

create table public.firm_refresh_rules (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  risk_rating text not null check (risk_rating in ('low', 'standard', 'high')),
  cadence_months integer not null check (cadence_months > 0 and cadence_months <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firm_id, risk_rating)
);

comment on table public.firm_refresh_rules is
  'Firm-level default refresh cadences. New clients inherit a due date from these rules unless an override date is supplied.';

create unique index clients_firm_external_ref_unique_idx
on public.clients (firm_id, external_ref)
where external_ref is not null;

create index clients_firm_refresh_due_date_idx
on public.clients (firm_id, refresh_due_date);

create index clients_firm_risk_rating_idx
on public.clients (firm_id, risk_rating);

create index clients_firm_status_idx
on public.clients (firm_id, status);

create index clients_firm_created_at_idx
on public.clients (firm_id, created_at desc, id desc);

create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger clients_set_updated_at
before update on public.clients
for each row
execute function public.tg_set_updated_at();

create trigger firm_refresh_rules_set_updated_at
before update on public.firm_refresh_rules
for each row
execute function public.tg_set_updated_at();

alter table public.clients enable row level security;
alter table public.firm_refresh_rules enable row level security;

-- RLS: active members can read only clients belonging to their own firms.
-- This guards against cross-tenant reads from browser-side Supabase calls.
-- There are intentionally no direct INSERT/UPDATE/DELETE policies on clients:
-- all writes must go through security-definer RPCs that validate membership and
-- write audit events atomically.
create policy "active members can read clients in their firms"
on public.clients
for select
to authenticated
using (
  firm_id in (
    select firm_id
    from public.firm_members
    where user_id = auth.uid()
      and status = 'active'
  )
);

-- RLS: active members can read refresh cadence defaults for their own firms.
create policy "active members can read refresh rules"
on public.firm_refresh_rules
for select
to authenticated
using (
  firm_id in (
    select firm_id
    from public.firm_members
    where user_id = auth.uid()
      and status = 'active'
  )
);

-- RLS: only admins can change firm-level refresh cadence defaults.
create policy "active admins can update refresh rules"
on public.firm_refresh_rules
for update
to authenticated
using (
  firm_id in (
    select firm_id
    from public.firm_members
    where user_id = auth.uid()
      and role = 'admin'
      and status = 'active'
  )
)
with check (
  firm_id in (
    select firm_id
    from public.firm_members
    where user_id = auth.uid()
      and role = 'admin'
      and status = 'active'
  )
);

-- No client-side INSERT policy for firm_refresh_rules. Defaults are seeded by
-- create_firm_with_admin, which must run before normal firm state fully exists.

create or replace function public.is_active_member_of_firm(p_firm_id uuid)
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
      and status = 'active'
  );
$$;

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
      and role in ('admin', 'analyst')
      and status = 'active'
  );
$$;

create or replace function public.is_admin_of_firm(p_firm_id uuid)
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
      and role = 'admin'
      and status = 'active'
  );
$$;

create or replace function public.slice2_compute_refresh_due_date(
  p_firm_id uuid,
  p_risk_rating text,
  p_refresh_due_date date default null
)
returns date
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_cadence_months integer;
begin
  if p_refresh_due_date is not null then
    return p_refresh_due_date;
  end if;

  select cadence_months
  into v_cadence_months
  from public.firm_refresh_rules
  where firm_id = p_firm_id
    and risk_rating = p_risk_rating;

  if v_cadence_months is null then
    raise exception 'refresh rule not found for risk rating %', p_risk_rating;
  end if;

  return (current_date + make_interval(months => v_cadence_months))::date;
end;
$$;

-- Security definer is used for client RPCs because each workflow must write to
-- clients and audit_events atomically. search_path is pinned to public, auth so
-- untrusted schemas cannot hijack function/table resolution.

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
begin
  if v_user_id is null then
    raise exception 'create_client requires an authenticated user';
  end if;

  if not public.is_active_member_of_firm(p_firm_id) then
    raise exception 'user is not an active member of this firm';
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

create or replace function public.update_client(
  p_client_id uuid,
  p_patch jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_before public.clients%rowtype;
  v_after public.clients%rowtype;
  v_changes jsonb := '{}'::jsonb;
  v_new_client_type text;
  v_new_display_name text;
  v_new_risk_rating text;
  v_new_refresh_due_date date;
  v_new_details jsonb;
  v_new_external_ref text;
begin
  if v_user_id is null then
    raise exception 'update_client requires an authenticated user';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'p_patch must be a JSON object';
  end if;

  select *
  into v_before
  from public.clients
  where id = p_client_id
  for update;

  if not found then
    raise exception 'client not found';
  end if;

  if not public.is_admin_or_analyst_of_firm(v_before.firm_id) then
    raise exception 'user cannot update clients in this firm';
  end if;

  v_new_client_type :=
    case
      when p_patch ? 'client_type' then p_patch->>'client_type'
      else v_before.client_type
    end;

  v_new_display_name :=
    case
      when p_patch ? 'display_name' then nullif(trim(p_patch->>'display_name'), '')
      else v_before.display_name
    end;

  v_new_risk_rating :=
    case
      when p_patch ? 'risk_rating' then p_patch->>'risk_rating'
      else v_before.risk_rating
    end;

  v_new_refresh_due_date :=
    case
      when p_patch ? 'refresh_due_date' and coalesce(p_patch->>'refresh_due_date', '') = '' then null
      when p_patch ? 'refresh_due_date' then (p_patch->>'refresh_due_date')::date
      else v_before.refresh_due_date
    end;

  v_new_details :=
    case
      when p_patch ? 'details' then coalesce(p_patch->'details', '{}'::jsonb)
      else v_before.details
    end;

  v_new_external_ref :=
    case
      when p_patch ? 'external_ref' then nullif(trim(p_patch->>'external_ref'), '')
      else v_before.external_ref
    end;

  if v_new_display_name is null then
    raise exception 'display_name is required';
  end if;

  if v_new_client_type not in ('individual', 'entity') then
    raise exception 'client_type must be individual or entity';
  end if;

  if v_new_risk_rating not in ('low', 'standard', 'high') then
    raise exception 'risk_rating must be low, standard, or high';
  end if;

  update public.clients
  set
    client_type = v_new_client_type,
    display_name = v_new_display_name,
    risk_rating = v_new_risk_rating,
    refresh_due_date = v_new_refresh_due_date,
    details = v_new_details,
    external_ref = v_new_external_ref
  where id = p_client_id
  returning *
  into v_after;

  if v_before.client_type is distinct from v_after.client_type then
    v_changes := v_changes || jsonb_build_object(
      'client_type',
      jsonb_build_object('before', v_before.client_type, 'after', v_after.client_type)
    );
  end if;

  if v_before.display_name is distinct from v_after.display_name then
    v_changes := v_changes || jsonb_build_object(
      'display_name',
      jsonb_build_object('before', v_before.display_name, 'after', v_after.display_name)
    );
  end if;

  if v_before.risk_rating is distinct from v_after.risk_rating then
    v_changes := v_changes || jsonb_build_object(
      'risk_rating',
      jsonb_build_object('before', v_before.risk_rating, 'after', v_after.risk_rating)
    );
  end if;

  if v_before.refresh_due_date is distinct from v_after.refresh_due_date then
    v_changes := v_changes || jsonb_build_object(
      'refresh_due_date',
      jsonb_build_object('before', v_before.refresh_due_date, 'after', v_after.refresh_due_date)
    );
  end if;

  if v_before.details is distinct from v_after.details then
    v_changes := v_changes || jsonb_build_object(
      'details',
      jsonb_build_object('before', v_before.details, 'after', v_after.details)
    );
  end if;

  if v_before.external_ref is distinct from v_after.external_ref then
    v_changes := v_changes || jsonb_build_object(
      'external_ref',
      jsonb_build_object('before', v_before.external_ref, 'after', v_after.external_ref)
    );
  end if;

  if v_changes <> '{}'::jsonb then
    insert into public.audit_events (
      firm_id,
      actor_user_id,
      event_type,
      entity_type,
      entity_id,
      payload
    )
    values (
      v_before.firm_id,
      v_user_id,
      'client.updated',
      'client',
      p_client_id,
      jsonb_build_object(
        'client_id', p_client_id,
        'changes', v_changes
      )
    );
  end if;

  if v_before.risk_rating is distinct from v_after.risk_rating then
    insert into public.audit_events (
      firm_id,
      actor_user_id,
      event_type,
      entity_type,
      entity_id,
      payload
    )
    values (
      v_before.firm_id,
      v_user_id,
      'client.risk_rating_changed',
      'client',
      p_client_id,
      jsonb_build_object(
        'client_id', p_client_id,
        'before', v_before.risk_rating,
        'after', v_after.risk_rating
      )
    );
  end if;

  if v_before.refresh_due_date is distinct from v_after.refresh_due_date then
    insert into public.audit_events (
      firm_id,
      actor_user_id,
      event_type,
      entity_type,
      entity_id,
      payload
    )
    values (
      v_before.firm_id,
      v_user_id,
      'client.refresh_due_date_changed',
      'client',
      p_client_id,
      jsonb_build_object(
        'client_id', p_client_id,
        'before', v_before.refresh_due_date,
        'after', v_after.refresh_due_date
      )
    );
  end if;

  return p_client_id;
exception
  when unique_violation then
    raise exception 'external_ref must be unique per firm';
end;
$$;

create or replace function public.archive_client(p_client_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_before public.clients%rowtype;
begin
  if v_user_id is null then
    raise exception 'archive_client requires an authenticated user';
  end if;

  select *
  into v_before
  from public.clients
  where id = p_client_id
  for update;

  if not found then
    raise exception 'client not found';
  end if;

  if not public.is_admin_or_analyst_of_firm(v_before.firm_id) then
    raise exception 'user cannot archive clients in this firm';
  end if;

  if v_before.status = 'archived' then
    return p_client_id;
  end if;

  update public.clients
  set status = 'archived'
  where id = p_client_id;

  insert into public.audit_events (
    firm_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  )
  values (
    v_before.firm_id,
    v_user_id,
    'client.archived',
    'client',
    p_client_id,
    jsonb_build_object(
      'client_id', p_client_id,
      'status',
      jsonb_build_object('before', v_before.status, 'after', 'archived')
    )
  );

  return p_client_id;
end;
$$;

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

  if not public.is_active_member_of_firm(p_firm_id) then
    raise exception 'user is not an active member of this firm';
  end if;

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

create or replace function public.update_refresh_rule(
  p_rule_id uuid,
  p_cadence_months integer
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_before public.firm_refresh_rules%rowtype;
begin
  if v_user_id is null then
    raise exception 'update_refresh_rule requires an authenticated user';
  end if;

  select *
  into v_before
  from public.firm_refresh_rules
  where id = p_rule_id
  for update;

  if not found then
    raise exception 'refresh rule not found';
  end if;

  if not public.is_admin_of_firm(v_before.firm_id) then
    raise exception 'user cannot update refresh rules in this firm';
  end if;

  if p_cadence_months <= 0 or p_cadence_months > 120 then
    raise exception 'cadence_months must be between 1 and 120';
  end if;

  update public.firm_refresh_rules
  set cadence_months = p_cadence_months
  where id = p_rule_id;

  insert into public.audit_events (
    firm_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  )
  values (
    v_before.firm_id,
    v_user_id,
    'firm_refresh_rules.updated',
    'firm_refresh_rule',
    p_rule_id,
    jsonb_build_object(
      'rule_id', p_rule_id,
      'risk_rating', v_before.risk_rating,
      'cadence_months',
      jsonb_build_object('before', v_before.cadence_months, 'after', p_cadence_months)
    )
  );

  return p_rule_id;
end;
$$;

-- Existing firm creation RPC is replaced to seed default refresh rules:
-- low = 60 months, standard = 36 months, high = 12 months.
--
-- This function remains security definer because the firm, first membership,
-- default refresh rules, and firm.created audit event must be created atomically
-- before ordinary tenant membership state can authorize table-level writes.
-- search_path is pinned for security-definer safety.
create or replace function public.create_firm_with_admin(
  p_user_id uuid,
  p_full_name text,
  p_firm_name text,
  p_slug text,
  p_mlr_supervisor text default null,
  p_firm_reference_number text default null,
  p_brand_primary text default '#0f766e'
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_firm_id uuid := gen_random_uuid();
  v_authenticated_user_id uuid := auth.uid();
begin
  if v_authenticated_user_id is null then
    raise exception 'create_firm_with_admin requires an authenticated user';
  end if;

  if v_authenticated_user_id <> p_user_id then
    raise exception 'cannot create firm admin membership for another user';
  end if;

  if nullif(trim(p_firm_name), '') is null then
    raise exception 'firm name is required';
  end if;

  if nullif(trim(p_full_name), '') is null then
    raise exception 'full name is required';
  end if;

  if nullif(trim(p_slug), '') is null then
    raise exception 'firm slug is required';
  end if;

  insert into public.firms (
    id,
    name,
    slug,
    mlr_supervisor,
    firm_reference_number,
    brand_primary
  )
  values (
    v_firm_id,
    trim(p_firm_name),
    trim(p_slug),
    nullif(trim(p_mlr_supervisor), ''),
    nullif(trim(p_firm_reference_number), ''),
    coalesce(nullif(trim(p_brand_primary), ''), '#0f766e')
  );

  insert into public.firm_members (
    firm_id,
    user_id,
    full_name,
    role,
    status,
    last_active_at
  )
  values (
    v_firm_id,
    p_user_id,
    trim(p_full_name),
    'admin',
    'active',
    now()
  );

  insert into public.firm_refresh_rules (
    firm_id,
    risk_rating,
    cadence_months
  )
  values
    (v_firm_id, 'low', 60),
    (v_firm_id, 'standard', 36),
    (v_firm_id, 'high', 12);

  insert into public.audit_events (
    firm_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  )
  values (
    v_firm_id,
    p_user_id,
    'firm.created',
    'firm',
    v_firm_id,
    jsonb_build_object(
      'name', trim(p_firm_name),
      'mlr_supervisor', nullif(trim(p_mlr_supervisor), ''),
      'firm_reference_number', nullif(trim(p_firm_reference_number), '')
    )
  );

  return v_firm_id;
end;
$$;

revoke all on function public.create_client(uuid, text, text, text, jsonb, text, date) from public;
revoke all on function public.update_client(uuid, jsonb) from public;
revoke all on function public.archive_client(uuid) from public;
revoke all on function public.import_clients(uuid, jsonb) from public;
revoke all on function public.update_refresh_rule(uuid, integer) from public;

grant execute on function public.create_client(uuid, text, text, text, jsonb, text, date) to authenticated;
grant execute on function public.update_client(uuid, jsonb) to authenticated;
grant execute on function public.archive_client(uuid) to authenticated;
grant execute on function public.import_clients(uuid, jsonb) to authenticated;
grant execute on function public.update_refresh_rule(uuid, integer) to authenticated;
