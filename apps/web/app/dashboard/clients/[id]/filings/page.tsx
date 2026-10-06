import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { fetchFilings } from '@/lib/companies-house/fetch-filings'
import type { Filing } from '@/lib/types/filings'
import { FilingList } from './filing-list'

export default async function ClientFilingsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: client } = await supabase
    .from('clients')
    .select('id, display_name, client_type, firm_id')
    .eq('id', id)
    .single()

  if (!client) notFound()
  if (client.client_type !== 'entity') redirect(`/dashboard/clients/${id}`)

  const [{ data: approvedCdd }, { data: membership }] = await Promise.all([
    supabase
      .from('entity_cdd_records')
      .select('company_number')
      .eq('client_id', id)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from('firm_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('firm_id', client.firm_id)
      .eq('status', 'active')
      .single(),
  ])

  if (!approvedCdd) redirect(`/dashboard/clients/${id}`)

  const canWrite = (membership?.role ?? 'read_only') !== 'read_only'
  const companyNumber = approvedCdd.company_number as string

  let filings: Filing[]
  let loadError: string | null = null
  try {
    filings = await fetchFilings(companyNumber)
  } catch (err) {
    filings = []
    loadError = err instanceof Error ? err.message : 'Companies House lookup failed'
  }

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-4xl">
        <header className="border-b border-[var(--line)] pb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
            {client.display_name}
          </p>
          <h1 className="mt-2 text-2xl font-semibold">
            Filing History — {client.display_name} ({companyNumber})
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Select filings to download from Companies House and save to this client&apos;s record.
            Saved filings are stored as documents and approved automatically.
          </p>
        </header>

        <div className="mt-8">
          {loadError ? (
            <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              Could not load filing history: {loadError}
            </p>
          ) : (
            <FilingList clientId={id} companyNumber={companyNumber} filings={filings} canWrite={canWrite} />
          )}
        </div>

        <footer className="mt-8">
          <Link href={`/dashboard/clients/${id}`} className="text-sm text-[var(--muted)] hover:underline">
            ← Back to client
          </Link>
        </footer>
      </section>
    </main>
  )
}
