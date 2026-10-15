import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createSignedUrl } from '@/lib/supabase/storage'
import { createGleifSource } from '@/lib/ownership/gleif-source'
import { gleifHttp } from '@/lib/kyc-profile/gleif'
import { coverage } from '@/lib/evidence/coverage'
import { evidenceGate } from '@/lib/evidence/permissions'
import { parseEvidenceResponse } from '@/lib/evidence/parse-response'
import { emptyPayload } from '@/lib/evidence/payload'
import { lookupRegistrations } from '@/lib/evidence/registration-lookup'
import {
  EVIDENCE_KIND_LABELS,
  EVIDENCE_LABEL,
  EVIDENCE_STATUS_LABELS,
  type EvidenceKind,
  type EvidencePayload,
  type EvidenceStatus,
} from '@/lib/evidence/types'
import { EvidenceEditor } from './evidence-editor'
import { RejectForm } from './reject-form'

const NOTICES: Record<string, string> = {
  extraction_off: 'Document extraction is switched off for this firm, so the owners need to be entered by hand.',
  extraction_failed: 'The document was uploaded but Claude could not read it. Enter the owners by hand, or reject this item and upload a clearer copy.',
}

type Row = {
  id: string
  client_id: string
  firm_id: string
  document_id: string
  subject_id: string
  node_key: string
  node_name: string
  evidence_kind: EvidenceKind
  status: EvidenceStatus
  proposal_source: string | null
  proposal: EvidencePayload | null
  confirmed: EvidencePayload | null
  raw_response: string | null
  confidence: number | null
  as_at: string | null
  document_date: string | null
  certified: string | null
  edited: boolean | null
  created_by: string
  created_at: string
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
}

function when(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

function holdingText(owner: EvidencePayload['owners'][number]): string {
  if (!owner.holding) return 'not printed'
  return owner.holding.type === 'percent' ? `${owner.holding.value}%` : `${owner.holding.low}% to ${owner.holding.high}%`
}

function OwnersTable({ payload }: { payload: EvidencePayload }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-[0.1em] text-[var(--muted)]">
          <tr>
            <th className="py-2 pr-4">Name as shown</th>
            <th className="py-2 pr-4">Holding</th>
            <th className="py-2 pr-4">Registration</th>
            <th className="py-2">Where</th>
          </tr>
        </thead>
        <tbody>
          {payload.owners.map((owner, i) => (
            <tr key={i} className="border-t border-[var(--line)] align-top">
              <td className="py-2 pr-4">
                {owner.name_as_shown}
                <span className="block text-xs text-[var(--muted)]">{owner.kind === 'individual' ? `Individual (${owner.initials})` : 'Company / entity'}</span>
              </td>
              <td className="py-2 pr-4">{holdingText(owner)}</td>
              <td className="py-2 pr-4">{owner.registration ? `${owner.registration.number} (${owner.registration.country})` : '—'}</td>
              <td className="py-2">{owner.page_ref}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function EvidencePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; evidenceId: string }>
  searchParams: Promise<{ notice?: string }>
}) {
  const { id, evidenceId } = await params
  const { notice } = await searchParams

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: client } = await supabase.from('clients').select('id, display_name, firm_id').eq('id', id).maybeSingle()
  if (!client) notFound()

  const { data: membership } = await supabase
    .from('firm_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('firm_id', client.firm_id)
    .eq('status', 'active')
    .maybeSingle()
  if (!membership) redirect('/dashboard')
  const role = membership.role as string

  const backLink = (
    <footer className="mt-8 flex gap-6">
      <a href="/dashboard/evidence" className="text-sm text-[var(--muted)] hover:underline">
        ← Evidence queue
      </a>
      <a href={`/dashboard/clients/${id}`} className="text-sm text-[var(--muted)] hover:underline">
        ← Back to client
      </a>
    </footer>
  )

  // read_only users never see names or the document: only the names-free overview.
  if (role === 'read_only') {
    const { data: overview } = await supabase.from('ownership_evidence_overview').select('*').eq('id', evidenceId).eq('client_id', id).maybeSingle()
    if (!overview) notFound()
    return (
      <main className="min-h-screen px-6 py-8">
        <section className="mx-auto max-w-3xl">
          <header className="border-b border-[var(--line)] pb-6">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">{client.display_name}</p>
            <h1 className="mt-2 text-2xl font-semibold">{overview.node_name}</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {EVIDENCE_KIND_LABELS[overview.evidence_kind as EvidenceKind]} · {EVIDENCE_STATUS_LABELS[overview.status as EvidenceStatus]}
            </p>
          </header>
          <p className="mt-6 border border-[var(--line)] bg-[var(--panel)] p-4 text-sm text-[var(--muted)]">
            Client evidence holds the names of shareholders, so read-only users see its status only.
          </p>
          {backLink}
        </section>
      </main>
    )
  }

  const { data: rowData } = await supabase.from('ownership_evidence').select('*').eq('id', evidenceId).eq('client_id', id).maybeSingle()
  if (!rowData) notFound()
  const ev = rowData as Row

  const [{ data: doc }, { data: firm }, { data: members }] = await Promise.all([
    supabase.from('client_documents').select('file_name, storage_path, mime_type').eq('id', ev.document_id).maybeSingle(),
    supabase.from('firms').select('four_eyes').eq('id', client.firm_id).maybeSingle(),
    supabase.from('firm_members').select('user_id, full_name').eq('firm_id', client.firm_id).eq('status', 'active'),
  ])
  const names = new Map((members ?? []).map((m) => [m.user_id as string, m.full_name as string]))
  const who = (userId: string | null) => (userId ? (userId === user.id ? 'you' : (names.get(userId) ?? 'a colleague')) : '—')

  const gate = evidenceGate({
    role,
    userId: user.id,
    uploadedBy: ev.created_by,
    status: ev.status,
    proposalSource: ev.proposal_source,
    fourEyes: firm?.four_eyes ?? true,
  })
  const signedUrl = doc ? await createSignedUrl(doc.storage_path) : null

  const open = ev.status === 'draft' || ev.status === 'proposed'
  const showConfirm = ev.status === 'proposed' && role === 'admin'
  const showPropose = open && gate.canEditProposal
  const initial = ev.proposal ?? emptyPayload()

  let warnings: string[] = []
  if (ev.proposal_source === 'extraction' && ev.raw_response) {
    try {
      warnings = parseEvidenceResponse(ev.raw_response).warnings
    } catch {
      warnings = []
    }
  }

  const lookups =
    showConfirm && ev.proposal ? await lookupRegistrations(ev.proposal.owners, createGleifSource(gleifHttp)) : []

  const shown = ev.confirmed ?? ev.proposal
  const cover = shown ? coverage(shown.owners, shown.owners_complete) : null

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-3xl">
        <header className="border-b border-[var(--line)] pb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">{client.display_name}</p>
          <h1 className="mt-2 text-2xl font-semibold">{ev.node_name}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {EVIDENCE_KIND_LABELS[ev.evidence_kind]} · {EVIDENCE_STATUS_LABELS[ev.status]} · uploaded by {who(ev.created_by)} on {when(ev.created_at)}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Walk subject {ev.subject_id} · node {ev.node_key}
          </p>
        </header>

        {notice && NOTICES[notice] && (
          <p className="mt-6 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{NOTICES[notice]}</p>
        )}

        <div className="mt-6 grid gap-4 border border-[var(--line)] bg-[var(--panel)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Document</h2>
            {ev.proposal_source === 'extraction' && ev.confidence !== null && (
              <span className="text-sm text-[var(--muted)]">Read by Claude · confidence {Math.round(ev.confidence * 100)}%</span>
            )}
          </div>
          {signedUrl && doc ? (
            doc.mime_type === 'application/pdf' ? (
              <a href={signedUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-[var(--accent)] hover:underline">
                Open {doc.file_name} in a new tab →
              </a>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={signedUrl} alt={doc.file_name} className="max-h-96 w-full object-contain" />
            )
          ) : (
            <p className="text-sm text-[var(--muted)]">The document preview is not available.</p>
          )}
          {warnings.length > 0 && (
            <ul className="space-y-1 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          )}
        </div>

        {ev.status === 'confirmed' && ev.confirmed && (
          <div className="mt-6 grid gap-4 border border-emerald-200 bg-emerald-50 p-4">
            <h2 className="text-base font-semibold text-emerald-900">Confirmed · {EVIDENCE_LABEL}</h2>
            <p className="text-sm text-emerald-900">
              Confirmed by {who(ev.reviewed_by)} on {when(ev.reviewed_at)}
              {ev.edited ? ' with edits to the proposal' : ''}. As at {ev.as_at ?? '—'}, document date {ev.document_date ?? '—'},
              certified: {ev.certified}
              {ev.confirmed.certified_by ? ` (${ev.confirmed.certified_by})` : ''}.
            </p>
            {ev.confirmed.override && (
              <p className="text-sm text-amber-900">
                Accepted by override ({ev.confirmed.override.reasons.join(', ')}): {ev.confirmed.override.note}
              </p>
            )}
            {ev.review_note && <p className="text-sm text-emerald-900">Note: {ev.review_note}</p>}
            <OwnersTable payload={ev.confirmed} />
          </div>
        )}

        {(ev.status === 'rejected' || ev.status === 'superseded') && (
          <div className="mt-6 border border-[var(--line)] bg-[var(--panel)] p-4 text-sm">
            <h2 className="text-base font-semibold">{EVIDENCE_STATUS_LABELS[ev.status]}</h2>
            <p className="mt-1 text-[var(--muted)]">
              {ev.status === 'rejected'
                ? `By ${who(ev.reviewed_by)} on ${when(ev.reviewed_at)}: ${ev.review_note ?? ''}`
                : 'A newer confirmed item replaced this one. It is kept for the record.'}
            </p>
            {ev.proposal && <div className="mt-3"><OwnersTable payload={ev.confirmed ?? ev.proposal} /></div>}
          </div>
        )}

        {lookups.length > 0 && (
          <div className="mt-6 border border-[var(--line)] bg-[var(--panel)] p-4">
            <h2 className="text-base font-semibold">Registration numbers in the proposal, looked up in GLEIF</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Only a printed registration number with its country is looked up, never a name. Nothing is linked from this; it is here for you to compare.
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              {lookups.map((l) => (
                <li key={l.row}>
                  <strong>
                    Owner {l.row} · {l.ownerName} · {l.number} ({l.country})
                  </strong>
                  <span className="block text-[var(--muted)]">{l.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {open && cover && !cover.covers && (
          <p className="mt-6 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Coverage: {cover.reason}. This evidence will not resolve the company on its own.
          </p>
        )}

        {showPropose && (
          <div className="mt-6 border border-[var(--line)] bg-[var(--panel)] p-5">
            <h2 className="text-base font-semibold">{ev.status === 'draft' ? 'Enter the owners shown in the document' : 'Correct the owners'}</h2>
            <p className="mt-1 mb-4 text-xs text-[var(--muted)]">
              Copy only what is printed. A different admin checks it against the document before it is used.
            </p>
            <EvidenceEditor mode="propose" evidenceId={ev.id} clientId={id} initial={initial} canSubmit={gate.canEditProposal} />
          </div>
        )}

        {showConfirm && (
          <div className="mt-6 border border-[var(--line)] bg-[var(--panel)] p-5">
            <h2 className="text-base font-semibold">Check against the document, then confirm</h2>
            <p className="mt-1 mb-4 text-xs text-[var(--muted)]">
              Edit anything that does not match the document. Confirming sets the evidence label &ldquo;{EVIDENCE_LABEL}&rdquo; with your name and the date.
            </p>
            <EvidenceEditor
              mode="confirm"
              evidenceId={ev.id}
              clientId={id}
              initial={initial}
              canSubmit={gate.canConfirm}
              reason={gate.reason}
            />
          </div>
        )}

        {open && !showPropose && !showConfirm && gate.reason && (
          <p className="mt-6 border border-[var(--line)] bg-[var(--panel)] p-4 text-sm text-[var(--muted)]">{gate.reason}</p>
        )}

        {open && gate.canReject && (
          <div className="mt-6 border border-[var(--line)] bg-[var(--panel)] p-5">
            <h2 className="text-base font-semibold">{role === 'admin' && ev.created_by !== user.id ? 'Reject' : 'Withdraw'}</h2>
            <div className="mt-3">
              <RejectForm evidenceId={ev.id} clientId={id} withdraw={ev.created_by === user.id} />
            </div>
          </div>
        )}

        {backLink}
      </section>
    </main>
  )
}
