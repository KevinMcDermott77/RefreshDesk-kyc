-- Slice 6 refresh pack tests: roles, four-eyes, immutability and row-level security.
--
-- Needs supabase/tests/helpers.sql run first, in the same transaction, and the Slice 0b and Slice 6
-- migrations applied (or applied earlier in the same transaction). This file has no BEGIN, COMMIT or
-- ROLLBACK.
--
-- Try it before applying anything:
--
--   DRYRUN_DB_URL=... node scripts/run-dryrun.cjs \
--     --migration supabase/migrations/20261014000000_slice0b_permissions.sql \
--     --migration supabase/migrations/20261015000000_slice6_refresh_packs.sql \
--     --tests supabase/tests/helpers.sql --tests supabase/tests/refresh_packs.test.sql

select _dryrun.reset_ids();

-- The statement runs as the connecting role (so triggers, not row security, are what is tested)
-- and must fail with a message matching p_pattern (ILIKE).
create function _dryrun.expect_direct_error(p_sql text, p_pattern text, p_name text)
returns void language plpgsql as $$
declare
  v_err text;
begin
  begin
    execute p_sql;
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'FAIL: %: expected an error like "%" but the statement succeeded', p_name, p_pattern;
  end if;
  if v_err not ilike p_pattern then
    raise exception 'FAIL: %: expected an error like "%" but got "%"', p_name, p_pattern, v_err;
  end if;
  perform _dryrun.pass(p_name);
end;
$$;

-- Creates a pack as p_user and remembers its id under p_key.
create function _dryrun.make_pack(p_user text, p_key text) returns void language plpgsql as $$
declare
  v_val text;
begin
  v_val := _dryrun.expect_ok(
    _dryrun.id(p_user),
    format(
      'select public.create_refresh_pack(%L, ''03261722'', ''ACME LTD'', %L::jsonb, %L::jsonb, %L)::text',
      _dryrun.id('firm'),
      '{"threshold": 25, "maxDepth": 6, "indirectMethod": "either", "acceptRegulatedAsTerminal": true}',
      '{"version": 1, "subject": {"id": "03261722", "kind": "company", "name": "ACME LTD"}, "policy": {"threshold": 25, "maxDepth": 6, "indirectMethod": "either", "acceptRegulatedAsTerminal": true}, "profile": [], "sourceLog": []}',
      repeat('a', 64)
    ),
    p_key || ': ' || p_user || ' can create a refresh pack'
  );
  insert into _dryrun.t_ids values (p_key, v_val::uuid);
end;
$$;

-- ─── Fixtures (as the connecting role; none of this is real data) ─────────────

insert into _dryrun.t_ids select n, gen_random_uuid() from unnest(array[
  'admin_a', 'admin_b', 'member', 'member_two', 'read_only', 'outsider', 'firm', 'other_firm'
]) as n;

insert into auth.users (id, email)
select id, name || '@refresh-packs.test' from _dryrun.t_ids
where name in ('admin_a', 'admin_b', 'member', 'member_two', 'read_only', 'outsider');

insert into public.firms (id, name, slug)
values
  (_dryrun.id('firm'), 'Pack Test Firm', 'pack-test-' || substr(gen_random_uuid()::text, 1, 8)),
  (_dryrun.id('other_firm'), 'Other Pack Firm', 'pack-other-' || substr(gen_random_uuid()::text, 1, 8));

insert into public.firm_members (firm_id, user_id, full_name, role)
values
  (_dryrun.id('firm'), _dryrun.id('admin_a'), 'Admin A (creator-admin)', 'admin'),
  (_dryrun.id('firm'), _dryrun.id('admin_b'), 'Admin B (second admin)', 'admin'),
  (_dryrun.id('firm'), _dryrun.id('member'), 'Plain Member', 'member'),
  (_dryrun.id('firm'), _dryrun.id('member_two'), 'Second Member', 'member'),
  (_dryrun.id('firm'), _dryrun.id('read_only'), 'Read Only', 'read_only'),
  (_dryrun.id('other_firm'), _dryrun.id('outsider'), 'Outsider', 'admin');

-- ─── Creating a pack ──────────────────────────────────────────────────────────

select _dryrun.expect_error(
  _dryrun.id('read_only'),
  format('select public.create_refresh_pack(%L, ''x'', ''X'', ''{}''::jsonb, ''{}''::jsonb, %L)::text', _dryrun.id('firm'), repeat('a', 64)),
  'permission denied%',
  'read_only cannot create a refresh pack'
);
select _dryrun.expect_error(
  _dryrun.id('outsider'),
  format('select public.create_refresh_pack(%L, ''x'', ''X'', ''{}''::jsonb, ''{}''::jsonb, %L)::text', _dryrun.id('firm'), repeat('a', 64)),
  '%not an active member%',
  'a member of another firm cannot create a pack in this firm'
);
select _dryrun.expect_error(
  null,
  format('select public.create_refresh_pack(%L, ''x'', ''X'', ''{}''::jsonb, ''{}''::jsonb, %L)::text', _dryrun.id('firm'), repeat('a', 64)),
  '%authenticated user%',
  'a signed-out caller cannot create a pack'
);

select _dryrun.make_pack('member', 'pack_member');
select _dryrun.expect_true(
  (select status = 'draft' and created_by = _dryrun.id('member') and firm_id = _dryrun.id('firm')
          and subject = '03261722' and snapshot_sha256 = repeat('a', 64) and submitted_at is null and reviewed_by is null
   from public.refresh_packs where id = _dryrun.id('pack_member')),
  'a new pack is a draft owned by its creator, with the fingerprint stored'
);
select _dryrun.make_pack('admin_a', 'pack_admin');

select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.create_refresh_pack(%L, ''03261722'', ''ACME LTD'', ''{"threshold": 10}''::jsonb, ''{"version": 1, "subject": {"id": "03261722"}, "policy": {}}''::jsonb, %L)::text', _dryrun.id('firm'), repeat('a', 64)),
  '%policy does not match%',
  'the stored policy must match the snapshot''s policy'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.create_refresh_pack(%L, ''99999999'', ''ACME LTD'', ''{}''::jsonb, ''{"version": 1, "subject": {"id": "03261722"}, "policy": {}}''::jsonb, %L)::text', _dryrun.id('firm'), repeat('a', 64)),
  '%subject does not match%',
  'the stored subject must match the snapshot''s subject'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.create_refresh_pack(%L, ''03261722'', ''ACME LTD'', ''{}''::jsonb, ''{"version": 1, "subject": {"id": "03261722"}, "policy": {}}''::jsonb, %L)::text', _dryrun.id('firm'), 'not-a-sha'),
  '%check constraint%',
  'the fingerprint must be 64 hex characters'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.create_refresh_pack(%L, ''03261722'', ''ACME LTD'', ''{}''::jsonb, ''[1, 2]''::jsonb, %L)::text', _dryrun.id('firm'), repeat('a', 64)),
  '%snapshot must be a JSON object%',
  'the snapshot must be a JSON object'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format(
    'select public.create_refresh_pack(%L, ''03261722'', ''ACME LTD'', ''{}''::jsonb, ''{"version": 1, "subject": {"id": "03261722"}, "policy": {}, "owner": {"date_of_birth": "1970-01-01"}}''::jsonb, %L)::text',
    _dryrun.id('firm'), repeat('a', 64)
  ),
  '%check constraint%',
  'a snapshot with a date of birth is refused'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format(
    'select public.create_refresh_pack(%L, ''03261722'', ''ACME LTD'', ''{}''::jsonb, ''{"version": 1, "subject": {"id": "03261722"}, "policy": {}, "x": [{"nationality": "British"}]}''::jsonb, %L)::text',
    _dryrun.id('firm'), repeat('a', 64)
  ),
  '%check constraint%',
  'a snapshot with a nationality, however deeply nested, is refused'
);
select _dryrun.expect_true(
  (select count(*) = 1 from public.audit_events
   where event_type = 'refresh_pack.created' and (payload ->> 'pack_id')::uuid = _dryrun.id('pack_member')
     and payload ->> 'snapshot_sha256' = repeat('a', 64)),
  'creating a pack writes an audit event with the fingerprint'
);

-- ─── Row-level security ───────────────────────────────────────────────────────

select _dryrun.expect_true(
  _dryrun.expect_ok(_dryrun.id('member'), format('select count(*)::text from public.refresh_packs where id = %L', _dryrun.id('pack_member')), 'a member can read a pack of their firm') = '1',
  'the member sees the pack'
);
select _dryrun.expect_true(
  _dryrun.expect_ok(_dryrun.id('read_only'), format('select count(*)::text from public.refresh_packs where id = %L', _dryrun.id('pack_member')), 'read_only can read a pack of their firm') = '1',
  'read_only sees the pack (read only)'
);
select _dryrun.expect_true(
  _dryrun.expect_ok(_dryrun.id('outsider'), format('select count(*)::text from public.refresh_packs where id = %L', _dryrun.id('pack_member')), 'a member of another firm can query packs') = '0',
  'a member of another firm does not see the pack'
);
select _dryrun.expect_error(
  _dryrun.id('admin_a'),
  format('update public.refresh_packs set review_note = ''x'' where id = %L', _dryrun.id('pack_member')),
  '%permission denied%',
  'even an admin cannot update a pack directly'
);
select _dryrun.expect_error(
  _dryrun.id('admin_a'),
  format('delete from public.refresh_packs where id = %L', _dryrun.id('pack_member')),
  '%permission denied%',
  'even an admin cannot delete a pack'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('insert into public.refresh_packs (firm_id, subject, subject_name, policy, snapshot, snapshot_sha256, created_by) values (%L, ''x'', ''X'', ''{}'', ''{"version": 1}'', %L, %L)', _dryrun.id('firm'), repeat('b', 64), _dryrun.id('member')),
  '%permission denied%',
  'a pack cannot be inserted directly, only through create_refresh_pack'
);

-- ─── Immutability (the trigger, even for the connecting role) ─────────────────

select _dryrun.expect_direct_error(
  format('update public.refresh_packs set snapshot = ''{"version": 1, "tampered": true}'' where id = %L', _dryrun.id('pack_member')),
  '%immutable%',
  'the snapshot cannot be changed'
);
select _dryrun.expect_direct_error(
  format('update public.refresh_packs set snapshot_sha256 = %L where id = %L', repeat('c', 64), _dryrun.id('pack_member')),
  '%immutable%',
  'the fingerprint cannot be changed'
);
select _dryrun.expect_direct_error(
  format('update public.refresh_packs set policy = ''{"threshold": 10}'' where id = %L', _dryrun.id('pack_member')),
  '%immutable%',
  'the policy cannot be changed'
);
select _dryrun.expect_direct_error(
  format('update public.refresh_packs set subject = ''00000000'' where id = %L', _dryrun.id('pack_member')),
  '%immutable%',
  'the subject cannot be changed'
);
select _dryrun.expect_direct_error(
  format('update public.refresh_packs set subject_name = ''Other'' where id = %L', _dryrun.id('pack_member')),
  '%immutable%',
  'the subject name cannot be changed'
);
select _dryrun.expect_direct_error(
  format('update public.refresh_packs set firm_id = %L where id = %L', _dryrun.id('other_firm'), _dryrun.id('pack_member')),
  '%immutable%',
  'the firm cannot be changed'
);
select _dryrun.expect_direct_error(
  format('update public.refresh_packs set created_by = %L where id = %L', _dryrun.id('admin_b'), _dryrun.id('pack_member')),
  '%immutable%',
  'the creator cannot be changed'
);
select _dryrun.expect_direct_error(
  format('update public.refresh_packs set created_at = now() - interval ''1 day'' where id = %L', _dryrun.id('pack_member')),
  '%immutable%',
  'the creation time cannot be changed'
);
select _dryrun.expect_direct_error(
  format('update public.refresh_packs set status = ''approved'' where id = %L', _dryrun.id('pack_member')),
  '%invalid refresh pack status change%',
  'a draft cannot jump to approved'
);
select _dryrun.expect_true(
  (select snapshot_sha256 = repeat('a', 64) and snapshot ->> 'version' = '1' and snapshot ? 'sourceLog' and status = 'draft'
   from public.refresh_packs where id = _dryrun.id('pack_member')),
  'after all those attempts the pack is unchanged'
);

-- ─── Submitting ───────────────────────────────────────────────────────────────

select _dryrun.expect_error(
  _dryrun.id('read_only'),
  format('select public.submit_refresh_pack(%L)::text', _dryrun.id('pack_member')),
  'permission denied%',
  'read_only cannot submit a pack'
);
select _dryrun.expect_error(
  _dryrun.id('member_two'),
  format('select public.submit_refresh_pack(%L)::text', _dryrun.id('pack_member')),
  '%only the person who created%',
  'a colleague cannot submit someone else''s pack'
);
select _dryrun.expect_error(
  _dryrun.id('admin_b'),
  format('select public.submit_refresh_pack(%L)::text', _dryrun.id('pack_member')),
  '%only the person who created%',
  'not even another admin can submit someone else''s pack'
);

-- Approving a draft is refused.
select _dryrun.expect_error(
  _dryrun.id('admin_b'),
  format('select public.approve_refresh_pack(%L)::text', _dryrun.id('pack_member')),
  '%has not been submitted%',
  'a draft cannot be approved'
);

select _dryrun.expect_ok(
  _dryrun.id('member'),
  format('select public.submit_refresh_pack(%L)::text', _dryrun.id('pack_member')),
  'the creator can submit their draft'
);
select _dryrun.expect_true(
  (select status = 'submitted' and submitted_at is not null from public.refresh_packs where id = _dryrun.id('pack_member')),
  'the pack is submitted, with the time recorded'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.submit_refresh_pack(%L)::text', _dryrun.id('pack_member')),
  '%not a draft%',
  'a submitted pack cannot be submitted again'
);

-- ─── Reviewing ────────────────────────────────────────────────────────────────

select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.approve_refresh_pack(%L)::text', _dryrun.id('pack_member')),
  'permission denied%',
  'a member (even the creator) cannot approve'
);
select _dryrun.expect_error(
  _dryrun.id('member_two'),
  format('select public.reject_refresh_pack(%L, ''no'')::text', _dryrun.id('pack_member')),
  'permission denied%',
  'a member cannot reject'
);
select _dryrun.expect_error(
  _dryrun.id('read_only'),
  format('select public.approve_refresh_pack(%L)::text', _dryrun.id('pack_member')),
  'permission denied%',
  'read_only cannot approve'
);
select _dryrun.expect_error(
  _dryrun.id('outsider'),
  format('select public.approve_refresh_pack(%L)::text', _dryrun.id('pack_member')),
  '%not an active member%',
  'an admin of another firm cannot approve'
);
select _dryrun.expect_error(
  _dryrun.id('admin_b'),
  format('select public.reject_refresh_pack(%L, ''   '')::text', _dryrun.id('pack_member')),
  '%note is required%',
  'rejecting needs a note'
);

select _dryrun.expect_ok(
  _dryrun.id('admin_b'),
  format('select public.approve_refresh_pack(%L, ''checked the chain'')::text', _dryrun.id('pack_member')),
  'a different admin can approve a member''s submitted pack'
);
select _dryrun.expect_true(
  (select status = 'approved' and reviewed_by = _dryrun.id('admin_b') and reviewed_at is not null and review_note = 'checked the chain'
   from public.refresh_packs where id = _dryrun.id('pack_member')),
  'the approval is recorded against the reviewer, with the note'
);
select _dryrun.expect_true(
  (select (payload ->> 'four_eyes')::boolean and payload ->> 'created_by' = _dryrun.id('member')::text
          and payload ->> 'snapshot_sha256' = repeat('a', 64)
   from public.audit_events
   where event_type = 'refresh_pack.approved' and (payload ->> 'pack_id')::uuid = _dryrun.id('pack_member')),
  'the approval audit event records the fingerprint, four_eyes and the creator'
);
select _dryrun.expect_error(
  _dryrun.id('admin_b'),
  format('select public.approve_refresh_pack(%L)::text', _dryrun.id('pack_member')),
  '%already been reviewed%',
  'an approved pack cannot be approved again'
);
select _dryrun.expect_error(
  _dryrun.id('admin_a'),
  format('select public.reject_refresh_pack(%L, ''changed my mind'')::text', _dryrun.id('pack_member')),
  '%already been reviewed%',
  'an approved pack cannot be rejected afterwards'
);
select _dryrun.expect_direct_error(
  format('update public.refresh_packs set review_note = ''edited later'' where id = %L', _dryrun.id('pack_member')),
  '%has been reviewed and cannot change%',
  'a reviewed pack cannot be edited, even its note'
);

-- Four-eyes: an admin who created a pack cannot approve it, but may reject it.
select _dryrun.expect_ok(
  _dryrun.id('admin_a'),
  format('select public.submit_refresh_pack(%L)::text', _dryrun.id('pack_admin')),
  'an admin can submit their own pack'
);
select _dryrun.expect_error(
  _dryrun.id('admin_a'),
  format('select public.approve_refresh_pack(%L)::text', _dryrun.id('pack_admin')),
  'Four-eyes rule: the person who created this pack cannot approve it',
  'the creator-admin cannot approve their own pack with four_eyes on'
);
select _dryrun.expect_true(
  (select status = 'submitted' and reviewed_by is null from public.refresh_packs where id = _dryrun.id('pack_admin')),
  'the blocked approval left the pack submitted'
);
select _dryrun.expect_ok(
  _dryrun.id('admin_a'),
  format('select public.reject_refresh_pack(%L, ''withdrawn to rerun with a deeper walk'')::text', _dryrun.id('pack_admin')),
  'the creator-admin may reject (withdraw) their own pack'
);
select _dryrun.expect_true(
  (select status = 'rejected' and review_note like 'withdrawn%' from public.refresh_packs where id = _dryrun.id('pack_admin')),
  'the rejection is recorded with its note'
);
select _dryrun.expect_error(
  _dryrun.id('admin_b'),
  format('select public.approve_refresh_pack(%L)::text', _dryrun.id('pack_admin')),
  '%already been reviewed%',
  'a rejected pack cannot be approved'
);

-- Four-eyes off: the creator-admin can approve their own pack.
update public.firms set four_eyes = false where id = _dryrun.id('firm');
select _dryrun.make_pack('admin_a', 'pack_admin_off');
select _dryrun.expect_ok(
  _dryrun.id('admin_a'),
  format('select public.submit_refresh_pack(%L)::text', _dryrun.id('pack_admin_off')),
  'the creator-admin submits a pack (four_eyes off)'
);
select _dryrun.expect_ok(
  _dryrun.id('admin_a'),
  format('select public.approve_refresh_pack(%L)::text', _dryrun.id('pack_admin_off')),
  'the creator-admin may approve their own pack with four_eyes off'
);
update public.firms set four_eyes = true where id = _dryrun.id('firm');

-- Rejection by a different admin.
select _dryrun.make_pack('member_two', 'pack_two');
select _dryrun.expect_ok(
  _dryrun.id('member_two'),
  format('select public.submit_refresh_pack(%L)::text', _dryrun.id('pack_two')),
  'a second member submits their pack'
);
select _dryrun.expect_ok(
  _dryrun.id('admin_b'),
  format('select public.reject_refresh_pack(%L, ''policy depth too low'')::text', _dryrun.id('pack_two')),
  'an admin can reject a submitted pack with a note'
);
select _dryrun.expect_true(
  (select status = 'rejected' and reviewed_by = _dryrun.id('admin_b') and review_note = 'policy depth too low'
   from public.refresh_packs where id = _dryrun.id('pack_two')),
  'the rejection is recorded against the reviewer'
);

-- ─── Audit trail ──────────────────────────────────────────────────────────────

select _dryrun.expect_true(
  (select count(*) filter (where event_type = 'refresh_pack.created') = 4
      and count(*) filter (where event_type = 'refresh_pack.submitted') = 4
      and count(*) filter (where event_type = 'refresh_pack.approved') = 2
      and count(*) filter (where event_type = 'refresh_pack.rejected') = 2
   from public.audit_events
   where firm_id = _dryrun.id('firm') and event_type like 'refresh_pack.%'),
  'every create, submit, approve and reject wrote an audit event'
);

-- ─── Done ─────────────────────────────────────────────────────────────────────

select _dryrun.finish();
