-- Slice 8: Billing — Stripe subscriptions, plan limits.
--
-- Adds:
-- - billing columns on firms (stripe_customer_id, stripe_subscription_id, plan, plan_expires_at)
-- - get_firm_plan RPC for UI plan/usage display
-- - plan limit checks in create_client and redeem_join_code

-- 1. Billing columns on firms
alter table public.firms
  add column if not exists stripe_customer_id text unique,
  add column if not exists stripe_subscription_id text unique,
  add column if not exists plan text not null default 'starter'
    check (plan in ('starter', 'pro')),
  add column if not exists plan_expires_at timestamptz;

create index if not exists firms_stripe_customer_id_idx
  on public.firms (stripe_customer_id);

create index if not exists firms_stripe_subscription_id_idx
  on public.firms (stripe_subscription_id);

-- ─── get_firm_plan ────────────────────────────────────────────────────────────

create or replace function public.get_firm_plan()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_firm record;
  v_client_count integer;
  v_member_count integer;
begin
  select f.id, f.plan, f.plan_expires_at
  into v_firm
  from public.firms f
  join public.firm_members fm on fm.firm_id = f.id
  where fm.user_id = auth.uid()
    and fm.status = 'active'
  limit 1;

  if not found then
    raise exception 'no active firm membership';
  end if;

  select count(*) into v_client_count
  from public.clients
  where firm_id = v_firm.id and status = 'active';

  select count(*) into v_member_count
  from public.firm_members
  where firm_id = v_firm.id and status = 'active';

  return jsonb_build_object(
    'plan', v_firm.plan,
    'plan_expires_at', v_firm.plan_expires_at,
    'client_count', v_client_count,
    'member_count', v_member_count,
    'limits', jsonb_build_object(
      'max_clients', case v_firm.plan when 'pro' then null else 10 end,
      'max_members', case v_firm.plan when 'pro' then null else 1 end
    )
  );
end;
$$;

-- ─── create_client: add Starter plan client-limit check ──────────────────────

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

  if not public.is_active_member_of_firm(p_firm_id) then
    raise exception 'user is not an active member of this firm';
  end if;

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

-- ─── redeem_join_code: add Starter plan member-limit check ───────────────────

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
  v_plan text;
  v_member_count integer;
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

  select plan into v_plan from public.firms where id = v_join_code.firm_id;

  if v_plan = 'starter' then
    select count(*) into v_member_count
    from public.firm_members
    where firm_id = v_join_code.firm_id and status = 'active';

    if v_member_count >= 1 then
      raise exception 'member limit reached — upgrade to Pro';
    end if;
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
