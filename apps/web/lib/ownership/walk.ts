import { classify, governingBand, maxRanges, multiplyRanges, parseNatures } from './bands'
import { countryCode } from './countries'
import { sameRegistration } from './registration-number'
import { profileFor, stopReasonFor } from './register-profiles'
import type {
  Fetched,
  Evidence,
  GleifRecord,
  IndirectMethod,
  OwnershipEdge,
  OwnershipFetcher,
  OwnershipNode,
  Range,
  RegisterProfileRef,
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
const GLEIF_RECORD_URL = 'https://search.gleif.org/#/record/'
const LEI_PATTERN = /^[A-Z0-9]{20}$/
/** GLEIF registration authority id for Companies House. */
export const COMPANIES_HOUSE_RA = 'RA000585'

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
  /** Companies House number; empty for GLEIF items. */
  companyNumber: string
  /** Set for items walked through GLEIF; `record` is its Level 1 record when already known. */
  lei?: string
  record?: GleifRecord
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

const HOLDING_COMPANY_NAME = /\b(top ?co|hold ?co|mid ?co|mezz ?co|bid ?co|pledge ?co|fin ?co|acquisition ?co|holdings? \d)\b/i
const UK_RESIDENCE = /^(united kingdom|uk|great britain|england|wales|scotland|northern ireland)$/i

/**
 * The PSC regime looks through non-UK fund entities, so an individual shown at
 * 75%+ of a holding-company-style structure, or living abroad, probably sits
 * above funds the register cannot show. Supporting evidence only.
 */
function likelyLookThrough(psc: Psc, parsed: ReturnType<typeof parseNatures>, pathNames: string[]): boolean {
  if ((parsed.shares?.[0] ?? 0) < 75 && (parsed.votes?.[0] ?? 0) < 75) return false
  if (pathNames.some((name) => HOLDING_COMPANY_NAME.test(name))) return true
  const residence = str(psc.country_of_residence)
  return residence !== undefined && !UK_RESIDENCE.test(residence.trim())
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

function overallStatus(nodes: OwnershipNode[], threshold: number, viaGleif: boolean): WalkStatus {
  const terminals = nodes.filter((node) => node.resolution !== 'PENDING')
  const materialUnresolved = terminals.some(
    (node) =>
      node.resolution === 'UNRESOLVED' &&
      (!node.effectiveRange || classify(node.effectiveRange, threshold) !== 'below'),
  )
  // A consolidation link in GLEIF is not a Companies House ownership interest: it can never make a walk fully resolved.
  if (!materialUnresolved) return viaGleif && terminals.some((node) => node.resolution.startsWith('RESOLVED_')) ? 'partial' : 'resolved'
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
  const acceptRegulated = policy.acceptRegulatedAsTerminal ?? true

  const nodes = new Map<string, OwnershipNode>()
  const edges: OwnershipEdge[] = []
  // Visited keys (GB:<number> or LEI:<lei>) to node id.
  const visited = new Map<string, string>()

  const rootNumber = rootId.trim().toUpperCase()
  // An LEI root starts a GLEIF walk; anything else is a Companies House number.
  const rootLei = LEI_PATTERN.test(rootNumber) ? rootNumber : undefined
  const root: OwnershipNode = {
    id: rootLei ? `LEI:${rootLei}` : companyKey(rootNumber),
    name: rootNumber,
    kind: 'corporate',
    jurisdiction: null,
    ...(rootLei ? { lei: rootLei } : { companyNumber: rootNumber }),
    resolution: 'PENDING',
    ...rangeFields({ multiply: [100, 100], majority: [100, 100] }, method),
    depth: 0,
    secondaryReasons: [],
  }
  nodes.set(root.id, root)
  visited.set(root.id, root.id)

  const queue: Item[] = [
    {
      companyNumber: rootLei ? '' : rootNumber,
      ...(rootLei ? { lei: rootLei } : {}),
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

  /** Keeps the oldest X-Fetched-At of the responses that informed this node. */
  function noteFetched(node: OwnershipNode, fetched: Fetched) {
    if (!fetched.fetchedAt || !isAvailable(fetched)) return
    if (!node.fetchedAt || Date.parse(fetched.fetchedAt) < Date.parse(node.fetchedAt)) {
      node.fetchedAt = fetched.fetchedAt
    }
  }

  function unavailable(node: OwnershipNode, ...failed: Fetched[]) {
    settle(node, 'UNRESOLVED', 'SOURCE_UNAVAILABLE')
    const retryAfter = failed.find((fetched) => !isAvailable(fetched) && fetched.retryAfter)?.retryAfter
    if (retryAfter) node.retryAfter = retryAfter
  }

  function registerProfileRef(country: string | undefined): RegisterProfileRef | undefined {
    const profile = profileFor(country)
    if (!profile) return undefined
    const { registerName, url, freeBasicData, shareholdersPublic, uboAccess, accessRoutes, documentToRequest, lastVerified, verified, note } = profile
    return {
      country: profile.country,
      registerName,
      url,
      freeBasicData,
      shareholdersPublic,
      uboAccess,
      accessRoutes,
      documentToRequest,
      lastVerified,
      verified,
      note,
      ...(profile.notProfiled ? { notProfiled: true } : {}),
    }
  }

  function gleifEdge(parentId: string, childId: string) {
    edges.push({ parentId, childId, source: 'gleif', basis: 'consolidation', band: null, natures: [] })
  }

  function gleifNode(record: GleifRecord, depth: number, base: Partial<OwnershipNode> = {}): OwnershipNode {
    return {
      id: `LEI:${record.lei}`,
      name: record.legalName,
      kind: 'corporate',
      jurisdiction: record.country ?? record.jurisdiction ?? null,
      lei: record.lei,
      resolution: 'PENDING',
      depth,
      secondaryReasons: [],
      evidenceUrl: `${GLEIF_RECORD_URL}${record.lei}`,
      ...base,
    }
  }

  /** A UK Companies House registration held in a GLEIF record, if it has one. */
  function ukRegistration(record: GleifRecord): string | null {
    const number = record.registeredAs?.replace(/\s/g, '').toUpperCase()
    return record.registeredAt === COMPANIES_HOUSE_RA && number && UK_COMPANY_NUMBER.test(number) ? number : null
  }

  /** Stops a GLEIF walk at `node`: the exception GLEIF reports, else the register's default reason. */
  function stopGleif(node: OwnershipNode, country: string | undefined, exception?: string) {
    const exceptionCode = exception ? GLEIF_EXCEPTION_REASONS[exception] : undefined
    settle(node, 'UNRESOLVED', exceptionCode ?? stopReasonFor(country))
    const profile = registerProfileRef(country)
    if (profile) node.registerProfile = profile
    addSecondary(node, country)
  }

  /** Records the register's further reasons (e.g. Cayman: paywalled, and UBO restricted) as secondary. */
  function addSecondary(node: OwnershipNode, country: string | undefined) {
    for (const code of profileFor(country)?.secondaryReasonCodes ?? []) {
      if (code !== node.reasonCode && !node.secondaryReasons.includes(code)) node.secondaryReasons.push(code)
    }
  }

  function addEvidence(node: OwnershipNode, evidence: Evidence) {
    node.evidence = [...(node.evidence ?? []), evidence]
  }

  function addSecondaryCode(node: OwnershipNode, code: ReasonCode) {
    if (!node.secondaryReasons.includes(code)) node.secondaryReasons.push(code)
  }

  /**
   * Listing and authorisation checks, run before a GLEIF node's parent is followed.
   * A listing always ends the walk; an authorisation does when the policy accepts it.
   * Either overrides a GLEIF reporting exception, which is kept as a secondary reason.
   * A US name match is only ever a secondary flag.
   */
  async function applyTerminals(node: OwnershipNode, record: GleifRecord): Promise<boolean> {
    const terminals = fetcher.terminals
    if (!terminals) return false

    try {
      const us = await terminals.usListing(record.legalName)
      if (us) {
        addEvidence(node, us)
        addSecondaryCode(node, 'LISTING_US_UNCONFIRMED')
      }
    } catch {
      // The US file is supporting evidence only.
    }

    async function check(run: () => Promise<Evidence | null>): Promise<Evidence | null> {
      try {
        return await run()
      } catch {
        addSecondaryCode(node, 'SOURCE_UNAVAILABLE')
        return null
      }
    }

    const listed = await check(() => terminals.listedEU(record.lei))
    const regulated = await check(() => terminals.regulatedEU(record.lei))
    if (listed) addEvidence(node, listed)
    if (regulated) addEvidence(node, regulated)

    const terminal = listed ? 'RESOLVED_LISTED' : regulated && acceptRegulated ? 'RESOLVED_REGULATED' : null
    if (!terminal) return false

    settle(node, terminal)
    try {
      const exception = (await fetcher.gleif?.getDirectParent(record.lei))?.exception
      const code = exception ? GLEIF_EXCEPTION_REASONS[exception] : undefined
      if (code) addSecondaryCode(node, code)
    } catch {
      // Only the exception is lost; the node is resolved.
    }
    return true
  }

  /** Walks one GLEIF node: follows its direct parent, or stops with a reason. Never resolves a node. */
  async function processGleif(item: Item, node: OwnershipNode) {
    const gleif = fetcher.gleif
    if (!gleif || !item.lei) {
      unavailable(node)
      return
    }

    let record = item.record
    try {
      record ??= (await gleif.getRecord(item.lei)) ?? undefined
    } catch {
      unavailable(node)
      return
    }
    if (!record) {
      settle(node, 'UNRESOLVED', 'REGISTER_NOT_PROFILED')
      return
    }

    node.name = record.legalName
    node.lei = record.lei
    node.jurisdiction = record.country ?? record.jurisdiction ?? null
    node.evidenceUrl = `${GLEIF_RECORD_URL}${record.lei}`
    const country = record.country ?? record.jurisdiction

    if (await applyTerminals(node, record)) return

    let result
    try {
      result = await gleif.getDirectParent(record.lei)
    } catch {
      unavailable(node)
      return
    }

    const parent = result.parent
    if (!parent) {
      stopGleif(node, country, result.exception)
      return
    }

    const uk = ukRegistration(parent)
    const key = uk ? companyKey(uk) : `LEI:${parent.lei}`
    if (item.ancestors.has(key)) {
      settle(node, 'UNRESOLVED', 'CIRCULAR_OWNERSHIP')
      return
    }
    const seen = visited.get(key)
    if (seen) {
      gleifEdge(seen, item.nodeId)
      return
    }

    const depth = item.depth + 1
    const created: OwnershipNode = uk
      ? {
          id: key,
          name: parent.legalName,
          kind: 'corporate',
          jurisdiction: null,
          companyNumber: uk,
          lei: parent.lei,
          resolution: 'PENDING',
          depth,
          secondaryReasons: [],
          evidenceUrl: `${CH_COMPANY_URL}${uk}`,
        }
      : gleifNode(parent, depth)
    nodes.set(key, created)
    visited.set(key, key)
    gleifEdge(key, item.nodeId)

    if (depth >= maxDepth) {
      settle(created, 'UNRESOLVED', 'DEPTH_LIMIT_REACHED')
      return
    }

    // A UK parent continues with the Companies House walker; any other parent with GLEIF.
    queue.push({
      companyNumber: uk ?? '',
      ...(uk ? {} : { lei: parent.lei, record: parent }),
      nodeId: key,
      depth,
      ranges: {},
      noPrune: item.noPrune,
      ancestors: new Set([...item.ancestors, key]),
    })
  }

  /** Free-text register description of an overseas PSC, and the country code it implies. */
  function overseasCountry(psc: Psc): { text: boolean; code: string | undefined } {
    const identification = asRecord(psc.identification)
    const parts = [identification.country_registered, identification.place_registered, identification.legal_authority]
      .map(str)
      .filter((part): part is string => part !== undefined)
    const code = parts.map(countryCode).find((c): c is string => c !== undefined && c !== 'GB')
    return { text: parts.length > 0, code }
  }

  async function addPsc(item: Item, psc: Psc, index: number) {
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
        // country_of_residence is read only for the look-through flag, never stored.
        ...(node.kind === 'individual' || node.kind === 'super_secure'
          ? {}
          : { jurisdiction: str(asRecord(psc.identification).country_registered) ?? null }),
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
      const pathNames = [...item.ancestors].map((id) => nodes.get(id)?.name ?? '')
      if (likelyLookThrough(psc, parsed, pathNames)) node.secondaryReasons.push('PSC_LOOK_THROUGH_LIKELY')
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
      const gleif = fetcher.gleif
      if (!gleif) {
        leaf({ kind: 'corporate', resolution: 'UNRESOLVED', reasonCode: 'FOREIGN_ENTITY_UNMATCHED' })
        return
      }

      // Match on registration number and country only, never on name.
      const { text, code } = overseasCountry(psc)
      const registration = str(asRecord(psc.identification).registration_number)?.trim()
      let matches: GleifRecord[] = []
      let outage = false
      if (registration && code) {
        try {
          matches = (await gleif.findByRegistration(registration, code)).filter(
            (m) => m.registrationStatus === 'ISSUED' && sameRegistration(m.registeredAs, registration),
          )
        } catch {
          outage = true
        }
      }

      if (matches.length !== 1) {
        const reasonCode: ReasonCode = outage
          ? 'SOURCE_UNAVAILABLE'
          : code
            ? stopReasonFor(code)
            : text
              ? 'REGISTER_NOT_PROFILED'
              : 'FOREIGN_ENTITY_UNMATCHED'
        const stop = leaf({ kind: 'corporate', resolution: 'UNRESOLVED', reasonCode })
        const profile = registerProfileRef(code)
        if (profile) stop.registerProfile = profile
        addSecondary(stop, code)
        return
      }

      const match = matches[0]
      const leiKey = `LEI:${match.lei}`
      if (item.ancestors.has(leiKey)) {
        leaf({ kind: 'corporate', resolution: 'UNRESOLVED', reasonCode: 'CIRCULAR_OWNERSHIP' })
        return
      }
      const seenLei = visited.get(leiKey)
      if (seenLei) {
        edgeTo(seenLei)
        return
      }

      const followed = gleifNode(match, depth, { name: pscName(psc), ...rangeFields(ranges, method) })
      nodes.set(leiKey, followed)
      visited.set(leiKey, leiKey)
      edgeTo(leiKey)

      if (depth >= maxDepth) {
        settle(followed, 'UNRESOLVED', 'DEPTH_LIMIT_REACHED')
        return
      }
      queue.push({
        companyNumber: '',
        lei: match.lei,
        record: match,
        nodeId: leiKey,
        depth,
        ranges,
        noPrune,
        ancestors: new Set([...item.ancestors, leiKey]),
      })
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

    if (item.lei) {
      await processGleif(item, node)
      continue
    }

    const profile = await safely(() => fetcher.getProfile(item.companyNumber))
    if (profile.status !== 200) {
      unavailable(node, profile)
      continue
    }
    noteFetched(node, profile)
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
    noteFetched(node, exemptions)
    if (hasUkRegulatedMarketExemption(exemptions)) {
      settle(node, 'RESOLVED_LISTED')
      continue
    }

    const pscs = await safely(() => fetcher.getPscs(item.companyNumber))
    if (!isAvailable(pscs)) {
      unavailable(node, pscs)
      continue
    }
    noteFetched(node, pscs)

    const active = items(pscs).filter((psc) => !isCeased(psc))
    if (active.length > 0) {
      for (const [index, psc] of active.entries()) await addPsc(item, psc, index)
      continue
    }

    const statements = await safely(() => fetcher.getPscStatements(item.companyNumber))
    noteFetched(node, statements)
    const activeStatement = items(statements).find((statement) => !isCeased(statement))
    if (activeStatement) {
      settle(node, 'UNRESOLVED', 'PSC_STATEMENT')
      node.statementCode = str(activeStatement.statement)
    } else if (!isAvailable(statements) || !isAvailable(exemptions)) {
      unavailable(node, statements, exemptions)
    } else {
      settle(node, 'UNRESOLVED', 'PSC_NONE_FILED')
    }
  }

  // A consolidation link is not a shareholding: whoever sits below a listed or regulated parent
  // only through GLEIF links is flagged, all the way down the chain.
  const isTerminal = (n: OwnershipNode) => n.resolution === 'RESOLVED_LISTED' || n.resolution === 'RESOLVED_REGULATED'
  for (let changed = true; changed; ) {
    changed = false
    for (const edge of edges) {
      if (edge.source !== 'gleif') continue
      const parent = nodes.get(edge.parentId)
      const child = nodes.get(edge.childId)
      if (!parent || !child || child.secondaryReasons.includes('CONSOLIDATION_ONLY')) continue
      if (isTerminal(parent) || parent.secondaryReasons.includes('CONSOLIDATION_ONLY')) {
        child.secondaryReasons.push('CONSOLIDATION_ONLY')
        changed = true
      }
    }
  }

  const all = [...nodes.values()]
  const viaGleif = edges.some((edge) => edge.source === 'gleif')
  return { rootId: root.id, status: overallStatus(all, threshold, viaGleif), nodes: all, edges }
}
