-- Slice 0b permission tests. Plain SQL, no extensions; everything runs inside one transaction
-- that is rolled back at the end, so nothing is left behind.
--
-- Run against a database that has the migrations applied (local stack or a branch):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/permissions.test.sql
-- It prints NOTICE "ok - ..." per check, "ALL N CHECKS PASSED" at the end, and stops with
-- an exception at the first failure.
--
-- Users are simulated by setting the JWT claim GUCs that auth.uid() reads. The SECURITY DEFINER
-- RPCs run as their owner, so the session role does not matter.

begin;

create temp table t_ids (name text primary key, id uuid not null) on commit drop;
create temp table t_count (n int not null) on commit drop;
insert into t_count values (0);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform set_config(
    'request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end,
    true
  );
end;
$$;

create function pg_temp.id(p_name text) returns uuid language sql as $$
  select id from t_ids where name = p_name;
$$;

create function pg_temp.pass(p_label text) returns void language plpgsql as $$
begin
  update t_count set n = n + 1;
  raise notice 'ok - %', p_label;
end;
$$;

-- The statement must raise an error whose message matches p_pattern (ILIKE).
create function pg_temp.expect_error(p_sql text, p_pattern text, p_label text) returns void language plpgsql as $$
declare
  v_matched boolean := false;
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike p_pattern then
      v_matched := true;
    else
      raise exception 'FAIL - %: expected an error like "%" but got "%"', p_label, p_pattern, sqlerrm;
    end if;
  end;
  if not v_matched then
    raise exception 'FAIL - %: expected an error like "%" but the statement succeeded', p_label, p_pattern;
  end if;
  perform pg_temp.pass(p_label);
end;
$$;

create function pg_temp.expect_ok(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise exception 'FAIL - %: unexpected error "%"', p_label, sqlerrm;
  end;
  perform pg_temp.pass(p_label);
end;
$$;

create function pg_temp.expect_true(p_condition boolean, p_label text) returns void language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'FAIL - %', p_label;
  end if;
  perform pg_temp.pass(p_label);
end;
$$;

-- Records a fetched record: act as p_user and save an entity CDD record, remembering its id.
create function pg_temp.fetch_record(p_user text, p_key text) returns void language plpgsql as $$
declare
  v_id uuid;
begin
  perform pg_temp.act_as(pg_temp.id(p_user));
  v_id := public.save_entity_cdd(
    pg_temp.id('client'), '00000001', null,
    '{"company_name": "Test Co"}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'full'
  );
  insert into t_ids values (p_key, v_id);
end;
$$;

-- ─── Fixtures (as the connecting superuser; RLS does not apply) ───────────────

insert into t_ids select n, gen_random_uuid() from unnest(array[
  'fetcher_admin', 'second_admin', 'member', 'read_only', 'outsider', 'firm', 'other_firm', 'client'
]) as n;

insert into auth.users (id, email)
select id, name || '@permissions.test' from t_ids
where name in ('fetcher_admin', 'second_admin', 'member', 'read_only', 'outsider');

insert into public.firms (id, name, slug)
values
  (pg_temp.id('firm'), 'Permissions Test Firm', 'permissions-test-' || substr(gen_random_uuid()::text, 1, 8)),
  (pg_temp.id('other_firm'), 'Other Firm', 'permissions-other-' || substr(gen_random_uuid()::text, 1, 8));

insert into public.firm_members (firm_id, user_id, full_name, role)
values
  (pg_temp.id('firm'), pg_temp.id('fetcher_admin'), 'Fetcher Admin', 'admin'),
  (pg_temp.id('firm'), pg_temp.id('second_admin'), 'Second Admin', 'admin'),
  (pg_temp.id('firm'), pg_temp.id('member'), 'Plain Member', 'member'),
  (pg_temp.id('firm'), pg_temp.id('read_only'), 'Read Only', 'read_only'),
  (pg_temp.id('other_firm'), pg_temp.id('outsider'), 'Outsider', 'admin');

insert into public.firm_refresh_rules (firm_id, risk_rating, cadence_months)
values (pg_temp.id('firm'), 'standard', 12);

insert into public.clients (id, firm_id, client_type, display_name, risk_rating)
values (pg_temp.id('client'), pg_temp.id('firm'), 'entity', 'Test Entity Ltd', 'standard');

-- ─── Defaults ─────────────────────────────────────────────────────────────────

select pg_temp.expect_true(
  (select four_eyes from public.firms where id = pg_temp.id('firm')),
  'four_eyes defaults to true'
);

-- ─── require_role ─────────────────────────────────────────────────────────────

select pg_temp.act_as(pg_temp.id('member'));
select pg_temp.expect_true(
  public.require_role(pg_temp.id('firm'), array['admin', 'member']) = 'member',
  'require_role returns the caller''s role when allowed'
);
select pg_temp.expect_error(
  format('select public.require_role(%L, array[''admin''])', pg_temp.id('firm')),
  'permission denied%',
  'require_role rejects a role that is not listed'
);
select pg_temp.expect_error(
  format('select public.require_role(%L, array[''admin'', ''member''])', pg_temp.id('other_firm')),
  '%not an active member%',
  'require_role rejects a user from another firm'
);
select pg_temp.act_as(null);
select pg_temp.expect_error(
  format('select public.require_role(%L, array[''admin''])', pg_temp.id('firm')),
  '%authentication required%',
  'require_role rejects an unauthenticated caller'
);

-- ─── save_entity_cdd ──────────────────────────────────────────────────────────

select pg_temp.act_as(pg_temp.id('read_only'));
select pg_temp.expect_error(
  format(
    'select public.save_entity_cdd(%L, ''00000001'', null, ''{}''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''full'')',
    pg_temp.id('client')
  ),
  'permission denied%',
  'read_only is blocked from save_entity_cdd'
);

select pg_temp.act_as(pg_temp.id('outsider'));
select pg_temp.expect_error(
  format(
    'select public.save_entity_cdd(%L, ''00000001'', null, ''{}''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''full'')',
    pg_temp.id('client')
  ),
  '%not an active member%',
  'a user from another firm is blocked from save_entity_cdd'
);

select pg_temp.act_as(null);
select pg_temp.expect_error(
  format(
    'select public.save_entity_cdd(%L, ''00000001'', null, ''{}''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''full'')',
    pg_temp.id('client')
  ),
  '%authenticated user%',
  'an unauthenticated caller is blocked from save_entity_cdd'
);

select pg_temp.fetch_record('member', 'rec_member');
select pg_temp.expect_true(
  (select fetched_by from public.entity_cdd_records where id = pg_temp.id('rec_member')) = pg_temp.id('member'),
  'save_entity_cdd sets fetched_by from auth.uid() (member)'
);

select pg_temp.fetch_record('fetcher_admin', 'rec_a');
select pg_temp.expect_true(
  (select fetched_by from public.entity_cdd_records where id = pg_temp.id('rec_a')) = pg_temp.id('fetcher_admin'),
  'save_entity_cdd sets fetched_by from auth.uid() (admin)'
);

-- ─── review_entity_cdd ────────────────────────────────────────────────────────

select pg_temp.act_as(pg_temp.id('read_only'));
select pg_temp.expect_error(
  format('select public.review_entity_cdd(%L, ''approved'')', pg_temp.id('rec_a')),
  'permission denied%',
  'read_only is blocked from approving'
);
select pg_temp.expect_error(
  format('select public.review_entity_cdd(%L, ''rejected'')', pg_temp.id('rec_a')),
  'permission denied%',
  'read_only is blocked from rejecting'
);

select pg_temp.act_as(pg_temp.id('member'));
select pg_temp.expect_error(
  format('select public.review_entity_cdd(%L, ''approved'')', pg_temp.id('rec_a')),
  'permission denied%',
  'member is blocked from approving'
);

select pg_temp.act_as(pg_temp.id('outsider'));
select pg_temp.expect_error(
  format('select public.review_entity_cdd(%L, ''approved'')', pg_temp.id('rec_a')),
  '%not an active member%',
  'a user from another firm is blocked from approving'
);

-- Four-eyes ON (the default): the fetcher cannot approve their own record.
select pg_temp.act_as(pg_temp.id('fetcher_admin'));
select pg_temp.expect_error(
  format('select public.review_entity_cdd(%L, ''approved'')', pg_temp.id('rec_a')),
  'Four-eyes rule: the person who fetched this record cannot approve it',
  'the fetcher is blocked from approving with four_eyes on'
);
select pg_temp.expect_true(
  (select status from public.entity_cdd_records where id = pg_temp.id('rec_a')) = 'pending_review',
  'the blocked approval left the record pending'
);

-- ...but may reject their own fetch.
select pg_temp.fetch_record('fetcher_admin', 'rec_reject');
select pg_temp.expect_ok(
  format('select public.review_entity_cdd(%L, ''rejected'', ''fetched the wrong company'')', pg_temp.id('rec_reject')),
  'the fetcher may reject their own record with four_eyes on'
);

-- A second reviewer is allowed.
select pg_temp.act_as(pg_temp.id('second_admin'));
select pg_temp.expect_ok(
  format('select public.review_entity_cdd(%L, ''approved'', ''checked against the register'')', pg_temp.id('rec_a')),
  'a second admin may approve with four_eyes on'
);
select pg_temp.expect_true(
  (select status = 'approved' and reviewed_by = pg_temp.id('second_admin')
   from public.entity_cdd_records where id = pg_temp.id('rec_a')),
  'the approval is recorded against the second reviewer'
);
select pg_temp.expect_true(
  (select (payload ->> 'four_eyes')::boolean and payload ->> 'fetched_by' = pg_temp.id('fetcher_admin')::text and payload ->> 'note' is null
   from public.audit_events
   where event_type = 'entity_cdd.approved' and (payload ->> 'record_id')::uuid = pg_temp.id('rec_a')),
  'the approval audit event records four_eyes and fetched_by, with no note'
);

-- Four-eyes OFF: the fetcher may approve their own record.
update public.firms set four_eyes = false where id = pg_temp.id('firm');
select pg_temp.fetch_record('fetcher_admin', 'rec_off');
select pg_temp.expect_ok(
  format('select public.review_entity_cdd(%L, ''approved'')', pg_temp.id('rec_off')),
  'the fetcher may approve their own record with four_eyes off'
);
update public.firms set four_eyes = true where id = pg_temp.id('firm');

-- Old rows: fetched_by is null, so the approval is allowed but logged with a note.
select pg_temp.fetch_record('fetcher_admin', 'rec_old');
update public.entity_cdd_records set fetched_by = null where id = pg_temp.id('rec_old');
select pg_temp.act_as(pg_temp.id('fetcher_admin'));
select pg_temp.expect_ok(
  format('select public.review_entity_cdd(%L, ''approved'')', pg_temp.id('rec_old')),
  'an approval is allowed when fetched_by is null'
);
select pg_temp.expect_true(
  (select payload ->> 'note' like 'Four-eyes could not be checked%'
   from public.audit_events
   where event_type = 'entity_cdd.approved' and (payload ->> 'record_id')::uuid = pg_temp.id('rec_old')),
  'that approval is logged with a note'
);

-- ─── Other write RPCs ─────────────────────────────────────────────────────────

select pg_temp.act_as(pg_temp.id('read_only'));
select pg_temp.expect_error(
  format('select public.create_client(%L, ''individual'', ''Nobody'', ''standard'', ''{}''::jsonb)', pg_temp.id('firm')),
  'permission denied%',
  'read_only is blocked from create_client'
);
select pg_temp.expect_error(
  format('select public.import_clients(%L, ''[]''::jsonb)', pg_temp.id('firm')),
  'permission denied%',
  'read_only is blocked from import_clients'
);

select pg_temp.act_as(pg_temp.id('member'));
select pg_temp.expect_ok(
  format(
    'select public.create_client(%L, ''individual'', ''Allowed Person'', ''standard'', ''{"date_of_birth": "1980-01-01"}''::jsonb)',
    pg_temp.id('firm')
  ),
  'member may create_client'
);

-- ─── Backfill ─────────────────────────────────────────────────────────────────

-- The same statement as the migration's backfill, on a record whose actor is in the audit trail.
select pg_temp.act_as(null);
insert into t_ids values ('rec_backfill', gen_random_uuid());
insert into public.entity_cdd_records (id, firm_id, client_id, company_number, status)
values (pg_temp.id('rec_backfill'), pg_temp.id('firm'), pg_temp.id('client'), '00000002', 'pending_review');
insert into public.audit_events (firm_id, actor_user_id, event_type, entity_type, entity_id, payload)
values (
  pg_temp.id('firm'), pg_temp.id('member'), 'entity_cdd.fetched', 'client', pg_temp.id('client'),
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
  'backfill takes fetched_by from the entity_cdd.fetched audit event'
);

select 'ALL ' || n || ' CHECKS PASSED' as result from t_count;

rollback;
