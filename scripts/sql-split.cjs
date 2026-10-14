// Splits a SQL script into its top-level statements, keeping each one's original text and the
// 1-based line where it starts. Semicolons inside comments, string literals, quoted identifiers
// and dollar-quoted bodies (function bodies, DO blocks) do not end a statement.
//
// Used by scripts/run-dryrun.cjs so that an error can be reported against a line of the file.

/** @returns {{ text: string, line: number }[]} */
function splitStatements(sql) {
  const statements = []
  const n = sql.length
  let i = 0
  let line = 1
  let start = -1
  let startLine = 0

  const begin = () => {
    if (start < 0) {
      start = i
      startLine = line
    }
  }

  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]

    if (c === '\n') {
      line++
      i++
    } else if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++
    } else if (c === '/' && next === '*') {
      let depth = 1
      i += 2
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++
          i += 2
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--
          i += 2
        } else {
          if (sql[i] === '\n') line++
          i++
        }
      }
    } else if (c === "'") {
      begin()
      i++
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2
        else if (sql[i] === "'") break
        else {
          if (sql[i] === '\n') line++
          i++
        }
      }
      i++
    } else if (c === '"') {
      begin()
      i++
      while (i < n && sql[i] !== '"') {
        if (sql[i] === '\n') line++
        i++
      }
      i++
    } else if (c === '$') {
      begin()
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i, i + 64))
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length)
        if (close < 0) throw new Error(`unterminated dollar-quoted string starting at line ${line}`)
        for (let k = i; k < close + tag[0].length; k++) if (sql[k] === '\n') line++
        i = close + tag[0].length
      } else {
        i++
      }
    } else if (c === ';') {
      if (start >= 0) statements.push({ text: sql.slice(start, i + 1), line: startLine })
      start = -1
      i++
    } else if (/\s/.test(c)) {
      i++
    } else {
      begin()
      i++
    }
  }
  if (start >= 0) statements.push({ text: sql.slice(start).trimEnd(), line: startLine })
  return statements
}

/** The 1-based line in a script of a 1-based character position inside one of its statements. */
function lineAt(statement, position) {
  const before = statement.text.slice(0, Math.max(0, position - 1))
  return statement.line + (before.match(/\n/g) || []).length
}

module.exports = { splitStatements, lineAt }
