'use client'

import { useActionState, useRef, useState } from 'react'
import Papa from 'papaparse'
import { validateCsvRow, type CsvRow } from '@/lib/schemas/client-csv'
import { FormError } from '@/components/form-error'
import { importClientsAction, type ImportResult } from '../actions'

type ParsedRow = {
  rowIndex: number
  raw: Record<string, string>
  valid: boolean
  data?: CsvRow
  errors?: { field: string; message: string }[]
}

export function ImportForm() {
  const [state, dispatch, pending] = useActionState<ImportResult, FormData>(
    importClientsAction,
    {}
  )
  const [rows, setRows] = useState<ParsedRow[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const parsed: ParsedRow[] = results.data.map((raw, i) => {
          const result = validateCsvRow(raw)
          if (result.success) {
            return { rowIndex: i, raw, valid: true, data: result.data }
          }
          return { rowIndex: i, raw, valid: false, errors: result.errors }
        })
        setRows(parsed)
      },
    })
  }

  const validRows = rows.filter((r) => r.valid).map((r) => r.data!)
  const invalidRows = rows.filter((r) => !r.valid)

  if (state.inserted_count !== undefined) {
    return (
      <div className="mt-6 border border-[var(--line)] bg-[var(--panel)] p-5">
        <p className="font-semibold text-[var(--accent-strong)]">
          Import complete —{' '}
          {state.inserted_count} client
          {state.inserted_count === 1 ? '' : 's'} added.
        </p>
        {state.row_errors && state.row_errors.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-medium text-red-700">
              {state.row_errors.length} row(s) failed server-side:
            </p>
            <ul className="mt-2 space-y-1 text-sm text-red-600">
              {state.row_errors.map((e) => (
                <li key={e.row_index}>
                  Row {e.row_index + 1}: {e.error_message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <a
          href="/dashboard/clients"
          className="mt-6 inline-block bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white"
        >
          View clients
        </a>
      </div>
    )
  }

  return (
    <div className="mt-8 grid gap-6">
      <div>
        <p className="mb-2 text-sm font-medium">Expected CSV headers:</p>
        <code className="block border border-[var(--line)] bg-white p-3 font-mono text-xs">
          client_type,display_name,risk_rating,external_ref,refresh_due_date
        </code>
        <ul className="mt-3 space-y-1 text-xs text-[var(--muted)]">
          <li>
            <strong>client_type</strong>: &ldquo;individual&rdquo; or
            &ldquo;entity&rdquo; (required)
          </li>
          <li>
            <strong>display_name</strong>: text (required)
          </li>
          <li>
            <strong>risk_rating</strong>: &ldquo;low&rdquo;,
            &ldquo;standard&rdquo;, or &ldquo;high&rdquo; (required)
          </li>
          <li>
            <strong>external_ref</strong>: text, optional
          </li>
          <li>
            <strong>refresh_due_date</strong>: YYYY-MM-DD, optional
          </li>
        </ul>
      </div>

      <label className="block">
        <span className="text-sm font-medium">Upload CSV file</span>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="mt-2 block w-full text-sm"
        />
      </label>

      {rows.length > 0 && (
        <div>
          <p className="mb-3 text-sm font-medium">
            Preview: {validRows.length} valid, {invalidRows.length} invalid
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-[var(--muted)]">
                  <th className="pb-2 pr-3">#</th>
                  <th className="pb-2 pr-3">Type</th>
                  <th className="pb-2 pr-3">Name</th>
                  <th className="pb-2 pr-3">Risk</th>
                  <th className="pb-2 pr-3">Ref</th>
                  <th className="pb-2 pr-3">Due date</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.rowIndex}
                    className={`border-b border-[var(--line)] ${
                      row.valid ? '' : 'bg-red-50'
                    }`}
                  >
                    <td className="py-2 pr-3 text-[var(--muted)]">
                      {row.rowIndex + 1}
                    </td>
                    <td className="py-2 pr-3">{row.raw.client_type}</td>
                    <td className="py-2 pr-3">{row.raw.display_name}</td>
                    <td className="py-2 pr-3">{row.raw.risk_rating}</td>
                    <td className="py-2 pr-3">
                      {row.raw.external_ref || '—'}
                    </td>
                    <td className="py-2 pr-3">
                      {row.raw.refresh_due_date || '—'}
                    </td>
                    <td className="py-2">
                      {row.valid ? (
                        <span className="text-emerald-700">✓</span>
                      ) : (
                        <span
                          className="text-red-700"
                          title={row.errors
                            ?.map((e) => `${e.field}: ${e.message}`)
                            .join('; ')}
                        >
                          ✗{' '}
                          {row.errors?.map((e) => e.message).join(', ')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {invalidRows.length > 0 && (
            <p className="mt-3 text-sm text-red-700">
              {invalidRows.length} row(s) will be skipped. Fix the CSV and
              re-upload to include them.
            </p>
          )}

          {validRows.length > 0 && (
            <form action={dispatch} className="mt-4">
              <input
                type="hidden"
                name="rows"
                value={JSON.stringify(validRows)}
              />
              <FormError message={state.error} />
              <button
                type="submit"
                disabled={pending}
                className="bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {pending
                  ? 'Importing...'
                  : `Import ${validRows.length} client${
                      validRows.length === 1 ? '' : 's'
                    }`}
              </button>
            </form>
          )}
        </div>
      )}

      <a
        href="/dashboard/clients"
        className="text-sm text-[var(--muted)] hover:underline"
      >
        ← Back to clients
      </a>
    </div>
  )
}
