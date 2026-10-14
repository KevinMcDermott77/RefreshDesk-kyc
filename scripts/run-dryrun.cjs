#!/usr/bin/env node
// Dry-runs the Slice 0b migration and its permission tests against a real database, over ONE
// connection, inside a transaction that is always rolled back.
//
//   DRYRUN_DB_URL='postgresql://...' node scripts/run-dryrun.cjs
//
// DRYRUN_DB_URL is read from the environment only. Neither it nor any part of it (host, user,
// password, database name) is ever printed: error text is scrubbed before it is shown.
//
// What it does, in order:
//   1. Checks whether the migration is already applied. If it is, it stops without running anything.
//   2. BEGIN, then the migration file, then supabase/tests/permissions.test.sql (both read from disk,
//      statement by statement, so an error names the file and line), printing every NOTICE as it arrives.
//   3. ROLLBACK, in a finally block, whatever happened.
//   4. Runs the check again to show nothing persisted.
//
// Exit code 0 only if "ALL PERMISSION TESTS PASSED" was seen and the post-rollback check is clean.
// Exit codes: 0 passed; 1 a test failed or errored; 2 the migration is already applied; 3 could not
// connect or DRYRUN_DB_URL is missing; 4 ran but the post-rollback check was not clean.
const fs = require('node:fs')
const path = require('node:path')
const { Client } = require('pg')
const { splitStatements, lineAt } = require('./sql-split.cjs')

const root = path.resolve(__dirname, '..')
const FILES = [
  path.join(root, 'supabase', 'migrations', '20261014000000_slice0b_permissions.sql'),
  path.join(root, 'supabase', 'tests', 'permissions.test.sql'),
]

const url = process.env.DRYRUN_DB_URL
if (!url) {
  console.error('DRYRUN_DB_URL is not set. Set it to a Postgres connection string for the database to dry-run against.')
  process.exit(3)
}

// Everything that could identify the database, to scrub from any text before it is printed.
const secrets = (() => {
  const found = new Set([url])
  try {
    const parsed = new URL(url)
    for (const part of [parsed.hostname, parsed.username, parsed.password, decodeURIComponent(parsed.password), parsed.pathname.replace(/^\//, ''), parsed.host]) {
      if (part && part.length >= 3) found.add(part)
    }
  } catch {
    // Not URL-shaped: the whole string is still scrubbed.
  }
  return [...found].sort((a, b) => b.length - a.length)
})()

function redact(value) {
  let text = String(value ?? '')
  for (const secret of secrets) text = text.split(secret).join('***')
  return text
}

const out = (message = '') => console.log(redact(message))
const err = (message = '') => console.error(redact(message))
const rel = (file) => path.relative(root, file).split(path.sep).join('/')

const CHECK_SQL = `
  select to_regprocedure('public.require_role(uuid,text[])')::text as require_role,
         (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'firms' and column_name = 'four_eyes')::int as four_eyes_columns,
         (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'entity_cdd_records' and column_name = 'fetched_by')::int as fetched_by_columns,
         exists (select 1 from pg_namespace where nspname = '_dryrun') as dryrun_schema_exists
`

async function check(client, label) {
  const { rows } = await client.query(CHECK_SQL)
  const r = rows[0]
  const applied = r.require_role !== null || r.four_eyes_columns > 0 || r.fetched_by_columns > 0
  out(`${label}:`)
  out(`  to_regprocedure('public.require_role(uuid,text[])') = ${r.require_role ?? 'null'}`)
  out(`  firms.four_eyes columns             = ${r.four_eyes_columns}`)
  out(`  entity_cdd_records.fetched_by cols  = ${r.fetched_by_columns}`)
  out(`  _dryrun schema present              = ${r.dryrun_schema_exists}`)
  out(`  => migration ${applied ? 'IS ALREADY APPLIED' : 'is not applied'}`)
  return { applied, dryrunSchemaExists: r.dryrun_schema_exists }
}

function describeError(e, file, statement) {
  err('')
  err(`ERROR: ${e.message}`)
  if (e.code) err(`  code:     ${e.code}`)
  if (e.position) err(`  position: ${e.position} (character, within the failing statement)`)
  if (e.detail) err(`  detail:   ${e.detail}`)
  if (e.hint) err(`  hint:     ${e.hint}`)
  if (e.where) err(`  where:    ${String(e.where).split('\n').join('\n            ')}`)
  if (file && statement) {
    const line = e.position ? lineAt(statement, Number(e.position)) : statement.line
    err(`  at:       ${rel(file)} line ${line}${e.position ? '' : ` (the statement starting there)`}`)
    const firstLine = statement.text.split('\n')[0].slice(0, 120)
    err(`  statement: ${firstLine}`)
  }
}

async function main() {
  const client = new Client({ connectionString: url })
  let passed = false
  let failed = false
  let exitCode = 1

  client.on('notice', (n) => {
    out(`NOTICE: ${n.message}`)
    if (n.message === 'ALL PERMISSION TESTS PASSED') passed = true
  })
  client.on('error', (e) => err(`connection error: ${e.message}`))

  try {
    await client.connect()
  } catch (e) {
    err(`Could not connect: ${e.message}`)
    return 3
  }

  let began = false
  try {
    const before = await check(client, 'Before')
    if (before.applied) {
      err('')
      err('The migration looks already applied to this database. Nothing was run.')
      err('A dry run only makes sense before applying it. Use a database (or branch) without it.')
      return 2
    }
    out('')

    await client.query('begin')
    began = true
    out('BEGIN')
    // A leftover scratch schema from an earlier failed run would collide with the tests; the
    // drop is inside the transaction, so it is rolled back like everything else.
    await client.query('drop schema if exists _dryrun cascade')

    for (const file of FILES) {
      const statements = splitStatements(fs.readFileSync(file, 'utf8'))
      out(`-- ${rel(file)}: ${statements.length} statements`)
      for (const statement of statements) {
        try {
          await client.query(statement.text)
        } catch (e) {
          describeError(e, file, statement)
          failed = true
          break
        }
      }
      if (failed) break
    }
  } catch (e) {
    describeError(e)
    failed = true
  } finally {
    if (began) {
      try {
        await client.query('rollback')
        out('ROLLBACK')
      } catch (e) {
        err(`ROLLBACK failed: ${e.message}`)
        failed = true
      }
    }
  }

  let afterClean = false
  try {
    const after = await check(client, 'After rollback')
    afterClean = !after.applied
  } catch (e) {
    err(`The post-rollback check failed: ${e.message}`)
  }
  await client.end().catch(() => undefined)

  out('')
  if (!afterClean) {
    err('The database still shows the migration after the rollback. Investigate before doing anything else.')
    exitCode = 4
  } else if (failed) {
    err('RESULT: FAILED (see the error above). Nothing persisted.')
    exitCode = 1
  } else if (!passed) {
    err('RESULT: the script ran to the end but never reported ALL PERMISSION TESTS PASSED.')
    exitCode = 1
  } else {
    out('RESULT: ALL PERMISSION TESTS PASSED, and nothing persisted.')
    exitCode = 0
  }
  return exitCode
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    err(`Unexpected error: ${e && e.message ? e.message : e}`)
    process.exit(1)
  })
