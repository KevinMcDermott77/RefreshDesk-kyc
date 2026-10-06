import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FetchEntityCddForm } from './fetch-form'

export default async function EntityCddFetchPage({
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

  const { data: membership } = await supabase
    .from('firm_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('firm_id', client.firm_id)
    .eq('status', 'active')
    .single()

  if (!membership || membership.role === 'read_only') {
    redirect(`/dashboard/clients/${id}`)
  }

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-2xl">
        <header className="border-b border-[var(--line)] pb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
            {client.display_name}
          </p>
          <h1 className="mt-2 text-2xl font-semibold">Fetch from Companies House</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Enter the company registration number, or upload an incorporation document and let
            Claude extract the number for you.
          </p>
        </header>

        <div className="mt-8">
          <FetchEntityCddForm clientId={id} />
        </div>

        <footer className="mt-8">
          <a
            href={`/dashboard/clients/${id}`}
            className="text-sm text-[var(--muted)] hover:underline"
          >
            ← Back to client
          </a>
        </footer>
      </section>
    </main>
  )
}
