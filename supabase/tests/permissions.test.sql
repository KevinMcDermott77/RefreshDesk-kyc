-- Slice 0b permission tests.
--
-- Runs against a database that already has the migrations applied (for a dry run before applying
-- anything, use permissions.dryrun.sql, which wraps the migration and these tests in one
-- transaction):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/permissions.test.sql
--
-- Everything happens inside one transaction that is rolled back, so nothing persists and no
-- existing data is read or changed. Users are simulated the way PostgREST does it: the
-- request.jwt.claims setting that auth.uid() reads, plus SET LOCAL ROLE authenticated.
-- Each check prints NOTICE 'PASS: <name>' or raises 'FAIL: <name>: <detail>'.

begin;

-- ===== BEGIN TESTS =====

create temp table t_ids (name text primary key, id uuid not null) on commit drop;
create temp table t_count (n int not null) on commit drop;
insert into t_count values (0);

-- Runs one statement as p_user (null = signed out) with the role the API uses, and returns its
-- error message (null if it succeeded) and first column. The statement text must not read the
-- temp tables: build it with pg_temp.id() before calling.
create function pg_temp.try_as(p_user uuid, p_sql text)
returns table (err text, val text)
language plpgsql
as $$
declare
  v_err text;
  v_val text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform set_config(
    'request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end,
    true
  );
  begin
    execute 'set local role authenticated';
    execute p_sql into v_val;
  exception when others then
    v_err := sqlerrm;
  end;
  execute 'reset role';
  return query select v_err, v_val;
end;
$$;

create function pg_temp.id(p_name text) returns uuid language sql as $$
  select id from t_ids where name = p_name;
$$;

create function pg_temp.pass(p_name text) returns void language plpgsql as $$
begin
  update t_count set n = n + 1;
  raise notice 'PASS: %', p_name;
end;
$$;

-- The call must fail with a message matching p_pattern (ILIKE).
create function pg_temp.expect_error(p_user uuid, p_sql text, p_pattern text, p_name text)
returns void language plpgsql as $$
declare
  v_err text;
begin
  select r.err into v_err from pg_temp.try_as(p_user, p_sql) r;
  if v_err is null then
    raise exception 'FAIL: %: expected an error like "%" but the call succeeded', p_name, p_pattern;
  end if;
  if v_err not ilike p_pattern then
    raise exception 'FAIL: %: expected an error like "%" but got "%"', p_name, p_pattern, v_err;
  end if;
  perform pg_temp.pass(p_name);
end;
$$;

-- The call must succeed; returns its first column.
create function pg_temp.expect_ok(p_user uuid, p_sql text, p_name text)
returns text language plpgsql as $$
declare
  v_err text;
  v_val text;
begin
  select r.err, r.val into v_err, v_val from pg_temp.try_as(p_user, p_sql) r;
  if v_err is not null then
    raise exception 'FAIL: %: unexpected error "%"', p_name, v_err;
  end if;
  perform pg_temp.pass(p_name);
  return v_val;
end;
$$;

create function pg_temp.expect_true(p_condition boolean, p_name text) returns void language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'FAIL: %: the condition was not true', p_name;
  end if;
  perform pg_temp.pass(p_name);
end;
$$;

-- Saves an entity CDD record as p_user and remembers its id under p_key.
create function pg_temp.fetch_record(p_user text, p_key text) returns void language plpgsql as $$
declare
  v_val text;
begin
  v_val := pg_temp.expect_ok(
    pg_temp.id(p_user),
    format(
      'select public.save_entity_cdd(%L, ''00000001'', null, ''{"company_name": "Test Co"}''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''full'')::text',
      pg_temp.id('client_entity')
    ),
    p_key || ': ' || p_user || ' can save_entity_cdd'
  );
  insert into t_ids values (p_key, v_val::uuid);
end;
$$;

-- Saves a filing as p_user (register_document) and remembers its id under p_key.
create function pg_temp.save_filing(p_user text, p_key text) returns void language plpgsql as $$
declare
  v_val text;
begin
  v_val := pg_temp.expect_ok(
    pg_temp.id(p_user),
    format(
      'select public.register_document(%L, ''filing'', %L, ''filing.pdf'', 1000, ''application/pdf'')::text',
      pg_temp.id('client_entity'), 'x/' || p_key || '.pdf'
    ),
    p_key || ': ' || p_user || ' can save a filing'
  );
  insert into t_ids values (p_key, v_val::uuid);
end;
$$;

-- ─── Fixtures (as the connecting role; none of this is real data) ─────────────

insert into t_ids select n, gen_random_uuid() from unnest(array[
  'admin_a', 'admin_b', 'member', 'read_only', 'outsider', 'firm', 'other_firm',
  'client_entity', 'client_edit', 'client_archive', 'doc_inc', 'ext_blocked', 'ext_ok'
]) as n;

insert into auth.users (id, email)
select id, name || '@permissions.test' from t_ids
where name in ('admin_a', 'admin_b', 'member', 'read_only', 'outsider');

insert into public.firms (id, name, slug)
values
  (pg_temp.id('firm'), 'Permissions Test Firm', 'permissions-test-' || substr(gen_random_uuid()::text, 1, 8)),
  (pg_temp.id('other_firm'), 'Other Firm', 'permissions-other-' || substr(gen_random_uuid()::text, 1, 8));

insert into public.firm_members (firm_id, user_id, full_name, role)
values
  (pg_temp.id('firm'), pg_temp.id('admin_a'), 'Admin A (fetcher)', 'admin'),
  (pg_temp.id('firm'), pg_temp.id('admin_b'), 'Admin B (second reviewer)', 'admin'),
  (pg_temp.id('firm'), pg_temp.id('member'), 'Plain Member', 'member'),
  (pg_temp.id('firm'), pg_temp.id('read_only'), 'Read Only', 'read_only'),
  (pg_temp.id('other_firm'), pg_temp.id('outsider'), 'Outsider', 'admin');

insert into public.firm_refresh_rules (firm_id, risk_rating, cadence_months)
values (pg_temp.id('firm'), 'standard', 12);

insert into public.clients (id, firm_id, client_type, display_name, risk_rating)
values
  (pg_temp.id('client_entity'), pg_temp.id('firm'), 'entity', 'Test Entity Ltd', 'standard'),
  (pg_temp.id('client_edit'), pg_temp.id('firm'), 'individual', 'Edit Me', 'standard'),
  (pg_temp.id('client_archive'), pg_temp.id('firm'), 'individual', 'Archive Me', 'standard');

insert into public.client_documents (id, firm_id, client_id, uploaded_by, document_type, storage_path, file_name, file_size_bytes, mime_type, status)
values
  (pg_temp.id('doc_inc'), pg_temp.id('firm'), pg_temp.id('client_entity'), pg_temp.id('member'), 'incorporation', 'x/inc.pdf', 'inc.pdf', 1, 'application/pdf', 'pending_review');

insert into public.document_extractions (id, document_id, firm_id, client_id, model_used, prompt_version)
values
  (pg_temp.id('ext_blocked'), pg_temp.id('doc_inc'), pg_temp.id('firm'), pg_temp.id('client_entity'), 'test-model', 'v0'),
  (pg_temp.id('ext_ok'), pg_temp.id('doc_inc'), pg_temp.id('firm'), pg_temp.id('client_entity'), 'test-model', 'v0');

-- ─── Defaults ─────────────────────────────────────────────────────────────────

select pg_temp.expect_true(
  (select four_eyes from public.firms where id = pg_temp.id('firm')),
  'firms.four_eyes defaults to true'
);

-- ─── require_role ─────────────────────────────────────────────────────────────

select pg_temp.expect_true(
  pg_temp.expect_ok(pg_temp.id('member'), format('select public.require_role(%L, array[''admin'', ''member''])', pg_temp.id('firm')), 'require_role runs for a member') = 'member',
  'require_role returns the caller''s role'
);
select pg_temp.expect_error(
  pg_temp.id('member'),
  format('select public.require_role(%L, array[''admin''])', pg_temp.id('firm')),
  'permission denied%',
  'require_role rejects a role that is not listed'
);
select pg_temp.expect_error(
  pg_temp.id('member'),
  format('select public.require_role(%L, array[''admin'', ''member''])', pg_temp.id('other_firm')),
  '%not an active member%',
  'require_role rejects a member of a different firm'
);
select pg_temp.expect_error(
  null,
  format('select public.require_role(%L, array[''admin''])', pg_temp.id('firm')),
  '%authentication required%',
  'require_role rejects a signed-out caller'
);

-- ─── save_entity_cdd ──────────────────────────────────────────────────────────

select pg_temp.expect_error(
  pg_temp.id('read_only'),
  format('select public.save_entity_cdd(%L, ''00000001'', null, ''{}''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''full'')', pg_temp.id('client_entity')),
  'permission denied%',
  'read_only is blocked from save_entity_cdd'
);
select pg_temp.expect_error(
  pg_temp.id('outsider'),
  format('select public.save_entity_cdd(%L, ''00000001'', null, ''{}''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''full'')', pg_temp.id('client_entity')),
  '%not an active member%',
  'a member of another firm is blocked from save_entity_cdd'
);
select pg_temp.expect_error(
  null,
  format('select public.save_entity_cdd(%L, ''00000001'', null, ''{}''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''full'')', pg_temp.id('client_entity')),
  '%authenticated user%',
  'a signed-out caller is blocked from save_entity_cdd'
);

select pg_temp.fetch_record('member', 'rec_member');
select pg_temp.expect_true(
  (select fetched_by from public.entity_cdd_records where id = pg_temp.id('rec_member')) = pg_temp.id('member'),
  'save_entity_cdd sets fetched_by to the member who fetched'
);
select pg_temp.fetch_record('admin_a', 'rec_a');
select pg_temp.expect_true(
  (select fetched_by from public.entity_cdd_records where id = pg_temp.id('rec_a')) = pg_temp.id('admin_a'),
  'save_entity_cdd sets fetched_by to the admin who fetched'
);

-- ─── review_entity_cdd ────────────────────────────────────────────────────────

select pg_temp.expect_error(
  pg_temp.id('read_only'),
  format('select public.review_entity_cdd(%L, ''approved'')', pg_temp.id('rec_a')),
  'permission denied%',
  'read_only is blocked from approving an entity CDD record'
);
select pg_temp.expect_error(
  pg_temp.id('read_only'),
  format('select public.review_entity_cdd(%L, ''rejected'')', pg_temp.id('rec_a')),
  'permission denied%',
  'read_only is blocked from rejecting an entity CDD record'
);
select pg_temp.expect_error(
  pg_temp.id('member'),
  format('select public.review_entity_cdd(%L, ''approved'')', pg_temp.id('rec_a')),
  'permission denied%',
  'a member is blocked from approving (only admins review)'
);
select pg_temp.expect_error(
  pg_temp.id('outsider'),
  format('select public.review_entity_cdd(%L, ''approved'')', pg_temp.id('rec_a')),
  '%not an active member%',
  'a member of another firm is blocked from approving'
);

-- Four-eyes on (the default): the fetcher cannot approve their own record...
select pg_temp.expect_error(
  pg_temp.id('admin_a'),
  format('select public.review_entity_cdd(%L, ''approved'')', pg_temp.id('rec_a')),
  'Four-eyes rule: the person who fetched this record cannot approve it',
  'the fetcher is blocked from approving their own record with four_eyes on'
);
select pg_temp.expect_true(
  (select status from public.entity_cdd_records where id = pg_temp.id('rec_a')) = 'pending_review',
  'the blocked approval left the record pending_review'
);

-- ...but may reject it.
select pg_temp.fetch_record('admin_a', 'rec_reject');
select pg_temp.expect_ok(
  pg_temp.id('admin_a'),
  format('select public.review_entity_cdd(%L, ''rejected'', ''fetched the wrong company'')::text', pg_temp.id('rec_reject')),
  'the fetcher may reject their own record with four_eyes on'
);

-- A second admin may approve.
select pg_temp.expect_ok(
  pg_temp.id('admin_b'),
  format('select public.review_entity_cdd(%L, ''approved'', ''checked against the register'')::text', pg_temp.id('rec_a')),
  'a second admin may approve with four_eyes on'
);
select pg_temp.expect_true(
  (select status = 'approved' and reviewed_by = pg_temp.id('admin_b') from public.entity_cdd_records where id = pg_temp.id('rec_a')),
  'the approval is recorded against the second admin'
);
select pg_temp.expect_true(
  (select (payload ->> 'four_eyes')::boolean
          and payload ->> 'fetched_by' = pg_temp.id('admin_a')::text
          and payload ->> 'note' is null
   from public.audit_events
   where event_type = 'entity_cdd.approved' and (payload ->> 'record_id')::uuid = pg_temp.id('rec_a')),
  'the approval audit event records four_eyes and fetched_by, with no note'
);

-- Four-eyes off: the fetcher may approve.
update public.firms set four_eyes = false where id = pg_temp.id('firm');
select pg_temp.fetch_record('admin_a', 'rec_off');
select pg_temp.expect_ok(
  pg_temp.id('admin_a'),
  format('select public.review_entity_cdd(%L, ''approved'')::text', pg_temp.id('rec_off')),
  'the fetcher may approve their own record with four_eyes off'
);
update public.firms set four_eyes = true where id = pg_temp.id('firm');

-- Records from before fetched_by existed: allowed, logged with a note.
select pg_temp.fetch_record('admin_a', 'rec_old');
update public.entity_cdd_records set fetched_by = null where id = pg_temp.id('rec_old');
select pg_temp.expect_ok(
  pg_temp.id('admin_a'),
  format('select public.review_entity_cdd(%L, ''approved'')::text', pg_temp.id('rec_old')),
  'an approval is allowed when fetched_by is null'
);
select pg_temp.expect_true(
  (select payload ->> 'note' like 'Four-eyes could not be checked%'
   from public.audit_events
   where event_type = 'entity_cdd.approved' and (payload ->> 'record_id')::uuid = pg_temp.id('rec_old')),
  'that approval is logged with a note that four-eyes could not be checked'
);

-- ─── review_extraction and approve_filing_document: admin only ────────────────

select pg_temp.expect_error(
  pg_temp.id('read_only'),
  format('select public.review_extraction(%L, ''approved'')::text', pg_temp.id('ext_blocked')),
  'permission denied%',
  'read_only is blocked from review_extraction'
);
select pg_temp.expect_error(
  pg_temp.id('member'),
  format('select public.review_extraction(%L, ''approved'')::text', pg_temp.id('ext_blocked')),
  'permission denied%',
  'a member is blocked from review_extraction'
);
select pg_temp.expect_ok(
  pg_temp.id('admin_a'),
  format('select public.review_extraction(%L, ''approved'')::text', pg_temp.id('ext_ok')),
  'an admin may review_extraction'
);

-- ─── Saving and approving filings (maker-checker) ─────────────────────────────

select pg_temp.expect_error(
  pg_temp.id('read_only'),
  format('select public.register_document(%L, ''filing'', ''x/ro.pdf'', ''ro.pdf'', 1000, ''application/pdf'')::text', pg_temp.id('client_entity')),
  'permission denied%',
  'read_only cannot save a filing'
);

-- A member can save a filing, and it waits as 'pending'.
select pg_temp.save_filing('member', 'fil_member');
select pg_temp.expect_true(
  (select status = 'pending' and uploaded_by = pg_temp.id('member') and document_type = 'filing'
   from public.client_documents where id = pg_temp.id('fil_member')),
  'a filing saved by a member is pending, with the member recorded as who saved it'
);

select pg_temp.expect_error(
  pg_temp.id('member'),
  format('select public.approve_filing_document(%L)::text', pg_temp.id('fil_member')),
  'permission denied%',
  'a member cannot approve a filing, even one they saved'
);
select pg_temp.expect_error(
  pg_temp.id('read_only'),
  format('select public.approve_filing_document(%L)::text', pg_temp.id('fil_member')),
  'permission denied%',
  'read_only cannot approve a filing'
);

-- An admin can approve a filing a member saved.
select pg_temp.expect_ok(
  pg_temp.id('admin_a'),
  format('select public.approve_filing_document(%L)::text', pg_temp.id('fil_member')),
  'an admin may approve a filing saved by a member'
);
select pg_temp.expect_true(
  (select status from public.client_documents where id = pg_temp.id('fil_member')) = 'approved',
  'the approved filing is now approved'
);
select pg_temp.expect_error(
  pg_temp.id('admin_a'),
  format('select public.approve_filing_document(%L)::text', pg_temp.id('fil_member')),
  '%already been approved%',
  'a filing cannot be approved twice'
);

-- Four-eyes on: an admin cannot approve the filing they saved themselves.
select pg_temp.save_filing('admin_a', 'fil_admin');
select pg_temp.expect_error(
  pg_temp.id('admin_a'),
  format('select public.approve_filing_document(%L)::text', pg_temp.id('fil_admin')),
  'Four-eyes rule: the person who saved this filing cannot approve it',
  'an admin cannot approve their own filing with four_eyes on'
);
select pg_temp.expect_true(
  (select status from public.client_documents where id = pg_temp.id('fil_admin')) = 'pending',
  'the blocked approval left the filing pending'
);

-- A different admin can.
select pg_temp.expect_ok(
  pg_temp.id('admin_b'),
  format('select public.approve_filing_document(%L)::text', pg_temp.id('fil_admin')),
  'a different admin may approve it'
);
select pg_temp.expect_true(
  (select (payload ->> 'four_eyes')::boolean and payload ->> 'saved_by' = pg_temp.id('admin_a')::text
   from public.audit_events
   where event_type = 'filing.saved' and (payload ->> 'document_id')::uuid = pg_temp.id('fil_admin')),
  'the approval audit event records who saved the filing and that four_eyes was on'
);

-- Four-eyes off: an admin can approve their own.
update public.firms set four_eyes = false where id = pg_temp.id('firm');
select pg_temp.save_filing('admin_a', 'fil_admin_off');
select pg_temp.expect_ok(
  pg_temp.id('admin_a'),
  format('select public.approve_filing_document(%L)::text', pg_temp.id('fil_admin_off')),
  'an admin may approve their own filing with four_eyes off'
);
update public.firms set four_eyes = true where id = pg_temp.id('firm');

-- Other documents are unaffected: they are still registered as 'uploaded'.
do $$
declare
  v_val text;
begin
  v_val := pg_temp.expect_ok(
    pg_temp.id('member'),
    format('select public.register_document(%L, ''passport'', ''x/p.pdf'', ''p.pdf'', 1000, ''application/pdf'')::text', pg_temp.id('client_entity')),
    'a member can register an ordinary document'
  );
  insert into t_ids values ('doc_passport', v_val::uuid);
end;
$$;
select pg_temp.expect_true(
  (select status from public.client_documents where id = pg_temp.id('doc_passport')) = 'uploaded',
  'ordinary documents still start as uploaded'
);

-- ─── Other write RPCs ─────────────────────────────────────────────────────────

select pg_temp.expect_error(
  pg_temp.id('read_only'),
  format('select public.create_client(%L, ''individual'', ''Nobody'', ''standard'', ''{}''::jsonb)::text', pg_temp.id('firm')),
  'permission denied%',
  'read_only is blocked from create_client'
);
select pg_temp.expect_error(
  pg_temp.id('read_only'),
  format('select public.import_clients(%L, ''[]''::jsonb)::text', pg_temp.id('firm')),
  'permission denied%',
  'read_only is blocked from import_clients'
);
select pg_temp.expect_ok(
  pg_temp.id('member'),
  format('select public.create_client(%L, ''individual'', ''Allowed Person'', ''standard'', ''{}''::jsonb)::text', pg_temp.id('firm')),
  'a member may create_client'
);

-- ─── update_client and archive_client (the analyst-role bug) ──────────────────

select pg_temp.expect_error(
  pg_temp.id('read_only'),
  format('select public.update_client(%L, ''{"display_name": "Nope"}''::jsonb)::text', pg_temp.id('client_edit')),
  'user cannot update clients in this firm',
  'read_only is blocked from update_client'
);
select pg_temp.expect_error(
  pg_temp.id('outsider'),
  format('select public.update_client(%L, ''{"display_name": "Nope"}''::jsonb)::text', pg_temp.id('client_edit')),
  'user cannot update clients in this firm',
  'a member of another firm is blocked from update_client'
);
select pg_temp.expect_ok(
  pg_temp.id('member'),
  format('select public.update_client(%L, ''{"display_name": "Renamed by member"}''::jsonb)::text', pg_temp.id('client_edit')),
  'a member may update_client'
);
select pg_temp.expect_ok(
  pg_temp.id('admin_a'),
  format('select public.update_client(%L, ''{"display_name": "Renamed by admin"}''::jsonb)::text', pg_temp.id('client_edit')),
  'an admin may update_client'
);
select pg_temp.expect_true(
  (select display_name from public.clients where id = pg_temp.id('client_edit')) = 'Renamed by admin',
  'the update_client changes were saved'
);

select pg_temp.expect_error(
  pg_temp.id('read_only'),
  format('select public.archive_client(%L)::text', pg_temp.id('client_archive')),
  'user cannot archive clients in this firm',
  'read_only is blocked from archive_client'
);
select pg_temp.expect_ok(
  pg_temp.id('member'),
  format('select public.archive_client(%L)::text', pg_temp.id('client_archive')),
  'a member may archive_client'
);
select pg_temp.expect_true(
  (select status from public.clients where id = pg_temp.id('client_archive')) = 'archived',
  'the archive_client change was saved'
);

-- ─── Backfill ─────────────────────────────────────────────────────────────────

-- The migration's backfill statement, run on a record whose fetcher is in the audit trail.
insert into t_ids values ('rec_backfill', gen_random_uuid());
insert into public.entity_cdd_records (id, firm_id, client_id, company_number, status)
values (pg_temp.id('rec_backfill'), pg_temp.id('firm'), pg_temp.id('client_entity'), '00000002', 'pending_review');
insert into public.audit_events (firm_id, actor_user_id, event_type, entity_type, entity_id, payload)
values (
  pg_temp.id('firm'), pg_temp.id('member'), 'entity_cdd.fetched', 'client', pg_temp.id('client_entity'),
  jsonb_build_object('record_id', pg_temp.id('rec_backfill'))
);
update public.entity_cdd_records r
set fetched_by = e.actor_user_id
from public.audit_events e
where r.fetched_by is null
  and e.event_type = 'entity_cdd.fetched'
  and e.payload ->> 'record_id' = r.id::text
  and e.actor_user_id is not null;
select pg_temp.expect_true(
  (select fetched_by from public.entity_cdd_records where id = pg_temp.id('rec_backfill')) = pg_temp.id('member'),
  'the backfill takes fetched_by from the entity_cdd.fetched audit event'
);

-- ─── Done ─────────────────────────────────────────────────────────────────────

do $$
declare
  v_checks int;
begin
  select n into v_checks from t_count;
  raise notice 'ALL PERMISSION TESTS PASSED';
  raise notice '% checks ran', v_checks;
end;
$$;

-- ===== END TESTS =====

rollback;
