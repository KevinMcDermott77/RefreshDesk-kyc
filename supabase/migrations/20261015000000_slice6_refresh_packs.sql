-- Slice 6: refresh packs.
--
-- A refresh pack is a saved, unchangeable record of an ownership run: the snapshot is exactly what
-- the pack page renders (profile rows, ownership chart, points to check, summary and a log of every
-- register fetch), with its SHA-256 fingerprint. A pack is made by a member or admin, submitted by
-- its creator, and approved or rejected by an admin; with firms.four_eyes on, not by its creator.
--
-- Depends on Slice 0b (public.require_role, firms.four_eyes). Nothing here needs more than one
-- transaction (no CONCURRENTLY, no ALTER TYPE ... ADD VALUE).
--
-- Immutability: a trigger refuses any change to the subject, policy, snapshot, fingerprint, firm,
-- creator or creation time, and only allows the status to move draft -> submitted -> approved or
-- rejected. Rows are written only by the RPCs below (there is no insert, update or delete policy).
-- Individuals appear in a snapshot as initials only: a check rejects personal-data keys, and the
-- app refuses to build a snapshot containing an individual's name.

create table public.refresh_packs (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  -- UK company number, overseas entity number or LEI.
  subject text not null check (length(btrim(subject)) > 0),
  subject_name text not null check (length(btrim(subject_name)) > 0),
  policy jsonb not null check (jsonb_typeof(policy) = 'object'),
  snapshot jsonb not null check (
    jsonb_typeof(snapshot) = 'object'
    and snapshot ? 'version'
    and octet_length(snapshot::text) <= 8 * 1024 * 1024
    -- No personal-data keys anywhere in the snapshot.
    and snapshot::text !~* '"(date_of_birth|dateofbirth|dob|nationality|country_of_residence|countryofresidence|occupation)"\s*:'
  ),
  -- SHA-256 of the snapshot's canonical JSON (sorted keys, no whitespace), computed by the app.
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text
);

comment on table public.refresh_packs is
  'Saved, unchangeable refresh packs. snapshot, snapshot_sha256, policy and subject never change after insert.';

create index refresh_packs_firm_created_idx on public.refresh_packs (firm_id, created_at desc);

-- Rows are read by firm members (read_only included) and written only by the RPCs below.
alter table public.refresh_packs enable row level security;

create policy "firm members can read refresh packs"
  on public.refresh_packs for select
  to authenticated
  using (
    firm_id in (
      select firm_id from public.firm_members
      where user_id = auth.uid() and status = 'active'
    )
  );

revoke all on table public.refresh_packs from anon, authenticated;
grant select on table public.refresh_packs to authenticated;

-- ─── Immutability and status moves ───────────────────────────────────────────

create or replace function public.refresh_packs_guard()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
    or new.firm_id is distinct from old.firm_id
    or new.subject is distinct from old.subject
    or new.subject_name is distinct from old.subject_name
    or new.policy is distinct from old.policy
    or new.snapshot is distinct from old.snapshot
    or new.snapshot_sha256 is distinct from old.snapshot_sha256
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'refresh pack % is immutable: its subject, policy, snapshot and fingerprint cannot change', old.id
      using errcode = '42501';
  end if;

  if old.status in ('approved', 'rejected') then
    raise exception 'refresh pack % has been reviewed and cannot change', old.id
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status
    and not (
      (old.status = 'draft' and new.status = 'submitted')
      or (old.status = 'submitted' and new.status in ('approved', 'rejected'))
    )
  then
    raise exception 'invalid refresh pack status change: % to %', old.status, new.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger refresh_packs_guard
  before update on public.refresh_packs
  for each row execute function public.refresh_packs_guard();

-- ─── create_refresh_pack ─────────────────────────────────────────────────────

create or replace function public.create_refresh_pack(
  p_firm_id uuid,
  p_subject text,
  p_subject_name text,
  p_policy jsonb,
  p_snapshot jsonb,
  p_snapshot_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_pack_id uuid := gen_random_uuid();
begin
  if v_user_id is null then
    raise exception 'create_refresh_pack requires an authenticated user';
  end if;

  perform public.require_role(p_firm_id, array['admin', 'member']);

  if nullif(btrim(p_subject), '') is null or nullif(btrim(p_subject_name), '') is null then
    raise exception 'a refresh pack needs a subject and a subject name';
  end if;

  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'the snapshot must be a JSON object';
  end if;

  -- What is stored beside the snapshot must agree with the snapshot itself.
  if p_snapshot #>> '{subject,id}' is distinct from p_subject then
    raise exception 'the subject does not match the snapshot';
  end if;

  if p_policy is distinct from p_snapshot -> 'policy' then
    raise exception 'the policy does not match the snapshot';
  end if;

  insert into public.refresh_packs (
    id, firm_id, subject, subject_name, policy, snapshot, snapshot_sha256, status, created_by
  )
  values (
    v_pack_id, p_firm_id, btrim(p_subject), btrim(p_subject_name), p_policy, p_snapshot, p_snapshot_sha256, 'draft', v_user_id
  );

  insert into public.audit_events (
    firm_id, actor_user_id, event_type, entity_type, entity_id, payload
  )
  values (
    p_firm_id,
    v_user_id,
    'refresh_pack.created',
    'refresh_pack',
    v_pack_id,
    jsonb_build_object(
      'pack_id', v_pack_id,
      'subject', btrim(p_subject),
      'subject_name', btrim(p_subject_name),
      'snapshot_sha256', p_snapshot_sha256
    )
  );

  return v_pack_id;
end;
$$;

-- ─── submit_refresh_pack ─────────────────────────────────────────────────────

create or replace function public.submit_refresh_pack(p_pack_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_pack public.refresh_packs%rowtype;
begin
  if v_user_id is null then
    raise exception 'submit_refresh_pack requires an authenticated user';
  end if;

  select * into v_pack
  from public.refresh_packs
  where id = p_pack_id
  for update;

  if not found then
    raise exception 'refresh pack not found';
  end if;

  perform public.require_role(v_pack.firm_id, array['admin', 'member']);

  if v_pack.created_by <> v_user_id then
    raise exception 'only the person who created a refresh pack can submit it' using errcode = '42501';
  end if;

  if v_pack.status <> 'draft' then
    raise exception 'refresh pack is not a draft (it is %)', v_pack.status;
  end if;

  update public.refresh_packs
  set status = 'submitted', submitted_at = now()
  where id = p_pack_id;

  insert into public.audit_events (
    firm_id, actor_user_id, event_type, entity_type, entity_id, payload
  )
  values (
    v_pack.firm_id,
    v_user_id,
    'refresh_pack.submitted',
    'refresh_pack',
    p_pack_id,
    jsonb_build_object('pack_id', p_pack_id, 'subject', v_pack.subject, 'snapshot_sha256', v_pack.snapshot_sha256)
  );

  return p_pack_id;
end;
$$;

-- ─── approve / reject ────────────────────────────────────────────────────────

-- The shared review logic. Not callable by clients: the two RPCs below call it.
create or replace function public.review_refresh_pack_internal(
  p_pack_id uuid,
  p_decision text,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_pack public.refresh_packs%rowtype;
  v_four_eyes boolean;
begin
  if v_user_id is null then
    raise exception 'reviewing a refresh pack requires an authenticated user';
  end if;

  select * into v_pack
  from public.refresh_packs
  where id = p_pack_id
  for update;

  if not found then
    raise exception 'refresh pack not found';
  end if;

  -- Admin is the reviewer.
  perform public.require_role(v_pack.firm_id, array['admin']);

  if v_pack.status in ('approved', 'rejected') then
    raise exception 'refresh pack has already been reviewed (it is %)', v_pack.status;
  end if;

  if v_pack.status <> 'submitted' then
    raise exception 'refresh pack has not been submitted for approval';
  end if;

  select four_eyes into v_four_eyes
  from public.firms
  where id = v_pack.firm_id;

  if p_decision = 'approved' and v_four_eyes and v_pack.created_by = v_user_id then
    raise exception 'Four-eyes rule: the person who created this pack cannot approve it'
      using errcode = '42501';
  end if;

  if p_decision = 'rejected' and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'a note is required to reject a refresh pack';
  end if;

  update public.refresh_packs
  set
    status = p_decision,
    reviewed_by = v_user_id,
    reviewed_at = now(),
    review_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_pack_id;

  insert into public.audit_events (
    firm_id, actor_user_id, event_type, entity_type, entity_id, payload
  )
  values (
    v_pack.firm_id,
    v_user_id,
    'refresh_pack.' || p_decision,
    'refresh_pack',
    p_pack_id,
    jsonb_build_object(
      'pack_id', p_pack_id,
      'subject', v_pack.subject,
      'snapshot_sha256', v_pack.snapshot_sha256,
      'decision', p_decision,
      'note', nullif(btrim(coalesce(p_note, '')), ''),
      'four_eyes', v_four_eyes,
      'created_by', v_pack.created_by
    )
  );

  return p_pack_id;
end;
$$;

create or replace function public.approve_refresh_pack(p_pack_id uuid, p_note text default null)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select public.review_refresh_pack_internal(p_pack_id, 'approved', p_note);
$$;

create or replace function public.reject_refresh_pack(p_pack_id uuid, p_note text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select public.review_refresh_pack_internal(p_pack_id, 'rejected', p_note);
$$;

-- ─── Privileges ──────────────────────────────────────────────────────────────

revoke all on function public.refresh_packs_guard() from public;
revoke all on function public.review_refresh_pack_internal(uuid, text, text) from public;
revoke all on function public.create_refresh_pack(uuid, text, text, jsonb, jsonb, text) from public;
revoke all on function public.submit_refresh_pack(uuid) from public;
revoke all on function public.approve_refresh_pack(uuid, text) from public;
revoke all on function public.reject_refresh_pack(uuid, text) from public;

grant execute on function public.create_refresh_pack(uuid, text, text, jsonb, jsonb, text) to authenticated;
grant execute on function public.submit_refresh_pack(uuid) to authenticated;
grant execute on function public.approve_refresh_pack(uuid, text) to authenticated;
grant execute on function public.reject_refresh_pack(uuid, text) to authenticated;
