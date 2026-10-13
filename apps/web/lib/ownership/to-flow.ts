import dagre from '@dagrejs/dagre'
import { governingBand, parseNatures } from './bands'
import type { Evidence, OwnershipNode, Range, ReasonCode, RegisterProfileRef, Resolution, WalkResult } from './types'

export const GLEIF_EDGE_LABEL = 'consolidates (GLEIF)'

export const NODE_WIDTH = 260
export const NODE_HEIGHT = 108

export type Tone = 'resolved' | 'unresolved' | 'pruned' | 'pending'

/** Everything the node card and side panel show. Individuals are masked to initials. */
export type FlowNodeData = {
  name: string
  /** Company number; empty for individuals, whose "Individual" status label says it. */
  subtitle: string
  resolution: Resolution
  /** What the card shows: a friendly label, or "Intermediate" / "Not reached" for PENDING nodes. The code stays in `resolution`. */
  resolutionLabel: string
  tone: Tone
  reasonCode?: ReasonCode
  effectiveRange?: Range
  effectiveRangeMultiply?: Range
  effectiveRangeMajority?: Range
  natures: string[]
  /** ISO country of a foreign or GLEIF node. */
  country?: string
  lei?: string
  registerProfile?: RegisterProfileRef
  evidence?: Evidence[]
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
  /** A GLEIF consolidation link rather than a Companies House interest. */
  dashed?: boolean
}

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'sir', 'dame', 'lord', 'lady', 'rev'])

/** "Mr Stephen Allen Schwarzman" -> "S.A.S."; "SMITH, John Paul" -> "J.P.S." */
export function initials(name: string): string {
  // Already initials (e.g. a sanitised fixture): leave as is.
  if (/^([A-Z]\.)+$/.test(name.trim())) return name.trim()
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

const FRIENDLY_RESOLUTION: Partial<Record<Resolution, string>> = {
  RESOLVED_INDIVIDUAL: 'Individual',
  RESOLVED_LISTED: 'Listed company',
  RESOLVED_REGULATED: 'Regulated firm',
  RESOLVED_GOVERNMENT: 'Government',
}

function resolutionLabel(node: OwnershipNode, hasOwners: boolean): string {
  if (node.resolution === 'PENDING') return hasOwners ? 'Intermediate' : 'Not reached'
  return FRIENDLY_RESOLUTION[node.resolution] ?? node.resolution
}

/** Ids of nodes that have at least one owner edge above them. */
function ownersOf(result: WalkResult): Set<string> {
  return new Set(result.edges.map((edge) => edge.childId))
}

/** The ISO country of a foreign node (never of an individual). */
function countryOf(node: OwnershipNode): { country?: string } {
  if (node.kind === 'individual') return {}
  const country = node.registerProfile?.country ?? (node.jurisdiction && /^[A-Z]{2}$/.test(node.jurisdiction) ? node.jurisdiction : undefined)
  return country && country !== 'GB' ? { country } : {}
}

function nodeData(node: OwnershipNode, natures: string[], hasOwners: boolean): FlowNodeData {
  const individual = node.kind === 'individual'
  return {
    name: individual ? initials(node.name) : node.name,
    subtitle: individual ? '' : (node.companyNumber ?? (node.lei ? `LEI ${node.lei}` : node.kind.replace('_', ' '))),
    resolution: node.resolution,
    resolutionLabel: resolutionLabel(node, hasOwners),
    tone: toneOf(node.resolution),
    reasonCode: node.reasonCode,
    effectiveRange: node.effectiveRange,
    effectiveRangeMultiply: node.effectiveRangeMultiply,
    effectiveRangeMajority: node.effectiveRangeMajority,
    natures,
    ...(node.registerProfile ? { registerProfile: node.registerProfile } : {}),
    ...(node.lei ? { lei: node.lei } : {}),
    ...(node.evidence?.length ? { evidence: node.evidence } : {}),
    ...countryOf(node),
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
    label: edge.source === 'gleif' ? GLEIF_EDGE_LABEL : edgeLabel(edge.band, edge.natures),
    ...(edge.source === 'gleif' ? { dashed: true } : {}),
  }))

  return { nodes, edges }
}

export type WalkSummary = {
  status: WalkResult['status']
  /** Terminal outcomes only; PENDING nodes are counted in `intermediate` / `notReached`. */
  counts: Partial<Record<Resolution, number>>
  intermediate: number
  /** Non-blocking observations (secondary flags); they never change the overall status. */
  pointsToCheck: { id: string; name: string; code: ReasonCode; detail?: string }[]
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
  // The gap list: unresolved nodes, plus those linked to a listed/regulated parent by consolidation only.
  const unresolved = result.nodes
    .filter((node) => node.resolution === 'UNRESOLVED' || node.secondaryReasons.includes('CONSOLIDATION_ONLY'))
    .map((node) => {
      const data = nodeData(node, [], false)
      const reasonCode = node.reasonCode ?? (node.secondaryReasons.includes('CONSOLIDATION_ONLY') ? ('CONSOLIDATION_ONLY' as const) : undefined)
      return { id: node.id, name: data.name, subtitle: data.subtitle, reasonCode }
    })
  return {
    status: result.status,
    counts,
    intermediate,
    pointsToCheck: result.nodes.flatMap((node) => {
      const name = nodeData(node, [], false).name
      const points: WalkSummary['pointsToCheck'] = []
      if (node.secondaryReasons.includes('PSC_LOOK_THROUGH_LIKELY')) points.push({ id: node.id, name, code: 'PSC_LOOK_THROUGH_LIKELY' })
      if (node.secondaryReasons.includes('LISTING_US_UNCONFIRMED')) {
        const us = node.evidence?.find((e) => e.kind === 'us_listing')
        points.push({
          id: node.id,
          name,
          code: 'LISTING_US_UNCONFIRMED',
          ...(us ? { detail: `${us.details.ticker} on ${us.details.exchange}` } : {}),
        })
      }
      if (node.secondaryReasons.includes('CONSOLIDATION_ONLY')) points.push({ id: node.id, name, code: 'CONSOLIDATION_ONLY' })
      return points
    }),
    notReached,
    sourceUnavailable: result.nodes.some((node) => node.reasonCode === 'SOURCE_UNAVAILABLE'),
    unresolved,
  }
}
