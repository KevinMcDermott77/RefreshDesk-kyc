'use client'

import { useActionState, useMemo, useState } from 'react'
import {
  filingLabel,
  isPriorityFiling,
  companiesHouseFilingUrl,
  type Filing,
} from '@/lib/types/filings'
import { saveFilingsAction, type SaveFilingsState } from './actions'

type Props = {
  clientId: string
  companyNumber: string
  filings: Filing[]
  canWrite: boolean
}

const ALL_TYPES = '__all__'

export function FilingList({ clientId, companyNumber, filings, canWrite }: Props) {
  const [state, dispatch, pending] = useActionState<SaveFilingsState, FormData>(saveFilingsAction, {})
  const [typeFilter, setTypeFilter] = useState(ALL_TYPES)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const savedSet = useMemo(() => new Set(state.saved ?? []), [state.saved])

  const filingTypes = useMemo(() => {
    const types = new Set<string>()
    for (const filing of filings) {
      if (filing.type) types.add(filing.type)
    }
    return Array.from(types).sort()
  }, [filings])

  const visible = useMemo(
    () => (typeFilter === ALL_TYPES ? filings : filings.filter((f) => f.type === typeFilter)),
    [filings, typeFilter],
  )

  function toggle(transactionId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(transactionId)) next.delete(transactionId)
      else next.add(transactionId)
      return next
    })
  }

  const selectableCount = visible.filter((f) => !savedSet.has(f.transactionId)).length
  const allSelected = selectableCount > 0 && visible.every((f) => savedSet.has(f.transactionId) || selected.has(f.transactionId))

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      const targets = visible.filter((f) => !savedSet.has(f.transactionId))
      const shouldSelect = !targets.every((f) => next.has(f.transactionId))
      for (const filing of targets) {
        if (shouldSelect) next.add(filing.transactionId)
        else next.delete(filing.transactionId)
      }
      return next
    })
  }

  const selectedCount = Array.from(selected).filter((id) => !savedSet.has(id)).length

  return (
    <form action={dispatch}>
      <input type="hidden" name="client_id" value={clientId} />
      {Array.from(selected)
        .filter((id) => !savedSet.has(id))
        .map((id) => (
          <input key={id} type="hidden" name="transaction_id" value={id} />
        ))}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Filter</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          >
            <option value={ALL_TYPES}>All</option>
            {filingTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        {canWrite && (
          <button
            type="submit"
            disabled={pending || selectedCount === 0}
            className="bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending
              ? 'Saving…'
              : selectedCount > 0
                ? `Save selected (${selectedCount})`
                : 'Save selected'}
          </button>
        )}
      </div>

      {state.error && (
        <p className="mt-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </p>
      )}

      <div className="mt-4 divide-y divide-[var(--line)] border border-[var(--line)]">
        <div className="flex items-center gap-4 bg-[var(--panel)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          {canWrite && (
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              disabled={selectableCount === 0}
              aria-label="Select all visible filings"
            />
          )}
          <span className="flex-1">Filing</span>
          <span className="w-28 text-right">Date</span>
          <span className="w-32 text-right">Companies House</span>
        </div>

        {visible.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--muted)]">No filings match this filter.</p>
        ) : (
          visible.map((filing) => {
            const isSaved = savedSet.has(filing.transactionId)
            const isChecked = selected.has(filing.transactionId)
            const priority = isPriorityFiling(filing)

            return (
              <div
                key={filing.transactionId}
                className={`flex items-center gap-4 px-4 py-3 ${priority ? 'bg-amber-50/40' : ''}`}
              >
                {canWrite && (
                  <input
                    type="checkbox"
                    checked={isChecked || isSaved}
                    disabled={isSaved}
                    onChange={() => toggle(filing.transactionId)}
                    aria-label={`Select ${filing.transactionId}`}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {filing.type && (
                      <span
                        className={`mr-2 inline-block border px-1.5 py-0.5 text-xs font-semibold uppercase ${
                          priority
                            ? 'border-amber-300 bg-amber-100 text-amber-900'
                            : 'border-[var(--line)]'
                        }`}
                      >
                        {filing.type}
                      </span>
                    )}
                    {filingLabel(filing)}
                  </p>
                </div>
                <span className="w-28 shrink-0 text-right text-xs text-[var(--muted)]">
                  {filing.date ? new Date(filing.date).toLocaleDateString('en-GB') : '—'}
                </span>
                <span className="w-32 shrink-0 text-right text-xs">
                  {isSaved ? (
                    <span className="font-semibold text-emerald-700">✓ Saved</span>
                  ) : (
                    <a
                      href={companiesHouseFilingUrl(companyNumber, filing.transactionId)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-[var(--accent)] hover:underline"
                    >
                      View on CH →
                    </a>
                  )}
                </span>
              </div>
            )
          })
        )}
      </div>
    </form>
  )
}
