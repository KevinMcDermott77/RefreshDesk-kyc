import { z } from 'zod'

export const REASON_CODES = [
  'REGISTER_PAYWALLED',
  'UBO_REGISTER_RESTRICTED',
  'SHAREHOLDERS_NOT_FILED',
  'FREE_MANUAL_RETRIEVAL',
  'REGISTER_NOT_PROFILED',
  'FOREIGN_ENTITY_UNMATCHED',
  'PSC_STATEMENT',
  'PSC_SUPER_SECURE',
  'PSC_NONE_FILED',
  'GLEIF_EXCEPTION_NATURAL_PERSONS',
  'GLEIF_EXCEPTION_NON_CONSOLIDATING',
  'GLEIF_EXCEPTION_NO_LEI',
  'GLEIF_EXCEPTION_NON_PUBLIC',
  'GLEIF_NO_KNOWN_PERSON',
  'BAND_STRADDLES_THRESHOLD',
  'CIRCULAR_OWNERSHIP',
  'DEPTH_LIMIT_REACHED',
  'SOURCE_UNAVAILABLE',
  // Secondary only: an individual's 75%+ holding probably hides non-UK fund entities the PSC regime looks through.
  'PSC_LOOK_THROUGH_LIKELY',
  // Secondary only: the name matches a US-listed company; never resolves a branch.
  'LISTING_US_UNCONFIRMED',
  // Secondary only: linked to a listed or regulated parent by accounting consolidation (GLEIF), not shareholding.
  'CONSOLIDATION_ONLY',
  // Client-provided, reviewer-verified ownership evidence (Slice 7). The first three are primary on a node whose
  // confirmed evidence could not be used; the others are secondary.
  'CLIENT_EVIDENCE_INCOMPLETE',
  'CLIENT_EVIDENCE_STALE',
  'CLIENT_EVIDENCE_UNCERTIFIED',
  'CLIENT_EVIDENCE_APPLIED',
  'CLIENT_EVIDENCE_NOT_ACCEPTED',
  'CLIENT_EVIDENCE_EMAIL_NOT_ACCEPTED',
  'CLIENT_EVIDENCE_PENDING',
] as const

export const reasonCodeSchema = z.enum(REASON_CODES)
export type ReasonCode = z.infer<typeof reasonCodeSchema>

export const RESOLUTIONS = [
  'RESOLVED_INDIVIDUAL',
  'RESOLVED_LISTED',
  'RESOLVED_REGULATED',
  'RESOLVED_GOVERNMENT',
  'PRUNED',
  'UNRESOLVED',
  // Intermediate company whose owners were walked: its outcome lives on its owners.
  'PENDING',
] as const

export const resolutionSchema = z.enum(RESOLUTIONS)
export type Resolution = z.infer<typeof resolutionSchema>

const rangeSchema = z.tuple([z.number(), z.number()])
export type Range = z.infer<typeof rangeSchema>

export const ownershipEdgeSchema = z.object({
  parentId: z.string(),
  childId: z.string(),
  source: z.enum(['ch', 'gleif', 'profile', 'client']),
  basis: z.enum(['psc', 'consolidation', 'fund', 'client_evidence']),
  band: rangeSchema.nullable(),
  natures: z.array(z.string()),
})
export type OwnershipEdge = z.infer<typeof ownershipEdgeSchema>

/** What a terminal check found, with where to verify it. */
export const evidenceSchema = z.object({
  kind: z.enum(['listed_eu', 'regulated_eu', 'us_listing']),
  source: z.string(),
  url: z.string(),
  details: z.record(z.string(), z.string()),
})
export type Evidence = z.infer<typeof evidenceSchema>

/** A listing / authorisation check the walk ran on a node, and what it came back with. */
export const CHECK_NAMES = ['ch_exemption', 'esma_firds', 'esma_upreg', 'sec_us'] as const
export const checkRunSchema = z.object({
  check: z.enum(CHECK_NAMES),
  // "none" is a clean miss; "unavailable" means the source was down, so absence proves nothing.
  outcome: z.enum(['found', 'none', 'unavailable']),
})
export type CheckRun = z.infer<typeof checkRunSchema>

/**
 * The confirmed client evidence a walk used or looked at for a node. Names of individuals never get
 * here: the owners are initials (the database strips names for read-only users and the loader drops
 * them for everyone), and the certifier's text, which can be a person's name, stays off this record.
 */
export const nodeClientEvidenceSchema = z.object({
  id: z.string(),
  kind: z.string(),
  asAt: z.string().optional(),
  documentDate: z.string().optional(),
  // Absent on a client's written confirmation, which nobody certifies.
  certified: z.enum(['yes', 'no', 'unclear']).optional(),
  certifierCapacity: z.enum(['notary', 'lawyer', 'accountant', 'company_officer', 'other', 'unclear']).optional(),
  certificationDate: z.string().optional(),
  // Present on a client's written confirmation: who confirmed it (capacity only), when, and how it arrived.
  confirmedByCapacity: z.enum(['director', 'company_secretary', 'authorised_signatory', 'compliance_officer', 'other', 'unclear']).optional(),
  confirmationDate: z.string().optional(),
  receivedAs: z.enum(['signed_letter', 'email', 'signed_chart', 'other']).optional(),
  confirmedBy: z.string().optional(),
  confirmedAt: z.string(),
  edited: z.boolean(),
  documentSha256: z.string(),
  override: z.object({ reasons: z.array(z.enum(['stale', 'uncertified'])) }).optional(),
  /** Whether it resolved the node. */
  applied: z.boolean(),
  /** Why it did not: the blockers, or "policy" when the policy does not accept evidence as resolving. */
  notApplied: z.array(z.enum(['incomplete', 'stale', 'uncertified', 'email', 'policy'])).optional(),
})
export type NodeClientEvidence = z.infer<typeof nodeClientEvidenceSchema>

// The register a walk stopped at, for the UI. Mirrors RegisterProfile (register-profiles.ts).
export const registerProfileRefSchema = z.object({
  country: z.string(),
  registerName: z.string(),
  url: z.string(),
  freeBasicData: z.boolean(),
  shareholdersPublic: z.enum(['yes', 'no', 'partial', 'manual']),
  uboAccess: z.enum(['public', 'legitimate_interest', 'obliged_entity', 'restricted']),
  accessRoutes: z.array(
    z.object({ route: z.enum(['public', 'obliged_entity', 'aggregator', 'paid_extract']), detail: z.string().optional() }),
  ),
  documentToRequest: z.string(),
  lastVerified: z.string(),
  verified: z.boolean(),
  note: z.string(),
  notProfiled: z.boolean().optional(),
})
export type RegisterProfileRef = z.infer<typeof registerProfileRefSchema>

export const ownershipNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['individual', 'corporate', 'legal_person', 'super_secure']),
  // Absent for individuals and super-secure PSCs: their country of residence is personal data.
  jurisdiction: z.string().nullable().optional(),
  companyNumber: z.string().optional(),
  lei: z.string().optional(),
  resolution: resolutionSchema,
  reasonCode: reasonCodeSchema.optional(),
  // Supporting evidence from other sources (GLEIF). Never drives resolution.
  secondaryReasons: z.array(reasonCodeSchema),
  // Cumulative interest in the root, as a band. Absent when a link on the path
  // is control-only (right to appoint directors, significant influence).
  effectiveRange: rangeSchema.optional(),
  // The same range under each indirect method; effectiveRange is the policy's choice.
  effectiveRangeMultiply: rangeSchema.optional(),
  effectiveRangeMajority: rangeSchema.optional(),
  evidenceUrl: z.string().optional(),
  // Set on foreign / GLEIF stop nodes: how the register where the walk stopped is accessed.
  registerProfile: registerProfileRefSchema.optional(),
  // Listing / authorisation evidence from the terminal checks.
  evidence: z.array(evidenceSchema).optional(),
  // Which listing / authorisation checks ran on this node, with their outcome.
  checks: z.array(checkRunSchema).optional(),
  // What identifies a foreign node that stopped the walk: an exact LEI, or a registration number with its country.
  // Company facts only; it is what evidence is matched on, and what the "Add client evidence" link is filled in from.
  identity: z.object({ lei: z.string().optional(), country: z.string().optional(), registrationNumber: z.string().optional() }).optional(),
  // Client evidence used (or found but not usable) for this node.
  clientEvidence: nodeClientEvidenceSchema.optional(),
  // Set on an owner that exists because confirmed client evidence named it: the evidence id.
  viaClientEvidence: z.string().optional(),
  // Edges from the root on the shortest path.
  depth: z.number().int().nonnegative(),
  // Companies House PSC statement code, verbatim (including CH's "signficant" typo).
  statementCode: z.string().optional(),
  // Oldest X-Fetched-At among the responses read for this company.
  fetchedAt: z.string().optional(),
  // Retry-After from the response that made this node SOURCE_UNAVAILABLE.
  retryAfter: z.string().optional(),
})
export type OwnershipNode = z.infer<typeof ownershipNodeSchema>

export type WalkStatus = 'resolved' | 'resolved_client_evidence' | 'partial' | 'unresolved'

export type WalkResult = {
  rootId: string
  status: WalkStatus
  nodes: OwnershipNode[]
  edges: OwnershipEdge[]
}

/**
 * How an indirect interest is computed down a chain:
 * - multiply: product of the bands at each link.
 * - majority: a link held at more than 50% (or with the right to appoint
 *   directors, or LLP members) passes the full interest through, i.e.
 *   counts as [100, 100].
 * - either: the element-wise maximum of both, so a holder is a beneficial
 *   owner if either method reaches the threshold. If only one method has a
 *   range, that range is used.
 */
export type IndirectMethod = 'multiply' | 'majority' | 'either'

export type WalkPolicy = {
  maxDepth?: number
  threshold?: number
  indirectMethod?: IndirectMethod
  /** An authorised credit institution or MiFID firm ends the walk. Default true. */
  acceptRegulatedAsTerminal?: boolean
  /** Confirmed client evidence may resolve a branch. Off: it is shown, but the branch stays partial. Default true. */
  acceptClientEvidenceAsResolved?: boolean
  /** An emailed confirmation from the client may resolve a branch. Off: it stays partial. Default true. */
  acceptEmailConfirmation?: boolean
  /** Evidence older than this, from its as-at (else document) date, is not applied. Default 12. */
  maxEvidenceAgeMonths?: number
  /** The run's date and time (ISO), for evidence age. The walk has no clock of its own beyond this default. */
  now?: string
}

/** A raw upstream response: HTTP status plus parsed JSON body (null when empty). */
export type Fetched = {
  status: number
  body: unknown
  /** When the upstream fetched this from Companies House (kyc-search X-Fetched-At). */
  fetchedAt?: string
  /** Retry-After from a 503, verbatim. */
  retryAfter?: string
}

export type GleifParents = {
  lei: string
  /** GLEIF reporting-exception reasons for the direct and ultimate parent, verbatim (e.g. NON_PUBLIC). */
  reportingExceptions: string[]
}

/** A GLEIF Level 1 record, reduced to what the walk and the profile panel use. */
export type GleifRecord = {
  lei: string
  legalName: string
  /** ELF code or free text from entity.legalForm. */
  legalForm?: string
  /** ISO country of the legal address. */
  country?: string
  jurisdiction?: string
  address?: string
  /** Registration authority id, e.g. RA000585 for Companies House. */
  registeredAt?: string
  registeredAs?: string
  /** registration.status: ISSUED, LAPSED, RETIRED, ... */
  registrationStatus: string
  /** entity.status: ACTIVE, INACTIVE. */
  entityStatus?: string
  nextRenewalDate?: string
}

export type GleifParentResult = {
  parent?: GleifRecord
  /** GLEIF reporting-exception reason, verbatim (e.g. NATURAL_PERSONS), when there is no parent. */
  exception?: string
}

/** Level 1 / Level 2 GLEIF lookups for the foreign walk. Methods throw when GLEIF is unavailable. */
export interface GleifSource {
  /** null when the LEI does not exist. */
  getRecord(lei: string): Promise<GleifRecord | null>
  /** Records whose registration number and country match; the caller decides what counts as a unique match. */
  findByRegistration(registeredAs: string, country: string): Promise<GleifRecord[]>
  getDirectParent(lei: string): Promise<GleifParentResult>
}

/** Listing and authorisation checks run on GLEIF nodes. Each returns null when nothing is found and throws when a source is down. */
export interface TerminalChecks {
  listedEU(lei: string): Promise<Evidence | null>
  regulatedEU(lei: string): Promise<Evidence | null>
  /** Null when no SEC User-Agent is configured. Never resolves anything. */
  usListing(name: string): Promise<Evidence | null>
}

/** An owner named by confirmed client evidence. Individuals are initials only: no name reaches the walk. */
export type ClientEvidenceOwner = {
  kind: 'individual' | 'entity'
  /** Initials for an individual; the name as shown for an entity. */
  label: string
  holding: { type: 'percent'; value: number } | { type: 'band'; low: number; high: number } | null
  registration: { number: string; country: string } | null
  leiShown: string | null
  pageRef: string
}

/** One confirmed evidence item, as the walk sees it. */
export type ClientEvidenceItem = {
  id: string
  /** What the reviewer saw: matched on these facts only, never on a name. */
  nodeIdentity: { lei?: string; country?: string; registrationNumber?: string }
  evidenceKind: string
  asAt: string | null
  documentDate: string | null
  certified: 'yes' | 'no' | 'unclear'
  certifierCapacity: 'notary' | 'lawyer' | 'accountant' | 'company_officer' | 'other' | 'unclear' | null
  certificationDate: string | null
  /** A client's written confirmation (Slice 7): the signatory's capacity, the date, how it arrived, and the "no other holder" statement. */
  confirmedByCapacity: 'director' | 'company_secretary' | 'authorised_signatory' | 'compliance_officer' | 'other' | 'unclear' | null
  confirmationDate: string | null
  receivedAs: 'signed_letter' | 'email' | 'signed_chart' | 'other' | null
  noOtherHolderAtOrAbove: number | null
  /** The admin who confirmed it (a user id, not a name). */
  confirmedBy: string | null
  confirmedAt: string
  edited: boolean
  documentSha256: string
  owners: ClientEvidenceOwner[]
  ownersComplete: boolean
  override: { reasons: ('stale' | 'uncertified')[]; note: string } | null
}

export interface OwnershipFetcher {
  getProfile(companyNumber: string): Promise<Fetched>
  getPscs(companyNumber: string): Promise<Fetched>
  getPscStatements(companyNumber: string): Promise<Fetched>
  getExemptions(companyNumber: string): Promise<Fetched>
  /** Returns null when the company has no LEI. */
  getGleifParents(companyNumber: string): Promise<GleifParents | null>
  /** Absent in fetchers that cannot reach GLEIF: the walk then stays on Companies House. */
  gleif?: GleifSource
  /** The confirmed client evidence for this walk's client and subject. Absent when the walk has no client. */
  clientEvidence?: () => Promise<ClientEvidenceItem[]>
  terminals?: TerminalChecks
}
