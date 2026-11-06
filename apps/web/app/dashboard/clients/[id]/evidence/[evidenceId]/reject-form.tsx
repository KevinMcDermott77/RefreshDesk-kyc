'use client'

import { useActionState } from 'react'
import { rejectEvidenceAction } from '../actions'

type Props = { evidenceId: string; clientId: string; withdraw: boolean }

export function RejectForm({ evidenceId, clientId, withdraw }: Props) {
  const [state, dispatch, pending] = useActionState(rejectEvidenceAction, {})
  return (
    <form action={dispatch} className="grid gap-3">
      <input type="hidden" name="evidence_id" value={evidenceId} />
      <input type="hidden" name="client_id" value={clientId} />
      <label className="block text-sm">
        <span className="font-medium">{withdraw ? 'Why are you withdrawing it? (required)' : 'Why is it rejected? (required)'}</span>
        <textarea
          name="note"
          rows={2}
          required
          className="mt-1 w-full resize-none border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
      </label>
      {state.error && <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="justify-self-start border border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-800 transition hover:bg-red-100 disabled:opacity-60"
      >
        {pending ? 'Saving…' : withdraw ? 'Withdraw' : 'Reject'}
      </button>
    </form>
  )
}
