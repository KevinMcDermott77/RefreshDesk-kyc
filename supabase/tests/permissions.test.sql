-- Slice 0b permission tests.
--
-- Needs supabase/tests/helpers.sql run first, in the same transaction. This file has no BEGIN,
-- COMMIT or ROLLBACK: run both inside a transaction that you roll back.
--
-- To try the migration before applying anything, use scripts/run-dryrun.cjs (see supabase/README.md).
-- Against a database that already has the migration (psql runs -c and -f in order, in one session):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "begin" -f supabase/tests/helpers.sql \
--     -f supabase/tests/permissions.test.sql -c "rollback"
--
-- Nothing persists and no existing data is read or changed.

select _dryrun.reset_ids();

-- Saves an entity CDD record as p_user and remembers its id under p_key.
create function _dryrun.fetch_record(p_user text, p_key text) returns void language plpgsql as $$
declare
  v_val text;
begin
  v_val := _dryrun.expect_ok(
    _dryrun.id(p_user),
    format(
      'select public.save_entity_cdd(%L, ''00000001'', null, ''{"company_name": "Test Co"}''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''full'')::text',
      _dryrun.id('client_entity')
    ),
    p_key || ': ' || p_user || ' can save_entity_cdd'
  );
  insert into _dryrun.t_ids values (p_key, v_val::uuid);
end;
$$;

-- Saves a filing as p_user (register_document) and remembers its id under p_key.
create function _dryrun.save_filing(p_user text, p_key text) returns void language plpgsql as $$
declare
  v_val text;
begin
  v_val := _dryrun.expect_ok(
    _dryrun.id(p_user),
    format(
      'select public.register_document(%L, ''filing'', %L, ''filing.pdf'', 1000, ''application/pdf'')::text',
      _dryrun.id('client_entity'), 'x/' || p_key || '.pdf'
    ),
    p_key || ': ' || p_user || ' can save a filing'
  );
  insert into _dryrun.t_ids values (p_key, v_val::uuid);
end;
$$;

-- ─── Fixtures (as the connecting role; none of this is real data) ─────────────

insert into _dryrun.t_ids select n, gen_random_uuid() from unnest(array[
  'admin_a', 'admin_b', 'member', 'read_only', 'outsider', 'firm', 'other_firm',
  'client_entity', 'client_edit', 'client_archive', 'doc_inc', 'ext_blocked', 'ext_ok'
]) as n;

insert into auth.users (id, email)
select id, name || '@permissions.test' from _dryrun.t_ids
where name in ('admin_a', 'admin_b', 'member', 'read_only', 'outsider');

insert into public.firms (id, name, slug)
values
  (_dryrun.id('firm'), 'Permissions Test Firm', 'permissions-test-' || substr(gen_random_uuid()::text, 1, 8)),
  (_dryrun.id('other_firm'), 'Other Firm', 'permissions-other-' || substr(gen_random_uuid()::text, 1, 8));

insert into public.firm_members (firm_id, user_id, full_name, role)
values
  (_dryrun.id('firm'), _dryrun.id('admin_a'), 'Admin A (fetcher)', 'admin'),
  (_dryrun.id('firm'), _dryrun.id('admin_b'), 'Admin B (second reviewer)', 'admin'),
  (_dryrun.id('firm'), _dryrun.id('member'), 'Plain Member', 'member'),
  (_dryrun.id('firm'), _dryrun.id('read_only'), 'Read Only', 'read_only'),
  (_dryrun.id('other_firm'), _dryrun.id('outsider'), 'Outsider', 'admin');

insert into public.firm_refresh_rules (firm_id, risk_rating, cadence_months)
values (_dryrun.id('firm'), 'standard', 12);

insert into public.clients (id, firm_id, client_type, display_name, risk_rating)
values
  (_dryrun.id('client_entity'), _dryrun.id('firm'), 'entity', 'Test Entity Ltd', 'standard'),
  (_dryrun.id('client_edit'), _dryrun.id('firm'), 'individual', 'Edit Me', 'standard'),
  (_dryrun.id('client_archive'), _dryrun.id('firm'), 'individual', 'Archive Me', 'standard');

insert into public.client_documents (id, firm_id, client_id, uploaded_by, document_type, storage_path, file_name, file_size_bytes, mime_type, status)
values
  (_dryrun.id('doc_inc'), _dryrun.id('firm'), _dryrun.id('client_entity'), _dryrun.id('member'), 'incorporation', 'x/inc.pdf', 'inc.pdf', 1, 'application/pdf', 'pending_review');

insert into public.document_extractions (id, document_id, firm_id, client_id, model_used, prompt_version)
values
  (_dryrun.id('ext_blocked'), _dryrun.id('doc_inc'), _dryrun.id('firm'), _dryrun.id('client_entity'), 'test-model', 'v0'),
  (_dryrun.id('ext_ok'), _dryrun.id('doc_inc'), _dryrun.id('firm'), _dryrun.id('client_entity'), 'test-model', 'v0');

-- ─── Defaults ─────────────────────────────────────────────────────────────────

select _dryrun.expect_true(
  (select four_eyes from public.firms where id = _dryrun.id('firm')),
  'firms.four_eyes defaults to true'
);

-- ─── require_role ─────────────────────────────────────────────────────────────

select _dryrun.expect_true(
  _dryrun.expect_ok(_dryrun.id('member'), format('select public.require_role(%L, array[''admin'', ''member''])', _dryrun.id('firm')), 'require_role runs for a member') = 'member',
  'require_role returns the caller''s role'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.require_role(%L, array[''admin''])', _dryrun.id('firm')),
  'permission denied%',
  'require_role rejects a role that is not listed'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.require_role(%L, array[''admin'', ''member''])', _dryrun.id('other_firm')),
  '%not an active member%',
  'require_role rejects a member of a different firm'
);
select _dryrun.expect_error(
  null,
  format('select public.require_role(%L, array[''admin''])', _dryrun.id('firm')),
  '%authentication required%',
  'require_role rejects a signed-out caller'
);

-- ─── save_entity_cdd ──────────────────────────────────────────────────────────

select _dryrun.expect_error(
  _dryrun.id('read_only'),
  format('select public.save_entity_cdd(%L, ''00000001'', null, ''{}''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''full'')', _dryrun.id('client_entity')),
  'permission denied%',
  'read_only is blocked from save_entity_cdd'
);
select _dryrun.expect_error(
  _dryrun.id('outsider'),
  format('select public.save_entity_cdd(%L, ''00000001'', null, ''{}''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''full'')', _dryrun.id('client_entity')),
  '%not an active member%',
  'a member of another firm is blocked from save_entity_cdd'
);
select _dryrun.expect_error(
  null,
  format('select public.save_entity_cdd(%L, ''00000001'', null, ''{}''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''full'')', _dryrun.id('client_entity')),
  '%authenticated user%',
  'a signed-out caller is blocked from save_entity_cdd'
);

select _dryrun.fetch_record('member', 'rec_member');
select _dryrun.expect_true(
  (select fetched_by from public.entity_cdd_records where id = _dryrun.id('rec_member')) = _dryrun.id('member'),
  'save_entity_cdd sets fetched_by to the member who fetched'
);
select _dryrun.fetch_record('admin_a', 'rec_a');
select _dryrun.expect_true(
  (select fetched_by from public.entity_cdd_records where id = _dryrun.id('rec_a')) = _dryrun.id('admin_a'),
  'save_entity_cdd sets fetched_by to the admin who fetched'
);

-- ─── review_entity_cdd ────────────────────────────────────────────────────────

select _dryrun.expect_error(
  _dryrun.id('read_only'),
  format('select public.review_entity_cdd(%L, ''approved'')', _dryrun.id('rec_a')),
  'permission denied%',
  'read_only is blocked from approving an entity CDD record'
);
select _dryrun.expect_error(
  _dryrun.id('read_only'),
  format('select public.review_entity_cdd(%L, ''rejected'')', _dryrun.id('rec_a')),
  'permission denied%',
  'read_only is blocked from rejecting an entity CDD record'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.review_entity_cdd(%L, ''approved'')', _dryrun.id('rec_a')),
  'permission denied%',
  'a member is blocked from approving (only admins review)'
);
select _dryrun.expect_error(
  _dryrun.id('outsider'),
  format('select public.review_entity_cdd(%L, ''approved'')', _dryrun.id('rec_a')),
  '%not an active member%',
  'a member of another firm is blocked from approving'
);

-- Four-eyes on (the default): the fetcher cannot approve their own record...
select _dryrun.expect_error(
  _dryrun.id('admin_a'),
  format('select public.review_entity_cdd(%L, ''approved'')', _dryrun.id('rec_a')),
  'Four-eyes rule: the person who fetched this record cannot approve it',
  'the fetcher is blocked from approving their own record with four_eyes on'
);
select _dryrun.expect_true(
  (select status from public.entity_cdd_records where id = _dryrun.id('rec_a')) = 'pending_review',
  'the blocked approval left the record pending_review'
);

-- ...but may reject it.
select _dryrun.fetch_record('admin_a', 'rec_reject');
select _dryrun.expect_ok(
  _dryrun.id('admin_a'),
  format('select public.review_entity_cdd(%L, ''rejected'', ''fetched the wrong company'')::text', _dryrun.id('rec_reject')),
  'the fetcher may reject their own record with four_eyes on'
);

-- A second admin may approve.
select _dryrun.expect_ok(
  _dryrun.id('admin_b'),
  format('select public.review_entity_cdd(%L, ''approved'', ''checked against the register'')::text', _dryrun.id('rec_a')),
  'a second admin may approve with four_eyes on'
);
select _dryrun.expect_true(
  (select status = 'approved' and reviewed_by = _dryrun.id('admin_b') from public.entity_cdd_records where id = _dryrun.id('rec_a')),
  'the approval is recorded against the second admin'
);
select _dryrun.expect_true(
  (select (payload ->> 'four_eyes')::boolean
          and payload ->> 'fetched_by' = _dryrun.id('admin_a')::text
          and payload ->> 'note' is null
   from public.audit_events
   where event_type = 'entity_cdd.approved' and (payload ->> 'record_id')::uuid = _dryrun.id('rec_a')),
  'the approval audit event records four_eyes and fetched_by, with no note'
);

-- Four-eyes off: the fetcher may approve.
update public.firms set four_eyes = false where id = _dryrun.id('firm');
select _dryrun.fetch_record('admin_a', 'rec_off');
select _dryrun.expect_ok(
  _dryrun.id('admin_a'),
  format('select public.review_entity_cdd(%L, ''approved'')::text', _dryrun.id('rec_off')),
  'the fetcher may approve their own record with four_eyes off'
);
update public.firms set four_eyes = true where id = _dryrun.id('firm');

-- Records from before fetched_by existed: allowed, logged with a note.
select _dryrun.fetch_record('admin_a', 'rec_old');
update public.entity_cdd_records set fetched_by = null where id = _dryrun.id('rec_old');
select _dryrun.expect_ok(
  _dryrun.id('admin_a'),
  format('select public.review_entity_cdd(%L, ''approved'')::text', _dryrun.id('rec_old')),
  'an approval is allowed when fetched_by is null'
);
select _dryrun.expect_true(
  (select payload ->> 'note' like 'Four-eyes could not be checked%'
   from public.audit_events
   where event_type = 'entity_cdd.approved' and (payload ->> 'record_id')::uuid = _dryrun.id('rec_old')),
  'that approval is logged with a note that four-eyes could not be checked'
);

-- ─── review_extraction and approve_filing_document: admin only ────────────────

select _dryrun.expect_error(
  _dryrun.id('read_only'),
  format('select public.review_extraction(%L, ''approved'')::text', _dryrun.id('ext_blocked')),
  'permission denied%',
  'read_only is blocked from review_extraction'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.review_extraction(%L, ''approved'')::text', _dryrun.id('ext_blocked')),
  'permission denied%',
  'a member is blocked from review_extraction'
);
select _dryrun.expect_ok(
  _dryrun.id('admin_a'),
  format('select public.review_extraction(%L, ''approved'')::text', _dryrun.id('ext_ok')),
  'an admin may review_extraction'
);

-- ─── Saving and approving filings (maker-checker) ─────────────────────────────

select _dryrun.expect_error(
  _dryrun.id('read_only'),
  format('select public.register_document(%L, ''filing'', ''x/ro.pdf'', ''ro.pdf'', 1000, ''application/pdf'')::text', _dryrun.id('client_entity')),
  'permission denied%',
  'read_only cannot save a filing'
);

-- A member can save a filing, and it waits as 'pending'.
select _dryrun.save_filing('member', 'fil_member');
select _dryrun.expect_true(
  (select status = 'pending' and uploaded_by = _dryrun.id('member') and document_type = 'filing'
   from public.client_documents where id = _dryrun.id('fil_member')),
  'a filing saved by a member is pending, with the member recorded as who saved it'
);

select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.approve_filing_document(%L)::text', _dryrun.id('fil_member')),
  'permission denied%',
  'a member cannot approve a filing, even one they saved'
);
select _dryrun.expect_error(
  _dryrun.id('read_only'),
  format('select public.approve_filing_document(%L)::text', _dryrun.id('fil_member')),
  'permission denied%',
  'read_only cannot approve a filing'
);

-- An admin can approve a filing a member saved.
select _dryrun.expect_ok(
  _dryrun.id('admin_a'),
  format('select public.approve_filing_document(%L)::text', _dryrun.id('fil_member')),
  'an admin may approve a filing saved by a member'
);
select _dryrun.expect_true(
  (select status from public.client_documents where id = _dryrun.id('fil_member')) = 'approved',
  'the approved filing is now approved'
);
select _dryrun.expect_error(
  _dryrun.id('admin_a'),
  format('select public.approve_filing_document(%L)::text', _dryrun.id('fil_member')),
  '%already been approved%',
  'a filing cannot be approved twice'
);

-- Four-eyes on: an admin cannot approve the filing they saved themselves.
select _dryrun.save_filing('admin_a', 'fil_admin');
select _dryrun.expect_error(
  _dryrun.id('admin_a'),
  format('select public.approve_filing_document(%L)::text', _dryrun.id('fil_admin')),
  'Four-eyes rule: the person who saved this filing cannot approve it',
  'an admin cannot approve their own filing with four_eyes on'
);
select _dryrun.expect_true(
  (select status from public.client_documents where id = _dryrun.id('fil_admin')) = 'pending',
  'the blocked approval left the filing pending'
);

-- A different admin can.
select _dryrun.expect_ok(
  _dryrun.id('admin_b'),
  format('select public.approve_filing_document(%L)::text', _dryrun.id('fil_admin')),
  'a different admin may approve it'
);
select _dryrun.expect_true(
  (select (payload ->> 'four_eyes')::boolean and payload ->> 'saved_by' = _dryrun.id('admin_a')::text
   from public.audit_events
   where event_type = 'filing.saved' and (payload ->> 'document_id')::uuid = _dryrun.id('fil_admin')),
  'the approval audit event records who saved the filing and that four_eyes was on'
);

-- Four-eyes off: an admin can approve their own.
update public.firms set four_eyes = false where id = _dryrun.id('firm');
select _dryrun.save_filing('admin_a', 'fil_admin_off');
select _dryrun.expect_ok(
  _dryrun.id('admin_a'),
  format('select public.approve_filing_document(%L)::text', _dryrun.id('fil_admin_off')),
  'an admin may approve their own filing with four_eyes off'
);
update public.firms set four_eyes = true where id = _dryrun.id('firm');

-- Other documents are unaffected: they are still registered as 'uploaded'.
do $$
declare
  v_val text;
begin
  v_val := _dryrun.expect_ok(
    _dryrun.id('member'),
    format('select public.register_document(%L, ''passport'', ''x/p.pdf'', ''p.pdf'', 1000, ''application/pdf'')::text', _dryrun.id('client_entity')),
    'a member can register an ordinary document'
  );
  insert into _dryrun.t_ids values ('doc_passport', v_val::uuid);
end;
$$;
select _dryrun.expect_true(
  (select status from public.client_documents where id = _dryrun.id('doc_passport')) = 'uploaded',
  'ordinary documents still start as uploaded'
);

-- ─── Other write RPCs ─────────────────────────────────────────────────────────

select _dryrun.expect_error(
  _dryrun.id('read_only'),
  format('select public.create_client(%L, ''individual'', ''Nobody'', ''standard'', ''{}''::jsonb)::text', _dryrun.id('firm')),
  'permission denied%',
  'read_only is blocked from create_client'
);
select _dryrun.expect_error(
  _dryrun.id('read_only'),
  format('select public.import_clients(%L, ''[]''::jsonb)::text', _dryrun.id('firm')),
  'permission denied%',
  'read_only is blocked from import_clients'
);
select _dryrun.expect_ok(
  _dryrun.id('member'),
  format('select public.create_client(%L, ''individual'', ''Allowed Person'', ''standard'', ''{}''::jsonb)::text', _dryrun.id('firm')),
  'a member may create_client'
);

-- ─── update_client and archive_client (the analyst-role bug) ──────────────────

select _dryrun.expect_error(
  _dryrun.id('read_only'),
  format('select public.update_client(%L, ''{"display_name": "Nope"}''::jsonb)::text', _dryrun.id('client_edit')),
  'user cannot update clients in this firm',
  'read_only is blocked from update_client'
);
select _dryrun.expect_error(
  _dryrun.id('outsider'),
  format('select public.update_client(%L, ''{"display_name": "Nope"}''::jsonb)::text', _dryrun.id('client_edit')),
  'user cannot update clients in this firm',
  'a member of another firm is blocked from update_client'
);
select _dryrun.expect_ok(
  _dryrun.id('member'),
  format('select public.update_client(%L, ''{"display_name": "Renamed by member"}''::jsonb)::text', _dryrun.id('client_edit')),
  'a member may update_client'
);
select _dryrun.expect_ok(
  _dryrun.id('admin_a'),
  format('select public.update_client(%L, ''{"display_name": "Renamed by admin"}''::jsonb)::text', _dryrun.id('client_edit')),
  'an admin may update_client'
);
select _dryrun.expect_true(
  (select display_name from public.clients where id = _dryrun.id('client_edit')) = 'Renamed by admin',
  'the update_client changes were saved'
);

select _dryrun.expect_error(
  _dryrun.id('read_only'),
  format('select public.archive_client(%L)::text', _dryrun.id('client_archive')),
  'user cannot archive clients in this firm',
  'read_only is blocked from archive_client'
);
select _dryrun.expect_ok(
  _dryrun.id('member'),
  format('select public.archive_client(%L)::text', _dryrun.id('client_archive')),
  'a member may archive_client'
);
select _dryrun.expect_true(
  (select status from public.clients where id = _dryrun.id('client_archive')) = 'archived',
  'the archive_client change was saved'
);

-- ─── Backfill ─────────────────────────────────────────────────────────────────

-- The migration's backfill statement, run on a record whose fetcher is in the audit trail.
insert into _dryrun.t_ids values ('rec_backfill', gen_random_uuid());
insert into public.entity_cdd_records (id, firm_id, client_id, company_number, status)
values (_dryrun.id('rec_backfill'), _dryrun.id('firm'), _dryrun.id('client_entity'), '00000002', 'pending_review');
insert into public.audit_events (firm_id, actor_user_id, event_type, entity_type, entity_id, payload)
values (
  _dryrun.id('firm'), _dryrun.id('member'), 'entity_cdd.fetched', 'client', _dryrun.id('client_entity'),
  jsonb_build_object('record_id', _dryrun.id('rec_backfill'))
);
update public.entity_cdd_records r
set fetched_by = e.actor_user_id
from public.audit_events e
where r.fetched_by is null
  and e.event_type = 'entity_cdd.fetched'
  and e.payload ->> 'record_id' = r.id::text
  and e.actor_user_id is not null;
select _dryrun.expect_true(
  (select fetched_by from public.entity_cdd_records where id = _dryrun.id('rec_backfill')) = _dryrun.id('member'),
  'the backfill takes fetched_by from the entity_cdd.fetched audit event'
);

-- ─── Done ─────────────────────────────────────────────────────────────────────

select _dryrun.finish();
