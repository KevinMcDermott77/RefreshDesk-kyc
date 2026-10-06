create extension if not exists pgcrypto;

create table public.firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  brand_primary text not null default '#0f766e',
  brand_accent text not null default '#334155',
  country_code text not null default 'GB',
  mlr_supervisor text,
  firm_reference_number text,
  retention_days integer not null default 2555,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.firms.retention_days is
  'Default record retention period aligned to Money Laundering Regulations 2017, regulation 40.';

create table public.firm_members (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin', 'analyst', 'auditor')),
  status text not null default 'active' check (status in ('invited', 'active', 'disabled')),
  invited_by uuid references auth.users(id),
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firm_id, user_id)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  schema_version smallint not null default 1,
  created_at timestamptz not null default now()
);

comment on table public.audit_events is
  'Append-only audit log. UPDATE and DELETE are blocked by trigger for every role.';

create index firms_slug_idx on public.firms (slug);
create index firm_members_user_id_idx on public.firm_members (user_id);
create index firm_members_firm_id_idx on public.firm_members (firm_id);
create index firm_members_firm_id_role_idx on public.firm_members (firm_id, role);
create index audit_events_firm_id_created_at_idx on public.audit_events (firm_id, created_at desc);
create index audit_events_firm_id_entity_idx on public.audit_events (firm_id, entity_type, entity_id);
create index audit_events_event_type_idx on public.audit_events (event_type);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger firms_set_updated_at
before update on public.firms
for each row
execute function public.set_updated_at();

create trigger firm_members_set_updated_at
before update on public.firm_members
for each row
execute function public.set_updated_at();

create or replace function public.prevent_audit_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events is append-only and cannot be updated or deleted';
end;
$$;

create trigger audit_events_prevent_update
before update on public.audit_events
for each row
execute function public.prevent_audit_event_mutation();

create trigger audit_events_prevent_delete
before delete on public.audit_events
for each row
execute function public.prevent_audit_event_mutation();

alter table public.firms enable row level security;
alter table public.firm_members enable row level security;
alter table public.audit_events enable row level security;

create or replace function public.is_active_firm_member(target_firm_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.firm_members
    where firm_id = target_firm_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function public.is_active_firm_admin(target_firm_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.firm_members
    where firm_id = target_firm_id
      and user_id = auth.uid()
      and role = 'admin'
      and status = 'active'
  );
$$;

create or replace function public.firm_has_no_members(target_firm_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not exists (
    select 1
    from public.firm_members
    where firm_id = target_firm_id
  );
$$;

create policy "authenticated users can create firms"
on public.firms
for insert
to authenticated
with check (true);

create policy "active members can read their firms"
on public.firms
for select
to authenticated
using (
  id in (
    select firm_id
    from public.firm_members
    where user_id = auth.uid()
      and status = 'active'
  )
);

create policy "active admins can update their firms"
on public.firms
for update
to authenticated
using (
  id in (
    select firm_id
    from public.firm_members
    where user_id = auth.uid()
      and role = 'admin'
      and status = 'active'
  )
)
with check (
  id in (
    select firm_id
    from public.firm_members
    where user_id = auth.uid()
      and role = 'admin'
      and status = 'active'
  )
);

create policy "users can create their first active admin membership"
on public.firm_members
for insert
to authenticated
with check (
  user_id = auth.uid()
  and role = 'admin'
  and status = 'active'
  and public.firm_has_no_members(firm_id)
);

create policy "active admins can create memberships for their firms"
on public.firm_members
for insert
to authenticated
with check (public.is_active_firm_admin(firm_id));

create policy "active members can read memberships for their firms"
on public.firm_members
for select
to authenticated
using (public.is_active_firm_member(firm_id));

create policy "active admins can update memberships for their firms"
on public.firm_members
for update
to authenticated
using (public.is_active_firm_admin(firm_id))
with check (public.is_active_firm_admin(firm_id));

create policy "active members can insert audit events for their firms"
on public.audit_events
for insert
to authenticated
with check (
  firm_id in (
    select firm_id
    from public.firm_members
    where user_id = auth.uid()
      and status = 'active'
  )
);

create policy "active members can read audit events for their firms"
on public.audit_events
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
