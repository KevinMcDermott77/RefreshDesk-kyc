import { classify, governingBand, maxRanges, multiplyRanges, parseNatures } from './bands'
import type {
  Fetched,
  IndirectMethod,
  OwnershipEdge,
  OwnershipFetcher,
  OwnershipNode,
  Range,
  ReasonCode,
  WalkPolicy,
  WalkResult,
  WalkStatus,
} from './types'

export const DEFAULT_MAX_DEPTH = 6
export const DEFAULT_THRESHOLD = 25
export const DEFAULT_INDIRECT_METHOD: IndirectMethod = 'either'

export const UK_COMPANY_NUMBER = /^([0-9]{8}|[A-Z]{2}[0-9]{6})$/
const UK_REGISTER = /united kingdom|\buk\b|england|wales|scotland|northern ireland|great britain|companies house/i
const UK_REGULATED_MARKET_EXEMPTION = 'psc-exempt-as-trading-on-uk-regulated-market'
const CH_COMPANY_URL = 'https://find-and-update.company-information.service.gov.uk/company/'

const GLEIF_EXCEPTION_REASONS: Record<string, ReasonCode> = {
  NATURAL_PERSONS: 'GLEIF_EXCEPTION_NATURAL_PERSONS',
  NON_CONSOLIDATING: 'GLEIF_EXCEPTION_NON_CONSOLIDATING',
  NO_LEI: 'GLEIF_EXCEPTION_NO_LEI',
  NON_PUBLIC: 'GLEIF_EXCEPTION_NON_PUBLIC',
  NO_KNOWN_PERSON: 'GLEIF_NO_KNOWN_PERSON',
}

/** Cumulative interest in the root under each method; absent where a link has no band. */
type PathRanges = { multiply?: Range; majority?: Range }

type Item = {
  companyNumber: string
  nodeId: string
  depth: number
  ranges: PathRanges
  // A control right on this link or any link below it: nothing here or above is pruned.
  noPrune: boolean
  ancestors: Set<string>
}

function chooseRange(ranges: PathRanges, method: IndirectMethod): Range | undefined {
  if (method === 'multiply') return ranges.multiply
  if (method === 'majority') return ranges.majority
  if (ranges.multiply && ranges.majority) return maxRanges(ranges.multiply, ranges.majority)
  return ranges.multiply ?? ranges.majority
}

function rangeFields(ranges: PathRanges, method: IndirectMethod) {
  const chosen = chooseRange(ranges, method)
  return {
    ...(chosen ? { effectiveRange: chosen } : {}),
    ...(ranges.multiply ? { effectiveRangeMultiply: ranges.multiply } : {}),
    ...(ranges.majority ? { effectiveRangeMajority: ranges.majority } : {}),
  }
}

type Psc = Record<string, unknown>

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function items(fetched: Fetched): Psc[] {
  const list = asRecord(fetched.body).items
  return Array.isArray(list) ? list.map(asRecord) : []
}

function companyKey(companyNumber: string): string {
  return `GB:${companyNumber}`
}

function isCeased(entry: Psc): boolean {
  return entry.ceased === true || typeof entry.ceased_on === 'string'
}

/** 200 is data, 404 is CH's "none on file"; anything else is an outage. */
function isAvailable(fetched: Fetched): boolean {
  return fetched.status === 200 || fetched.status === 404
}

async function safely(call: () => Promise<Fetched>): Promise<Fetched> {
  try {
    return await call()
  } catch {
    return { status: 0, body: null }
  }
}

function hasUkRegulatedMarketExemption(fetched: Fetched): boolean {
  if (fetched.status !== 200) return false
  const exemptions = asRecord(asRecord(fetched.body).exemptions)
  return Object.values(exemptions).some((raw) => {
    const exemption = asRecord(raw)
    if (exemption.exemption_type !== UK_REGULATED_MARKET_EXEMPTION) return false
    const periods = Array.isArray(exemption.items) ? exemption.items.map(asRecord) : []
    return periods.some((period) => !period.exempt_to)
  })
}

function ukRegistrationNumber(psc: Psc): string | null {
  const identification = asRecord(psc.identification)
  const number = str(identification.registration_number)?.replace(/\s/g, '').toUpperCase()
  if (!number || !UK_COMPANY_NUMBER.test(number)) return null

  // An 8-digit number alone is not proof of a UK company (e.g. Dutch KvK numbers).
  const register = [identification.country_registered, identification.place_registered, identification.legal_authority]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ')
  if (register && (!UK_REGISTER.test(register) || /new south wales/i.test(register))) return null

  return number
}

function pscName(psc: Psc): string {
  const name = str(psc.name)
  if (name) return name
  const elements = asRecord(psc.name_elements)
  const parts = [elements.forename, elements.surname].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  )
  return parts.length > 0 ? parts.join(' ') : 'Unknown'
}

function overallStatus(nodes: OwnershipNode[], threshold: number): WalkStatus {
  const terminals = nodes.filter((node) => node.resolution !== 'PENDING')
  const materialUnresolved = terminals.some(
    (node) =>
      node.resolution === 'UNRESOLVED' &&
      (!node.effectiveRange || classify(node.effectiveRange, threshold) !== 'below'),
  )
  if (!materialUnresolved) return 'resolved'
  return terminals.some((node) => node.resolution.startsWith('RESOLVED_')) ? 'partial' : 'unresolved'
}

/**
 * Breadth-first walk of the Companies House PSC register upwards from rootId.
 * Pure apart from the injected fetcher: no I/O, clock or randomness of its own.
 */
export async function walk(
  rootId: string,
  fetcher: OwnershipFetcher,
  policy: WalkPolicy = {},
): Promise<WalkResult> {
  const maxDepth = policy.maxDepth ?? DEFAULT_MAX_DEPTH
  const threshold = policy.threshold ?? DEFAULT_THRESHOLD
  const method = policy.indirectMethod ?? DEFAULT_INDIRECT_METHOD

  const nodes = new Map<string, OwnershipNode>()
  const edges: OwnershipEdge[] = []
  // Visited keys (GB:<number> or LEI:<lei>) to node id.
  const visited = new Map<string, string>()

  const rootNumber = rootId.trim().toUpperCase()
  const root: OwnershipNode = {
    id: companyKey(rootNumber),
    name: rootNumber,
    kind: 'corporate',
    jurisdiction: null,
    companyNumber: rootNumber,
    resolution: 'PENDING',
    ...rangeFields({ multiply: [100, 100], majority: [100, 100] }, method),
    depth: 0,
    secondaryReasons: [],
  }
  nodes.set(root.id, root)
  visited.set(root.id, root.id)

  const queue: Item[] = [
    {
      companyNumber: rootNumber,
      nodeId: root.id,
      depth: 0,
      ranges: { multiply: [100, 100], majority: [100, 100] },
      noPrune: false,
      ancestors: new Set([root.id]),
    },
  ]

  function settle(node: OwnershipNode, resolution: OwnershipNode['resolution'], reasonCode?: OwnershipNode['reasonCode']) {
    node.resolution = resolution
    if (reasonCode) node.reasonCode = reasonCode
  }

  function addPsc(item: Item, psc: Psc, index: number) {
    const natures = Array.isArray(psc.natures_of_control)
      ? psc.natures_of_control.filter((n): n is string => typeof n === 'string')
      : []
    const parsed = parseNatures(natures)
    const band = governingBand(parsed)
    const majorityLink: Range | null = parsed.majority ? [100, 100] : band
    const ranges: PathRanges = {
      ...(item.ranges.multiply && band ? { multiply: multiplyRanges(item.ranges.multiply, band) } : {}),
      ...(item.ranges.majority && majorityLink ? { majority: multiplyRanges(item.ranges.majority, majorityLink) } : {}),
    }
    const range = chooseRange(ranges, method)
    const noPrune = item.noPrune || parsed.control
    const depth = item.depth + 1
    const kind = str(psc.kind) ?? ''

    const edgeTo = (parentId: string) =>
      edges.push({ parentId, childId: item.nodeId, source: 'ch', basis: 'psc', band, natures })

    const leaf = (
      node: Pick<OwnershipNode, 'kind' | 'resolution' | 'reasonCode' | 'companyNumber'>,
    ) => {
      const created: OwnershipNode = {
        id: `${item.nodeId}/psc/${index}`,
        name: pscName(psc),
        jurisdiction: str(psc.country_of_residence) ?? str(asRecord(psc.identification).country_registered) ?? null,
        depth,
        secondaryReasons: [],
        ...rangeFields(ranges, method),
        ...node,
      }
      nodes.set(created.id, created)
      edgeTo(created.id)
      return created
    }

    if (kind.startsWith('individual-')) {
      const node = leaf({ kind: 'individual', resolution: 'RESOLVED_INDIVIDUAL' })
      if (range && classify(range, threshold) === 'straddles') node.reasonCode = 'BAND_STRADDLES_THRESHOLD'
      return
    }

    if (!noPrune && range && classify(range, threshold) === 'below') {
      leaf({ kind: kind.startsWith('corporate-') ? 'corporate' : 'legal_person', resolution: 'PRUNED' })
      return
    }

    if (kind.startsWith('super-secure-')) {
      leaf({ kind: 'super_secure', resolution: 'UNRESOLVED', reasonCode: 'PSC_SUPER_SECURE' })
      return
    }

    if (!kind.startsWith('corporate-')) {
      // Legal persons (government bodies, corporations sole) have no register we walk.
      leaf({ kind: 'legal_person', resolution: 'UNRESOLVED', reasonCode: 'REGISTER_NOT_PROFILED' })
      return
    }

    const number = ukRegistrationNumber(psc)
    if (!number) {
      leaf({ kind: 'corporate', resolution: 'UNRESOLVED', reasonCode: 'FOREIGN_ENTITY_UNMATCHED' })
      return
    }

    const key = companyKey(number)
    if (item.ancestors.has(key)) {
      leaf({ kind: 'corporate', companyNumber: number, resolution: 'UNRESOLVED', reasonCode: 'CIRCULAR_OWNERSHIP' })
      return
    }

    const seen = visited.get(key)
    if (seen) {
      // Reached by a second, non-circular path: link it, don't walk it twice.
      edgeTo(seen)
      return
    }

    const node: OwnershipNode = {
      id: key,
      name: pscName(psc),
      kind: 'corporate',
      jurisdiction: null,
      companyNumber: number,
      resolution: 'PENDING',
      depth,
      secondaryReasons: [],
      ...rangeFields(ranges, method),
      evidenceUrl: `${CH_COMPANY_URL}${number}`,
    }
    nodes.set(key, node)
    visited.set(key, key)
    edgeTo(key)

    if (depth >= maxDepth) {
      settle(node, 'UNRESOLVED', 'DEPTH_LIMIT_REACHED')
      return
    }

    queue.push({ companyNumber: number, nodeId: key, depth, ranges, noPrune, ancestors: new Set([...item.ancestors, key]) })
  }

  while (queue.length > 0) {
    const item = queue.shift()!
    const node = nodes.get(item.nodeId)!

    const profile = await safely(() => fetcher.getProfile(item.companyNumber))
    if (profile.status !== 200) {
      settle(node, 'UNRESOLVED', 'SOURCE_UNAVAILABLE')
      continue
    }
    const profileBody = asRecord(profile.body)
    node.name = str(profileBody.company_name) ?? node.name
    node.jurisdiction = str(profileBody.jurisdiction) ?? node.jurisdiction
    node.evidenceUrl = `${CH_COMPANY_URL}${item.companyNumber}`

    // Source precedence: Companies House decides UK nodes. GLEIF may become the
    // primary source only where CH cannot follow, and never resolves a branch.
    // For now GLEIF contributes the LEI and secondaryReasons only.
    try {
      const gleif = await fetcher.getGleifParents(item.companyNumber)
      if (gleif?.lei) {
        node.lei = gleif.lei
        visited.set(`LEI:${gleif.lei}`, node.id)
        for (const reason of gleif.reportingExceptions) {
          const code = GLEIF_EXCEPTION_REASONS[reason]
          if (code && !node.secondaryReasons.includes(code)) node.secondaryReasons.push(code)
        }
      }
    } catch {
      // GLEIF is supporting evidence only; the walk does not depend on it.
    }

    const exemptions = await safely(() => fetcher.getExemptions(item.companyNumber))
    if (hasUkRegulatedMarketExemption(exemptions)) {
      settle(node, 'RESOLVED_LISTED')
      continue
    }

    const pscs = await safely(() => fetcher.getPscs(item.companyNumber))
    if (!isAvailable(pscs)) {
      settle(node, 'UNRESOLVED', 'SOURCE_UNAVAILABLE')
      continue
    }

    const active = items(pscs).filter((psc) => !isCeased(psc))
    if (active.length > 0) {
      active.forEach((psc, index) => addPsc(item, psc, index))
      continue
    }

    const statements = await safely(() => fetcher.getPscStatements(item.companyNumber))
    const activeStatement = items(statements).find((statement) => !isCeased(statement))
    if (activeStatement) {
      settle(node, 'UNRESOLVED', 'PSC_STATEMENT')
      node.statementCode = str(activeStatement.statement)
    } else if (!isAvailable(statements) || !isAvailable(exemptions)) {
      settle(node, 'UNRESOLVED', 'SOURCE_UNAVAILABLE')
    } else {
      settle(node, 'UNRESOLVED', 'PSC_NONE_FILED')
    }
  }

  const all = [...nodes.values()]
  return { rootId: root.id, status: overallStatus(all, threshold), nodes: all, edges }
}
