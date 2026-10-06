import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { UploadForm } from './upload-form'

export default async function UploadDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ type?: string }>
}) {
  const { id } = await params
  const { type } = await searchParams

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: client } = await supabase
    .from('clients')
    .select('id, display_name, firm_id')
    .eq('id', id)
    .single()

  if (!client) redirect('/dashboard/clients')

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

  const preselectedType =
    type && ['passport', 'proof_of_address', 'incorporation', 'source_of_funds'].includes(type)
      ? type
      : 'passport'

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-2xl">
        <header className="border-b border-[var(--line)] pb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
            {client.display_name}
          </p>
          <h1 className="mt-2 text-2xl font-semibold">Upload document</h1>
        </header>

        <div className="mt-8">
          <UploadForm clientId={id} preselectedType={preselectedType} />
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
