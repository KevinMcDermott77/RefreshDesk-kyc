'use client'

import { useState } from 'react'

type Plan = {
  plan: 'starter' | 'pro'
  client_count: number
  member_count: number
  limits: {
    max_clients: number | null
    max_members: number | null
  }
}

type Props = {
  plan: Plan
}

export function BillingSection({ plan }: Props) {
  const [pending, setPending] = useState<'checkout' | 'portal' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isPro = plan.plan === 'pro'

  async function startCheckout() {
    setPending('checkout')
    setError(null)
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.url) {
        setError(data.error ?? 'Failed to start checkout')
        setPending(null)
        return
      }
      window.location.href = data.url
    } catch {
      setError('Failed to start checkout')
      setPending(null)
    }
  }

  async function openPortal() {
    setPending('portal')
    setError(null)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.url) {
        setError(data.error ?? 'Failed to open billing portal')
        setPending(null)
        return
      }
      window.location.href = data.url
    } catch {
      setError('Failed to open billing portal')
      setPending(null)
    }
  }

  return (
    <section className="mt-10 border-t border-[var(--line)] pt-6">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
        Billing
      </p>

      <dl className="mt-4 grid gap-3 text-sm">
        <div className="flex justify-between border-b border-[var(--line)] pb-3">
          <dt className="text-[var(--muted)]">Plan</dt>
          <dd className="font-medium">{isPro ? 'Pro' : 'Starter (free)'}</dd>
        </div>
        <div className="flex justify-between border-b border-[var(--line)] pb-3">
          <dt className="text-[var(--muted)]">Clients</dt>
          <dd className="font-medium">
            {plan.client_count}
            {plan.limits.max_clients !== null ? ` / ${plan.limits.max_clients}` : ''}
          </dd>
        </div>
        <div className="flex justify-between border-b border-[var(--line)] pb-3">
          <dt className="text-[var(--muted)]">Members</dt>
          <dd className="font-medium">
            {plan.member_count}
            {plan.limits.max_members !== null ? ` / ${plan.limits.max_members}` : ''}
          </dd>
        </div>
      </dl>

      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}

      {isPro ? (
        <button
          type="button"
          onClick={openPortal}
          disabled={pending !== null}
          className="mt-6 border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {pending === 'portal' ? 'Opening…' : 'Manage subscription →'}
        </button>
      ) : (
        <div className="mt-6">
          <p className="text-sm text-[var(--muted)]">
            You&apos;re on the free plan. Upgrade to Pro for unlimited clients, unlimited team
            members, email campaigns, and CSV import.
          </p>
          <button
            type="button"
            onClick={startCheckout}
            disabled={pending !== null}
            className="mt-4 bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending === 'checkout' ? 'Redirecting…' : 'Upgrade to Pro — £49/month'}
          </button>
        </div>
      )}
    </section>
  )
}
