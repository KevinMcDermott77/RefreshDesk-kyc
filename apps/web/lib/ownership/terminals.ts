import type { Evidence, TerminalChecks } from './types'

/** One FIRDS reference-data row for an equity instrument on a venue. */
export type FirdsRow = {
  isin: string
  mic: string
  cfi: string
  name?: string
  status?: string
  latestReceived?: boolean
  /** mrkt_trdng_start_date: when trading on this venue began. */
  startDate?: string
  /** ISO date or timestamp; a past date means the admission has ended. */
  terminationDate?: string
}

export type IsoMic = {
  mic: string
  operatingMic: string
  /** ISO 10383 market category code: RMKT, MLTF, NSPD, ... */
  category: string
  country: string
  name: string
  status: string
}

export type UpregFirm = { name: string; typeCode: string; typeLabel: string; status: string; authority: string; officeType: string }

export type SecTicker = { cik: string; name: string; ticker: string; exchange: string }

/** The reference data the checks run over. Implementations cache; the checks are pure. */
export type TerminalLookups = {
  firdsEquities(lei: string): Promise<FirdsRow[]>
  /** ESMA upreg regulated markets (MIR), active, by MIC. */
  regulatedMarkets(): Promise<Map<string, string>>
  isoMics(): Promise<Map<string, IsoMic>>
  upregFirms(lei: string): Promise<UpregFirm[]>
  ecbSupervised(): Promise<{ month: string; url: string; leis: Set<string> } | null>
  /** null when no SEC User-Agent is configured. */
  secTickers(): Promise<SecTicker[] | null>
  now?: () => Date
}

export const FIRDS_SOURCE = 'ESMA FIRDS (instrument reference data)'
export const FIRDS_URL = 'https://registers.esma.europa.eu/solr/esma_registers_firds/select'
export const UPREG_URL = 'https://registers.esma.europa.eu/solr/esma_registers_upreg/select'
export const ISO_MIC_URL = 'https://www.iso20022.org/sites/default/files/ISO10383_MIC/ISO10383_MIC.csv'

const EEA = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO',
])

// Rule b trusts an exchange operator's regulated market only for plain market categories. ISO files
// the operator's multilateral trading facilities (MLTF) under the same operating MIC.
const OPERATING_MIC_CATEGORIES = new Set(['RMKT', 'NSPD'])

export type VenueRule = 'mir' | 'operating-mic' | 'iso-rmkt'

const RULE_TEXT: Record<string, string> = {
  mir: 'ESMA regulated-market list',
  'operating-mic': 'Operated by an exchange on the ESMA regulated-market list',
  'iso-rmkt': 'ISO 10383 regulated market (EEA)',
}

/** Plain-English name of the rule that matched a venue; unknown values are returned as they are. */
export function ruleText(rule: string): string {
  return RULE_TEXT[rule] ?? rule
}

export type VenueMatch = { rule: VenueRule; operatingMic: string; venueName: string }

/** Whether `mic` is a regulated market, and which rule says so. Rules are tried in order a, b, c. */
export function matchRegulatedVenue(
  mic: string,
  mir: Map<string, string>,
  iso: Map<string, IsoMic>,
): VenueMatch | null {
  const key = mic.toUpperCase()
  const row = iso.get(key)
  const operatingMic = row?.operatingMic ?? key

  // a. The MIC itself is in ESMA's list of regulated markets.
  const direct = mir.get(key)
  if (direct) return { rule: 'mir', operatingMic, venueName: direct }

  if (!row || row.status !== 'ACTIVE') return null

  // b. Its ISO operating MIC is in that list.
  const operator = mir.get(row.operatingMic)
  if (operator && row.operatingMic !== key && OPERATING_MIC_CATEGORIES.has(row.category)) {
    return { rule: 'operating-mic', operatingMic: row.operatingMic, venueName: `${row.name} (operator: ${operator})` }
  }

  // c. ISO says regulated market, in the EEA.
  if (row.category === 'RMKT' && EEA.has(row.country)) {
    return { rule: 'iso-rmkt', operatingMic, venueName: row.name }
  }
  return null
}

function ended(row: FirdsRow, now: Date): boolean {
  if (!row.terminationDate) return false
  const at = Date.parse(row.terminationDate)
  // FIRDS uses 9999-12-31 for "no end"; anything in the past has ended.
  return !Number.isNaN(at) && at < now.getTime()
}

/**
 * An equity instrument (CFI starting "ES") with this issuer LEI that is live
 * on a regulated market. Bond-only issuers (CFI "D...") do not qualify.
 */
export async function listedEU(lei: string, lookups: TerminalLookups): Promise<Evidence | null> {
  const now = lookups.now?.() ?? new Date()
  const rows = (await lookups.firdsEquities(lei)).filter(
    (row) =>
      row.cfi.toUpperCase().startsWith('ES') &&
      row.latestReceived !== false &&
      row.status !== 'TERM' &&
      row.status !== 'CANC' &&
      !ended(row, now),
  )
  if (rows.length === 0) return null

  const [mir, iso] = await Promise.all([lookups.regulatedMarkets(), lookups.isoMics()])
  const matched = rows.flatMap((row) => {
    const match = matchRegulatedVenue(row.mic, mir, iso)
    return match ? [{ row, match }] : []
  })
  if (matched.length === 0) return null

  // The primary venue: the issuer's home-country regulated venue (ISIN country = venue country),
  // preferring a main market (a MIC that is its own operating MIC) over a segment,
  // then the earliest start of trading, then alphabetical MIC.
  const isHome = (row: FirdsRow) => iso.get(row.mic.toUpperCase())?.country === row.isin.slice(0, 2).toUpperCase()
  const started = (row: FirdsRow) => (row.startDate ? Date.parse(row.startDate) : Number.POSITIVE_INFINITY)
  const home = matched.filter(({ row }) => isHome(row))
  const isMainMarket = ({ row, match }: (typeof matched)[number]) => (match.operatingMic === row.mic.toUpperCase() ? 0 : 1)
  const best = (home.length > 0 ? home : matched).sort(
    (a, b) =>
      isMainMarket(a) - isMainMarket(b) ||
      started(a.row) - started(b.row) ||
      a.row.mic.toUpperCase().localeCompare(b.row.mic.toUpperCase()),
  )[0]

  return {
    kind: 'listed_eu',
    source: FIRDS_SOURCE,
    url: `${FIRDS_URL}?q=${encodeURIComponent(`lei:${lei} AND gnr_cfi_code:ES*`)}&wt=json`,
    details: {
      isin: best.row.isin,
      mic: best.row.mic.toUpperCase(),
      operatingMic: best.match.operatingMic,
      venueName: best.match.venueName,
      rule: best.match.rule,
    },
  }
}

/** An authorised credit institution (ECB list) or an active MiFID investment firm (ESMA upreg). */
export async function regulatedEU(lei: string, lookups: TerminalLookups): Promise<Evidence | null> {
  const firms = await lookups.upregFirms(lei)
  // Prefer the head office record over a branch's for the evidence.
  const active = firms.filter((f) => f.typeCode.toUpperCase() === 'MIF' && f.status.toLowerCase() === 'active')
  const firm = active.find((f) => f.officeType.toLowerCase() === 'head office') ?? active[0]
  if (firm) {
    return {
      kind: 'regulated_eu',
      source: 'ESMA register of authorised entities (MiFID investment firms)',
      url: `${UPREG_URL}?q=${encodeURIComponent(`ae_lei:${lei}`)}&wt=json`,
      details: { register: 'ESMA upreg', authority: firm.authority, status: firm.status, entity: firm.name },
    }
  }

  const ecb = await lookups.ecbSupervised()
  if (ecb?.leis.has(lei.toUpperCase())) {
    return {
      kind: 'regulated_eu',
      source: 'ECB list of supervised entities',
      url: ecb.url,
      details: { register: 'ECB list of supervised entities', authority: 'ECB / Single Supervisory Mechanism', status: 'Supervised credit institution', fileMonth: ecb.month },
    }
  }
  return null
}

/** Lower-case, no punctuation, trailing legal-form words dropped. */
export function normaliseListingName(name: string): string {
  const suffixes = new Set(['inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'plc', 'llc', 'lp', 'sa', 'nv', 'ag', 'se', 'ab', 'asa', 'abp', 'oyj', 'spa'])
  const words = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  while (words.length > 1 && suffixes.has(words[words.length - 1])) words.pop()
  return words.join(' ')
}

/**
 * NYSE / Nasdaq entry in the SEC ticker file whose normalised name equals this
 * entity's. The file carries no LEI, so the match is by name only: it is
 * evidence for a human to confirm, never a resolution.
 */
export async function usListing(name: string, lookups: TerminalLookups): Promise<Evidence | null> {
  const tickers = await lookups.secTickers()
  if (!tickers) return null
  const wanted = normaliseListingName(name)
  if (!wanted) return null
  const hit = tickers.find((t) => /^(NYSE|NASDAQ)$/i.test(t.exchange) && normaliseListingName(t.name) === wanted)
  if (!hit) return null
  return {
    kind: 'us_listing',
    source: 'SEC company tickers (name match only)',
    url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${hit.cik}`,
    details: { ticker: hit.ticker, exchange: hit.exchange, secName: hit.name },
  }
}

export function createTerminalChecks(lookups: TerminalLookups): TerminalChecks {
  return {
    listedEU: (lei) => listedEU(lei, lookups),
    regulatedEU: (lei) => regulatedEU(lei, lookups),
    usListing: (name) => usListing(name, lookups),
  }
}
