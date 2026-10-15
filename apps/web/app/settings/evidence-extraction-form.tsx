'use client'

import { useActionState } from 'react'
import { setEvidenceExtractionAction } from './actions'

type Props = { firmId: string; enabled: boolean }

export function EvidenceExtractionForm({ firmId, enabled }: Props) {
  const [state, dispatch, pending] = useActionState(setEvidenceExtractionAction, {})

  return (
    <form action={dispatch} className="mt-6 border-t border-[var(--line)] pt-6">
      <input type="hidden" name="firm_id" value={firmId} />
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">Client ownership evidence</p>
      <label className="mt-4 flex items-start gap-3 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={enabled} className="mt-1" />
        <span>
          Let Claude read documents clients provide for ownership evidence.
          <span className="block text-xs text-[var(--muted)]">
            When on, an uploaded confirmation letter, email, shareholder register or structure chart is sent to the Anthropic API to propose the
            owners. Names of shareholders can be in these documents, so check your data-processing terms first. When off, owners are
            entered by hand. Either way a different admin confirms everything before it is used. The change is recorded in the audit log.
          </span>
        </span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="mt-3 border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save'}
      </button>
      {state.error && <p className="mt-2 text-xs text-red-600">{state.error}</p>}
      {state.success && <p className="mt-2 text-xs text-emerald-600">{state.success}</p>}
    </form>
  )
}
