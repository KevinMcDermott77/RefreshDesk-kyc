import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canWrite } from '@/lib/entity-cdd/permissions'
import { EVIDENCE_KINDS } from '@/lib/evidence/types'
import { EvidenceUploadForm } from './evidence-upload-form'

type Search = { subject?: string; name?: string; lei?: string; country?: string; registration?: string; kind?: string }

export default async function NewEvidencePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Search>
}) {
  const { id } = await params
  const query = await searchParams

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: client } = await supabase.from('clients').select('id, display_name, firm_id').eq('id', id).single()
  if (!client) redirect('/dashboard/clients')

  const { data: membership } = await supabase
    .from('firm_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('firm_id', client.firm_id)
    .eq('status', 'active')
    .single()
  if (!membership || !canWrite(membership.role)) redirect(`/dashboard/clients/${id}`)

  const { data: firm } = await supabase.from('firms').select('evidence_extraction_enabled').eq('id', client.firm_id).maybeSingle()

  const kind = (EVIDENCE_KINDS as readonly string[]).includes(query.kind ?? '') ? (query.kind as string) : 'shareholder_register'

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-2xl">
        <header className="border-b border-[var(--line)] pb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">{client.display_name}</p>
          <h1 className="mt-2 text-2xl font-semibold">Add client-provided ownership evidence</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            For a company the ownership walk could not resolve from a register: a register extract, shareholder register, signed
            structure chart or annual report page. Nothing is used until a different admin confirms it.
          </p>
        </header>

        <div className="mt-8">
          <EvidenceUploadForm
            clientId={id}
            firmId={client.firm_id}
            extractionEnabled={!!firm?.evidence_extraction_enabled}
            defaults={{
              subject: query.subject ?? '',
              name: query.name ?? '',
              lei: query.lei ?? '',
              country: query.country ?? '',
              registration: query.registration ?? '',
              kind,
            }}
          />
        </div>

        <footer className="mt-8">
          <a href={`/dashboard/clients/${id}`} className="text-sm text-[var(--muted)] hover:underline">
            ← Back to client
          </a>
        </footer>
      </section>
    </main>
  )
}
