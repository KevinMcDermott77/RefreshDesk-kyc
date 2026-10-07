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
  source: z.enum(['ch', 'gleif', 'profile']),
  basis: z.enum(['psc', 'consolidation', 'fund']),
  band: rangeSchema.nullable(),
  natures: z.array(z.string()),
})
export type OwnershipEdge = z.infer<typeof ownershipEdgeSchema>

export const ownershipNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['individual', 'corporate', 'legal_person', 'super_secure']),
  jurisdiction: z.string().nullable(),
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

export type WalkStatus = 'resolved' | 'partial' | 'unresolved'

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

export interface OwnershipFetcher {
  getProfile(companyNumber: string): Promise<Fetched>
  getPscs(companyNumber: string): Promise<Fetched>
  getPscStatements(companyNumber: string): Promise<Fetched>
  getExemptions(companyNumber: string): Promise<Fetched>
  /** Returns null when the company has no LEI. */
  getGleifParents(companyNumber: string): Promise<GleifParents | null>
}
