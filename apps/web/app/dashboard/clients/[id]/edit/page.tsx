import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Client } from '@/lib/types/clients'
import { ClientForm } from '../../client-form'
import { editClientAction } from '../../actions'

export default async function EditClientPage({
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
    .select('*')
    .eq('id', id)
    .single()

  if (!client) notFound()

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-3xl border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_22px_70px_rgba(44,36,22,0.11)] md:p-8">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
          Client management
        </p>
        <h1 className="text-3xl font-semibold">Edit client</h1>
        <div className="mt-8">
          <ClientForm
            action={editClientAction}
            initial={client as Client}
            submitLabel="Save changes"
            cancelHref={`/dashboard/clients/${id}`}
          />
        </div>
      </section>
    </main>
  )
}
