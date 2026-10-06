'use client'

import { useActionState } from 'react'
import { reviewExtractionAction } from './actions'

type Props = {
  extractionId: string
  clientId: string
}

export function ReviewForm({ extractionId, clientId }: Props) {
  const [state, dispatch, pending] = useActionState(reviewExtractionAction, {})

  return (
    <form action={dispatch} className="mt-4 grid gap-4">
      <input type="hidden" name="extraction_id" value={extractionId} />
      <input type="hidden" name="client_id" value={clientId} />

      <label className="block">
        <span className="text-sm font-medium">Reviewer notes</span>
        <textarea
          name="reviewer_notes"
          rows={2}
          placeholder="Optional — note any discrepancies or observations"
          className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 text-sm outline-none focus:border-[var(--accent)] resize-none"
        />
      </label>

      {state.error && (
        <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          name="decision"
          value="approved"
          disabled={pending}
          className="bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Approve'}
        </button>
        <button
          type="submit"
          name="decision"
          value="rejected"
          disabled={pending}
          className="border border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-800 transition hover:bg-red-100 disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Reject'}
        </button>
      </div>
    </form>
  )
}
