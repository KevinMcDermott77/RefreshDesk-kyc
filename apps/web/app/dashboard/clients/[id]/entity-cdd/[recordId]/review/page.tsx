import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { EntityCddRecord } from '@/lib/types/entity-cdd'
import { PSC_DATA_QUALITY_LABELS } from '@/lib/types/entity-cdd'
import { ReviewEntityCddForm } from './review-form'
import { OwnershipOrgChart } from './org-chart'

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value || '—'
  if (typeof value === 'number') return String(value)
  return '—'
}

function formatAddress(value: unknown): string {
  const addr = asRecord(value)
  const parts = [
    addr.premises,
    addr.address_line_1,
    addr.address_line_2,
    addr.locality,
    addr.region,
    addr.postal_code,
    addr.country,
  ]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : '—'
}

function formatDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB')
}

export default async function ReviewEntityCddPage({
  params,
}: {
  params: Promise<{ id: string; recordId: string }>
}) {
  const { id, recordId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: recordData } = await supabase
    .from('entity_cdd_records')
    .select('*')
    .eq('id', recordId)
    .eq('client_id', id)
    .single()

  if (!recordData) notFound()
  const record = recordData as EntityCddRecord

  if (record.status !== 'pending_review') {
    redirect(`/dashboard/clients/${id}`)
  }

  const profile = asRecord(record.company_profile)
  const registeredOffice = profile.registered_office_address

  const officers = (record.officers ?? []) as unknown[]
  const directors = officers
    .map(asRecord)
    .filter((o) => !o.resigned_on)

  const pscs = (record.pscs ?? []) as unknown[]
  const uboNames = new Set(record.ubo_list.map((u) => u.name))

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-4xl">
        <header className="border-b border-[var(--line)] pb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
            Review entity CDD
          </p>
          <h1 className="mt-2 text-2xl font-semibold">{str(profile.company_name)}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Company number {record.company_number} · Fetched{' '}
            {new Date(record.fetched_at).toLocaleDateString('en-GB')}
          </p>
        </header>

        {/* Company details */}
        <div className="mt-8 border border-[var(--line)] bg-[var(--panel)] p-5">
          <h2 className="text-base font-semibold">Company details</h2>
          <table className="mt-4 w-full">
            <tbody>
              <tr className="border-t border-[var(--line)]">
                <td className="py-3 pr-6 text-sm text-[var(--muted)] align-top">Company name</td>
                <td className="py-3 text-sm font-medium align-top">{str(profile.company_name)}</td>
              </tr>
              <tr className="border-t border-[var(--line)]">
                <td className="py-3 pr-6 text-sm text-[var(--muted)] align-top">Company number</td>
                <td className="py-3 text-sm font-medium align-top">{record.company_number}</td>
              </tr>
              <tr className="border-t border-[var(--line)]">
                <td className="py-3 pr-6 text-sm text-[var(--muted)] align-top">Status</td>
                <td className="py-3 text-sm font-medium align-top capitalize">
                  {str(profile.company_status)}
                </td>
              </tr>
              <tr className="border-t border-[var(--line)]">
                <td className="py-3 pr-6 text-sm text-[var(--muted)] align-top">Incorporated</td>
                <td className="py-3 text-sm font-medium align-top">
                  {formatDate(profile.date_of_creation)}
                </td>
              </tr>
              <tr className="border-t border-[var(--line)]">
                <td className="py-3 pr-6 text-sm text-[var(--muted)] align-top">Registered office</td>
                <td className="py-3 text-sm font-medium align-top">{formatAddress(registeredOffice)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Directors */}
        <div className="mt-6 border border-[var(--line)] bg-[var(--panel)] p-5">
          <h2 className="text-base font-semibold">Directors &amp; officers</h2>
          {directors.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted)]">No active officers returned.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                    <th className="pb-2 pr-4">Name</th>
                    <th className="pb-2 pr-4">Role</th>
                    <th className="pb-2 pr-4">Nationality</th>
                    <th className="pb-2">Appointed</th>
                  </tr>
                </thead>
                <tbody>
                  {directors.map((o, i) => (
                    <tr key={i} className="border-t border-[var(--line)]">
                      <td className="py-3 pr-4 font-medium">{str(o.name)}</td>
                      <td className="py-3 pr-4 capitalize">{str(o.officer_role).replace(/-/g, ' ')}</td>
                      <td className="py-3 pr-4">{str(o.nationality)}</td>
                      <td className="py-3">{formatDate(o.appointed_on)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* PSC table + warning */}
        <div className="mt-6 border border-[var(--line)] bg-[var(--panel)] p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold">Persons with significant control</h2>
            <span className="text-sm text-[var(--muted)]">
              PSC data: {PSC_DATA_QUALITY_LABELS[record.psc_data_quality]}
            </span>
          </div>

          {record.psc_warning && record.psc_data_quality !== 'full' && (
            <p className="mt-3 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              ⚠ {record.psc_warning}
            </p>
          )}

          {pscs.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted)]">No PSCs returned by Companies House.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                    <th className="pb-2 pr-4">Name</th>
                    <th className="pb-2 pr-4">Kind</th>
                    <th className="pb-2 pr-4">Nature of control</th>
                    <th className="pb-2 pr-4">Notified</th>
                    <th className="pb-2">UBO</th>
                  </tr>
                </thead>
                <tbody>
                  {pscs.map((pscRaw, i) => {
                    const psc = asRecord(pscRaw)
                    const name = str(psc.name)
                    const natures = Array.isArray(psc.natures_of_control)
                      ? (psc.natures_of_control as unknown[])
                          .filter((n): n is string => typeof n === 'string')
                          .map((n) => n.replace(/-/g, ' '))
                          .join(', ')
                      : '—'
                    return (
                      <tr key={i} className="border-t border-[var(--line)]">
                        <td className="py-3 pr-4 font-medium">{name}</td>
                        <td className="py-3 pr-4 capitalize">
                          {str(psc.kind).replace(/-/g, ' ').replace('person with significant control', '')}
                        </td>
                        <td className="py-3 pr-4">{natures}</td>
                        <td className="py-3 pr-4">{formatDate(psc.notified_on)}</td>
                        <td className="py-3">
                          {uboNames.has(name) ? (
                            <span className="border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-800">
                              UBO
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Org chart */}
        <div className="mt-6 border border-[var(--line)] bg-[var(--panel)] p-5">
          <h2 className="text-base font-semibold">Ownership chain</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Click a node to expand its details. Estimated percentages are derived from Companies
            House &quot;nature of control&quot; bands.
          </p>
          <div className="mt-4">
            <OwnershipOrgChart
              companyName={str(profile.company_name)}
              companyNumber={record.company_number}
              ownershipChain={record.ownership_chain}
            />
          </div>
        </div>

        {/* Review decision */}
        <div className="mt-6 border border-[var(--line)] bg-[var(--panel)] p-5">
          <h2 className="text-base font-semibold">Review decision</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Approving will save these company details to the client record and recalculate the
            refresh due date. Rejecting will discard this fetch — no client data will change.
          </p>
          <ReviewEntityCddForm recordId={record.id} clientId={id} />
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
