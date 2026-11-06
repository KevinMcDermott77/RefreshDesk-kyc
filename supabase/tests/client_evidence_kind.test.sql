-- Slice 7f tests: the client_ownership_confirmation kind, and certified = 'not_applicable'.
--
-- Needs supabase/tests/helpers.sql run first, in the same transaction, and the Slice 0b, 6, 7a, 7e and 7f
-- migrations applied (or applied earlier in the same transaction). No BEGIN, COMMIT or ROLLBACK. Invented
-- names only. It can run after client_evidence_followup.test.sql in the same transaction: its helper
-- functions and fixtures have different names.
--
-- Slices 7e and 7f are both unapplied, so one command dry-runs them together, in order, with all their tests:
--
--   DRYRUN_DB_URL=... node scripts/run-dryrun.cjs \
--     --migration supabase/migrations/20261017000000_slice7e_evidence_followup.sql \
--     --migration supabase/migrations/20261018000000_slice7f_confirmation_kind.sql \
--     --tests supabase/tests/helpers.sql \
--     --tests supabase/tests/client_evidence_followup.test.sql \
--     --tests supabase/tests/client_evidence_kind.test.sql

select _dryrun.reset_ids();

create or replace function _dryrun.expect_direct_error(p_sql text, p_pattern text, p_name text)
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

-- A valid payload with one individual and the given certified value. Invented name.
create function _dryrun.k_payload(p_certified text, p_extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'owners', jsonb_build_array(jsonb_build_object(
      'kind', 'individual', 'name_as_shown', 'Testperson Alpha', 'initials', 'T.A.',
      'holding', jsonb_build_object('type', 'percent', 'value', 100), 'page_ref', 'para 2'
    )),
    'owners_complete', true,
    'as_at', '2026-06-30',
    'certified', p_certified
  ) || p_extra;
$$;

-- Opens an item of the given kind on node p_node and remembers its id under p_key.
create function _dryrun.k_open(p_user text, p_key text, p_node text, p_kind text) returns void language plpgsql as $$
declare
  v_val text;
begin
  v_val := _dryrun.expect_ok(
    _dryrun.id(p_user),
    format(
      'select public.create_ownership_evidence(%L, ''SUBJ1'', %L, ''Example Holdings AS'', %L::jsonb, %L, %L, ''doc.pdf'', 4096, ''application/pdf'', %L)::text',
      _dryrun.id('client'),
      'FOREIGN:NO:' || p_node,
      '{"country": "NO", "registration_number": "999999999"}',
      p_kind,
      format('%s/%s/%s/doc.pdf', _dryrun.id('firm'), _dryrun.id('client'), gen_random_uuid()),
      repeat('b', 64)
    ),
    p_key || ': a ' || p_kind || ' item can be opened'
  );
  insert into _dryrun.t_ids values (p_key, v_val::uuid);
end;
$$;

create function _dryrun.k_propose(p_key text, p_certified text, p_extra jsonb default '{}'::jsonb) returns text language plpgsql as $$
begin
  return (select err from _dryrun.try_as(
    _dryrun.id('member'),
    format('select public.save_evidence_proposal(%L, ''manual'', %L::jsonb)::text', _dryrun.id(p_key), _dryrun.k_payload(p_certified, p_extra)::text)
  ));
end;
$$;

-- ─── Fixtures ─────────────────────────────────────────────────────────────────

insert into _dryrun.t_ids select n, gen_random_uuid() from unnest(array[
  'admin_b', 'member', 'read_only', 'firm', 'client'
]) as n;

insert into auth.users (id, email)
select id, name || '@evidence-kind.test' from _dryrun.t_ids where name in ('admin_b', 'member', 'read_only');

insert into public.firms (id, name, slug)
values (_dryrun.id('firm'), 'Evidence Kind Firm', 'evidence-kind-' || substr(gen_random_uuid()::text, 1, 8));

insert into public.firm_members (firm_id, user_id, full_name, role)
values
  (_dryrun.id('firm'), _dryrun.id('admin_b'), 'Admin B', 'admin'),
  (_dryrun.id('firm'), _dryrun.id('member'), 'Plain Member', 'member'),
  (_dryrun.id('firm'), _dryrun.id('read_only'), 'Read Only', 'read_only');

insert into public.clients (id, firm_id, client_type, display_name, risk_rating)
values (_dryrun.id('client'), _dryrun.id('firm'), 'entity', 'Kind Test Entity Ltd', 'standard');

-- ─── The kinds ────────────────────────────────────────────────────────────────

select _dryrun.k_open('member', 'confirmation', 'k1', 'client_ownership_confirmation');
select _dryrun.expect_true(
  (select e.evidence_kind = 'client_ownership_confirmation' and e.status = 'draft' and e.certified is null
   from public.ownership_evidence e where e.id = _dryrun.id('confirmation')),
  'a client''s written confirmation opens as a draft, with no certification yet'
);
select _dryrun.expect_true(
  (select payload ->> 'evidence_kind' = 'client_ownership_confirmation'
   from public.audit_events where entity_id = _dryrun.id('confirmation') and event_type = 'ownership_evidence.created'),
  'the audit event names the kind'
);

select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.create_ownership_evidence(%L, ''SUBJ1'', ''FOREIGN:NO:bad'', ''X'', ''{"country": "NO", "registration_number": "1"}''::jsonb, ''signed_client_declaration'', %L, ''a.pdf'', 100, ''application/pdf'', %L)::text',
    _dryrun.id('client'), format('%s/%s/z/a.pdf', _dryrun.id('firm'), _dryrun.id('client')), repeat('b', 64)),
  '%invalid evidence kind%',
  'an unknown kind (the planned declaration type) is still refused'
);

select _dryrun.k_open('member', 'reg_extract', 'k2', 'register_extract');
select _dryrun.k_open('member', 'reg_share', 'k3', 'shareholder_register');
select _dryrun.k_open('member', 'chart', 'k4', 'signed_structure_chart');
select _dryrun.k_open('member', 'annual', 'k5', 'annual_report_page');

select _dryrun.expect_error(
  _dryrun.id('read_only'),
  format('select public.create_ownership_evidence(%L, ''SUBJ1'', ''FOREIGN:NO:k6'', ''X'', ''{"country": "NO", "registration_number": "1"}''::jsonb, ''client_ownership_confirmation'', %L, ''a.pdf'', 100, ''application/pdf'', %L)::text',
    _dryrun.id('client'), format('%s/%s/z/a.pdf', _dryrun.id('firm'), _dryrun.id('client')), repeat('b', 64)),
  'permission denied%',
  'read_only still cannot open one'
);

-- ─── certified = not_applicable: for the client's own statement, and only for it ──

select _dryrun.expect_true(
  public.ownership_evidence_payload_error(_dryrun.k_payload('not_applicable'), false) is null,
  'the payload check accepts not_applicable'
);
select _dryrun.expect_true(
  public.ownership_evidence_payload_error(_dryrun.k_payload('maybe'), false) = 'certified must be yes, no, unclear or not_applicable',
  'and still names the allowed values when it is something else'
);

-- a confirmation must say not_applicable
select _dryrun.expect_true(_dryrun.k_propose('confirmation', 'yes') like '%ownership_evidence_certified_matches_kind%', 'a confirmation cannot say certified = yes');
select _dryrun.expect_true(_dryrun.k_propose('confirmation', 'no') like '%ownership_evidence_certified_matches_kind%', 'nor no');
select _dryrun.expect_true(_dryrun.k_propose('confirmation', 'unclear') like '%ownership_evidence_certified_matches_kind%', 'nor unclear: it has to say not_applicable');
select _dryrun.expect_true(
  _dryrun.k_propose('confirmation', 'not_applicable', '{"confirmed_by_capacity": "director", "confirmation_date": "2026-07-16", "received_as": "signed_letter", "no_other_holder_at_or_above": 25}') is null,
  'a confirmation with not_applicable and the confirmation fields is accepted'
);
select _dryrun.expect_true(
  (select status = 'proposed' and certified = 'not_applicable' and proposal ->> 'certified' = 'not_applicable'
          and proposal ->> 'confirmed_by_capacity' = 'director' and (proposal ->> 'no_other_holder_at_or_above')::int = 25
   from public.ownership_evidence where id = _dryrun.id('confirmation')),
  'the typed column and the proposal both say not_applicable, and the confirmation fields are kept'
);

-- the older signed-chart kind is a confirmation too
select _dryrun.expect_true(_dryrun.k_propose('chart', 'unclear') like '%ownership_evidence_certified_matches_kind%', 'a signed structure chart cannot say unclear');
select _dryrun.expect_true(_dryrun.k_propose('chart', 'not_applicable') is null, 'a signed structure chart says not_applicable');

-- every other kind keeps yes / no / unclear, and cannot say not_applicable
select _dryrun.expect_true(_dryrun.k_propose('reg_extract', 'not_applicable') like '%ownership_evidence_certified_matches_kind%', 'a register extract cannot say not_applicable');
select _dryrun.expect_true(_dryrun.k_propose('reg_share', 'not_applicable') like '%ownership_evidence_certified_matches_kind%', 'nor a shareholder register');
select _dryrun.expect_true(_dryrun.k_propose('annual', 'not_applicable') like '%ownership_evidence_certified_matches_kind%', 'nor an annual report page');
select _dryrun.expect_true(_dryrun.k_propose('reg_share', 'yes') is null, 'a shareholder register can say yes');
select _dryrun.expect_true(_dryrun.k_propose('reg_share', 'no') is null, 'or no');
select _dryrun.expect_true(_dryrun.k_propose('reg_share', 'unclear') is null, 'or unclear');
select _dryrun.expect_true(_dryrun.k_propose('reg_extract', 'yes') is null, 'a register extract can say yes');
select _dryrun.expect_true(_dryrun.k_propose('annual', 'unclear') is null, 'an annual report page can say unclear');
select _dryrun.expect_true(
  (select certified = 'unclear' from public.ownership_evidence where id = _dryrun.id('annual')),
  'an older-kind item keeps its yes / no / unclear in the typed column'
);

-- the constraint also checks rows written directly (as the connecting role), not only through the RPC
select _dryrun.expect_direct_error(
  format('update public.ownership_evidence set certified = ''unclear'' where id = %L', _dryrun.id('confirmation')),
  '%ownership_evidence_certified_matches_kind%',
  'changing a confirmation''s typed certified value to unclear is refused, even directly'
);
select _dryrun.expect_direct_error(
  format('update public.ownership_evidence set certified = ''not_applicable'' where id = %L', _dryrun.id('reg_share')),
  '%ownership_evidence_certified_matches_kind%',
  'and so is setting not_applicable on a shareholder register'
);
select _dryrun.expect_true(
  (select not convalidated from pg_constraint where conname = 'ownership_evidence_certified_matches_kind'),
  'the matching constraint is NOT VALID: it checks new and changed rows, not rows written before it existed'
);

-- ─── Confirming ───────────────────────────────────────────────────────────────

select _dryrun.expect_error(
  _dryrun.id('admin_b'),
  format('select public.confirm_ownership_evidence(%L, %L::jsonb)::text', _dryrun.id('confirmation'), _dryrun.k_payload('yes')::text),
  '%ownership_evidence_certified_matches_kind%',
  'a confirmation cannot be confirmed as certified'
);
select _dryrun.expect_ok(
  _dryrun.id('admin_b'),
  format('select public.confirm_ownership_evidence(%L, %L::jsonb, ''checked against the letter'')::text', _dryrun.id('confirmation'),
    _dryrun.k_payload('not_applicable', '{"confirmed_by_capacity": "director", "confirmation_date": "2026-07-16", "received_as": "signed_letter", "no_other_holder_at_or_above": 25}')::text),
  'an admin confirms a client confirmation, certification not applicable'
);
select _dryrun.expect_true(
  (select status = 'confirmed' and certified = 'not_applicable' and confirmed ->> 'certified' = 'not_applicable' and edited = false
   from public.ownership_evidence where id = _dryrun.id('confirmation')),
  'the confirmed item says not_applicable, in the column and in the payload'
);
select _dryrun.expect_true(
  (select (val::jsonb -> 0 ->> 'certified') = 'not_applicable' and (val::jsonb -> 0 -> 'payload' ->> 'received_as') = 'signed_letter'
   from _dryrun.try_as(_dryrun.id('member'), format('select public.confirmed_evidence_for(%L, ''SUBJ1'')::text', _dryrun.id('client')))),
  'the walk''s read function returns not_applicable and the confirmation fields'
);
select _dryrun.expect_true(
  (select val = 'not_applicable'
   from _dryrun.try_as(_dryrun.id('read_only'), format('select certified::text from public.ownership_evidence_overview where id = %L', _dryrun.id('confirmation')))),
  'the names-free overview shows not_applicable to a read_only user'
);

-- An older-kind item is confirmed as before.
select _dryrun.expect_ok(
  _dryrun.id('admin_b'),
  format('select public.confirm_ownership_evidence(%L, %L::jsonb)::text', _dryrun.id('reg_share'), _dryrun.k_payload('yes', '{"certifier_capacity": "notary"}')::text),
  'a shareholder register is confirmed as certified, as before'
);
select _dryrun.expect_true(
  (select status = 'confirmed' and certified = 'yes' from public.ownership_evidence where id = _dryrun.id('reg_share')),
  'and keeps yes'
);

-- The 7e fix still holds for the new kind: a draft confirmation can be withdrawn without a proposal.
select _dryrun.k_open('member', 'draft_confirmation', 'k7', 'client_ownership_confirmation');
select _dryrun.expect_ok(
  _dryrun.id('member'),
  format('select public.reject_ownership_evidence(%L, ''wrong letter'')::text', _dryrun.id('draft_confirmation')),
  'a draft written confirmation can be withdrawn without a proposal'
);

select _dryrun.finish();
