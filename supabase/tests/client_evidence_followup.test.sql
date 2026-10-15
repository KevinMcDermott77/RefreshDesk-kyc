-- Slice 7e tests: a draft can be withdrawn or rejected without a proposal, and the "already open" message.
--
-- Needs supabase/tests/helpers.sql run first, in the same transaction, and the Slice 0b, 6, 7a and 7e migrations
-- applied (or applied earlier in the same transaction). No BEGIN, COMMIT or ROLLBACK. Invented names only.
--
-- Slice 7a is already on the live database, so dry-run ONLY the new migration:
--
--   DRYRUN_DB_URL=... node scripts/run-dryrun.cjs \
--     --migration supabase/migrations/20261017000000_slice7e_evidence_followup.sql \
--     --tests supabase/tests/helpers.sql --tests supabase/tests/client_evidence_followup.test.sql

select _dryrun.reset_ids();

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

-- Opens an evidence item as p_user on node p_node and remembers its id under p_key. Returns nothing else.
create function _dryrun.open_item(p_user text, p_key text, p_node text) returns void language plpgsql as $$
declare
  v_val text;
begin
  v_val := _dryrun.expect_ok(
    _dryrun.id(p_user),
    format(
      'select public.create_ownership_evidence(%L, ''SUBJ1'', %L, ''Example Holdings AS'', %L::jsonb, ''shareholder_register'', %L, ''register.pdf'', 4096, ''application/pdf'', %L)::text',
      _dryrun.id('client'),
      'FOREIGN:NO:' || p_node,
      '{"country": "NO", "registration_number": "999999999"}',
      format('%s/%s/%s/register.pdf', _dryrun.id('firm'), _dryrun.id('client'), gen_random_uuid()),
      repeat('b', 64)
    ),
    p_key || ': ' || p_user || ' can open an evidence item'
  );
  insert into _dryrun.t_ids values (p_key, v_val::uuid);
end;
$$;

-- ─── Fixtures ─────────────────────────────────────────────────────────────────

insert into _dryrun.t_ids select n, gen_random_uuid() from unnest(array[
  'admin_a', 'admin_b', 'member', 'member_two', 'read_only', 'firm', 'client'
]) as n;

insert into auth.users (id, email)
select id, name || '@evidence-followup.test' from _dryrun.t_ids
where name in ('admin_a', 'admin_b', 'member', 'member_two', 'read_only');

insert into public.firms (id, name, slug)
values (_dryrun.id('firm'), 'Evidence Followup Firm', 'evidence-followup-' || substr(gen_random_uuid()::text, 1, 8));

insert into public.firm_members (firm_id, user_id, full_name, role)
values
  (_dryrun.id('firm'), _dryrun.id('admin_a'), 'Admin A', 'admin'),
  (_dryrun.id('firm'), _dryrun.id('admin_b'), 'Admin B', 'admin'),
  (_dryrun.id('firm'), _dryrun.id('member'), 'Plain Member', 'member'),
  (_dryrun.id('firm'), _dryrun.id('member_two'), 'Second Member', 'member'),
  (_dryrun.id('firm'), _dryrun.id('read_only'), 'Read Only', 'read_only');

insert into public.clients (id, firm_id, client_type, display_name, risk_rating)
values (_dryrun.id('client'), _dryrun.id('firm'), 'entity', 'Followup Entity Ltd', 'standard');

-- ─── Withdrawing a draft ──────────────────────────────────────────────────────

select _dryrun.open_item('member', 'draft_a', 'n1');
select _dryrun.expect_true(
  (select status = 'draft' and proposal is null from public.ownership_evidence where id = _dryrun.id('draft_a')),
  'the item starts as a draft with no proposal'
);

select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.reject_ownership_evidence(%L, ''  '')::text', _dryrun.id('draft_a')),
  '%note is required%',
  'withdrawing a draft still needs a note'
);
select _dryrun.expect_error(
  _dryrun.id('member_two'),
  format('select public.reject_ownership_evidence(%L, ''not mine'')::text', _dryrun.id('draft_a')),
  '%only an admin, or the person who uploaded%',
  'another member cannot withdraw someone else''s draft'
);
select _dryrun.expect_error(
  _dryrun.id('read_only'),
  format('select public.reject_ownership_evidence(%L, ''no'')::text', _dryrun.id('draft_a')),
  'permission denied%',
  'read_only cannot withdraw a draft'
);

select _dryrun.expect_ok(
  _dryrun.id('member'),
  format('select public.reject_ownership_evidence(%L, ''wrong file, will upload again'')::text', _dryrun.id('draft_a')),
  'the uploader can withdraw their own draft, which has no proposal'
);
select _dryrun.expect_true(
  (select status = 'rejected' and proposal is null and reviewed_by = _dryrun.id('member') and review_note = 'wrong file, will upload again'
   from public.ownership_evidence where id = _dryrun.id('draft_a')),
  'a withdrawn draft is kept as rejected, with no proposal and the note'
);
select _dryrun.expect_true(
  (select (payload ->> 'withdrawn')::boolean = true and payload ->> 'status_before' = 'draft'
   from public.audit_events where entity_id = _dryrun.id('draft_a') and event_type = 'ownership_evidence.rejected'),
  'the audit event says a draft was withdrawn by its uploader'
);

-- ─── An admin rejecting a draft ───────────────────────────────────────────────

select _dryrun.open_item('member', 'draft_b', 'n2');
select _dryrun.expect_ok(
  _dryrun.id('admin_b'),
  format('select public.reject_ownership_evidence(%L, ''not the document we asked for'')::text', _dryrun.id('draft_b')),
  'an admin can reject someone else''s draft that has no proposal'
);
select _dryrun.expect_true(
  (select status = 'rejected' and proposal is null and reviewed_by = _dryrun.id('admin_b')
   from public.ownership_evidence where id = _dryrun.id('draft_b')),
  'a draft rejected by an admin is recorded against the admin'
);
select _dryrun.expect_true(
  (select (payload ->> 'withdrawn')::boolean = false and payload ->> 'status_before' = 'draft'
   from public.audit_events where entity_id = _dryrun.id('draft_b') and event_type = 'ownership_evidence.rejected'),
  'the audit event says an admin rejected it, not the uploader'
);

select _dryrun.open_item('admin_a', 'draft_c', 'n3');
select _dryrun.expect_ok(
  _dryrun.id('admin_a'),
  format('select public.reject_ownership_evidence(%L, ''uploaded by mistake'')::text', _dryrun.id('draft_c')),
  'an admin can withdraw their own draft'
);

-- ─── What still holds ─────────────────────────────────────────────────────────

select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.reject_ownership_evidence(%L, ''again'')::text', _dryrun.id('draft_a')),
  '%not open%',
  'a rejected draft cannot be rejected again'
);
select _dryrun.expect_direct_error(
  format('update public.ownership_evidence set review_note = ''edited'' where id = %L', _dryrun.id('draft_a')),
  '%is rejected and cannot change%',
  'a rejected draft is frozen'
);
select _dryrun.expect_direct_error(
  format('delete from public.ownership_evidence where id = %L', _dryrun.id('draft_a')),
  '%never deleted%',
  'a rejected draft is never deleted'
);

-- A proposed, confirmed or superseded item must still have a proposal.
select _dryrun.open_item('member', 'draft_d', 'n4');
select _dryrun.expect_direct_error(
  format('update public.ownership_evidence set status = ''proposed'' where id = %L', _dryrun.id('draft_d')),
  '%ownership_evidence_proposal_present%',
  'an item cannot become proposed without a proposal'
);

-- After a draft is rejected, a new item can be opened for the same node.
select _dryrun.open_item('member', 'draft_a_again', 'n1');

-- ─── The "already open" message ───────────────────────────────────────────────

select _dryrun.expect_error(
  _dryrun.id('member_two'),
  format('select public.create_ownership_evidence(%L, ''SUBJ1'', ''FOREIGN:NO:n1'', ''Example Holdings AS'', ''{"country": "NO", "registration_number": "999999999"}''::jsonb, ''register_extract'', %L, ''a.pdf'', 100, ''application/pdf'', %L)::text',
    _dryrun.id('client'), format('%s/%s/z/a.pdf', _dryrun.id('firm'), _dryrun.id('client')), repeat('b', 64)),
  '%already open (draft or awaiting confirmation)%',
  'a second item for a node with an open DRAFT says "already open (draft or awaiting confirmation)"'
);

select _dryrun.expect_ok(
  _dryrun.id('member'),
  format('select public.save_evidence_proposal(%L, ''manual'', %L::jsonb)::text', _dryrun.id('draft_a_again'),
    '{"owners": [{"kind": "individual", "name_as_shown": "Testperson Alpha", "initials": "T.A.", "holding": {"type": "percent", "value": 100}, "page_ref": "p.1"}], "owners_complete": true, "as_at": "2026-06-30", "certified": "yes"}'),
  'a proposal can still be saved on a draft'
);
select _dryrun.expect_error(
  _dryrun.id('member_two'),
  format('select public.create_ownership_evidence(%L, ''SUBJ1'', ''FOREIGN:NO:n1'', ''Example Holdings AS'', ''{"country": "NO", "registration_number": "999999999"}''::jsonb, ''register_extract'', %L, ''a.pdf'', 100, ''application/pdf'', %L)::text',
    _dryrun.id('client'), format('%s/%s/z/a.pdf', _dryrun.id('firm'), _dryrun.id('client')), repeat('b', 64)),
  '%already open (draft or awaiting confirmation)%',
  'and the same message when the open item is awaiting confirmation'
);

-- A proposed item can still be withdrawn (it has a proposal).
select _dryrun.expect_ok(
  _dryrun.id('member'),
  format('select public.reject_ownership_evidence(%L, ''changed my mind'')::text', _dryrun.id('draft_a_again')),
  'a proposed item can still be withdrawn'
);

select _dryrun.finish();
