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

revoke all on function public.create_firm_with_admin(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) from public;

grant execute on function public.create_firm_with_admin(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;
