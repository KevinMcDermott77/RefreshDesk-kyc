// Run with: node --test scripts/
const test = require('node:test')
const assert = require('node:assert/strict')
const { splitStatements, lineAt } = require('./sql-split.cjs')

test('splits on top-level semicolons and records the start line', () => {
  const out = splitStatements('select 1;\n\n  select 2;\nselect 3')
  assert.deepEqual(
    out.map((s) => [s.text, s.line]),
    [
      ['select 1;', 1],
      ['select 2;', 3],
      ['select 3', 4],
    ],
  )
})

test('ignores semicolons in comments, strings, identifiers and dollar-quoted bodies', () => {
  const sql = [
    '-- a; comment',
    "select 'a;b', \"c;d\"; /* x; y */",
    'create function f() returns int language plpgsql as $body$',
    'begin',
    '  return 1;',
    'end;',
    '$body$;',
    'do $$ begin perform 1; end $$;',
  ].join('\n')
  const out = splitStatements(sql)
  assert.equal(out.length, 3)
  assert.equal(out[0].line, 2)
  assert.equal(out[1].line, 3)
  assert.ok(out[1].text.endsWith('$body$;'))
  assert.equal(out[2].line, 8)
})

test('a plpgsql begin/end inside a body is not a statement of its own', () => {
  const out = splitStatements('create function g() returns void language plpgsql as $$ begin commit; end; $$;\nrollback;')
  assert.deepEqual(
    out.map((s) => s.text.split(/\s+/)[0]),
    ['create', 'rollback;'],
  )
})

test('lineAt maps a character position inside a statement to a file line', () => {
  const [, second] = splitStatements('select 1;\nselect\n  2,\n  broken;')
  assert.equal(second.line, 2)
  assert.equal(lineAt(second, 1), 2)
  assert.equal(lineAt(second, second.text.indexOf('broken') + 1), 4)
})

test('an unterminated dollar quote is an error, not a silent swallow', () => {
  assert.throws(() => splitStatements('select $$ oops'), /unterminated/)
})

test('keeps $1 style placeholders and plain dollar signs from starting a body', () => {
  const out = splitStatements('select $1 + 1; select 2;')
  assert.equal(out.length, 2)
})
