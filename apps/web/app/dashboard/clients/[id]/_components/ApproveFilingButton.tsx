'use client'

import { useActionState } from 'react'
import { approveFilingAction } from '../filings/actions'

type Props = {
  documentId: string
  clientId: string
  canApprove: boolean
  /** Why Approve is disabled; shown beside it. */
  reason?: string
}

/** The Approve button for a pending filing. Only admins are shown it. */
export function ApproveFilingButton({ documentId, clientId, canApprove, reason }: Props) {
  const [state, dispatch, pending] = useActionState(approveFilingAction, {})

  return (
    <form action={dispatch} className="flex items-center gap-2">
      <input type="hidden" name="document_id" value={documentId} />
      <input type="hidden" name="client_id" value={clientId} />
      <button
        type="submit"
        disabled={pending || !canApprove}
        title={canApprove ? undefined : reason}
        className="border border-emerald-600 px-3 py-1 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Approving…' : 'Approve'}
      </button>
      {!canApprove && reason ? <span className="max-w-[16rem] text-xs text-amber-800">{reason}</span> : null}
      {state.error ? <span className="max-w-[16rem] text-xs text-red-700">{state.error}</span> : null}
    </form>
  )
}
