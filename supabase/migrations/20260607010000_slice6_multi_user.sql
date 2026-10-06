-- Slice 6: Multi-user firms — join codes, roles, team management.
--
-- Adds:
-- - role check constraint on firm_members (admin, member, read_only)
-- - firm_join_codes table with admin-only read RLS
-- - four security-definer RPCs: generate_join_code, redeem_join_code,
--   remove_firm_member, update_member_role

-- 1. Add role constraint to firm_members
alter table public.firm_members
  drop constraint if exists firm_members_role_check;

alter table public.firm_members
  add constraint firm_members_role_check
  check (role in ('admin', 'member', 'read_only'));

-- 2. New table: firm_join_codes
create table public.firm_join_codes (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  code text not null unique,
  role text not null default 'member' check (role in ('member', 'read_only')),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz,                    -- null = never expires
  max_uses integer,                          -- null = unlimited
  use_count integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index firm_join_codes_firm_id_idx on public.firm_join_codes (firm_id);

alter table public.firm_join_codes enable row level security;

-- Read: firm admins only
create policy "firm admins can read join codes"
  on public.firm_join_codes for select
  to authenticated
  using (
    firm_id in (
      select firm_id from public.firm_members
      where user_id = auth.uid()
        and status = 'active'
        and role = 'admin'
    )
  );

-- ─── generate_join_code ───────────────────────────────────────────────────────

create or replace function public.generate_join_code(
  p_role text default 'member',
  p_expires_at timestamptz default null,
  p_max_uses integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_firm_id uuid;
  v_code text;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_role not in ('member', 'read_only') then
    raise exception 'role must be member or read_only';
  end if;

  select firm_id into v_firm_id
  from public.firm_members
  where user_id = v_user_id
    and status = 'active'
    and role = 'admin'
  limit 1;

  if v_firm_id is null then
    raise exception 'not an active admin of any firm';
  end if;

  -- Generate unique 8-char code
  loop
    v_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (
      select 1 from public.firm_join_codes where code = v_code
    );
  end loop;

  insert into public.firm_join_codes (
    firm_id, code, role, created_by, expires_at, max_uses
  ) values (
    v_firm_id, v_code, p_role, v_user_id, p_expires_at, p_max_uses
  );

  insert into public.audit_events (
    firm_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_firm_id, v_user_id, 'firm.join_code_created', 'firm', v_firm_id,
    jsonb_build_object('code', v_code, 'role', p_role)
  );

  return jsonb_build_object('code', v_code, 'role', p_role, 'expires_at', p_expires_at);
end;
$$;

-- ─── redeem_join_code ─────────────────────────────────────────────────────────

create or replace function public.redeem_join_code(
  p_code text,
  p_full_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_join_code public.firm_join_codes%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  select * into v_join_code
  from public.firm_join_codes
  where code = upper(trim(p_code))
    and is_active = true
  for update;

  if not found then
    raise exception 'invalid or inactive join code';
  end if;

  if v_join_code.expires_at is not null and v_join_code.expires_at < now() then
    raise exception 'join code has expired';
  end if;

  if v_join_code.max_uses is not null and v_join_code.use_count >= v_join_code.max_uses then
    raise exception 'join code has reached its maximum uses';
  end if;

  if exists (
    select 1 from public.firm_members
    where user_id = v_user_id
      and firm_id = v_join_code.firm_id
      and status = 'active'
  ) then
    raise exception 'already a member of this firm';
  end if;

  insert into public.firm_members (
    user_id, firm_id, role, full_name, status
  ) values (
    v_user_id, v_join_code.firm_id, v_join_code.role, p_full_name, 'active'
  );

  update public.firm_join_codes
  set use_count = use_count + 1
  where id = v_join_code.id;

  insert into public.audit_events (
    firm_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_join_code.firm_id, v_user_id, 'firm.member_joined', 'firm', v_join_code.firm_id,
    jsonb_build_object(
      'full_name', p_full_name,
      'role', v_join_code.role,
      'join_code', p_code
    )
  );

  return v_join_code.firm_id;
end;
$$;

-- ─── remove_firm_member ───────────────────────────────────────────────────────

create or replace function public.remove_firm_member(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_firm_id uuid;
  v_target_role text;
  v_admin_count integer;
begin
  if v_actor_id is null then
    raise exception 'authentication required';
  end if;

  select firm_id into v_firm_id
  from public.firm_members
  where user_id = v_actor_id
    and status = 'active'
    and role = 'admin'
  limit 1;

  if v_firm_id is null then
    raise exception 'not an active admin of any firm';
  end if;

  select role into v_target_role
  from public.firm_members
  where user_id = p_user_id
    and firm_id = v_firm_id
    and status = 'active';

  if v_target_role is null then
    raise exception 'member not found';
  end if;

  if v_target_role = 'admin' then
    select count(*) into v_admin_count
    from public.firm_members
    where firm_id = v_firm_id
      and role = 'admin'
      and status = 'active';

    if v_admin_count <= 1 then
      raise exception 'cannot remove the last admin';
    end if;
  end if;

  update public.firm_members
  set status = 'inactive'
  where user_id = p_user_id
    and firm_id = v_firm_id;

  insert into public.audit_events (
    firm_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_firm_id, v_actor_id, 'firm.member_removed', 'firm_member', p_user_id,
    jsonb_build_object('removed_user_id', p_user_id, 'previous_role', v_target_role)
  );
end;
$$;

-- ─── update_member_role ───────────────────────────────────────────────────────

create or replace function public.update_member_role(
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_firm_id uuid;
  v_current_role text;
  v_admin_count integer;
begin
  if v_actor_id is null then
    raise exception 'authentication required';
  end if;

  if p_role not in ('admin', 'member', 'read_only') then
    raise exception 'role must be admin, member, or read_only';
  end if;

  select firm_id into v_firm_id
  from public.firm_members
  where user_id = v_actor_id
    and status = 'active'
    and role = 'admin'
  limit 1;

  if v_firm_id is null then
    raise exception 'not an active admin of any firm';
  end if;

  select role into v_current_role
  from public.firm_members
  where user_id = p_user_id
    and firm_id = v_firm_id
    and status = 'active';

  if v_current_role is null then
    raise exception 'member not found';
  end if;

  if v_current_role = 'admin' and p_role <> 'admin' then
    select count(*) into v_admin_count
    from public.firm_members
    where firm_id = v_firm_id
      and role = 'admin'
      and status = 'active';

    if v_admin_count <= 1 then
      raise exception 'cannot demote the last admin';
    end if;
  end if;

  update public.firm_members
  set role = p_role
  where user_id = p_user_id
    and firm_id = v_firm_id;

  insert into public.audit_events (
    firm_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_firm_id, v_actor_id, 'firm.member_role_changed', 'firm_member', p_user_id,
    jsonb_build_object('user_id', p_user_id, 'before', v_current_role, 'after', p_role)
  );
end;
$$;

-- ─── deactivate_join_code ─────────────────────────────────────────────────────

create or replace function public.deactivate_join_code(
  p_code_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_firm_id uuid;
  v_code text;
begin
  if v_actor_id is null then
    raise exception 'authentication required';
  end if;

  select firm_id into v_firm_id
  from public.firm_members
  where user_id = v_actor_id
    and status = 'active'
    and role = 'admin'
  limit 1;

  if v_firm_id is null then
    raise exception 'not an active admin of any firm';
  end if;

  select code into v_code
  from public.firm_join_codes
  where id = p_code_id
    and firm_id = v_firm_id;

  if v_code is null then
    raise exception 'join code not found';
  end if;

  update public.firm_join_codes
  set is_active = false
  where id = p_code_id
    and firm_id = v_firm_id;

  insert into public.audit_events (
    firm_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_firm_id, v_actor_id, 'firm.join_code_deactivated', 'firm', v_firm_id,
    jsonb_build_object('code', v_code)
  );
end;
$$;
