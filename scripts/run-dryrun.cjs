#!/usr/bin/env node
// Dry-runs one or more migrations and their SQL tests against a real database, over ONE
// connection, inside a transaction that is always rolled back.
//
//   DRYRUN_DB_URL='postgresql://...' node scripts/run-dryrun.cjs
//   DRYRUN_DB_URL='postgresql://...' node scripts/run-dryrun.cjs \
//     --migration supabase/migrations/20261014000000_slice0b_permissions.sql \
//     --migration supabase/migrations/20261015000000_slice6_refresh_packs.sql \
//     --tests supabase/tests/helpers.sql --tests supabase/tests/refresh_packs.test.sql
//
// With no arguments it dry-runs the Slice 0b migration and supabase/tests/permissions.test.sql
// (after supabase/tests/helpers.sql). --migration and --tests may each be given several times and
// run in the order given: migrations first, then tests. Paths are relative to the current directory.
// Slice 6 needs Slice 0b (require_role, firms.four_eyes), so list both unless 0b is already applied.
//
// DRYRUN_DB_URL is read from the environment only. Neither it nor any part of it (host, user,
// password, database name) is ever printed: error text is scrubbed before it is shown.
//
// What it does, in order:
//   1. Checks whether each migration is already applied. If any is, it stops without running anything.
//   2. BEGIN, then the migration files and the test files (read from disk, statement by statement,
//      so an error names the file and line), printing every NOTICE as it arrives.
//   3. ROLLBACK, in a finally block, whatever happened.
//   4. Runs the checks again to show nothing persisted.
//
// Exit code 0 only if "ALL PERMISSION TESTS PASSED" was seen and the post-rollback checks are clean.
// Exit codes: 0 passed; 1 a test failed or errored; 2 a migration is already applied; 3 could not
// connect, DRYRUN_DB_URL is missing or the arguments are wrong; 4 ran but the post-rollback check
// was not clean.
const fs = require('node:fs')
const path = require('node:path')
const { Client } = require('pg')
const { splitStatements, lineAt } = require('./sql-split.cjs')

const root = path.resolve(__dirname, '..')

const DEFAULT_MIGRATIONS = [path.join(root, 'supabase', 'migrations', '20261014000000_slice0b_permissions.sql')]
const DEFAULT_TESTS = [path.join(root, 'supabase', 'tests', 'helpers.sql'), path.join(root, 'supabase', 'tests', 'permissions.test.sql')]

// "Already applied?" probes, chosen by migration file name. Each query returns one row of columns;
// `applied` says, from that row, whether the migration's objects exist.
const PROBES = [
  {
    match: /slice0b/,
    name: 'Slice 0b (permissions)',
    sql: `
      select to_regprocedure('public.require_role(uuid,text[])')::text as require_role,
             (select count(*) from information_schema.columns
               where table_schema = 'public' and table_name = 'firms' and column_name = 'four_eyes')::int as four_eyes_columns,
             (select count(*) from information_schema.columns
               where table_schema = 'public' and table_name = 'entity_cdd_records' and column_name = 'fetched_by')::int as fetched_by_columns`,
    applied: (r) => r.require_role !== null || r.four_eyes_columns > 0 || r.fetched_by_columns > 0,
  },
  {
    match: /slice6_refresh_packs/,
    name: 'Slice 6 (refresh packs)',
    sql: `
      select to_regclass('public.refresh_packs')::text as refresh_packs_table,
             to_regprocedure('public.create_refresh_pack(uuid,text,text,jsonb,jsonb,text)')::text as create_refresh_pack`,
    applied: (r) => r.refresh_packs_table !== null || r.create_refresh_pack !== null,
  },
]

function parseArgs(argv) {
  const migrations = []
  const tests = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const v = argv[++i]
      if (!v) throw new Error(`${arg} needs a file path`)
      return path.resolve(process.cwd(), v)
    }
    if (arg === '--migration') migrations.push(value())
    else if (arg === '--tests') tests.push(value())
    else if (arg === '--help' || arg === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 33).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
      process.exit(0)
    } else throw new Error(`unknown argument: ${arg} (use --migration <file> and --tests <file>)`)
  }
  for (const file of [...migrations, ...tests]) {
    if (!fs.existsSync(file)) throw new Error(`no such file: ${file}`)
  }
  return {
    migrations: migrations.length > 0 ? migrations : DEFAULT_MIGRATIONS,
    tests: tests.length > 0 ? tests : DEFAULT_TESTS,
  }
}

let args
try {
  args = parseArgs(process.argv.slice(2))
} catch (e) {
  console.error(e.message)
  process.exit(3)
}
const FILES = [...args.migrations, ...args.tests]

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
const rel = (file) => {
  const r = path.relative(root, file).split(path.sep).join('/')
  return r.startsWith('..') ? file : r
}

/** Runs the probes for the listed migrations. Returns whether any migration is already applied. */
async function check(client, label) {
  out(`${label}:`)
  let anyApplied = false
  const probes = new Set()
  for (const file of args.migrations) {
    const probe = PROBES.find((p) => p.match.test(path.basename(file)))
    if (!probe) {
      out(`  (no "already applied?" check known for ${rel(file)})`)
      continue
    }
    probes.add(probe)
  }
  for (const probe of probes) {
    const { rows } = await client.query(probe.sql)
    const applied = probe.applied(rows[0])
    anyApplied ||= applied
    out(`  ${probe.name}:`)
    for (const [key, value] of Object.entries(rows[0])) out(`    ${key} = ${value === null ? 'null' : value}`)
    out(`    => ${applied ? 'IS ALREADY APPLIED' : 'not applied'}`)
  }
  const { rows } = await client.query("select exists (select 1 from pg_namespace where nspname = '_dryrun') as e")
  out(`  _dryrun schema present = ${rows[0].e}`)
  return anyApplied
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
    out(`Migrations: ${args.migrations.map(rel).join(', ')}`)
    out(`Tests:      ${args.tests.map(rel).join(', ')}`)
    out('')
    if (await check(client, 'Before')) {
      err('')
      err('A migration listed above looks already applied to this database. Nothing was run.')
      err('A dry run only makes sense before applying it. Use a database (or branch) without it.')
      await client.end().catch(() => undefined)
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
    afterClean = !(await check(client, 'After rollback'))
  } catch (e) {
    err(`The post-rollback check failed: ${e.message}`)
  }
  await client.end().catch(() => undefined)

  out('')
  if (!afterClean) {
    err('The database still shows a migration after the rollback. Investigate before doing anything else.')
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
