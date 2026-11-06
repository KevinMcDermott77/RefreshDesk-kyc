'use client'

import { startTransition, useActionState, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Position,
  type NodeProps,
  type ReactFlowInstance,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { ExternalLink, X } from 'lucide-react'
import { REQUEST_CONFIRMATION, reasonText } from '@/lib/ownership/reason-text'
import { evidenceLink } from '@/lib/evidence/entry-link'
import { formatFetchedAt, formatRange, overallText, NODE_HEIGHT, NODE_WIDTH, type FlowNode, type FlowNodeData, type Tone } from '@/lib/ownership/to-flow'
import type { Mark, ProfileRow } from '@/lib/kyc-profile/evaluate'
import { ruleText } from '@/lib/ownership/terminals'
import { SavePackButton } from './save-pack-button'
import { pickedFormData } from './picker'
import { walkOwnershipAction, type OwnershipViewState } from './actions'

const TONE_CLASSES: Record<Tone, string> = {
  resolved: 'border-emerald-600 bg-emerald-50 text-emerald-950 dark:border-emerald-500 dark:bg-emerald-950 dark:text-emerald-50',
  unresolved: 'border-amber-600 bg-amber-50 text-amber-950 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-50',
  pruned: 'border-gray-400 bg-gray-100 text-gray-700 dark:border-gray-500 dark:bg-gray-800 dark:text-gray-200',
  pending: 'border-[var(--line)] bg-[var(--panel)] text-[var(--foreground)] dark:bg-gray-900 dark:text-gray-100',
}

const BANNER_CLASSES = {
  good: TONE_CLASSES.resolved,
  attention: TONE_CLASSES.unresolved,
  error: 'border-red-600 bg-red-50 text-red-900 dark:border-red-500 dark:bg-red-950 dark:text-red-100',
} as const

type Summary = NonNullable<OwnershipViewState['result']>['summary']

const MARK_CLASSES: Record<Mark, string> = {
  PASS: TONE_CLASSES.resolved,
  GAP: TONE_CLASSES.unresolved,
  INFO: TONE_CLASSES.pending,
}

function ProfilePanel({ rows }: { rows: ProfileRow[] }) {
  return (
    <section className="mt-6 border border-[var(--line)] bg-[var(--panel)] p-4 text-[var(--foreground)] dark:bg-gray-900 dark:text-gray-100">
      <h2 className="text-lg font-semibold">Entity KYC profile</h2>
      <div className="mt-3 divide-y divide-[var(--line)]">
        {rows.map((row) => (
          <div key={row.key} className="grid gap-2 py-3 md:grid-cols-[8rem_1fr]">
            <div>
              <p className="text-sm font-semibold">{row.label}</p>
              <span className={`${BADGE} mt-1 inline-block ${MARK_CLASSES[row.mark]}`}>{row.mark}</span>
            </div>
            <div className="text-sm">
              <ul className="space-y-0.5">
                {row.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {row.note ? <p className="mt-1 text-xs text-[var(--muted)]">{row.note}</p> : null}
              {row.links?.length ? (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {row.links.map((link, index) => (
                    <span key={link.url}>
                      {index > 0 ? ' · ' : ''}
                      <a href={link.url} target="_blank" rel="noreferrer" className="underline">
                        {link.label}
                      </a>
                    </span>
                  ))}
                </p>
              ) : null}
              {row.source || row.fetchedAt ? (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {row.source ? (
                    <>
                      Source:{' '}
                      <a href={row.source.url} target="_blank" rel="noreferrer" className="underline">
                        {row.source.label}
                      </a>
                    </>
                  ) : null}
                  {row.source && row.fetchedAt ? ' · ' : ''}
                  {row.fetchedAt ? `fetched ${formatFetchedAt(row.fetchedAt)}` : ''}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function bannerTone(summary: Summary) {
  if (summary.sourceUnavailable) return 'error'
  return summary.status === 'resolved' || summary.status === 'resolved_client_evidence' ? 'good' : 'attention'
}

const BADGE = 'border border-current px-1.5 py-0.5 text-xs font-semibold uppercase tracking-[0.06em]'

/** Plain-English list: "5 intermediate · 1 unresolved". */
function countsLine(summary: Summary): string {
  const parts: string[] = []
  if (summary.intermediate > 0) parts.push(`${summary.intermediate} intermediate`)
  if (summary.notReached > 0) parts.push(`${summary.notReached} not reached`)
  for (const [resolution, count] of Object.entries(summary.counts)) {
    parts.push(`${count} ${resolution.toLowerCase().replace(/_/g, ' ')}`)
  }
  return parts.join(' · ')
}

function OwnerNode({ data, selected }: NodeProps<FlowNodeData>) {
  return (
    <div
      className={`w-[260px] cursor-pointer border-2 px-3 py-2 shadow-sm ${TONE_CLASSES[data.tone]} ${
        selected ? 'border-[var(--accent)]! shadow-md' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} />
      <p className="line-clamp-2 text-[14px] font-semibold leading-tight">{data.name}</p>
      {data.subtitle ? <p className="text-[12px] opacity-80">{data.subtitle}</p> : null}
      <div className="mt-1 flex flex-wrap items-center gap-1 text-[12px] font-semibold">
        {data.country ? (
          <span title={data.country} className="opacity-90">
            {data.country}
          </span>
        ) : null}
        <span className="opacity-80">{data.resolutionLabel}</span>
        {data.reasonCode ? <span className={BADGE}>{data.reasonCode}</span> : null}
        {data.viaClientEvidence || data.clientEvidence?.applied ? (
          <span className={`${BADGE} border-sky-700 text-sky-900 dark:border-sky-300 dark:text-sky-200`}>Client evidence</span>
        ) : null}
        {data.secondaryReasons.includes('LISTING_US_UNCONFIRMED') ? (
          <span className={`${BADGE} border-amber-600 text-amber-800 dark:border-amber-400 dark:text-amber-300`}>US listing?</span>
        ) : null}
        {data.secondaryReasons.includes('PSC_LOOK_THROUGH_LIKELY') ? (
          <span className={`${BADGE} border-amber-600 text-amber-800 dark:border-amber-400 dark:text-amber-300`}>
            Look-through likely
          </span>
        ) : null}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

const nodeTypes = { owner: OwnerNode }

/** Renders nothing when there is no value. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === '' || children === false) return null
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  )
}

const EVIDENCE_LABELS = {
  listed_eu: 'listed on an EU regulated market',
  regulated_eu: 'authorised / supervised',
  us_listing: 'US name match (unconfirmed)',
} as const

const ROUTE_LABELS = {
  public: 'Public (free)',
  obliged_entity: 'Obliged-entity access',
  aggregator: 'Commercial data aggregator',
  paid_extract: 'Paid register extract',
} as const

function RegisterProfileBlock({ profile }: { profile: NonNullable<FlowNodeData['registerProfile']> }) {
  const why = profile.freeBasicData
    ? profile.uboAccess === 'public'
      ? 'Ownership is public here, but this tool cannot read the register.'
      : 'Basic data is free; ownership is not (' + profile.uboAccess.replace(/_/g, ' ') + ').'
    : 'Register data is paid; ownership is not freely available.'
  return (
    <div className="border border-[var(--line)] p-3">
      <p className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
        Register profile · {profile.country}
        {profile.notProfiled ? ' · not yet profiled' : ''}
        {profile.verified ? ` · verified ${profile.lastVerified}` : ' · unverified'}
      </p>
      <dl className="mt-2 space-y-2">
        <Field label="Register">
          <a href={profile.url} target="_blank" rel="noreferrer" className="underline">
            {profile.registerName}
          </a>
        </Field>
        <Field label="Why not free">{why}</Field>
        <Field label="Access route">
          {profile.accessRoutes.length > 0 ? (
            <ul className="list-inside list-disc">
              {profile.accessRoutes.map(({ route, detail }) => (
                <li key={`${route}:${detail ?? ''}`}>
                  {ROUTE_LABELS[route]}
                  {detail ? ` (${detail})` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </Field>
        <Field label="Document to request">
          {REQUEST_CONFIRMATION}.
          <span className="mt-1 block text-xs text-[var(--muted)]">If a register document is wanted instead: {profile.documentToRequest}.</span>
        </Field>
        <Field label="Note">{profile.note}</Field>
      </dl>
    </div>
  )
}

const CERTIFIED_TEXT = { yes: 'certified', no: 'not certified', unclear: 'certification unclear' } as const

function ClientEvidenceBlock({ evidence, clientId }: { evidence: NonNullable<FlowNodeData['clientEvidence']>; clientId?: string }) {
  const why = evidence.notApplied?.map((w) => (w === 'policy' ? 'the policy does not accept client evidence as resolving' : w)).join(', ')
  return (
    <div className="border border-[var(--line)] p-3">
      <p className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
        Client evidence · {evidence.applied ? 'used: resolved on client-provided, reviewer-verified evidence' : 'found but not used'}
      </p>
      <ul className="mt-1 text-sm">
        <li>
          <span className="text-[var(--muted)]">document:</span> {evidence.kind.replace(/_/g, ' ')}
        </li>
        <li>
          <span className="text-[var(--muted)]">as at:</span> {evidence.asAt ?? evidence.documentDate ?? 'not stated'}
        </li>
        {evidence.certified ? (
          <li>
            <span className="text-[var(--muted)]">certification:</span> {CERTIFIED_TEXT[evidence.certified]}
            {evidence.certifierCapacity ? ` (${evidence.certifierCapacity.replace(/_/g, ' ')}${evidence.certificationDate ? `, ${evidence.certificationDate}` : ''})` : ''}
          </li>
        ) : (
          <li>
            <span className="text-[var(--muted)]">written confirmation:</span> {(evidence.receivedAs ?? 'other').replace(/_/g, ' ')} from the client, confirmed by a{' '}
            {(evidence.confirmedByCapacity ?? 'unclear').replace(/_/g, ' ')}
            {evidence.confirmationDate ? `, ${evidence.confirmationDate}` : ''} (no certification applies)
          </li>
        )}
        <li>
          <span className="text-[var(--muted)]">confirmed:</span> {formatFetchedAt(evidence.confirmedAt)}
          {evidence.edited ? ' (with edits by the reviewer)' : ''}
        </li>
        {evidence.override ? (
          <li>
            <span className="text-[var(--muted)]">override:</span> accepted despite {evidence.override.reasons.join(' and ')}
          </li>
        ) : null}
        {why ? (
          <li>
            <span className="text-[var(--muted)]">not used because:</span> {why}
          </li>
        ) : null}
      </ul>
      {clientId ? (
        <a href={`/dashboard/clients/${clientId}/evidence/${evidence.id}`} className="mt-1 inline-block text-sm underline">
          Open the evidence and its document
        </a>
      ) : null}
    </div>
  )
}

function SidePanel({
  data,
  onClose,
  client,
  subjectId,
}: {
  data: FlowNodeData
  onClose: () => void
  client?: { id: string; name: string }
  subjectId?: string
}) {
  const link = evidenceLink(client?.id, subjectId, data)
  return (
    <aside className="absolute right-0 top-0 z-10 h-full w-full max-w-sm overflow-y-auto border-l border-[var(--line)] bg-[var(--panel)] p-4 text-[var(--foreground)] shadow-lg dark:bg-gray-900 dark:text-gray-100">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{data.name}</h2>
          {data.subtitle ? <p className="text-sm text-[var(--muted)]">{data.subtitle}</p> : null}
        </div>
        <button aria-label="Close" onClick={onClose} className="p-1 hover:opacity-70">
          <X className="h-4 w-4" />
        </button>
      </div>
      {link ? (
        // At the top: the register profile below is long, and the button must not hide under it.
        <a
          href={link.href}
          className="mt-3 block border border-[var(--accent-strong)] bg-[var(--accent)] px-4 py-2 text-center text-sm font-semibold text-white"
        >
          {link.label}
        </a>
      ) : null}
      <dl className="mt-4 space-y-3">
        <Field label="Resolution">
          {data.resolution}
          {data.reasonCode ? ` · ${data.reasonCode}` : ''}
        </Field>
        {data.reasonCode ? <Field label="What to do">{reasonText(data.reasonCode)}</Field> : null}
        <Field label="Effective range">{formatRange(data.effectiveRange)}</Field>
        <Field label="Effective range (multiply)">{formatRange(data.effectiveRangeMultiply)}</Field>
        <Field label="Effective range (majority)">{formatRange(data.effectiveRangeMajority)}</Field>
        <Field label="Natures of control">
          {data.natures.length > 0 ? (
            <ul className="list-inside list-disc">
              {data.natures.map((n) => (
                <li key={n}>{n.replace(/-/g, ' ')}</li>
              ))}
            </ul>
          ) : null}
        </Field>
        <Field label="Statement code">{data.statementCode}</Field>
        <Field label="Secondary reasons">
          {data.secondaryReasons.length > 0 ? data.secondaryReasons.join(', ') : null}
        </Field>
        <Field label="Fetched at">{formatFetchedAt(data.fetchedAt)}</Field>
        <Field label="Retry after">{data.retryAfter}</Field>
        <Field label="LEI">{data.lei}</Field>
        {data.evidence?.map((e) => (
          <div key={e.kind + e.url} className="border border-[var(--line)] p-3">
            <p className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">Evidence · {EVIDENCE_LABELS[e.kind]}</p>
            <ul className="mt-1 text-sm">
              {Object.entries(e.details).map(([key, value]) => (
                <li key={key}>
                  <span className="text-[var(--muted)]">{key}:</span> {key === 'rule' ? ruleText(value) : value}
                </li>
              ))}
            </ul>
            <a href={e.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm underline">
              {e.source} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        ))}
        {data.clientEvidence ? <ClientEvidenceBlock evidence={data.clientEvidence} clientId={client?.id} /> : null}
        {data.registerProfile ? <RegisterProfileBlock profile={data.registerProfile} /> : null}
      </dl>
      {data.companyUrl ? (
        <a
          href={data.companyUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--accent-strong)] underline dark:text-emerald-300"
        >
          Companies House <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </aside>
  )
}

const MIN_ZOOM = 0.85
const MAX_ZOOM = 1.1
const LEVEL_HEIGHT = 140

/** Fits the chart's width (within the zoom limits), centred, starting at the top owner. */
function showTop(instance: ReactFlowInstance, nodes: FlowNode[], width: number) {
  const left = Math.min(...nodes.map((n) => n.position.x))
  const right = Math.max(...nodes.map((n) => n.position.x + NODE_WIDTH))
  const top = Math.min(...nodes.map((n) => n.position.y))
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (width - 40) / (right - left)))
  instance.setViewport({ zoom, x: width / 2 - ((left + right) / 2) * zoom, y: 24 - top * zoom })
}

const INPUT = 'mt-1 block w-full border border-[var(--line)] bg-white px-3 py-2 text-sm text-gray-900 dark:bg-gray-900 dark:text-gray-100'

export function OwnershipViewer({ client }: { client?: { id: string; name: string } } = {}) {
  const [state, action, pending] = useActionState<OwnershipViewState, FormData>(walkOwnershipAction, {})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const entryRef = useRef<HTMLInputElement>(null)

  /** Walks a GLEIF pick directly, so an empty search box does not block it. */
  function walkPicked(lei: string) {
    if (!formRef.current) return
    const data = pickedFormData(new FormData(formRef.current), lei)
    if (entryRef.current) entryRef.current.value = lei
    startTransition(() => action(data))
  }

  const result = state.result
  const chartRef = useRef<HTMLDivElement>(null)
  const levels = result ? new Set(result.nodes.map((n) => Math.round(n.position.y / NODE_HEIGHT))).size : 0
  const chartHeight = Math.max(560, levels * LEVEL_HEIGHT + 80)
  const selected = useMemo(
    () => result?.nodes.find((n) => n.id === selectedId)?.data ?? null,
    [result, selectedId],
  )

  return (
    <div className="mt-6">
      <form ref={formRef} action={action} className="grid gap-4 border border-[var(--line)] bg-[var(--panel)] p-4 dark:bg-gray-900 md:grid-cols-5">
        <label className="text-sm font-medium md:col-span-2">
          Company number, LEI or name
          <input ref={entryRef} name="entry" required placeholder="03261722, an LEI, or Nordea Bank" className={INPUT} />
        </label>
        <label className="text-sm font-medium">
          Max depth
          <input name="max_depth" type="number" min={1} max={15} defaultValue={6} className={INPUT} />
        </label>
        <label className="text-sm font-medium">
          Threshold %
          <input name="threshold" type="number" min={1} max={99} step="any" defaultValue={25} className={INPUT} />
        </label>
        <label className="text-sm font-medium">
          Indirect method
          <select name="indirect_method" defaultValue="either" className={INPUT}>
            <option value="either">either</option>
            <option value="multiply">multiply</option>
            <option value="majority">majority</option>
          </select>
        </label>
        {client ? (
          <fieldset className="grid gap-3 border border-[var(--line)] p-3 md:col-span-5 md:grid-cols-3">
            <legend className="px-1 text-sm font-semibold">Client evidence for {client.name}</legend>
            <input type="hidden" name="client_id" value={client.id} />
            <label className="flex items-start gap-2 text-sm md:col-span-2">
              <input type="checkbox" name="accept_client_evidence" defaultChecked className="mt-1" />
              <span>
                Let confirmed client evidence resolve branches the registers cannot.
                <span className="block text-xs text-[var(--muted)]">
                  Shown as &ldquo;Resolved (client evidence)&rdquo;. When unticked, the evidence is shown but those branches stay partial. To add evidence, click an unresolved foreign company in the chart: its panel has an &ldquo;Add client evidence&rdquo; button at the top.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="accept_email_confirmation" defaultChecked className="mt-1" />
              <span>
                Accept an emailed confirmation.
                <span className="block text-xs text-[var(--muted)]">Unticked: a confirmation that arrived by email stays partial; ask for a signed letter or chart.</span>
              </span>
            </label>
            <label className="text-sm font-medium">
              Oldest evidence accepted (months)
              <input name="max_evidence_age_months" type="number" min={1} max={120} defaultValue={12} className={INPUT} />
            </label>
          </fieldset>
        ) : null}
        <div className="md:col-span-5">
          <button
            disabled={pending}
            className="border border-[var(--accent-strong)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? 'Walking…' : 'Walk ownership'}
          </button>
        </div>
      </form>

      {state.candidates ? (
        <section className="mt-4 border border-[var(--line)] bg-[var(--panel)] p-4 text-[var(--foreground)] dark:bg-gray-900 dark:text-gray-100">
          <h2 className="text-sm font-semibold">Pick the entity (GLEIF matches)</h2>
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {state.candidates.map((c) => (
              <li
                key={c.lei}
                className={`flex flex-wrap items-center justify-between gap-2 py-2 text-sm ${c.historic ? 'opacity-60' : ''}`}
              >
                <span>
                  <strong>{c.name}</strong> · {c.country ?? 'country unknown'} · {c.entityStatus ?? '—'} · {c.registrationStatus}
                  {c.historic ? <span className={`${BADGE} ml-2`}>historic entity</span> : null}
                  <span className="block text-xs text-[var(--muted)]">{c.lei}</span>
                </span>
                <button
                  type="button"
                  onClick={() => walkPicked(c.lei)}
                  disabled={pending}
                  className="border border-[var(--accent-strong)] px-3 py-1 text-sm font-semibold"
                >
                  Walk this one
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {state.error ? (
        <p role="alert" className="mt-4 border border-red-600 bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">
          {state.error}
        </p>
      ) : null}

      {result ? (
        <>
          {result.sample ? (
            <p role="note" className="mt-4 border-2 border-red-700 bg-red-50 px-4 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-red-900">
              Sample data: the built-in demo subject. The company, its register entries and the evidence are invented. A pack saved from this run says so.
            </p>
          ) : null}

          <SavePackButton pack={result.pack} />

          <ProfilePanel rows={result.profile} />

          <section className={`mt-6 border p-4 ${BANNER_CLASSES[bannerTone(result.summary)]}`}>
            <p className="text-sm font-semibold uppercase tracking-[0.1em]">Overall: {overallText(result.summary)}</p>
            <p className="mt-1 text-sm">{countsLine(result.summary)}</p>
            {result.summary.unresolved.length > 0 ? (
              <ul className="mt-3 space-y-1 text-sm">
                {result.summary.unresolved.map((u) => (
                  <li key={u.id}>
                    <strong>{u.name}</strong>{u.subtitle ? ` (${u.subtitle})` : ''}
                    {u.reasonCode ? (
                      <>
                        {' '}
                        <span className={BADGE}>{u.reasonCode}</span> {reasonText(u.reasonCode)}
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {result.summary.pointsToCheck.length > 0 ? (
            <section className={`mt-4 border p-4 ${TONE_CLASSES.unresolved}`}>
              <h2 className="text-sm font-semibold uppercase tracking-[0.1em]">Points to check</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {result.summary.pointsToCheck.map((p) => (
                  <li key={`${p.id}:${p.code}`}>
                    <strong>{p.name}</strong> <span className={BADGE}>{p.code}</span> {reasonText(p.code)}{p.detail ? ` (${p.detail})` : ""}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div
            ref={chartRef}
            style={{ height: chartHeight }}
            className="relative mt-4 w-full border border-[var(--line)] bg-white dark:bg-gray-950">
            <ReactFlow
              key={`${result.nodes[0]?.id}:${result.nodes.length}:${result.edges.length}`}
              nodes={result.nodes}
              edges={result.edges.map(({ dashed, ...e }) => ({
                ...e,
                type: 'smoothstep',
                ...(dashed ? { style: { strokeDasharray: '6 4' } } : {}),
                labelStyle: { fontSize: 12, fill: '#17201c' },
                labelBgStyle: { fill: '#fffaf1', fillOpacity: 1 },
                labelBgPadding: [6, 3] as [number, number],
              }))}
              nodeTypes={nodeTypes}
              onNodeClick={(_, node) => setSelectedId(node.id)}
              onPaneClick={() => setSelectedId(null)}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              onInit={(instance) => showTop(instance, result.nodes, chartRef.current?.clientWidth ?? 900)}
              zoomOnScroll={false}
              panOnScroll={false}
              preventScrolling={false}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
            {selected ? <SidePanel data={selected} onClose={() => setSelectedId(null)} client={client} subjectId={result?.subjectId} /> : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
