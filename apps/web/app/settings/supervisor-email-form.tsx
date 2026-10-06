'use client'

import { useActionState } from 'react'
import { updateSupervisorEmailAction } from './actions'

type Props = { currentEmail: string | null }

export function SupervisorEmailForm({ currentEmail }: Props) {
  const [state, dispatch, pending] = useActionState(updateSupervisorEmailAction, {})

  return (
    <form action={dispatch} className="mt-6 border-t border-[var(--line)] pt-6">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
        Notification settings
      </p>
      <div className="mt-4">
        <label htmlFor="mlr_supervisor_email" className="block text-sm text-[var(--muted)]">
          MLR supervisor email
        </label>
        <div className="mt-1 flex gap-3">
          <input
            id="mlr_supervisor_email"
            name="mlr_supervisor_email"
            type="email"
            required
            defaultValue={currentEmail ?? ''}
            placeholder="supervisor@firm.com"
            className="flex-1 border border-[var(--line)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
          <button
            type="submit"
            disabled={pending}
            className="border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
        {state.error && (
          <p className="mt-2 text-xs text-red-600">{state.error}</p>
        )}
        {state.success && (
          <p className="mt-2 text-xs text-emerald-600">{state.success}</p>
        )}
      </div>
    </form>
  )
}
