import dagre from '@dagrejs/dagre'
import { governingBand, parseNatures } from './bands'
import type { OwnershipNode, Range, ReasonCode, Resolution, WalkResult } from './types'

export const NODE_WIDTH = 260
export const NODE_HEIGHT = 108

export type Tone = 'resolved' | 'unresolved' | 'pruned' | 'pending'

/** Everything the node card and side panel show. Individuals are masked to initials. */
export type FlowNodeData = {
  name: string
  /** Company number, or "individual". */
  subtitle: string
  resolution: Resolution
  /** What the card shows: the resolution, or "Intermediate" / "Not reached" for PENDING nodes. */
  resolutionLabel: string
  tone: Tone
  reasonCode?: ReasonCode
  effectiveRange?: Range
  effectiveRangeMultiply?: Range
  effectiveRangeMajority?: Range
  natures: string[]
  secondaryReasons: ReasonCode[]
  statementCode?: string
  fetchedAt?: string
  retryAfter?: string
  companyUrl?: string
}

export type FlowNode = {
  id: string
  type: 'owner'
  position: { x: number; y: number }
  data: FlowNodeData
}

export type FlowEdge = {
  id: string
  source: string
  target: string
  label?: string
}

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'sir', 'dame', 'lord', 'lady', 'rev'])

/** "Mr Stephen Allen Schwarzman" -> "S.A.S."; "SMITH, John Paul" -> "J.P.S." */
export function initials(name: string): string {
  const [first, ...rest] = name.split(',')
  const ordered = rest.length > 0 ? `${rest.join(' ')} ${first}` : first
  const letters = ordered
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}]/gu, ''))
    .filter((word) => word && !TITLES.has(word.toLowerCase()))
    .map((word) => word[0].toUpperCase())
  return letters.length > 0 ? `${letters.join('.')}.` : '?'
}

function toneOf(resolution: Resolution): Tone {
  if (resolution.startsWith('RESOLVED_')) return 'resolved'
  if (resolution === 'UNRESOLVED') return 'unresolved'
  if (resolution === 'PRUNED') return 'pruned'
  return 'pending'
}

/** At most one decimal place, no trailing ".0": 23.7, 25, 100. */
export function formatNumber(value: number): string {
  return String(Math.round(value * 10) / 10)
}

export function formatRange(range: Range | undefined): string | undefined {
  return range ? `${formatNumber(range[0])}-${formatNumber(range[1])}%` : undefined
}

/** "7 Oct 2026, 20:04" in London time; the input unchanged if it is not a date. */
export function formatFetchedAt(iso: string | undefined): string | undefined {
  if (!iso) return undefined
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

function resolutionLabel(node: OwnershipNode, hasOwners: boolean): string {
  if (node.resolution !== 'PENDING') return node.resolution
  return hasOwners ? 'Intermediate' : 'Not reached'
}

/** Ids of nodes that have at least one owner edge above them. */
function ownersOf(result: WalkResult): Set<string> {
  return new Set(result.edges.map((edge) => edge.childId))
}

function nodeData(node: OwnershipNode, natures: string[], hasOwners: boolean): FlowNodeData {
  const individual = node.kind === 'individual'
  return {
    name: individual ? initials(node.name) : node.name,
    subtitle: individual ? 'individual' : (node.companyNumber ?? node.kind.replace('_', ' ')),
    resolution: node.resolution,
    resolutionLabel: resolutionLabel(node, hasOwners),
    tone: toneOf(node.resolution),
    reasonCode: node.reasonCode,
    effectiveRange: node.effectiveRange,
    effectiveRangeMultiply: node.effectiveRangeMultiply,
    effectiveRangeMajority: node.effectiveRangeMajority,
    natures,
    secondaryReasons: node.secondaryReasons,
    statementCode: node.statementCode,
    fetchedAt: node.fetchedAt,
    retryAfter: node.retryAfter,
    companyUrl: individual ? undefined : node.evidenceUrl,
  }
}

/** e.g. "75-100% shares", "25-50% votes + control", "control"; undefined when there is nothing to say. */
export function edgeLabel(band: Range | null, natures: string[]): string | undefined {
  const parsed = parseNatures(natures)
  const parts: string[] = []
  if (band) {
    const governing = governingBand(parsed)
    const viaShares =
      parsed.shares && governing && parsed.shares[0] === governing[0] && parsed.shares[1] === governing[1]
    parts.push(`${formatRange(band)} ${viaShares ? 'shares' : 'votes'}`)
  }
  if (parsed.control) parts.push('control')
  return parts.length > 0 ? parts.join(' + ') : undefined
}

/**
 * Turns a walk result into React Flow nodes and edges, laid out with dagre so
 * owners sit above the company they own. Pure: no I/O.
 */
export function toFlow(result: WalkResult): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const graph = new dagre.graphlib.Graph()
  graph.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 90 })
  graph.setDefaultEdgeLabel(() => ({}))

  for (const node of result.nodes) graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  for (const edge of result.edges) graph.setEdge(edge.parentId, edge.childId)
  dagre.layout(graph)

  // A node's natures are those of the edge to the company it owns.
  const walkedThrough = ownersOf(result)
  const naturesByParent = new Map<string, string[]>()
  for (const edge of result.edges) {
    if (!naturesByParent.has(edge.parentId)) naturesByParent.set(edge.parentId, edge.natures)
  }

  const nodes: FlowNode[] = result.nodes.map((node) => {
    const { x, y } = graph.node(node.id)
    return {
      id: node.id,
      type: 'owner',
      position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
      data: nodeData(node, naturesByParent.get(node.id) ?? [], walkedThrough.has(node.id)),
    }
  })

  const edges: FlowEdge[] = result.edges.map((edge, index) => ({
    id: `e${index}:${edge.parentId}>${edge.childId}`,
    source: edge.parentId,
    target: edge.childId,
    label: edgeLabel(edge.band, edge.natures),
  }))

  return { nodes, edges }
}

export type WalkSummary = {
  status: WalkResult['status']
  /** Terminal outcomes only; PENDING nodes are counted in `intermediate` / `notReached`. */
  counts: Partial<Record<Resolution, number>>
  intermediate: number
  notReached: number
  sourceUnavailable: boolean
  unresolved: { id: string; name: string; subtitle: string; reasonCode: ReasonCode | undefined }[]
}

/** Overall status, counts by resolution and the UNRESOLVED nodes (names masked as in the chart). */
export function summarise(result: WalkResult): WalkSummary {
  const counts: WalkSummary['counts'] = {}
  const walkedThrough = ownersOf(result)
  let intermediate = 0
  let notReached = 0
  for (const node of result.nodes) {
    if (node.resolution !== 'PENDING') counts[node.resolution] = (counts[node.resolution] ?? 0) + 1
    else if (walkedThrough.has(node.id)) intermediate++
    else notReached++
  }
  const unresolved = result.nodes
    .filter((node) => node.resolution === 'UNRESOLVED')
    .map((node) => {
      const data = nodeData(node, [], false)
      return { id: node.id, name: data.name, subtitle: data.subtitle, reasonCode: node.reasonCode }
    })
  return {
    status: result.status,
    counts,
    intermediate,
    notReached,
    sourceUnavailable: result.nodes.some((node) => node.reasonCode === 'SOURCE_UNAVAILABLE'),
    unresolved,
  }
}
