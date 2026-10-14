import type { ReactNode } from 'react'
import { reasonText } from '@/lib/ownership/reason-text'
import { formatFetchedAt } from '@/lib/ownership/to-flow'
import type { ReasonCode } from '@/lib/ownership/types'
import { PACK_STATUS_LABELS, type PackStatus } from '@/lib/packs/sign-off'
import type { PackSnapshot } from '@/lib/packs/snapshot'
import { StaticChart } from './StaticChart'

export type PackMeta = {
  id: string
  status: PackStatus
  /** The fingerprint stored with the pack. */
  fingerprint: string
  /** Whether the fingerprint recomputed from the snapshot matches the stored one. */
  verified: boolean
  recomputed: string
  createdByName: string
  createdAt: string
  submittedAt: string | null
  reviewedByName: string | null
  reviewedAt: string | null
  reviewNote: string | null
}

// Printing: hide the app chrome and controls, repeat table headers, never cut a row or a card, and
// repeat the fingerprint in the footer of every page.
const PRINT_CSS = `
@page { size: A4; margin: 14mm 12mm 18mm; }
.print-only { display: none; }
@media print {
  html, body { background: #fff !important; color: #000 !important; }
  .no-print, nav, header.app-chrome { display: none !important; }
  .print-only { display: block; }
  main { padding: 0 !important; min-height: 0 !important; }
  .pack-card { border-color: #000 !important; background: #fff !important; box-shadow: none !important; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr, .keep-together { break-inside: avoid; page-break-inside: avoid; }
  h2 { break-after: avoid; page-break-after: avoid; }
  a { color: inherit !important; text-decoration: none !important; }
  .print-footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 8pt; border-top: 1px solid #000; padding-top: 2mm; }
}
`

const MARK_STYLE = {
  PASS: 'border-emerald-600 text-emerald-800',
  GAP: 'border-amber-600 text-amber-900',
  INFO: 'border-gray-500 text-gray-700',
} as const

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pack-card mt-6 border border-[var(--line)] bg-[var(--panel)] p-5 text-[var(--foreground)] dark:bg-gray-900 dark:text-gray-100">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function countsLine(summary: PackSnapshot['summary']): string {
  const parts: string[] = []
  if (summary.intermediate > 0) parts.push(`${summary.intermediate} intermediate`)
  if (summary.notReached > 0) parts.push(`${summary.notReached} not reached`)
  for (const [resolution, count] of Object.entries(summary.counts)) {
    parts.push(`${count} ${resolution.toLowerCase().replace(/_/g, ' ')}`)
  }
  return parts.join(' · ') || 'no nodes'
}

function reasonOf(code: string | undefined): string {
  return code ? reasonText(code as ReasonCode) ?? '' : ''
}

/**
 * A refresh pack, rendered ONLY from its snapshot (plus the pack's own record: who made it, its
 * status and fingerprint). Nothing here fetches live data.
 */
export function PackReport({ snapshot, meta, controls }: { snapshot: PackSnapshot; meta: PackMeta; controls?: ReactNode }) {
  const { subject, policy, summary } = snapshot
  const shortPrint = `${meta.fingerprint.slice(0, 16)}…${meta.fingerprint.slice(-8)}`

  return (
    <article>
      <style>{PRINT_CSS}</style>

      <header className="border-b border-[var(--line)] pb-5">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">Refresh pack</p>
        <h1 className="mt-2 text-3xl font-semibold">{subject.name}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {subject.kind === 'lei' ? 'LEI' : subject.kind === 'overseas_entity' ? 'Overseas entity' : 'Company number'} {subject.id} · generated{' '}
          {formatFetchedAt(snapshot.generatedAt)}
        </p>

        <dl className="keep-together mt-4 grid gap-x-8 gap-y-2 text-sm md:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">Status</dt>
            <dd className="font-semibold">{PACK_STATUS_LABELS[meta.status]}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">Policy</dt>
            <dd>
              Threshold {policy.threshold}% · max depth {policy.maxDepth} · indirect method {policy.indirectMethod} · regulated entities{' '}
              {policy.acceptRegulatedAsTerminal ? 'end the walk' : 'do not end the walk'}
            </dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">Fingerprint (SHA-256 of the snapshot)</dt>
            <dd className="break-all font-mono text-xs">{meta.fingerprint}</dd>
            {meta.verified ? (
              <p className="mt-1 text-sm font-semibold text-emerald-800 dark:text-emerald-300">✓ Fingerprint verified: the snapshot matches the stored fingerprint.</p>
            ) : (
              <p role="alert" className="mt-1 border border-red-600 bg-red-50 px-3 py-2 text-sm font-semibold text-red-900">
                ✗ FINGERPRINT MISMATCH: the snapshot no longer matches the fingerprint stored with this pack. Do not rely on it. Recomputed:{' '}
                <span className="break-all font-mono text-xs">{meta.recomputed}</span>
              </p>
            )}
          </div>
        </dl>
        {controls ? <div className="no-print mt-4 flex flex-wrap gap-3">{controls}</div> : null}
      </header>

      <Section title="Summary">
        <p className="keep-together text-sm">
          <strong>{summary.status === 'complete' ? 'Complete' : 'Partial'}</strong> · {summary.openBranches} open{' '}
          {summary.openBranches === 1 ? 'branch' : 'branches'} · walk status {summary.walkStatus}
        </p>
        <p className="mt-1 text-sm text-[var(--muted)]">{countsLine(summary)}</p>
        {summary.unresolved.length > 0 ? (
          <ul className="mt-3 space-y-2 text-sm">
            {summary.unresolved.map((item) => (
              <li key={item.id} className="keep-together">
                <strong>{item.name}</strong>
                {item.subtitle ? ` (${item.subtitle})` : ''}
                {item.reasonCode ? (
                  <>
                    {' '}
                    <span className="border border-current px-1.5 py-0.5 text-xs font-semibold">{item.reasonCode}</span> {reasonOf(item.reasonCode)}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="Entity KYC profile">
        <div className="divide-y divide-[var(--line)]">
          {snapshot.profile.map((row) => (
            <div key={row.key} className="keep-together grid gap-2 py-3 md:grid-cols-[9rem_1fr]">
              <div>
                <p className="text-sm font-semibold">{row.label}</p>
                <span className={`mt-1 inline-block border px-1.5 py-0.5 text-xs font-semibold ${MARK_STYLE[row.mark]}`}>{row.mark}</span>
              </div>
              <div className="text-sm">
                <ul className="space-y-0.5">
                  {row.lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
                {row.note ? <p className="mt-1 text-xs text-[var(--muted)]">{row.note}</p> : null}
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {row.source ? `Source: ${row.source.label} (${row.source.url})` : ''}
                  {row.source && row.fetchedAt ? ' · ' : ''}
                  {row.fetchedAt ? `fetched ${formatFetchedAt(row.fetchedAt)}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Points to check">
        {snapshot.pointsToCheck.length === 0 ? (
          <p className="text-sm">None.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {snapshot.pointsToCheck.map((point) => (
              <li key={`${point.id}:${point.code}`} className="keep-together">
                <strong>{point.name}</strong> <span className="border border-current px-1.5 py-0.5 text-xs font-semibold">{point.code}</span>{' '}
                {reasonOf(point.code)}
                {point.detail ? ` (${point.detail})` : ''}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Ownership chart">
        <div className="keep-together">
          <StaticChart nodes={snapshot.chart.nodes} edges={snapshot.chart.edges} />
          <p className="mt-2 text-xs text-[var(--muted)]">
            Individuals are shown as initials only. A dashed link is an accounting consolidation reported to GLEIF, not a shareholding.
          </p>
        </div>
      </Section>

      <Section title="Source log">
        <p className="mb-2 text-xs text-[var(--muted)]">Every fetch behind this pack. “Cached” rows were served from an in-memory cache; the time is that of the original fetch.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--line)] uppercase tracking-[0.06em] text-[var(--muted)]">
                <th className="py-1 pr-3">Register</th>
                <th className="py-1 pr-3">Endpoint</th>
                <th className="py-1 pr-3">Fetched at</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1">Cached</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.sourceLog.map((entry, i) => (
                <tr key={i} className="border-b border-[var(--line)] align-top">
                  <td className="py-1 pr-3">{entry.register}</td>
                  <td className="break-all py-1 pr-3 font-mono">{entry.path}</td>
                  <td className="whitespace-nowrap py-1 pr-3">{formatFetchedAt(entry.fetchedAt)}</td>
                  <td className="py-1 pr-3">{entry.status === 0 ? 'failed' : entry.status}</td>
                  <td className="py-1">{entry.cached ? 'yes' : 'no'}</td>
                </tr>
              ))}
              {snapshot.sourceLog.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-2">
                    No fetches were recorded.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Sign-off">
        <table className="keep-together w-full text-left text-sm">
          <tbody>
            <tr className="border-b border-[var(--line)] align-top">
              <th className="w-44 py-2 pr-3 font-medium">Prepared by</th>
              <td className="py-2">
                {meta.createdByName} · {formatFetchedAt(meta.createdAt)}
              </td>
            </tr>
            <tr className="border-b border-[var(--line)] align-top">
              <th className="py-2 pr-3 font-medium">Submitted</th>
              <td className="py-2">{meta.submittedAt ? formatFetchedAt(meta.submittedAt) : 'Not yet submitted'}</td>
            </tr>
            <tr className="border-b border-[var(--line)] align-top">
              <th className="py-2 pr-3 font-medium">Decision</th>
              <td className="py-2">
                {meta.status === 'approved' || meta.status === 'rejected' ? (
                  <>
                    <strong>{PACK_STATUS_LABELS[meta.status]}</strong> by {meta.reviewedByName ?? 'unknown'}
                    {meta.reviewedAt ? ` · ${formatFetchedAt(meta.reviewedAt)}` : ''}
                  </>
                ) : (
                  'Awaiting decision'
                )}
              </td>
            </tr>
            <tr className="align-top">
              <th className="py-2 pr-3 font-medium">Note</th>
              <td className="py-2">{meta.reviewNote ?? '—'}</td>
            </tr>
          </tbody>
        </table>
        <div className="print-only keep-together mt-8 grid grid-cols-2 gap-10 text-xs">
          <div className="border-t border-black pt-1">Prepared by (signature, date)</div>
          <div className="border-t border-black pt-1">Approved by (signature, date)</div>
        </div>
      </Section>

      <div className="print-only print-footer">
        Refresh pack {meta.id} · {subject.name} ({subject.id}) · {PACK_STATUS_LABELS[meta.status]} · SHA-256 {shortPrint} ·{' '}
        {meta.verified ? 'fingerprint verified' : 'FINGERPRINT MISMATCH'}
      </div>
    </article>
  )
}
