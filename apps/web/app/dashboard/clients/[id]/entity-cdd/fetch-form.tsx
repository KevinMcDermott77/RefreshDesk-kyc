'use client'

import { useActionState } from 'react'
import { fetchEntityCddAction } from './actions'

type Props = {
  clientId: string
}

export function FetchEntityCddForm({ clientId }: Props) {
  const [state, dispatch, pending] = useActionState(fetchEntityCddAction, {})

  return (
    <form action={dispatch} className="grid gap-6" encType="multipart/form-data">
      <input type="hidden" name="client_id" value={clientId} />

      <label className="block">
        <span className="text-sm font-medium">Company number</span>
        <p className="mt-1 text-xs text-[var(--muted)]">
          8 characters — e.g. 12345678 or SC123456. Leave blank to extract it from an uploaded
          document instead.
        </p>
        <input
          name="company_number"
          type="text"
          maxLength={8}
          placeholder="12345678"
          className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 text-sm uppercase outline-none focus:border-[var(--accent)]"
        />
      </label>

      <div className="flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
        <span className="h-px flex-1 bg-[var(--line)]" />
        or
        <span className="h-px flex-1 bg-[var(--line)]" />
      </div>

      <label className="block">
        <span className="text-sm font-medium">Upload incorporation document</span>
        <p className="mt-1 text-xs text-[var(--muted)]">
          PDF, JPEG, or PNG — Claude will extract the company number. Max 10 MB.
        </p>
        <input
          name="file"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,image/jpeg,image/png,application/pdf"
          className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 text-sm outline-none file:mr-4 file:border-0 file:bg-[var(--accent)] file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white"
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
          disabled={pending}
          className="bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
        >
          {pending ? 'Fetching from Companies House…' : 'Fetch from Companies House'}
        </button>
        <a
          href={`/dashboard/clients/${clientId}`}
          className="border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-sm font-semibold"
        >
          Cancel
        </a>
      </div>

      {pending && (
        <p className="text-sm text-[var(--muted)]">
          This can take a moment — fetching company profile, officers, and PSC register…
        </p>
      )}
    </form>
  )
}
