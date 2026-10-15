import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { EVIDENCE_KIND_LABELS, EVIDENCE_STATUS_LABELS, type EvidenceKind, type EvidenceStatus } from '@/lib/evidence/types'

type Item = {
  id: string
  firm_id: string
  client_id: string
  node_name: string
  evidence_kind: EvidenceKind
  status: EvidenceStatus
  has_override: boolean
  created_by: string
  created_at: string
  reviewed_at: string | null
}

function age(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
}

export default async function EvidenceQueuePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // The overview carries no names, so every role can list from it; the item page decides what each role sees.
  const { data } = await supabase
    .from('ownership_evidence_overview')
    .select('id, firm_id, client_id, node_name, evidence_kind, status, has_override, created_by, created_at, reviewed_at')
    .order('created_at', { ascending: false })
    .limit(200)
  const items = (data ?? []) as Item[]

  const clientIds = [...new Set(items.map((i) => i.client_id))]
  const [{ data: clients }, { data: members }] = await Promise.all([
    clientIds.length > 0 ? supabase.from('clients').select('id, display_name').in('id', clientIds) : Promise.resolve({ data: [] }),
    supabase.from('firm_members').select('user_id, full_name').eq('status', 'active'),
  ])
  const clientName = new Map((clients ?? []).map((c) => [c.id as string, c.display_name as string]))
  const memberName = new Map((members ?? []).map((m) => [m.user_id as string, m.full_name as string]))

  const proposed = items.filter((i) => i.status === 'proposed')
  const drafts = items.filter((i) => i.status === 'draft')
  const decided = items.filter((i) => i.status !== 'proposed' && i.status !== 'draft').slice(0, 20)

  function Section({ title, hint, rows }: { title: string; hint?: string; rows: Item[] }) {
    return (
      <section className="mt-8">
        <h2 className="text-lg font-semibold">
          {title} <span className="text-sm font-normal text-[var(--muted)]">({rows.length})</span>
        </h2>
        {hint && <p className="mt-1 text-sm text-[var(--muted)]">{hint}</p>}
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">Nothing here.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--line)] border border-[var(--line)] bg-[var(--panel)]">
            {rows.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/dashboard/clients/${item.client_id}/evidence/${item.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-white"
                >
                  <span>
                    <strong>{item.node_name}</strong>
                    <span className="block text-xs text-[var(--muted)]">
                      {clientName.get(item.client_id) ?? 'Client'} · {EVIDENCE_KIND_LABELS[item.evidence_kind]} · uploaded by{' '}
                      {item.created_by === user!.id ? 'you' : (memberName.get(item.created_by) ?? 'a colleague')} {age(item.created_at)}
                    </span>
                  </span>
                  <span className="text-xs font-semibold text-[var(--muted)]">
                    {EVIDENCE_STATUS_LABELS[item.status]}
                    {item.has_override ? ' · override' : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-3xl">
        <header className="border-b border-[var(--line)] pb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">Client evidence</p>
          <h1 className="mt-2 text-2xl font-semibold">Evidence queue</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Documents the client provided for companies no register could resolve. An admin other than the uploader checks each one against
            the document before it is used.
          </p>
        </header>

        <Section title="Awaiting confirmation" hint="Open one to check the owners against the document." rows={proposed} />
        <Section title="Waiting for owners to be entered" rows={drafts} />
        <Section title="Recently decided" rows={decided} />

        <footer className="mt-8">
          <Link href="/dashboard" className="text-sm text-[var(--muted)] hover:underline">
            ← Dashboard
          </Link>
        </footer>
      </section>
    </main>
  )
}
