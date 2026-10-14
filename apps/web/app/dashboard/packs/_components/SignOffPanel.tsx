'use client'

import { useActionState } from 'react'
import type { SignOffGate } from '@/lib/packs/sign-off'
import { approvePackAction, rejectPackAction, submitPackAction } from '../actions'

type Props = { packId: string; gate: SignOffGate }

/** Submit, approve and reject for one pack. Hidden when printing; nothing here is part of the record. */
export function SignOffPanel({ packId, gate }: Props) {
  const [submitState, submit, submitting] = useActionState(submitPackAction, {})
  const [approveState, approve, approving] = useActionState(approvePackAction, {})
  const [rejectState, reject, rejecting] = useActionState(rejectPackAction, {})

  if (!gate.showSubmit && !gate.showReview) return null

  const error = submitState.error ?? approveState.error ?? rejectState.error
  const busy = submitting || approving || rejecting

  return (
    <section className="no-print mt-6 border border-[var(--line)] bg-[var(--panel)] p-5 text-[var(--foreground)] dark:bg-gray-900 dark:text-gray-100">
      <h2 className="text-lg font-semibold">Sign-off</h2>

      {gate.showSubmit ? (
        <form action={submit} className="mt-3">
          <input type="hidden" name="pack_id" value={packId} />
          <p className="text-sm text-[var(--muted)]">Submit this pack for approval. Once submitted it cannot be edited; it never can be.</p>
          <button
            disabled={busy || !gate.canSubmit}
            className="mt-2 border border-[var(--accent-strong)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit for approval'}
          </button>
        </form>
      ) : null}

      {gate.showReview ? (
        <div className="mt-3 grid gap-3">
          <label className="block text-sm font-medium" htmlFor={`note-${packId}`}>
            Note <span className="font-normal text-[var(--muted)]">(required to reject)</span>
          </label>
          <textarea
            id={`note-${packId}`}
            name="note"
            form={`approve-${packId}`}
            rows={2}
            className="w-full resize-none border border-[var(--line)] bg-white px-3 py-2 text-sm text-gray-900 dark:bg-gray-950 dark:text-gray-100"
          />
          {gate.reason ? (
            <p role="note" className="border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {gate.reason}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <form id={`approve-${packId}`} action={approve}>
              <input type="hidden" name="pack_id" value={packId} />
              <button
                disabled={busy || !gate.canApprove}
                title={gate.canApprove ? undefined : gate.reason}
                className="bg-emerald-600 px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {approving ? 'Approving…' : 'Approve'}
              </button>
            </form>
            <form
              action={(formData) => {
                // The note field belongs to the approve form; copy it across for the reject action.
                const note = (document.getElementById(`note-${packId}`) as HTMLTextAreaElement | null)?.value ?? ''
                formData.set('note', note)
                return reject(formData)
              }}
            >
              <input type="hidden" name="pack_id" value={packId} />
              <button
                disabled={busy || !gate.canReject}
                className="border border-red-300 bg-red-50 px-5 py-2 text-sm font-semibold text-red-800 disabled:opacity-50"
              >
                {rejecting ? 'Rejecting…' : 'Reject'}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
    </section>
  )
}
