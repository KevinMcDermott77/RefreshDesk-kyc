// Builds supabase/tests/permissions.dryrun.sql: BEGIN; a one-transaction guard; the Slice 0b
// migration; the permission tests; ROLLBACK. Paste the result into the Supabase dashboard SQL
// editor to try the migration without keeping any of it.
//
//   node supabase/tests/build-dryrun.cjs
//
// Re-run it whenever the migration or permissions.test.sql or helpers.sql changes.
//
// The only BEGIN is the first statement of the output and the only ROLLBACK is the last. The
// build fails if the migration or the tests contain a transaction-control statement of their own
// (BEGIN, COMMIT, END, ROLLBACK, ABORT, START TRANSACTION, SAVEPOINT, RELEASE), or anything else
// that cannot run inside a transaction block.
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const migrationFile = path.join(root, 'migrations', '20261014000000_slice0b_permissions.sql')
const testsFiles = [path.join(__dirname, 'helpers.sql'), path.join(__dirname, 'permissions.test.sql')]
const outFile = path.join(__dirname, 'permissions.dryrun.sql')

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

/**
 * The top-level statements of a SQL script, as text with comments, string literals, quoted
 * identifiers and dollar-quoted bodies (function bodies, DO blocks) blanked out. A plpgsql
 * "begin" or "end;" inside a function body is therefore never mistaken for a statement.
 */
function topLevelStatements(sql) {
  const statements = []
  let current = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]
    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++
    } else if (c === '/' && next === '*') {
      let depth = 1
      i += 2
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') (depth++, (i += 2))
        else if (sql[i] === '*' && sql[i + 1] === '/') (depth--, (i += 2))
        else i++
      }
    } else if (c === "'") {
      i++
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2
        else if (sql[i] === "'") break
        else i++
      }
      i++
      current += "''"
    } else if (c === '"') {
      i++
      while (i < n && sql[i] !== '"') i++
      i++
      current += '""'
    } else if (c === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length)
        if (close < 0) throw new Error('unterminated dollar-quoted string')
        i = close + tag[0].length
        current += '$$'
      } else {
        current += c
        i++
      }
    } else if (c === ';') {
      if (current.trim()) statements.push(current.trim())
      current = ''
      i++
    } else {
      current += c
      i++
    }
  }
  if (current.trim()) statements.push(current.trim())
  return statements
}

const TRANSACTION_CONTROL = /^(begin|commit|end|rollback|abort|start\s+transaction|savepoint|release|prepare\s+transaction|commit\s+prepared|rollback\s+prepared)\b/i
const NOT_IN_TRANSACTION = [
  /^create\s+(unique\s+)?index\s+concurrently/i,
  /^drop\s+index\s+concurrently/i,
  /^reindex\b.*\bconcurrently/i,
  /^alter\s+type\b.*\badd\s+value/i,
  /^vacuum\b/i,
  /^create\s+database\b/i,
  /^drop\s+database\b/i,
  /^create\s+tablespace\b/i,
  /^alter\s+system\b/i,
  /^cluster\b/i,
]

function check(label, sql) {
  const problems = []
  for (const statement of topLevelStatements(sql)) {
    const text = statement.replace(/\s+/g, ' ')
    if (TRANSACTION_CONTROL.test(text)) problems.push(`transaction control: "${text.slice(0, 60)}"`)
    if (NOT_IN_TRANSACTION.some((pattern) => pattern.test(text))) problems.push(`cannot run in a transaction: "${text.slice(0, 60)}"`)
  }
  if (problems.length > 0) {
    console.error(`${label} contains statements that must not be in a dry run:\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
}

const migration = read(migrationFile)
const tests = testsFiles.map(read).join('\n\n')
check('The migration', migration)
check('the test files', tests)

// A self-test of the scanner, so a change to it cannot silently let a COMMIT through.
{
  const sample = "select 1; do $$ begin commit; end $$; -- commit;\n/* rollback; */ select 'end;'; begin;"
  const found = topLevelStatements(sample)
  if (found.length !== 4 || !TRANSACTION_CONTROL.test(found[3]) || found.slice(0, 3).some((s) => TRANSACTION_CONTROL.test(s))) {
    console.error('build-dryrun.cjs: the statement scanner failed its self-test')
    process.exit(1)
  }
}

const out = `-- DRY RUN for Slice 0b. Paste the whole file into the Supabase dashboard SQL editor and run it once.
--
-- BEGIN; a guard; the migration; the permission tests; ROLLBACK. The migration is undone and the test
-- users, firms and clients are never committed. No real data is read or changed.
-- Read the NOTICE lines: 'PASS: <name>' per check, then 'ALL PERMISSION TESTS PASSED'.
-- A failure stops the script with an error 'FAIL: <name>: <detail>'; the transaction is then abandoned.
--
-- The guard (right after BEGIN) stops the script before the migration if the editor is not running it
-- as ONE transaction. That matters: if each statement were committed on its own, a "dry run" would
-- really apply the migration. If you see 'ABORTED: ... not running the script as one transaction',
-- run  drop schema if exists _dryrun cascade;  and use scripts/run-dryrun.cjs instead.
--
-- Generated by supabase/tests/build-dryrun.cjs from:
--   supabase/migrations/20261014000000_slice0b_permissions.sql
--   supabase/tests/helpers.sql and supabase/tests/permissions.test.sql

begin;

-- ##### GUARD #####

drop schema if exists _dryrun cascade;
create schema _dryrun;
create table _dryrun.guard (txid bigint not null, who name not null);
insert into _dryrun.guard values (txid_current(), current_user);

do $$
begin
  if (select txid from _dryrun.guard) <> txid_current() then
    raise exception 'ABORTED: the SQL editor is not running the script as one transaction, so nothing here would be undone. Nothing from the migration has run. Run: drop schema if exists _dryrun cascade;';
  end if;
  raise notice 'guard ok: one transaction (txid %), running as %', txid_current(), current_user;
end;
$$;

-- ##### MIGRATION: 20261014000000_slice0b_permissions.sql #####

${migration.trim()}

-- ##### PERMISSION TESTS #####

${tests.trim()}

rollback;
`

// The only BEGIN is the first statement and the only ROLLBACK is the last.
const control = topLevelStatements(out).filter((s) => TRANSACTION_CONTROL.test(s.replace(/\s+/g, ' ')))
const all = topLevelStatements(out)
if (control.length !== 2 || !/^begin$/i.test(all[0]) || !/^rollback$/i.test(all[all.length - 1])) {
  console.error('The dry run must have exactly one BEGIN (first) and one ROLLBACK (last):', control)
  process.exit(1)
}

fs.writeFileSync(outFile, out)
console.log(`wrote ${path.relative(process.cwd(), outFile)} (${out.split('\n').length} lines)`)
