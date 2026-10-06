import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createSignedUrl } from '@/lib/supabase/storage'
import type { Client } from '@/lib/types/clients'
import type { ClientDocument } from '@/lib/types/documents'
import { DOCUMENT_TYPE_LABELS, DOCUMENT_STATUS_LABELS } from '@/lib/types/documents'
import type { EntityCddRecord } from '@/lib/types/entity-cdd'
import { PSC_DATA_QUALITY_LABELS } from '@/lib/types/entity-cdd'
import { fetchFilings } from '@/lib/companies-house/fetch-filings'
import { filingLabel, isPriorityFiling } from '@/lib/types/filings'
import { archiveClientAction } from '../actions'
import { AuditTimeline } from './_components/AuditTimeline'
import type { AuditEventRow } from './_components/AuditEvent'

const RISK_BADGE: Record<string, string> = {
  low: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  standard: 'bg-amber-50 text-amber-800 border-amber-200',
  high: 'bg-red-50 text-red-800 border-red-200',
}

const DOC_STATUS_STYLE: Record<string, string> = {
  uploaded: 'text-[var(--muted)]',
  extracting: 'text-amber-700',
  pending_review: 'text-amber-700 font-semibold',
  approved: 'text-emerald-700',
  rejected: 'text-red-700',
}

const DOC_STATUS_ICON: Record<string, string> = {
  uploaded: '○',
  extracting: '◌',
  pending_review: '●',
  approved: '✓',
  rejected: '✗',
}

const CDD_STATUS_LABELS: Record<string, string> = {
  pending_review: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
}

const CDD_STATUS_STYLE: Record<string, string> = {
  pending_review: 'text-amber-700 font-semibold',
  approved: 'text-emerald-700',
  rejected: 'text-red-700',
}

const CDD_STATUS_ICON: Record<string, string> = {
  pending_review: '●',
  approved: '✓',
  rejected: '✗',
}

const DOCUMENT_TYPES = [
  { value: 'passport', label: 'Passport' },
  { value: 'proof_of_address', label: 'Proof of address' },
  { value: 'incorporation', label: 'Incorporation' },
  { value: 'source_of_funds', label: 'Source of funds' },
]

export default async function ClientDetailPage({
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

  // Run documents and audit data fetches in parallel
  const [{ data: documents }, { data: entityCddRecords }, { data: auditRows }, { data: members }, { data: membership }] = await Promise.all([
    supabase
      .from('client_documents')
      .select('*')
      .eq('client_id', id)
      .order('created_at', { ascending: false }),

    supabase
      .from('entity_cdd_records')
      .select('*')
      .eq('client_id', id)
      .order('created_at', { ascending: false }),

    supabase
      .from('audit_events')
      .select('id, event_type, entity_type, entity_id, payload, created_at, actor_user_id')
      .eq('firm_id', client.firm_id)
      .or(`entity_id.eq.${id},payload->>client_id.eq.${id}`)
      .order('created_at', { ascending: false })
      .limit(50),

    supabase
      .from('firm_members')
      .select('user_id, full_name')
      .eq('firm_id', client.firm_id),

    supabase
      .from('firm_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('firm_id', client.firm_id)
      .eq('status', 'active')
      .single(),
  ])

  const c = client as Client
  const docs = (documents ?? []) as ClientDocument[]
  const cddRecords = (entityCddRecords ?? []) as EntityCddRecord[]
  const latestCdd = cddRecords[0] ?? null
  const approvedCdd = cddRecords.find((record) => record.status === 'approved') ?? null
  const events = (auditRows ?? []) as AuditEventRow[]

  const filingsSummary = approvedCdd ? await fetchFilingsSummary(approvedCdd.company_number) : []

  const docSignedUrls = new Map<string, string>(
    (
      await Promise.all(
        docs
          .filter((doc) => doc.storage_path)
          .map(async (doc) => [doc.id, await createSignedUrl(doc.storage_path)] as const),
      )
    ).filter((entry): entry is [string, string] => entry[1] !== null),
  )
  const actorMap = new Map<string, string>(
    (members ?? []).map((m) => [m.user_id as string, m.full_name as string])
  )
  const role = membership?.role ?? 'read_only'
  const canWrite = role !== 'read_only'
  const canArchive = role === 'admin'
  const canReview = role !== 'read_only'

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-4xl">
        <header className="flex flex-col justify-between gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
              Client
            </p>
            <h1 className="mt-2 text-3xl font-semibold">{c.display_name}</h1>
            <p className="mt-2 flex items-center gap-2 text-sm text-[var(--muted)] capitalize">
              {c.client_type}
              <span
                className={`inline-block border px-2 py-0.5 text-xs font-medium capitalize ${RISK_BADGE[c.risk_rating] ?? ''}`}
              >
                {c.risk_rating} risk
              </span>
            </p>
          </div>
          <div className="flex gap-3">
            {canWrite && (
              <Link
                href={`/dashboard/clients/${id}/edit`}
                className="border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold"
              >
                Edit
              </Link>
            )}
            {canArchive && c.status === 'active' && (
              <form action={archiveClientAction}>
                <input type="hidden" name="client_id" value={id} />
                <button
                  type="submit"
                  className="border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800"
                >
                  Archive
                </button>
              </form>
            )}
          </div>
        </header>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <div className="border border-[var(--line)] bg-[var(--panel)] p-5">
            <p className="text-sm text-[var(--muted)]">Refresh due</p>
            <p className="mt-2 text-xl font-semibold">
              {c.refresh_due_date
                ? new Date(c.refresh_due_date).toLocaleDateString('en-GB')
                : '—'}
            </p>
          </div>
          <div className="border border-[var(--line)] bg-[var(--panel)] p-5">
            <p className="text-sm text-[var(--muted)]">Last refreshed</p>
            <p className="mt-2 text-xl font-semibold">
              {c.last_refreshed_at
                ? new Date(c.last_refreshed_at).toLocaleDateString('en-GB')
                : 'Never'}
            </p>
          </div>
          <div className="border border-[var(--line)] bg-[var(--panel)] p-5">
            <p className="text-sm text-[var(--muted)]">External ref</p>
            <p className="mt-2 text-xl font-semibold">
              {c.external_ref ?? '—'}
            </p>
          </div>
        </div>

        {/* Entity CDD section (entity clients only) */}
        {c.client_type === 'entity' && (
          <section className="mt-6 border border-[var(--line)] bg-[var(--panel)] p-5">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">Entity CDD</h2>
              {canWrite && (!latestCdd || latestCdd.status === 'rejected') && (
                <Link
                  href={`/dashboard/clients/${id}/entity-cdd`}
                  className="border border-[var(--line)] bg-white px-3 py-2 text-sm font-semibold hover:bg-[var(--line)]"
                >
                  Fetch from Companies House
                </Link>
              )}
            </div>

            {!latestCdd ? (
              <p className="mt-4 text-sm text-[var(--muted)]">
                No Companies House data fetched yet.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">Company {latestCdd.company_number}</p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      Fetched {new Date(latestCdd.fetched_at).toLocaleDateString('en-GB')} · PSC data:{' '}
                      {PSC_DATA_QUALITY_LABELS[latestCdd.psc_data_quality]}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <span className={`text-sm ${CDD_STATUS_STYLE[latestCdd.status] ?? ''}`}>
                      {CDD_STATUS_ICON[latestCdd.status]} {CDD_STATUS_LABELS[latestCdd.status]}
                    </span>
                    {latestCdd.status === 'pending_review' && canReview && (
                      <Link
                        href={`/dashboard/clients/${id}/entity-cdd/${latestCdd.id}/review`}
                        className="text-xs font-semibold text-[var(--accent)] hover:underline"
                      >
                        Review →
                      </Link>
                    )}
                  </div>
                </div>

                {latestCdd.psc_warning && latestCdd.psc_data_quality !== 'full' && (
                  <p className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {latestCdd.psc_warning}
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {/* Filing History section (entity clients with approved CDD only) */}
        {approvedCdd && (
          <section className="mt-6 border border-[var(--line)] bg-[var(--panel)] p-5">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">Filing History</h2>
              <Link
                href={`/dashboard/clients/${id}/filings`}
                className="text-sm font-semibold text-[var(--accent)] hover:underline"
              >
                View all filings →
              </Link>
            </div>

            {filingsSummary.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--muted)]">No filings found.</p>
            ) : (
              <div className="mt-4 divide-y divide-[var(--line)]">
                {filingsSummary.map((filing) => (
                  <div key={filing.transactionId} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {filing.type && (
                          <span className="mr-2 inline-block border border-[var(--line)] px-1.5 py-0.5 text-xs font-semibold uppercase">
                            {filing.type}
                          </span>
                        )}
                        {filingLabel(filing)}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--muted)]">
                      {filing.date ? new Date(filing.date).toLocaleDateString('en-GB') : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Documents section */}
        <section className="mt-6 border border-[var(--line)] bg-[var(--panel)] p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">Documents</h2>
            {canWrite && <UploadDropdown clientId={id} />}
          </div>

          {docs.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--muted)]">No documents uploaded yet.</p>
          ) : (
            <div className="mt-4 divide-y divide-[var(--line)]">
              {docs.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{doc.file_name}</p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {DOCUMENT_TYPE_LABELS[doc.document_type]}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <span className={`text-sm ${DOC_STATUS_STYLE[doc.status] ?? ''}`}>
                      {DOC_STATUS_ICON[doc.status]} {DOCUMENT_STATUS_LABELS[doc.status]}
                    </span>
                    {doc.status === 'pending_review' && canReview && (
                      <Link
                        href={`/dashboard/clients/${id}/documents/${doc.id}/review`}
                        className="text-xs font-semibold text-[var(--accent)] hover:underline"
                      >
                        Review →
                      </Link>
                    )}
                    {doc.status === 'approved' && docSignedUrls.has(doc.id) && (
                      <a
                        href={docSignedUrls.get(doc.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-[var(--accent)] hover:underline"
                      >
                        View →
                      </a>
                    )}
                    {(doc.status === 'approved' || doc.status === 'rejected') && (
                      <span className="text-xs text-[var(--muted)]">
                        {new Date(doc.created_at).toLocaleDateString('en-GB')}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mt-4 border border-[var(--line)] bg-[var(--panel)] p-5">
          <h2 className="text-lg font-semibold">Audit timeline</h2>
          <AuditTimeline events={events} actorMap={actorMap} />
        </section>

        <footer className="mt-8 text-right">
          <Link
            href="/dashboard/clients"
            className="text-sm text-[var(--muted)] hover:underline"
          >
            ← Back to clients
          </Link>
        </footer>
      </section>
    </main>
  )
}

async function fetchFilingsSummary(companyNumber: string) {
  try {
    const filings = await fetchFilings(companyNumber)
    const sorted = [...filings].sort((a, b) => {
      const aPriority = isPriorityFiling(a) ? 0 : 1
      const bPriority = isPriorityFiling(b) ? 0 : 1
      if (aPriority !== bPriority) return aPriority - bPriority
      return (b.date ?? '').localeCompare(a.date ?? '')
    })
    return sorted.slice(0, 5)
  } catch {
    return []
  }
}

function UploadDropdown({ clientId }: { clientId: string }) {
  return (
    <details className="relative group">
      <summary className="cursor-pointer list-none">
        <span className="inline-flex items-center gap-1 border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm font-semibold hover:bg-[var(--line)]">
          Upload document ▾
        </span>
      </summary>
      <div className="absolute right-0 z-10 mt-1 min-w-[180px] border border-[var(--line)] bg-white shadow-sm">
        {DOCUMENT_TYPES.map((dt) => (
          <a
            key={dt.value}
            href={`/dashboard/clients/${clientId}/documents/upload?type=${dt.value}`}
            className="block px-4 py-2 text-sm hover:bg-[var(--panel)]"
          >
            {dt.label}
          </a>
        ))}
      </div>
    </details>
  )
}
