import { kycSearchGet } from '@/lib/companies-house/kyc-search-client'
import type { EntityCddData } from '@/lib/companies-house/fetch-entity-cdd'
import { createGleifSource } from './gleif-source'
import { createTerminalLookups } from './terminal-sources'
import { createTerminalChecks } from './terminals'
import { gleifHttp, withSourceLog } from '@/lib/kyc-profile/gleif'
import type { SourceLog } from '@/lib/packs/source-log'
import type { OwnershipFetcher } from './types'

/**
 * `root` is the company fetchEntityCdd has already loaded; its profile is
 * served from memory so the walk does not fetch the root again. PSCs are never
 * served from memory: fetchEntityCdd's copy is flattened and drops
 * `identification`, which the walker needs to find the parent's registration
 * number, so every company (root included) uses /pscs/raw, Companies House's
 * PSC JSON unchanged.
 *
 * kyc-search maps Companies House 404 to 404 (the walker reads it as "none on
 * file") and CH 429 to 503 with Retry-After (SOURCE_UNAVAILABLE). Statements,
 * exemptions and raw PSCs are always live. kyc-search has no GLEIF data.
 */
// One cache for the process: the registers change monthly or daily at most.
const sharedLookups = createTerminalLookups()
export const sharedTerminals = createTerminalChecks(sharedLookups)

/** The shared terminal checks, recording the registers they use in `log` (a refresh pack's source log). */
export function terminalChecksFor(log: SourceLog | undefined) {
  return log ? createTerminalChecks(sharedLookups.withLog(log)) : sharedTerminals
}

export function createKycSearchFetcher(token: string, root?: EntityCddData, log?: SourceLog): OwnershipFetcher {
  const get = (path: string) => kycSearchGet(path, token, log)
  const isRoot = (n: string) => root?.companyNumber === n

  return {
    getProfile: async (n) =>
      isRoot(n)
        ? { status: 200, body: root!.companyProfile, fetchedAt: root!.fetchedAt?.profile }
        : get(`/companies/${n}`),
    getPscs: async (n) => get(`/companies/${n}/pscs/raw`),
    getPscStatements: async (n) => get(`/companies/${n}/pscs/statements`),
    getExemptions: async (n) => get(`/companies/${n}/exemptions`),
    getGleifParents: async () => null,
    // GLEIF is public: foreign owners are matched and followed directly, not through kyc-search.
    gleif: createGleifSource(withSourceLog(gleifHttp, log)),
    terminals: terminalChecksFor(log),
  }
}
