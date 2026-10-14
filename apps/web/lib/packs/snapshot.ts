import { z } from 'zod'
import type { ProfileRow } from '@/lib/kyc-profile/evaluate'
import type { FlowEdge, FlowNode, WalkSummary } from '@/lib/ownership/to-flow'
import type { IndirectMethod, WalkResult } from '@/lib/ownership/types'
import { canonicalJson, snapshotFingerprint } from './canonical'
import type { SourceLogEntry } from './source-log'

export const PACK_SNAPSHOT_VERSION = 1

export type PackSubject = {
  /** UK company number, overseas entity number or LEI. */
  id: string
  kind: 'company' | 'overseas_entity' | 'lei'
  name: string
}

export type PackPolicy = {
  threshold: number
  maxDepth: number
  indirectMethod: IndirectMethod
  acceptRegulatedAsTerminal: boolean
}

export type PackSummary = {
  /** "complete" only when the walk resolved every branch. */
  status: 'complete' | 'partial'
  walkStatus: WalkSummary['status']
  /** Branches still open: unresolved nodes plus those linked only by consolidation. */
  openBranches: number
  counts: WalkSummary['counts']
  intermediate: number
  notReached: number
  unresolved: WalkSummary['unresolved']
}

/**
 * Exactly what the pack page renders, and nothing live. Individuals appear as initials only (the
 * profile rows and chart are built from the already-masked views), and every fetch behind the
 * data is in sourceLog.
 */
export type PackSnapshot = {
  version: typeof PACK_SNAPSHOT_VERSION
  generatedAt: string
  subject: PackSubject
  policy: PackPolicy
  profile: ProfileRow[]
  summary: PackSummary
  pointsToCheck: WalkSummary['pointsToCheck']
  chart: { nodes: FlowNode[]; edges: FlowEdge[] }
  sourceLog: SourceLogEntry[]
}

// Keys that must never appear anywhere in a snapshot (personal data about individuals).
const FORBIDDEN_KEYS = ['date_of_birth', 'dateofbirth', 'dob', 'nationality', 'country_of_residence', 'countryofresidence', 'occupation']

/** The forbidden personal-data keys found anywhere in a value, with their paths. */
export function findForbiddenKeys(value: unknown, path = 'snapshot'): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => findForbiddenKeys(item, `${path}[${index}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
      ...(FORBIDDEN_KEYS.includes(key.toLowerCase().replace(/[-_\s]/g, '')) || FORBIDDEN_KEYS.includes(key.toLowerCase())
        ? [`${path}.${key}`]
        : []),
      ...findForbiddenKeys(child, `${path}.${key}`),
    ])
  }
  return []
}

/** "SMITH, John Paul" and "Mr John Paul Smith" both reduce to the words John, Paul, Smith. */
function nameVariants(name: string): string[] {
  const clean = name.trim()
  if (clean.length < 4) return []
  const [first, ...rest] = clean.split(',')
  const reordered = rest.length > 0 ? `${rest.join(' ').trim()} ${first.trim()}` : clean
  return [...new Set([clean, reordered].map((variant) => variant.toLowerCase().replace(/\s+/g, ' ')))]
}

/**
 * Throws if any individual's full name appears in the serialised snapshot. The builder works from
 * masked views, so this is a safety net against a leak, not the masking itself.
 */
export function assertNoPersonalNames(snapshot: unknown, individualNames: string[]): void {
  const text = canonicalJson(snapshot).toLowerCase().replace(/\s+/g, ' ')
  for (const name of individualNames) {
    for (const variant of nameVariants(name)) {
      if (text.includes(variant)) throw new Error('A refresh pack snapshot must not contain individuals\' names; it was not saved.')
    }
  }
}

export type BuildSnapshotInput = {
  subject: PackSubject
  policy: PackPolicy
  walked: WalkResult
  profile: ProfileRow[]
  flow: { nodes: FlowNode[]; edges: FlowEdge[] }
  summary: WalkSummary
  sourceLog: SourceLogEntry[]
  /** Full names that must not appear (officers and individual owners); checked, never stored. */
  individualNames?: string[]
  now?: Date
}

/** Assembles the snapshot from the views the ownership page already shows. Pure. */
export function buildSnapshot(input: BuildSnapshotInput): PackSnapshot {
  const { subject, policy, walked, profile, flow, summary, sourceLog } = input
  const openBranches = summary.unresolved.length

  const snapshot: PackSnapshot = {
    version: PACK_SNAPSHOT_VERSION,
    generatedAt: (input.now ?? new Date()).toISOString(),
    subject,
    policy,
    profile,
    summary: {
      status: walked.status === 'resolved' && openBranches === 0 ? 'complete' : 'partial',
      walkStatus: summary.status,
      openBranches,
      counts: summary.counts,
      intermediate: summary.intermediate,
      notReached: summary.notReached,
      unresolved: summary.unresolved,
    },
    pointsToCheck: summary.pointsToCheck,
    chart: flow,
    sourceLog,
  }

  // Normalise to plain JSON (no undefined, no class instances) so what is hashed is what is stored.
  const plain = JSON.parse(JSON.stringify(snapshot)) as PackSnapshot

  const forbidden = findForbiddenKeys(plain)
  if (forbidden.length > 0) throw new Error(`A refresh pack snapshot must not hold personal data (${forbidden.join(', ')})`)
  const names = [...(input.individualNames ?? []), ...walked.nodes.filter((n) => n.kind === 'individual').map((n) => n.name)]
  assertNoPersonalNames(plain, names)
  return plain
}

/** The snapshot with its fingerprint. */
export async function sealSnapshot(snapshot: PackSnapshot): Promise<{ snapshot: PackSnapshot; sha256: string }> {
  return { snapshot, sha256: await snapshotFingerprint(snapshot) }
}

// --- Validation of a snapshot read back from the database or received from the browser ---

const rangeSchema = z.tuple([z.number(), z.number()])

const profileRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  mark: z.enum(['PASS', 'GAP', 'INFO']),
  lines: z.array(z.string()),
  source: z.object({ label: z.string(), url: z.string() }).optional(),
  links: z.array(z.object({ label: z.string(), url: z.string() })).optional(),
  fetchedAt: z.string().optional(),
  note: z.string().optional(),
})

export const packSnapshotSchema = z.object({
  version: z.literal(PACK_SNAPSHOT_VERSION),
  generatedAt: z.string(),
  subject: z.object({ id: z.string().min(1), kind: z.enum(['company', 'overseas_entity', 'lei']), name: z.string().min(1) }),
  policy: z.object({
    threshold: z.number(),
    maxDepth: z.number(),
    indirectMethod: z.enum(['either', 'multiply', 'majority']),
    acceptRegulatedAsTerminal: z.boolean(),
  }),
  profile: z.array(profileRowSchema),
  summary: z.object({
    status: z.enum(['complete', 'partial']),
    walkStatus: z.enum(['resolved', 'partial', 'unresolved']),
    openBranches: z.number().int().nonnegative(),
    counts: z.record(z.string(), z.number()),
    intermediate: z.number(),
    notReached: z.number(),
    unresolved: z.array(z.object({ id: z.string(), name: z.string(), subtitle: z.string(), reasonCode: z.string().optional() })),
  }),
  pointsToCheck: z.array(z.object({ id: z.string(), name: z.string(), code: z.string(), detail: z.string().optional() })),
  chart: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        position: z.object({ x: z.number(), y: z.number() }),
        data: z
          .object({
            name: z.string(),
            subtitle: z.string(),
            resolution: z.string(),
            resolutionLabel: z.string(),
            tone: z.enum(['resolved', 'unresolved', 'pruned', 'pending']),
            reasonCode: z.string().optional(),
            effectiveRange: rangeSchema.optional(),
            secondaryReasons: z.array(z.string()),
          })
          .passthrough(),
      }),
    ),
    edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string(), label: z.string().optional(), dashed: z.boolean().optional() })),
  }),
  sourceLog: z.array(
    z.object({ register: z.string(), path: z.string(), fetchedAt: z.string(), status: z.number(), cached: z.boolean().optional() }),
  ),
})

/** Parses and checks a snapshot; throws with a readable message if it is malformed or holds personal data. */
export function parseSnapshot(value: unknown): PackSnapshot {
  const parsed = packSnapshotSchema.safeParse(value)
  if (!parsed.success) throw new Error(`Not a valid refresh pack snapshot: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`)
  const forbidden = findForbiddenKeys(value)
  if (forbidden.length > 0) throw new Error(`A refresh pack snapshot must not hold personal data (${forbidden.join(', ')})`)
  return value as PackSnapshot
}
