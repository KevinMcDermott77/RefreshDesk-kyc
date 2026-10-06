import { redirect } from 'next/navigation'
import Link from 'next/link'
import { addDays, parseISO } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import type { Client, ClientFilter } from '@/lib/types/clients'
import { archiveClientAction } from './actions'
import { SearchBar } from './search-bar'

const FILTER_LABELS: Record<ClientFilter, string> = {
  overdue: 'Overdue',
  due_soon: 'Due ≤ 30 days',
  complete: 'Up to date',
  all: 'All',
}

const RISK_BADGE: Record<string, string> = {
  low: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  standard: 'bg-amber-50 text-amber-800 border-amber-200',
  high: 'bg-red-50 text-red-800 border-red-200',
}

function applyFilter(clients: Client[], filter: ClientFilter): Client[] {
  if (filter === 'all') return clients

  // Work with date strings throughout to avoid local/UTC timezone mismatch.
  // parseISO treats date-only strings as UTC midnight; new Date() is local.
  // String comparison on YYYY-MM-DD is correct and avoids both.
  const today = new Date().toISOString().split('T')[0]
  const in30 = addDays(parseISO(today), 30).toISOString().split('T')[0]

  return clients.filter((c) => {
    if (!c.refresh_due_date) return filter === 'complete'
    const due = c.refresh_due_date
    if (filter === 'overdue') return due < today
    if (filter === 'due_soon') return due >= today && due <= in30
    if (filter === 'complete') return due > in30
    return true
  })
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  const { filter: rawFilter } = await searchParams
  const filter: ClientFilter =
    rawFilter === 'overdue' || rawFilter === 'due_soon' || rawFilter === 'complete'
      ? rawFilter
      : 'all'

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('firm_members')
    .select('firm_id, role')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()

  if (!membership) redirect('/onboarding')

  const canWrite = membership.role !== 'read_only'
  const canArchive = membership.role === 'admin'

  const [{ data: clients = [] }, { data: plan }] = await Promise.all([
    supabase
      .from('clients')
      .select('*')
      .eq('firm_id', membership.firm_id)
      .eq('status', 'active')
      .order('refresh_due_date', { ascending: true, nullsFirst: false }),
    supabase.rpc('get_firm_plan'),
  ])

  const displayed = applyFilter((clients ?? []) as Client[], filter)

  const isStarter = plan?.plan === 'starter'
  const maxClients: number | null = plan?.limits?.max_clients ?? null
  const atClientLimit = isStarter && maxClients !== null && (plan?.client_count ?? 0) >= maxClients

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-6xl">
        <header className="flex flex-col justify-between gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
              RefreshDesk
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Clients</h1>
          </div>
          <SearchBar />
          {canWrite ? (
            <div className="flex items-center gap-3">
              {isStarter ? (
                <span className="inline-flex items-center gap-2 border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold text-[var(--muted)]">
                  Import CSV — Available on Pro
                </span>
              ) : (
                <Link
                  href="/dashboard/clients/import"
                  className="inline-flex items-center gap-2 border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold"
                >
                  Import CSV
                </Link>
              )}
              {atClientLimit ? (
                <Link
                  href="/settings"
                  className="inline-flex items-center gap-2 bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                >
                  Upgrade to add more
                </Link>
              ) : (
                <Link
                  href="/dashboard/clients/new"
                  className="inline-flex items-center gap-2 bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                >
                  Add client
                </Link>
              )}
            </div>
          ) : null}
        </header>

        {atClientLimit ? (
          <p className="mt-4 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            You&apos;ve reached the 10-client limit on the free plan.{' '}
            <Link href="/settings" className="font-semibold underline">
              Upgrade to Pro
            </Link>{' '}
            to add more.
          </p>
        ) : null}

        <nav className="mt-6 flex gap-1 border-b border-[var(--line)]">
          {(Object.keys(FILTER_LABELS) as ClientFilter[]).map((f) => (
            <Link
              key={f}
              href={
                f === 'all'
                  ? '/dashboard/clients'
                  : `/dashboard/clients?filter=${f}`
              }
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                filter === f
                  ? 'border-[var(--accent)] text-[var(--accent-strong)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              {FILTER_LABELS[f]}
            </Link>
          ))}
        </nav>

        <div className="mt-6">
          {displayed.length === 0 ? (
            <p className="py-12 text-center text-sm text-[var(--muted)]">
              No clients in this view.
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-[var(--muted)]">
                  <th className="pb-3 pr-4 font-medium">Name</th>
                  <th className="pb-3 pr-4 font-medium">Type</th>
                  <th className="pb-3 pr-4 font-medium">Risk</th>
                  <th className="pb-3 pr-4 font-medium">Due date</th>
                  <th className="pb-3 pr-4 font-medium">Ref</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {displayed.map((client) => (
                  <tr key={client.id} className="group">
                    <td className="py-3 pr-4 font-medium">
                      <Link
                        href={`/dashboard/clients/${client.id}`}
                        className="hover:text-[var(--accent)]"
                      >
                        {client.display_name}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 capitalize text-[var(--muted)]">
                      {client.client_type}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`inline-block border px-2 py-0.5 text-xs font-medium capitalize ${RISK_BADGE[client.risk_rating] ?? ''}`}
                      >
                        {client.risk_rating}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-[var(--muted)]">
                      {client.refresh_due_date ?? '—'}
                    </td>
                    <td className="py-3 pr-4 text-[var(--muted)]">
                      {client.external_ref ?? '—'}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-3 opacity-0 transition-opacity group-hover:opacity-100">
                        {canWrite ? (
                          <Link
                            href={`/dashboard/clients/${client.id}/edit`}
                            className="text-xs text-[var(--accent)] hover:underline"
                          >
                            Edit
                          </Link>
                        ) : null}
                        {canArchive ? (
                          <form action={archiveClientAction}>
                            <input
                              type="hidden"
                              name="client_id"
                              value={client.id}
                            />
                            <button
                              type="submit"
                              className="text-xs text-[var(--muted)] hover:text-red-700"
                            >
                              Archive
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="mt-8 text-right">
          <Link
            href="/dashboard"
            className="text-sm text-[var(--muted)] hover:underline"
          >
            ← Back to dashboard
          </Link>
        </footer>
      </section>
    </main>
  )
}
