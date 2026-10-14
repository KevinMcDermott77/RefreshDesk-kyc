import { evaluateForeignProfile, evaluateProfile, ownershipSummary } from '@/lib/kyc-profile/evaluate'
import { fixtureFetcher } from '@/lib/ownership/__tests__/fixture-fetcher'
import { summarise, toFlow } from '@/lib/ownership/to-flow'
import { walk } from '@/lib/ownership/walk'
import type { WalkPolicy } from '@/lib/ownership/types'
import { buildSnapshot, type BuildSnapshotInput, type PackPolicy } from '../snapshot'
import type { SourceLogEntry } from '../source-log'

export const SOURCE_LOG: SourceLogEntry[] = [
  { register: 'Companies House (via kyc-search)', path: '/companies/OE005000', fetchedAt: '2026-10-14T09:00:00.000Z', status: 200 },
  { register: 'Companies House (via kyc-search)', path: '/companies/OE005000/pscs/raw', fetchedAt: '2026-10-14T09:00:01.000Z', status: 200 },
  { register: 'GLEIF', path: '/api/v1/lei-records?filter[entity.registeredAs]=OE005000', fetchedAt: '2026-10-13T08:00:00.000Z', status: 200, cached: true },
]

export const POLICY: PackPolicy = { threshold: 25, maxDepth: 10, indirectMethod: 'either', acceptRegulatedAsTerminal: true }

/** The OE005000 chain at maxDepth 10: it ends at an individual, so the snapshot has a named person to mask. */
export async function buildFixtureInput(over: Partial<BuildSnapshotInput> = {}): Promise<BuildSnapshotInput> {
  const policy: WalkPolicy = { maxDepth: POLICY.maxDepth, threshold: POLICY.threshold, indirectMethod: POLICY.indirectMethod }
  const { fetcher } = fixtureFetcher()
  const walked = await walk('OE005000', fetcher, policy)
  const rows = evaluateForeignProfile({
    record: { lei: '5299000000000000000', legalName: 'CAPELLA TEST LIMITED', registrationStatus: 'ISSUED', entityStatus: 'ACTIVE' },
    ownership: ownershipSummary(walked, POLICY.threshold),
  })
  return {
    subject: { id: 'OE005000', kind: 'overseas_entity', name: 'Test Overseas Entity' },
    policy: POLICY,
    walked,
    profile: rows,
    flow: toFlow(walked),
    summary: summarise(walked),
    sourceLog: SOURCE_LOG,
    now: new Date('2026-10-14T10:00:00Z'),
    ...over,
  }
}

export async function buildFixtureSnapshot(over: Partial<BuildSnapshotInput> = {}) {
  return buildSnapshot(await buildFixtureInput(over))
}

export { evaluateProfile }
