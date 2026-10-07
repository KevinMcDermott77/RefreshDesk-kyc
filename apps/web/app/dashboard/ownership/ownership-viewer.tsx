'use client'

import { useActionState, useMemo, useRef, useState } from 'react'
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
import { reasonText } from '@/lib/ownership/reason-text'
import { formatFetchedAt, formatRange, NODE_HEIGHT, NODE_WIDTH, type FlowNode, type FlowNodeData, type Tone } from '@/lib/ownership/to-flow'
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

function bannerTone(summary: Summary) {
  if (summary.sourceUnavailable) return 'error'
  return summary.status === 'resolved' ? 'good' : 'attention'
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
      <p className="text-[12px] opacity-80">{data.subtitle}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1 text-[12px] font-semibold">
        <span className="opacity-80">{data.resolutionLabel}</span>
        {data.reasonCode ? <span className={BADGE}>{data.reasonCode}</span> : null}
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

function SidePanel({ data, onClose }: { data: FlowNodeData; onClose: () => void }) {
  return (
    <aside className="absolute right-0 top-0 z-10 h-full w-full max-w-sm overflow-y-auto border-l border-[var(--line)] bg-[var(--panel)] p-4 text-[var(--foreground)] shadow-lg dark:bg-gray-900 dark:text-gray-100">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{data.name}</h2>
          <p className="text-sm text-[var(--muted)]">{data.subtitle}</p>
        </div>
        <button aria-label="Close" onClick={onClose} className="p-1 hover:opacity-70">
          <X className="h-4 w-4" />
        </button>
      </div>
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

export function OwnershipViewer() {
  const [state, action, pending] = useActionState<OwnershipViewState, FormData>(walkOwnershipAction, {})
  const [selectedId, setSelectedId] = useState<string | null>(null)

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
      <form action={action} className="grid gap-4 border border-[var(--line)] bg-[var(--panel)] p-4 dark:bg-gray-900 md:grid-cols-5">
        <label className="text-sm font-medium md:col-span-2">
          Company number
          <input name="company_number" required placeholder="03261722" className={INPUT} />
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
        <div className="md:col-span-5">
          <button
            disabled={pending}
            className="border border-[var(--accent-strong)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? 'Walking…' : 'Walk ownership'}
          </button>
        </div>
      </form>

      {state.error ? (
        <p role="alert" className="mt-4 border border-red-600 bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">
          {state.error}
        </p>
      ) : null}

      {result ? (
        <>
          <section className={`mt-6 border p-4 ${BANNER_CLASSES[bannerTone(result.summary)]}`}>
            <p className="text-sm font-semibold uppercase tracking-[0.1em]">Overall: {result.summary.status}</p>
            <p className="mt-1 text-sm">{countsLine(result.summary)}</p>
            {result.summary.unresolved.length > 0 ? (
              <ul className="mt-3 space-y-1 text-sm">
                {result.summary.unresolved.map((u) => (
                  <li key={u.id}>
                    <strong>{u.name}</strong> ({u.subtitle})
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

          <div
            ref={chartRef}
            style={{ height: chartHeight }}
            className="relative mt-4 w-full border border-[var(--line)] bg-white dark:bg-gray-950">
            <ReactFlow
              key={`${result.nodes[0]?.id}:${result.nodes.length}:${result.edges.length}`}
              nodes={result.nodes}
              edges={result.edges.map((e) => ({
                ...e,
                type: 'smoothstep',
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
            {selected ? <SidePanel data={selected} onClose={() => setSelectedId(null)} /> : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
