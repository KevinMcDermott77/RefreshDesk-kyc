import { classify } from '@/lib/ownership/bands'
import { initials } from '@/lib/ownership/to-flow'
import type { WalkResult } from '@/lib/ownership/types'

export type Mark = 'PASS' | 'GAP' | 'INFO'

export type ProfileRow = {
  key: 'identity' | 'filings' | 'officers' | 'lei' | 'ownership' | 'not-covered'
  label: string
  mark: Mark
  lines: string[]
  source?: { label: string; url: string }
  /** ISO timestamp the data was fetched. */
  fetchedAt?: string
  note?: string
}

export type GleifLookup =
  | { status: 'none' }
  | { status: 'unavailable' }
  | { status: 'found'; lei: string; legalName: string; registrationStatus: string; nextRenewalDate?: string }

export type OwnershipSummary = {
  status: WalkResult['status']
  threshold: number
  /** Initials of individuals whose effective range is wholly at or above the threshold. */
  owners: string[]
  /** Initials of individuals whose band straddles the threshold. */
  possibleOwners: string[]
  fetchedAt?: string
}

export type ProfileInput = {
  /** Companies House company profile, as returned by kyc-search. */
  profile: Record<string, unknown>
  officers: unknown[]
  gleif: GleifLookup
  gleifFetchedAt?: string
  ownership: OwnershipSummary
  fetchedAt: { profile?: string; officers?: string }
}

export const GLEIF_NOTE = 'LEI data from GLEIF, CC0. GLEIF does not endorse this tool.'
export const SCREENING_GAP = 'Sanctions, PEP and adverse media screening: run through your screening provider.'

const CH_COMPANY_URL = 'https://find-and-update.company-information.service.gov.uk/company/'

type Rec = Record<string, unknown>

function rec(value: unknown): Rec {
  return typeof value === 'object' && value !== null ? (value as Rec) : {}
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-12-06" or a full ISO timestamp -> "6 Dec 2026". Unparseable input is returned as is. */
export function formatDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return value
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`
}

const LEGAL_FORMS: Record<string, string> = {
  ltd: 'Private limited company',
  plc: 'Public limited company',
  llp: 'Limited liability partnership',
  'private-limited-guarant-nsc': 'Private company limited by guarantee',
  'private-limited-guarant-nsc-limited-exemption': 'Private company limited by guarantee',
  'private-unlimited': 'Private unlimited company',
  'registered-overseas-entity': 'Registered overseas entity',
}

function address(value: unknown): string | undefined {
  const a = rec(value)
  const parts = [a.address_line_1, a.address_line_2, a.locality, a.region, a.postal_code, a.country].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  )
  return parts.length > 0 ? parts.join(', ') : undefined
}

/** Lower-case, no punctuation, trailing LTD / LIMITED dropped. */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word, index, words) => !(index === words.length - 1 && (word === 'ltd' || word === 'limited')))
    .join(' ')
}

export function namesMatch(a: string, b: string): boolean {
  return normaliseName(a) === normaliseName(b)
}

function identityRow(input: ProfileInput): ProfileRow {
  const p = input.profile
  const number = str(p.company_number) ?? ''
  const status = str(p.company_status)
  const type = str(p.type)
  const sic = Array.isArray(p.sic_codes) ? p.sic_codes.filter((c): c is string => typeof c === 'string') : []
  const lines = [
    `Registered name: ${str(p.company_name) ?? 'not provided'}`,
    `Company number: ${number}`,
    `Status: ${status ?? 'not provided'}`,
    `Legal form: ${type ? (LEGAL_FORMS[type] ?? type) : 'not provided'}`,
    `Incorporated: ${str(p.date_of_creation) ? formatDate(str(p.date_of_creation)!) : 'not provided'}`,
    `Registered office: ${address(p.registered_office_address) ?? 'not provided'}`,
    `SIC codes: ${sic.length > 0 ? sic.join(', ') : 'none filed'}`,
  ]
  return {
    key: 'identity',
    label: 'Identity',
    mark: status === 'active' ? 'PASS' : 'GAP',
    lines,
    source: { label: 'Companies House', url: `${CH_COMPANY_URL}${number}` },
    fetchedAt: input.fetchedAt.profile,
    ...(status === 'active' ? {} : { note: `Company status is ${status ?? 'unknown'}, not active.` }),
  }
}

function dueLine(label: string, section: unknown): { line: string; overdue: boolean; known: boolean } {
  const s = rec(section)
  const due = str(s.next_due)
  if (!due || typeof s.overdue !== 'boolean') {
    return { line: `${label}: not provided by Companies House for this entity`, overdue: false, known: false }
  }
  return {
    line: s.overdue ? `${label}: OVERDUE (was due ${formatDate(due)})` : `${label}: next due ${formatDate(due)}`,
    overdue: s.overdue,
    known: true,
  }
}

function filingsRow(input: ProfileInput): ProfileRow {
  const accounts = dueLine('Accounts', input.profile.accounts)
  const confirmation = dueLine('Confirmation statement', input.profile.confirmation_statement)
  const mark: Mark = accounts.overdue || confirmation.overdue ? 'GAP' : accounts.known || confirmation.known ? 'PASS' : 'INFO'
  return {
    key: 'filings',
    label: 'Filings',
    mark,
    lines: [accounts.line, confirmation.line],
    source: { label: 'Companies House', url: `${CH_COMPANY_URL}${str(input.profile.company_number) ?? ''}` },
    fetchedAt: input.fetchedAt.profile,
  }
}

function officersRow(input: ProfileInput): ProfileRow {
  const number = str(input.profile.company_number) ?? ''
  const current = input.officers
    .map(rec)
    .filter((o) => !o.resigned_on)
    .map((o) => ({ role: str(o.officer_role) ?? '', name: str(o.name) ?? '' }))
    .filter((o) => /director|secretary/.test(o.role))

  const directors = current.filter((o) => o.role.includes('director')).length
  const secretaries = current.filter((o) => o.role.includes('secretary')).length
  const lines = [
    `${directors} active ${directors === 1 ? 'director' : 'directors'}, ${secretaries} active ${secretaries === 1 ? 'secretary' : 'secretaries'}`,
    ...current.map((o) => {
      const role = o.role.replace(/-/g, ' ')
      // Corporate officers are companies, not people: their name is shown.
      return `${o.role.startsWith('corporate-') ? o.name : initials(o.name)} — ${role}`
    }),
  ]
  return {
    key: 'officers',
    label: 'Officers',
    mark: 'INFO',
    lines,
    source: { label: 'Companies House', url: `${CH_COMPANY_URL}${number}/officers` },
    fetchedAt: input.fetchedAt.officers,
  }
}

function leiRow(input: ProfileInput): ProfileRow {
  const gleif = input.gleif
  const base = { key: 'lei' as const, label: 'LEI', fetchedAt: input.gleifFetchedAt, note: GLEIF_NOTE }
  if (gleif.status === 'unavailable') {
    return {
      ...base,
      mark: 'INFO',
      lines: ['GLEIF lookup unavailable; try again later'],
      source: { label: 'GLEIF', url: 'https://search.gleif.org' },
    }
  }
  if (gleif.status === 'none') {
    return { ...base, mark: 'INFO', lines: ['No LEI'], source: { label: 'GLEIF', url: 'https://search.gleif.org' } }
  }

  const chName = str(input.profile.company_name) ?? ''
  const nameMatches = namesMatch(chName, gleif.legalName)
  const lines = [
    `LEI: ${gleif.lei}`,
    `Registration status: ${gleif.registrationStatus}`,
    `Next renewal: ${gleif.nextRenewalDate ? formatDate(gleif.nextRenewalDate) : 'not provided'}`,
    nameMatches
      ? 'Legal name matches Companies House'
      : `Legal name differs from Companies House: GLEIF has "${gleif.legalName}"`,
  ]
  return {
    ...base,
    mark: gleif.registrationStatus === 'ISSUED' && nameMatches ? 'PASS' : 'GAP',
    lines,
    source: { label: 'GLEIF', url: `https://search.gleif.org/#/record/${gleif.lei}` },
  }
}

function ownershipRow(input: ProfileInput): ProfileRow {
  const { status, threshold, owners, possibleOwners } = input.ownership
  const lines = [
    `Walk status: ${status}`,
    owners.length > 0
      ? `${owners.length} beneficial ${owners.length === 1 ? 'owner' : 'owners'} at or above ${threshold}%: ${owners.join(', ')}`
      : `No beneficial owners identified at or above ${threshold}%`,
    ...(possibleOwners.length > 0
      ? [`${possibleOwners.length} possible (band straddles ${threshold}%): ${possibleOwners.join(', ')}`]
      : []),
  ]
  return {
    key: 'ownership',
    label: 'Ownership',
    mark: status === 'resolved' ? 'PASS' : 'GAP',
    lines,
    source: {
      label: 'Companies House PSC register',
      url: `${CH_COMPANY_URL}${str(input.profile.company_number) ?? ''}/persons-with-significant-control`,
    },
    fetchedAt: input.ownership.fetchedAt,
  }
}

/** Individuals at or above the threshold, masked to initials. */
export function ownershipSummary(result: WalkResult, threshold: number): OwnershipSummary {
  const individuals = result.nodes.filter((node) => node.resolution === 'RESOLVED_INDIVIDUAL')
  const named = (kind: 'above' | 'straddles') =>
    individuals
      .filter((node) => node.effectiveRange && classify(node.effectiveRange, threshold) === kind)
      .map((node) => initials(node.name))
  const fetched = result.nodes.map((node) => node.fetchedAt).filter((t): t is string => !!t)
  const oldest = fetched.sort((a, b) => Date.parse(a) - Date.parse(b))[0]
  return {
    status: result.status,
    threshold,
    owners: named('above'),
    possibleOwners: named('straddles'),
    fetchedAt: oldest,
  }
}

/** The entity KYC profile: one row per check, ending with what this tool does not cover. */
export function evaluateProfile(input: ProfileInput): ProfileRow[] {
  return [
    identityRow(input),
    filingsRow(input),
    officersRow(input),
    leiRow(input),
    ownershipRow(input),
    { key: 'not-covered', label: 'Not covered', mark: 'GAP', lines: [SCREENING_GAP] },
  ]
}
