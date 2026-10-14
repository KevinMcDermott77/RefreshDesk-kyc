'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { PackOfferResult } from '@/lib/packs/offer'
import { saveRefreshPackAction } from '../packs/actions'

/** "Save as refresh pack" for a finished run, or the reason it cannot be saved. */
export function SavePackButton({ pack }: { pack: PackOfferResult | undefined }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!pack) return null
  if ('unavailable' in pack) {
    return <p className="mt-6 text-xs text-[var(--muted)]">Not saveable as a refresh pack: {pack.unavailable}</p>
  }

  const { snapshot, sha256, issuedAt, signature } = pack.offer
  const incomplete = snapshot.summary.status === 'partial'

  function save() {
    setError(null)
    startTransition(async () => {
      const result = await saveRefreshPackAction({ snapshot, sha256, issuedAt, signature })
      if (result.error || !result.id) setError(result.error ?? 'The pack could not be saved')
      else router.push(`/dashboard/packs/${result.id}`)
    })
  }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 border border-[var(--line)] bg-[var(--panel)] p-4 text-[var(--foreground)] dark:bg-gray-900 dark:text-gray-100">
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="border border-[var(--accent-strong)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Save as refresh pack'}
      </button>
      <span className="text-xs text-[var(--muted)]">
        Saves exactly what is shown below, with its fingerprint ({sha256.slice(0, 12)}…). A pack cannot be edited afterwards.
        {incomplete ? ` This run is partial: ${snapshot.summary.openBranches} open ${snapshot.summary.openBranches === 1 ? 'branch' : 'branches'} will be recorded.` : ''}
      </span>
      <Link href="/dashboard/packs" className="text-xs underline">
        All packs
      </Link>
      {error ? (
        <p role="alert" className="w-full border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
    </div>
  )
}
