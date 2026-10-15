import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { OwnershipViewer } from './ownership-viewer'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function OwnershipPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  // Started from a client page: that client's confirmed ownership evidence is used. Row-level security decides if it exists for this user.
  const { client: clientId } = await searchParams
  let client: { id: string; name: string } | undefined
  if (clientId && UUID.test(clientId)) {
    const supabase = await createClient()
    const { data } = await supabase.from('clients').select('id, display_name').eq('id', clientId).maybeSingle()
    if (data) client = { id: data.id as string, name: data.display_name as string }
  }

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-6xl">
        <header className="border-b border-[var(--line)] pb-6">
          <Link href="/dashboard" className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-3xl font-semibold">Ownership chain</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Walks ownership upwards using Companies House, GLEIF and EU registers (ESMA, ECB). Runs live; nothing is
            saved. Individuals are shown as initials only.
          </p>
        </header>
        <OwnershipViewer client={client} />
      </section>
    </main>
  )
}
