'use client'

import { useActionState } from 'react'
import { FormError } from '@/components/form-error'
import type { Client } from '@/lib/types/clients'

type ActionFn = (
  prev: { error?: string },
  formData: FormData
) => Promise<{ error?: string }>

type Props = {
  action: ActionFn
  initial?: Partial<Client>
  submitLabel: string
  cancelHref: string
}

export function ClientForm({ action, initial, submitLabel, cancelHref }: Props) {
  const [state, dispatch, pending] = useActionState(action, {})

  return (
    <form action={dispatch} className="grid gap-5">
      {initial?.id && (
        <input type="hidden" name="client_id" value={initial.id} />
      )}

      <label className="block">
        <span className="text-sm font-medium">Client type</span>
        <select
          name="client_type"
          defaultValue={initial?.client_type ?? 'individual'}
          className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--accent)]"
        >
          <option value="individual">Individual</option>
          <option value="entity">Entity</option>
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium">Display name</span>
        <input
          name="display_name"
          defaultValue={initial?.display_name ?? ''}
          required
          className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--accent)]"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Risk rating</span>
        <select
          name="risk_rating"
          defaultValue={initial?.risk_rating ?? 'standard'}
          className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--accent)]"
        >
          <option value="low">Low</option>
          <option value="standard">Standard</option>
          <option value="high">High</option>
        </select>
      </label>

      <div className="grid gap-5 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">External reference</span>
          <input
            name="external_ref"
            defaultValue={initial?.external_ref ?? ''}
            placeholder="Optional — must be unique per firm"
            className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Override refresh due date</span>
          <input
            name="refresh_due_date"
            type="date"
            defaultValue={initial?.refresh_due_date ?? ''}
            className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--accent)]"
          />
        </label>
      </div>

      <p className="text-xs text-[var(--muted)]">
        Leave "Override refresh due date" blank to use the firm's default cadence for the selected risk rating.
      </p>

      <FormError message={state.error} />

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="bg-[var(--accent)] px-4 py-3 font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
        >
          {pending ? 'Saving...' : submitLabel}
        </button>
        <a
          href={cancelHref}
          className="border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-sm font-semibold"
        >
          Cancel
        </a>
      </div>
    </form>
  )
}
