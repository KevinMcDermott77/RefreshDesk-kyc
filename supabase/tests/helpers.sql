-- Helpers shared by the Slice 0b and Slice 6 SQL tests (supabase/tests/*.test.sql).
--
-- Run this FIRST, inside the transaction that will be rolled back, then a test file. It has no
-- BEGIN, COMMIT or ROLLBACK. Scratch objects live in the _dryrun schema (not pg_temp: temp tables
-- are private to one session and the tests switch roles); the ROLLBACK removes them.
--
-- Each check prints NOTICE 'PASS: <name>' or raises 'FAIL: <name>: <detail>'.
-- _dryrun.finish() prints 'ALL PERMISSION TESTS PASSED' and the count.

drop schema if exists _dryrun cascade;
create schema _dryrun;
grant usage on schema _dryrun to authenticated;
create table _dryrun.guard (txid bigint not null, who name not null);
insert into _dryrun.guard values (txid_current(), current_user);
create table _dryrun.t_ids (name text primary key, id uuid not null);
create table _dryrun.t_count (n int not null);
insert into _dryrun.t_count values (0);
grant select on all tables in schema _dryrun to authenticated;

-- Runs one statement as p_user (null = signed out) with the role the API uses, and returns its
-- error message (null if it succeeded) and first column. The statement text must not read the
-- scratch tables: build it with _dryrun.id() before calling.
create function _dryrun.try_as(p_user uuid, p_sql text)
returns table (err text, val text)
language plpgsql
as $$
declare
  v_err text;
  v_val text;
  v_back name;
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
  -- Back to the role the script started as (RESET ROLE goes to the session user, which may differ).
  select who into v_back from _dryrun.guard;
  if current_user <> v_back then
    execute format('set local role %I', v_back);
  end if;
  return query select v_err, v_val;
end;
$$;

create function _dryrun.id(p_name text) returns uuid language sql as $$
  select id from _dryrun.t_ids where name = p_name;
$$;

create function _dryrun.pass(p_name text) returns void language plpgsql as $$
begin
  update _dryrun.t_count set n = n + 1;
  raise notice 'PASS: %', p_name;
end;
$$;

-- The call must fail with a message matching p_pattern (ILIKE).
create function _dryrun.expect_error(p_user uuid, p_sql text, p_pattern text, p_name text)
returns void language plpgsql as $$
declare
  v_err text;
begin
  select r.err into v_err from _dryrun.try_as(p_user, p_sql) r;
  if v_err is null then
    raise exception 'FAIL: %: expected an error like "%" but the call succeeded', p_name, p_pattern;
  end if;
  if v_err not ilike p_pattern then
    raise exception 'FAIL: %: expected an error like "%" but got "%"', p_name, p_pattern, v_err;
  end if;
  perform _dryrun.pass(p_name);
end;
$$;

-- The call must succeed; returns its first column.
create function _dryrun.expect_ok(p_user uuid, p_sql text, p_name text)
returns text language plpgsql as $$
declare
  v_err text;
  v_val text;
begin
  select r.err, r.val into v_err, v_val from _dryrun.try_as(p_user, p_sql) r;
  if v_err is not null then
    raise exception 'FAIL: %: unexpected error "%"', p_name, v_err;
  end if;
  perform _dryrun.pass(p_name);
  return v_val;
end;
$$;

create function _dryrun.expect_true(p_condition boolean, p_name text) returns void language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'FAIL: %: the condition was not true', p_name;
  end if;
  perform _dryrun.pass(p_name);
end;
$$;

-- Resets the remembered ids between test files.
create function _dryrun.reset_ids() returns void language sql as $$
  truncate _dryrun.t_ids;
$$;

-- Prints the result. Call it as the last statement of a test file.
create function _dryrun.finish() returns void language plpgsql as $$
declare
  v_checks int;
begin
  select n into v_checks from _dryrun.t_count;
  raise notice 'ALL PERMISSION TESTS PASSED';
  raise notice '% checks ran', v_checks;
end;
$$;
