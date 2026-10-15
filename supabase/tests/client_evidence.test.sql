-- Slice 7a client-evidence tests: roles, four-eyes, validation, supersede, immutability, row-level
-- security, the names-free overview, audit events and the refresh-pack personal-data check.
--
-- Needs supabase/tests/helpers.sql run first, in the same transaction, and the Slice 0b, Slice 6 and
-- Slice 7a migrations applied (or applied earlier in the same transaction). No BEGIN, COMMIT or
-- ROLLBACK. Every name below is invented; no real personal data.
--
-- Slice 0b and Slice 6 are already on the live database, so dry-run ONLY the new migration:
--
--   DRYRUN_DB_URL=... node scripts/run-dryrun.cjs \
--     --migration supabase/migrations/20261016000000_slice7a_client_evidence.sql \
--     --tests supabase/tests/helpers.sql --tests supabase/tests/client_evidence.test.sql

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

-- A valid payload: one individual (initials set, as the app does) and one entity with a printed
-- registration number. Invented names.
create function _dryrun.payload(
  p_certified text default 'yes',
  p_override jsonb default null,
  p_pct numeric default 60
) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'owners', jsonb_build_array(
      jsonb_build_object(
        'kind', 'individual', 'name_as_shown', 'Testperson Alpha', 'initials', 'T.A.',
        'holding', jsonb_build_object('type', 'percent', 'value', p_pct), 'page_ref', 'p.3, table 2'
      ),
      jsonb_build_object(
        'kind', 'entity', 'name_as_shown', 'Example Holdings AS',
        'holding', jsonb_build_object('type', 'band', 'low', 10, 'high', 30),
        'registration', jsonb_build_object('number', '999999999', 'country', 'NO'), 'page_ref', 'p.3, table 2'
      )
    ),
    'owners_complete', true,
    'as_at', '2026-06-30',
    'document_date', '2026-07-15',
    'certified', p_certified,
    'certified_by', case when p_certified = 'yes' then 'Company secretary' end,
    'override', p_override
  ));
$$;

-- Opens an evidence item as p_user on node p_node and remembers its id under p_key.
create function _dryrun.make_evidence(p_user text, p_key text, p_node text default 'n1') returns void language plpgsql as $$
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

-- Saves a manual proposal as p_user.
create function _dryrun.propose(p_user text, p_key text, p_payload jsonb default null) returns void language plpgsql as $$
begin
  perform _dryrun.expect_ok(
    _dryrun.id(p_user),
    format('select public.save_evidence_proposal(%L, ''manual'', %L::jsonb)::text', _dryrun.id(p_key), coalesce(p_payload, _dryrun.payload())::text),
    p_key || ': ' || p_user || ' can save a manual proposal'
  );
end;
$$;

-- ─── Fixtures (as the connecting role; none of this is real data) ─────────────

insert into _dryrun.t_ids select n, gen_random_uuid() from unnest(array[
  'admin_a', 'admin_b', 'member', 'member_two', 'read_only', 'outsider', 'firm', 'other_firm', 'client', 'other_client'
]) as n;

insert into auth.users (id, email)
select id, name || '@client-evidence.test' from _dryrun.t_ids
where name in ('admin_a', 'admin_b', 'member', 'member_two', 'read_only', 'outsider');

insert into public.firms (id, name, slug)
values
  (_dryrun.id('firm'), 'Evidence Test Firm', 'evidence-test-' || substr(gen_random_uuid()::text, 1, 8)),
  (_dryrun.id('other_firm'), 'Other Evidence Firm', 'evidence-other-' || substr(gen_random_uuid()::text, 1, 8));

insert into public.firm_members (firm_id, user_id, full_name, role)
values
  (_dryrun.id('firm'), _dryrun.id('admin_a'), 'Admin A (uploader-admin)', 'admin'),
  (_dryrun.id('firm'), _dryrun.id('admin_b'), 'Admin B (second admin)', 'admin'),
  (_dryrun.id('firm'), _dryrun.id('member'), 'Plain Member', 'member'),
  (_dryrun.id('firm'), _dryrun.id('member_two'), 'Second Member', 'member'),
  (_dryrun.id('firm'), _dryrun.id('read_only'), 'Read Only', 'read_only'),
  (_dryrun.id('other_firm'), _dryrun.id('outsider'), 'Outsider', 'admin');

insert into public.clients (id, firm_id, client_type, display_name, risk_rating)
values
  (_dryrun.id('client'), _dryrun.id('firm'), 'entity', 'Evidence Test Entity Ltd', 'standard'),
  (_dryrun.id('other_client'), _dryrun.id('other_firm'), 'entity', 'Other Firm Entity Ltd', 'standard');

-- ─── The firm setting ─────────────────────────────────────────────────────────

select _dryrun.expect_true(
  (select evidence_extraction_enabled = false from public.firms where id = _dryrun.id('firm')),
  'a new firm has document extraction off by default'
);

-- ─── Opening an evidence item ─────────────────────────────────────────────────

select _dryrun.expect_error(
  _dryrun.id('read_only'),
  format('select public.create_ownership_evidence(%L, ''SUBJ1'', ''FOREIGN:NO:x'', ''X'', ''{"country": "NO", "registration_number": "1"}''::jsonb, ''register_extract'', %L, ''a.pdf'', 100, ''application/pdf'', %L)::text',
    _dryrun.id('client'), format('%s/%s/z/a.pdf', _dryrun.id('firm'), _dryrun.id('client')), repeat('b', 64)),
  'permission denied%',
  'read_only cannot open an evidence item'
);
select _dryrun.expect_error(
  _dryrun.id('outsider'),
  format('select public.create_ownership_evidence(%L, ''SUBJ1'', ''FOREIGN:NO:x'', ''X'', ''{"country": "NO", "registration_number": "1"}''::jsonb, ''register_extract'', %L, ''a.pdf'', 100, ''application/pdf'', %L)::text',
    _dryrun.id('client'), format('%s/%s/z/a.pdf', _dryrun.id('firm'), _dryrun.id('client')), repeat('b', 64)),
  '%not an active member%',
  'a member of another firm cannot open evidence for this client'
);
select _dryrun.expect_error(
  null,
  format('select public.create_ownership_evidence(%L, ''SUBJ1'', ''FOREIGN:NO:x'', ''X'', ''{"country": "NO", "registration_number": "1"}''::jsonb, ''register_extract'', %L, ''a.pdf'', 100, ''application/pdf'', %L)::text',
    _dryrun.id('client'), format('%s/%s/z/a.pdf', _dryrun.id('firm'), _dryrun.id('client')), repeat('b', 64)),
  '%authenticated user%',
  'a signed-out caller cannot open an evidence item'
);

select _dryrun.make_evidence('member', 'e1', 'n1');
select _dryrun.expect_true(
  (select e.status = 'draft' and e.created_by = _dryrun.id('member') and e.proposal is null and e.document_sha256 = repeat('b', 64)
          and d.document_type = 'ownership_evidence' and d.status = 'uploaded' and d.uploaded_by = _dryrun.id('member')
          and d.firm_id = e.firm_id and d.client_id = e.client_id and d.file_size_bytes = 4096
   from public.ownership_evidence e join public.client_documents d on d.id = e.document_id
   where e.id = _dryrun.id('e1')),
  'a new item is a draft, with its document registered against the client and its hash stored'
);

select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.register_document(%L, ''ownership_evidence'', ''x/y.pdf'', ''y.pdf'', 100, ''application/pdf'')::text', _dryrun.id('client')),
  '%invalid document_type%',
  'register_document still refuses the ownership_evidence type'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.create_ownership_evidence(%L, ''SUBJ1'', ''FOREIGN:NO:n9'', ''X'', ''{"country": "NO", "registration_number": "1"}''::jsonb, ''register_extract'', %L, ''a.pdf'', 100, ''application/pdf'', %L)::text',
    _dryrun.id('client'), format('%s/%s/z/a.pdf', _dryrun.id('other_firm'), _dryrun.id('other_client')), repeat('b', 64)),
  '%not in this client''s folder%',
  'the file must be in this client''s folder'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.create_ownership_evidence(%L, ''SUBJ1'', ''FOREIGN:NO:n9'', ''X'', ''{"country": "NO", "registration_number": "1"}''::jsonb, ''register_extract'', %L, ''a.html'', 100, ''text/html'', %L)::text',
    _dryrun.id('client'), format('%s/%s/z/a.html', _dryrun.id('firm'), _dryrun.id('client')), repeat('b', 64)),
  '%PDF, JPEG, or PNG%',
  'the file must be a PDF, JPEG or PNG'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.create_ownership_evidence(%L, ''SUBJ1'', ''FOREIGN:NO:n9'', ''X'', ''{"country": "NO", "registration_number": "1"}''::jsonb, ''register_extract'', %L, ''a.pdf'', 11000000, ''application/pdf'', %L)::text',
    _dryrun.id('client'), format('%s/%s/z/a.pdf', _dryrun.id('firm'), _dryrun.id('client')), repeat('b', 64)),
  '%10 MB%',
  'the file cannot exceed 10 MB'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.create_ownership_evidence(%L, ''SUBJ1'', ''FOREIGN:NO:n9'', ''X'', ''{"country": "NO", "registration_number": "1"}''::jsonb, ''signed_client_declaration'', %L, ''a.pdf'', 100, ''application/pdf'', %L)::text',
    _dryrun.id('client'), format('%s/%s/z/a.pdf', _dryrun.id('firm'), _dryrun.id('client')), repeat('b', 64)),
  '%invalid evidence kind%',
  'an unknown evidence kind (including the planned declaration type) is refused for now'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.create_ownership_evidence(%L, ''SUBJ1'', ''FOREIGN:NO:n9'', ''X'', ''{"name": "only a name"}''::jsonb, ''register_extract'', %L, ''a.pdf'', 100, ''application/pdf'', %L)::text',
    _dryrun.id('client'), format('%s/%s/z/a.pdf', _dryrun.id('firm'), _dryrun.id('client')), repeat('b', 64)),
  '%check constraint%',
  'the node needs an LEI or a country plus registration number, never a name alone'
);
select _dryrun.expect_error(
  _dryrun.id('member_two'),
  format('select public.create_ownership_evidence(%L, ''SUBJ1'', ''FOREIGN:NO:n1'', ''Example Holdings AS'', ''{"country": "NO", "registration_number": "999999999"}''::jsonb, ''register_extract'', %L, ''a.pdf'', 100, ''application/pdf'', %L)::text',
    _dryrun.id('client'), format('%s/%s/z/a.pdf', _dryrun.id('firm'), _dryrun.id('client')), repeat('b', 64)),
  '%already %',
  'a second open item for the same node is refused'
);

-- ─── Proposals ────────────────────────────────────────────────────────────────

select _dryrun.expect_error(
  _dryrun.id('admin_b'),
  format('select public.save_evidence_proposal(%L, ''manual'', %L::jsonb)::text', _dryrun.id('e1'), _dryrun.payload()::text),
  '%only the person who uploaded%',
  'only the uploader can save the proposal'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.save_evidence_proposal(%L, ''extraction'', %L::jsonb, ''test-model'', ''v1'', 0.8, ''raw'')::text', _dryrun.id('e1'), _dryrun.payload()::text),
  '%extraction is switched off%',
  'extraction is refused while the firm setting is off'
);

-- invalid payloads, one rule each
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.save_evidence_proposal(%L, ''manual'', %L::jsonb)::text', _dryrun.id('e1'),
    jsonb_set(_dryrun.payload(), '{owners,0}', (_dryrun.payload() #> '{owners,0}') - 'page_ref')::text),
  '%page_ref is required%',
  'an owner without a page reference is refused'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.save_evidence_proposal(%L, ''manual'', %L::jsonb)::text', _dryrun.id('e1'), _dryrun.payload('yes', null, 120)::text),
  '%between 0 and 100%',
  'a holding above 100 is refused'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.save_evidence_proposal(%L, ''manual'', %L::jsonb)::text', _dryrun.id('e1'),
    jsonb_set(_dryrun.payload(), '{owners,1,holding}', '{"type": "band", "low": 40, "high": 20}')::text),
  '%0 <= low <= high <= 100%',
  'a band with low above high is refused'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.save_evidence_proposal(%L, ''manual'', %L::jsonb)::text', _dryrun.id('e1'),
    jsonb_set(_dryrun.payload(), '{owners,0}', (_dryrun.payload() #> '{owners,0}') - 'initials')::text),
  '%needs initials%',
  'an individual without initials is refused'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.save_evidence_proposal(%L, ''manual'', %L::jsonb)::text', _dryrun.id('e1'),
    jsonb_set(_dryrun.payload(), '{owners,0,initials}', '"Testperson"')::text),
  '%needs initials%',
  'a whole name in the initials field is refused'
);
select _dryrun.expect_ok(
  _dryrun.id('member'),
  format('select public.save_evidence_proposal(%L, ''manual'', %L::jsonb)::text', _dryrun.id('e1'),
    jsonb_set(_dryrun.payload(), '{owners,0,initials}', '"Ø.Å."')::text),
  'initials of non-English letters (Ø.Å.) are accepted: Nordic names are the point'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.save_evidence_proposal(%L, ''manual'', %L::jsonb)::text', _dryrun.id('e1'),
    jsonb_set(_dryrun.payload(), '{owners,0,date_of_birth}', '"1970-01-01"')::text),
  '%personal-data keys%',
  'a date-of-birth key is refused'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.save_evidence_proposal(%L, ''manual'', %L::jsonb)::text', _dryrun.id('e1'), _dryrun.payload('maybe')::text),
  '%certified must be yes, no or unclear%',
  'certified must be yes, no or unclear'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.save_evidence_proposal(%L, ''manual'', %L::jsonb)::text', _dryrun.id('e1'),
    jsonb_set(_dryrun.payload(), '{owners,1,registration,country}', '"NOR"')::text),
  '%two-letter country code%',
  'a registration needs a two-letter country'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.save_evidence_proposal(%L, ''manual'', %L::jsonb)::text', _dryrun.id('e1'),
    jsonb_set(_dryrun.payload(), '{as_at}', to_jsonb((current_date + 30)::text))::text),
  '%cannot be in the future%',
  'an as-at date in the future is refused'
);

select _dryrun.propose('member', 'e1');
select _dryrun.expect_true(
  (select status = 'proposed' and proposal_source = 'manual' and as_at = date '2026-06-30' and document_date = date '2026-07-15'
          and certified = 'yes' and certified_by = 'Company secretary' and model_used is null and proposed_at is not null
   from public.ownership_evidence where id = _dryrun.id('e1')),
  'a manual proposal moves the item to proposed and copies the document facts'
);

-- ─── The extraction setting ───────────────────────────────────────────────────

select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.set_evidence_extraction(%L, true)::text', _dryrun.id('firm')),
  'permission denied%',
  'a member cannot switch extraction on'
);
select _dryrun.expect_error(
  _dryrun.id('outsider'),
  format('select public.set_evidence_extraction(%L, true)::text', _dryrun.id('firm')),
  '%not an active member%',
  'an admin of another firm cannot switch it on'
);
select _dryrun.expect_ok(
  _dryrun.id('admin_a'),
  format('select public.set_evidence_extraction(%L, true)::text', _dryrun.id('firm')),
  'an admin can switch extraction on'
);
select _dryrun.expect_true(
  (select count(*) = 1 from public.audit_events
   where firm_id = _dryrun.id('firm') and event_type = 'firm.evidence_extraction_changed'
     and payload = '{"from": false, "to": true}'::jsonb),
  'switching extraction on is audited'
);

select _dryrun.make_evidence('member_two', 'e2', 'n2');
select _dryrun.expect_error(
  _dryrun.id('member_two'),
  format('select public.save_evidence_proposal(%L, ''extraction'', %L::jsonb)::text', _dryrun.id('e2'), _dryrun.payload()::text),
  '%model and prompt version%',
  'an extraction needs the model and prompt version'
);
select _dryrun.expect_ok(
  _dryrun.id('member_two'),
  format('select public.save_evidence_proposal(%L, ''extraction'', %L::jsonb, ''test-model'', ''ownership-evidence-v1'', 0.8, ''raw model text'')::text', _dryrun.id('e2'), _dryrun.payload()::text),
  'an extraction proposal is accepted once the setting is on'
);
select _dryrun.expect_true(
  (select status = 'proposed' and proposal_source = 'extraction' and model_used = 'test-model' and prompt_version = 'ownership-evidence-v1'
          and confidence = 0.8 and raw_response = 'raw model text'
   from public.ownership_evidence where id = _dryrun.id('e2')),
  'the extraction records its model, prompt version, confidence and raw response'
);

-- ─── Confirming ───────────────────────────────────────────────────────────────

select _dryrun.expect_error(
  _dryrun.id('member'),
  format('select public.confirm_ownership_evidence(%L, %L::jsonb)::text', _dryrun.id('e1'), _dryrun.payload()::text),
  'permission denied%',
  'a member cannot confirm'
);
select _dryrun.expect_error(
  _dryrun.id('read_only'),
  format('select public.confirm_ownership_evidence(%L, %L::jsonb)::text', _dryrun.id('e1'), _dryrun.payload()::text),
  'permission denied%',
  'read_only cannot confirm'
);
select _dryrun.expect_error(
  _dryrun.id('outsider'),
  format('select public.confirm_ownership_evidence(%L, %L::jsonb)::text', _dryrun.id('e1'), _dryrun.payload()::text),
  '%not an active member%',
  'an admin of another firm cannot confirm'
);
select _dryrun.expect_error(
  _dryrun.id('admin_b'),
  format('select public.confirm_ownership_evidence(%L, %L::jsonb)::text', _dryrun.id('e1'),
    (_dryrun.payload() - 'as_at' - 'document_date')::text),
  '%as_at or document_date%',
  'a confirmation needs a date to measure the evidence''s age from'
);
select _dryrun.expect_error(
  _dryrun.id('admin_b'),
  format('select public.confirm_ownership_evidence(%L, %L::jsonb)::text', _dryrun.id('e1'),
    jsonb_set(_dryrun.payload(), '{owners,0}', (_dryrun.payload() #> '{owners,0}') - 'page_ref')::text),
  '%page_ref is required%',
  'a confirmation is validated like a proposal'
);
select _dryrun.expect_error(
  _dryrun.id('admin_b'),
  format('select public.confirm_ownership_evidence(%L, %L::jsonb)::text', _dryrun.id('e1'),
    _dryrun.payload('no', '{"reasons": ["uncertified"]}')::text),
  '%override needs a note%',
  'an override without a note is refused'
);
select _dryrun.expect_error(
  _dryrun.id('admin_b'),
  format('select public.confirm_ownership_evidence(%L, %L::jsonb)::text', _dryrun.id('e1'),
    _dryrun.payload('no', '{"reasons": ["coverage"], "note": "n"}')::text),
  '%reasons: stale and/or uncertified%',
  'coverage cannot be overridden: only stale and uncertified are valid reasons'
);
select _dryrun.expect_error(
  _dryrun.id('admin_b'),
  format('select public.confirm_ownership_evidence(%L, %L::jsonb)::text', _dryrun.id('e1'),
    _dryrun.payload('yes', '{"reasons": ["uncertified"], "note": "n"}')::text),
  '%cannot be given for a certified document%',
  'an uncertified override cannot be given for a certified document'
);

-- A draft cannot be confirmed (nothing was proposed).
select _dryrun.make_evidence('member', 'e_draft', 'n_draft');
select _dryrun.expect_error(
  _dryrun.id('admin_b'),
  format('select public.confirm_ownership_evidence(%L, %L::jsonb)::text', _dryrun.id('e_draft'), _dryrun.payload()::text),
  '%not awaiting confirmation%',
  'a draft with no proposal cannot be confirmed'
);

select _dryrun.expect_ok(
  _dryrun.id('admin_b'),
  format('select public.confirm_ownership_evidence(%L, %L::jsonb, ''checked against the register extract'')::text', _dryrun.id('e1'), _dryrun.payload()::text),
  'a different admin confirms the proposal as it is'
);
select _dryrun.expect_true(
  (select status = 'confirmed' and edited = false and reviewed_by = _dryrun.id('admin_b') and reviewed_at is not null
          and review_note = 'checked against the register extract' and confirmed is not null and certified = 'yes'
   from public.ownership_evidence where id = _dryrun.id('e1')),
  'the confirmation is recorded against the reviewer, with edited = false'
);
select _dryrun.expect_error(
  _dryrun.id('admin_b'),
  format('select public.confirm_ownership_evidence(%L, %L::jsonb)::text', _dryrun.id('e1'), _dryrun.payload()::text),
  '%not awaiting confirmation%',
  'a confirmed item cannot be confirmed again'
);

-- e2 was uploaded by member_two; admin_a confirms with an edit (a different holding).
select _dryrun.expect_ok(
  _dryrun.id('admin_a'),
  format('select public.confirm_ownership_evidence(%L, %L::jsonb)::text', _dryrun.id('e2'), _dryrun.payload('yes', null, 55)::text),
  'an admin can confirm with edits'
);
select _dryrun.expect_true(
  (select edited = true and confirmed #>> '{owners,0,holding,value}' = '55' and proposal #>> '{owners,0,holding,value}' = '60'
   from public.ownership_evidence where id = _dryrun.id('e2')),
  'an edited confirmation is flagged, and the original proposal is kept beside it'
);

-- ─── Four-eyes ────────────────────────────────────────────────────────────────

select _dryrun.make_evidence('admin_a', 'e3', 'n3');
select _dryrun.propose('admin_a', 'e3');
select _dryrun.expect_error(
  _dryrun.id('admin_a'),
  format('select public.confirm_ownership_evidence(%L, %L::jsonb)::text', _dryrun.id('e3'), _dryrun.payload()::text),
  '%Four-eyes rule%',
  'with four-eyes on, the uploader cannot confirm their own evidence, even as an admin'
);
update public.firms set four_eyes = false where id = _dryrun.id('firm');
select _dryrun.expect_ok(
  _dryrun.id('admin_a'),
  format('select public.confirm_ownership_evidence(%L, %L::jsonb)::text', _dryrun.id('e3'), _dryrun.payload()::text),
  'with four-eyes off, the uploader-admin can confirm'
);
update public.firms set four_eyes = true where id = _dryrun.id('firm');

-- ─── Overrides, and a newer confirmation supersedes the old one (which is kept) ─

select _dryrun.make_evidence('member', 'e4', 'n1');
select _dryrun.propose('member', 'e4', _dryrun.payload('no'));
select _dryrun.expect_ok(
  _dryrun.id('admin_b'),
  format('select public.confirm_ownership_evidence(%L, %L::jsonb, ''accepted for now'')::text', _dryrun.id('e4'),
    _dryrun.payload('no', '{"reasons": ["uncertified"], "note": "client cannot get a certified copy before the deadline"}')::text),
  'an admin can confirm uncertified evidence with an override and a note'
);
select _dryrun.expect_true(
  (select old.status = 'superseded' and old.superseded_by = _dryrun.id('e4') and old.superseded_at is not null
          and new.status = 'confirmed' and new.certified = 'no'
          and new.confirmed #>> '{override,reasons,0}' = 'uncertified'
          and (select count(*) from public.ownership_evidence
               where client_id = _dryrun.id('client') and node_key = 'FOREIGN:NO:n1' and status = 'confirmed') = 1
          and (select count(*) from public.ownership_evidence
               where client_id = _dryrun.id('client') and node_key = 'FOREIGN:NO:n1') = 2
   from public.ownership_evidence old, public.ownership_evidence new
   where old.id = _dryrun.id('e1') and new.id = _dryrun.id('e4')),
  'confirming a new item supersedes the old one; both rows stay and only one is confirmed'
);

-- ─── Rejecting and withdrawing ────────────────────────────────────────────────

select _dryrun.make_evidence('member', 'e5', 'n5');
select _dryrun.propose('member', 'e5');
select _dryrun.expect_error(
  _dryrun.id('member_two'),
  format('select public.reject_ownership_evidence(%L, ''no'')::text', _dryrun.id('e5')),
  '%only an admin, or the person who uploaded%',
  'another member cannot reject someone else''s evidence'
);
select _dryrun.expect_error(
  _dryrun.id('read_only'),
  format('select public.reject_ownership_evidence(%L, ''no'')::text', _dryrun.id('e5')),
  'permission denied%',
  'read_only cannot reject'
);
select _dryrun.expect_error(
  _dryrun.id('admin_b'),
  format('select public.reject_ownership_evidence(%L, ''   '')::text', _dryrun.id('e5')),
  '%note is required%',
  'rejecting needs a note'
);
select _dryrun.expect_ok(
  _dryrun.id('member'),
  format('select public.reject_ownership_evidence(%L, ''uploaded the wrong file'')::text', _dryrun.id('e5')),
  'the uploader can withdraw their own evidence with a note'
);
select _dryrun.expect_true(
  (select status = 'rejected' and review_note = 'uploaded the wrong file' and reviewed_by = _dryrun.id('member')
   from public.ownership_evidence where id = _dryrun.id('e5')),
  'a withdrawn item is kept as rejected, with the note'
);

select _dryrun.make_evidence('member', 'e6', 'n5');
select _dryrun.propose('member', 'e6');
select _dryrun.expect_ok(
  _dryrun.id('admin_b'),
  format('select public.reject_ownership_evidence(%L, ''holdings do not add up'')::text', _dryrun.id('e6')),
  'an admin can reject proposed evidence with a note'
);
select _dryrun.expect_error(
  _dryrun.id('admin_a'),
  format('select public.confirm_ownership_evidence(%L, %L::jsonb)::text', _dryrun.id('e6'), _dryrun.payload()::text),
  '%not awaiting confirmation%',
  'a rejected item cannot be confirmed'
);
select _dryrun.expect_error(
  _dryrun.id('admin_b'),
  format('select public.reject_ownership_evidence(%L, ''too late'')::text', _dryrun.id('e4')),
  '%not open%',
  'confirmed evidence cannot be rejected'
);

-- ─── Immutability: nothing is deleted, nothing confirmed changes ──────────────

select _dryrun.expect_direct_error(
  format('update public.ownership_evidence set review_note = ''edited'' where id = %L', _dryrun.id('e4')),
  '%confirmed and cannot change except to be superseded%',
  'a confirmed item cannot be edited'
);
select _dryrun.expect_direct_error(
  format('update public.ownership_evidence set confirmed = %L::jsonb where id = %L', _dryrun.payload('yes', null, 99)::text, _dryrun.id('e4')),
  '%confirmed and cannot change%',
  'the confirmed payload cannot be replaced'
);
select _dryrun.expect_direct_error(
  format('update public.ownership_evidence set review_note = ''edited'' where id = %L', _dryrun.id('e1')),
  '%is superseded and cannot change%',
  'a superseded item cannot change'
);
select _dryrun.expect_direct_error(
  format('update public.ownership_evidence set review_note = ''edited'' where id = %L', _dryrun.id('e5')),
  '%is rejected and cannot change%',
  'a rejected item cannot change'
);
select _dryrun.expect_direct_error(
  format('update public.ownership_evidence set node_key = ''FOREIGN:NO:other'' where id = %L', _dryrun.id('e_draft')),
  '%immutable%',
  'an item''s node cannot be changed'
);
select _dryrun.expect_direct_error(
  format('update public.ownership_evidence set document_sha256 = %L where id = %L', repeat('c', 64), _dryrun.id('e_draft')),
  '%immutable%',
  'an item''s document hash cannot be changed'
);
select _dryrun.expect_direct_error(
  format('update public.ownership_evidence set status = ''confirmed'' where id = %L', _dryrun.id('e_draft')),
  '%invalid ownership evidence status change%',
  'status cannot jump from draft to confirmed outside the RPC'
);
select _dryrun.expect_direct_error(
  format('delete from public.ownership_evidence where id = %L', _dryrun.id('e_draft')),
  '%never deleted%',
  'a draft is never deleted'
);
select _dryrun.expect_direct_error(
  format('delete from public.ownership_evidence where id = %L', _dryrun.id('e1')),
  '%never deleted%',
  'a superseded item is never deleted'
);
select _dryrun.expect_direct_error(
  format('delete from public.ownership_evidence where id = %L', _dryrun.id('e4')),
  '%never deleted%',
  'a confirmed item is never deleted'
);
select _dryrun.expect_direct_error(
  format('delete from public.ownership_evidence where id = %L', _dryrun.id('e5')),
  '%never deleted%',
  'a rejected item is never deleted'
);
select _dryrun.expect_error(
  _dryrun.id('admin_a'),
  format('delete from public.ownership_evidence where id = %L', _dryrun.id('e_draft')),
  '%permission denied%',
  'the API role has no delete privilege on the table'
);
select _dryrun.expect_error(
  _dryrun.id('admin_a'),
  format('update public.ownership_evidence set review_note = ''x'' where id = %L', _dryrun.id('e_draft')),
  '%permission denied%',
  'the API role has no update privilege on the table'
);
select _dryrun.expect_error(
  _dryrun.id('admin_a'),
  format('insert into public.ownership_evidence (firm_id, client_id, document_id, subject_id, node_key, node_name, node_identity, evidence_kind, document_sha256, created_by) values (%L, %L, %L, ''S'', ''k'', ''n'', ''{"lei": "529900ABCDEFGHIJKL12"}'', ''register_extract'', %L, %L)',
    _dryrun.id('firm'), _dryrun.id('client'), (select document_id from public.ownership_evidence where id = _dryrun.id('e_draft')), repeat('b', 64), _dryrun.id('admin_a')),
  '%permission denied%',
  'the API role cannot insert evidence directly'
);

-- ─── Row-level security and the names-free overview ───────────────────────────

select _dryrun.expect_true(
  (select val::int >= 6 from _dryrun.try_as(_dryrun.id('member'), 'select count(*)::text from public.ownership_evidence')),
  'a member can read the firm''s evidence rows'
);
select _dryrun.expect_true(
  (select val::int >= 6 from _dryrun.try_as(_dryrun.id('admin_b'), 'select count(*)::text from public.ownership_evidence')),
  'an admin can read the firm''s evidence rows'
);
select _dryrun.expect_true(
  (select val = '0' from _dryrun.try_as(_dryrun.id('read_only'), 'select count(*)::text from public.ownership_evidence')),
  'read_only cannot read the table (it holds names)'
);
select _dryrun.expect_true(
  (select val = '0' from _dryrun.try_as(_dryrun.id('outsider'), 'select count(*)::text from public.ownership_evidence')),
  'another firm''s admin sees none of this firm''s evidence'
);
select _dryrun.expect_true(
  (select val::int >= 6 from _dryrun.try_as(_dryrun.id('read_only'), 'select count(*)::text from public.ownership_evidence_overview')),
  'read_only can read the names-free overview'
);
select _dryrun.expect_true(
  (select val = '0' from _dryrun.try_as(_dryrun.id('outsider'), 'select count(*)::text from public.ownership_evidence_overview')),
  'the overview is limited to the viewer''s own firms'
);
select _dryrun.expect_true(
  (select count(*) = 0 from information_schema.columns
   where table_schema = 'public' and table_name = 'ownership_evidence_overview'
     and column_name in ('proposal', 'confirmed', 'raw_response', 'model_used', 'certified_by', 'review_note', 'document_id', 'node_identity')),
  'the overview carries no payload, no reviewer text and no document reference'
);
select _dryrun.expect_true(
  (select val = 'true' from _dryrun.try_as(_dryrun.id('read_only'),
     format('select has_override::text from public.ownership_evidence_overview where id = %L', _dryrun.id('e4')))),
  'the overview shows that an override exists, not its text'
);

-- ─── confirmed_evidence_for: names for admins and members, initials only for read_only ──

select _dryrun.expect_true(
  (select i #>> '{payload,owners,0,name_as_shown}' = 'Testperson Alpha'
   from _dryrun.try_as(_dryrun.id('admin_a'),
          format('select public.confirmed_evidence_for(%L, ''SUBJ1'')::text', _dryrun.id('client'))) r,
        jsonb_array_elements(r.val::jsonb) i
   where i ->> 'node_key' = 'FOREIGN:NO:n2'),
  'an admin receives the individual''s name as shown'
);
select _dryrun.expect_true(
  (select (i -> 'payload' -> 'owners' -> 0) = '{"kind": "individual", "initials": "T.A.", "holding": {"type": "percent", "value": 55}, "page_ref": "p.3, table 2"}'::jsonb
      and (i -> 'payload' -> 'owners' -> 1 ->> 'name_as_shown') = 'Example Holdings AS'
      and position('Testperson' in r.val) = 0
   from _dryrun.try_as(_dryrun.id('read_only'),
          format('select public.confirmed_evidence_for(%L, ''SUBJ1'')::text', _dryrun.id('client'))) r,
        jsonb_array_elements(r.val::jsonb) i
   where i ->> 'node_key' = 'FOREIGN:NO:n2'),
  'read_only receives initials for individuals and no name; an entity''s name is kept'
);
select _dryrun.expect_true(
  (select jsonb_array_length(val::jsonb) = 3
      and (select count(*) from jsonb_array_elements(val::jsonb) i where i ->> 'node_key' = 'FOREIGN:NO:n1') = 1
      and (select i ->> 'id' from jsonb_array_elements(val::jsonb) i where i ->> 'node_key' = 'FOREIGN:NO:n1') = _dryrun.id('e4')::text
   from _dryrun.try_as(_dryrun.id('member'),
     format('select public.confirmed_evidence_for(%L, ''SUBJ1'')::text', _dryrun.id('client')))),
  'only confirmed items come back (n1 from the newer item e4, n2, n3); drafts, rejected and superseded do not'
);
select _dryrun.expect_error(
  _dryrun.id('outsider'),
  format('select public.confirmed_evidence_for(%L, ''SUBJ1'')::text', _dryrun.id('client')),
  '%not an active member%',
  'another firm cannot read this client''s evidence through the function'
);
select _dryrun.expect_true(
  (select val = '[]' from _dryrun.try_as(_dryrun.id('member'),
     format('select public.confirmed_evidence_for(%L, ''OTHER-SUBJECT'')::text', _dryrun.id('client')))),
  'evidence for a different walk subject is not returned'
);

-- ─── Audit events: ids, kinds, counts and hashes, never names ─────────────────

select _dryrun.expect_true(
  (select count(*) filter (where event_type = 'ownership_evidence.created') = 7
      and count(*) filter (where event_type = 'ownership_evidence.proposed') = 7
      and count(*) filter (where event_type = 'ownership_evidence.confirmed') = 4
      and count(*) filter (where event_type = 'ownership_evidence.rejected') = 2
      and count(*) filter (where event_type = 'ownership_evidence.superseded') = 1
   from public.audit_events
   where firm_id = _dryrun.id('firm') and event_type like 'ownership_evidence.%'),
  'every open, proposal, confirmation, rejection and supersede wrote an audit event'
);
select _dryrun.expect_true(
  (select payload ->> 'edited' = 'false' and (payload ->> 'four_eyes')::boolean = true
          and payload ->> 'uploaded_by' = _dryrun.id('member')::text and payload ->> 'confirmed_by' = _dryrun.id('admin_b')::text
          and (payload ->> 'confirmed_sha256') ~ '^[0-9a-f]{64}$' and payload ->> 'document_sha256' = repeat('b', 64)
          and (payload ->> 'owner_count')::int = 2 and payload -> 'override_reasons' = '[]'::jsonb
   from public.audit_events where entity_id = _dryrun.id('e1') and event_type = 'ownership_evidence.confirmed'),
  'the confirm event records who, edited or not, four-eyes, the document hash and a hash of what was confirmed'
);
select _dryrun.expect_true(
  (select payload -> 'override_reasons' = '["uncertified"]'::jsonb and (payload ->> 'override_note_given')::boolean
          and payload ->> 'superseded' = _dryrun.id('e1')::text
   from public.audit_events where entity_id = _dryrun.id('e4') and event_type = 'ownership_evidence.confirmed'),
  'an override''s reasons, and what it superseded, are in the confirm event'
);
select _dryrun.expect_true(
  (select (payload ->> 'withdrawn')::boolean = true
   from public.audit_events where entity_id = _dryrun.id('e5') and event_type = 'ownership_evidence.rejected')
  and (select (payload ->> 'withdrawn')::boolean = false
   from public.audit_events where entity_id = _dryrun.id('e6') and event_type = 'ownership_evidence.rejected'),
  'the reject event says whether it was the uploader withdrawing'
);
select _dryrun.expect_true(
  (select count(*) = 0 from public.audit_events
   where firm_id = _dryrun.id('firm')
     and (event_type like 'ownership_evidence.%' or event_type = 'firm.evidence_extraction_changed')
     and (payload::text ilike '%Testperson%' or payload::text ilike '%Example Holdings%' or payload::text ilike '%Company secretary%'
          or payload::text ilike '%certified copy%')),
  'no audit payload contains an owner''s name, an entity name or a certifier'
);

-- ─── Refresh packs: the snapshot stays initials-only and keeps passing the personal-data check ──

select _dryrun.expect_ok(
  _dryrun.id('member'),
  format(
    'select public.create_refresh_pack(%L, ''03261722'', ''ACME LTD'', %L::jsonb, %L::jsonb, %L)::text',
    _dryrun.id('firm'),
    '{"threshold": 25, "acceptClientEvidenceAsResolved": true, "maxEvidenceAgeMonths": 12}',
    '{"version": 1, "subject": {"id": "03261722", "kind": "company", "name": "ACME LTD"}, "policy": {"threshold": 25, "acceptClientEvidenceAsResolved": true, "maxEvidenceAgeMonths": 12}, "profile": [], "sourceLog": [], "clientEvidence": [{"id": "11111111-1111-4111-8111-111111111111", "kind": "shareholder_register", "asAt": "2026-06-30", "documentDate": "2026-07-15", "certified": "yes", "certifiedBy": "company secretary", "confirmedAt": "2026-10-16T09:00:00Z", "documentSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "label": "client-provided, reviewer-verified", "override": null, "owners": ["T.A."]}]}',
    repeat('a', 64)
  ),
  'a snapshot with client-evidence blocks (initials only) is accepted'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format(
    'select public.create_refresh_pack(%L, ''03261722'', ''ACME LTD'', %L::jsonb, %L::jsonb, %L)::text',
    _dryrun.id('firm'),
    '{"threshold": 25}',
    '{"version": 1, "subject": {"id": "03261722"}, "policy": {"threshold": 25}, "clientEvidence": [{"id": "1", "owners": [{"initials": "T.A.", "nationality": "NO"}]}]}',
    repeat('a', 64)
  ),
  '%check constraint%',
  'a personal-data key inside a client-evidence block is still rejected by the snapshot check'
);
select _dryrun.expect_error(
  _dryrun.id('member'),
  format(
    'select public.create_refresh_pack(%L, ''03261722'', ''ACME LTD'', %L::jsonb, %L::jsonb, %L)::text',
    _dryrun.id('firm'),
    '{"threshold": 25}',
    '{"version": 1, "subject": {"id": "03261722"}, "policy": {"threshold": 25}, "clientEvidence": [{"id": "1", "date_of_birth": "1970-01-01"}]}',
    repeat('a', 64)
  ),
  '%check constraint%',
  'a date of birth next to a client-evidence reference is rejected too'
);

-- ─── Done ─────────────────────────────────────────────────────────────────────

select _dryrun.finish();
