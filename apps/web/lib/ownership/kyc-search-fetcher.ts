import { kycSearchGet } from '@/lib/companies-house/kyc-search-client'
import type { EntityCddData } from '@/lib/companies-house/fetch-entity-cdd'
import type { Fetched, OwnershipFetcher } from './types'

// kyc-search does not expose PSC statements, exemptions or GLEIF. Reporting
// them as unavailable makes the walker say SOURCE_UNAVAILABLE instead of
// wrongly concluding PSC_NONE_FILED.
const UNAVAILABLE: Fetched = { status: 0, body: null }

/**
 * `root` is the company fetchEntityCdd has already loaded; its profile and
 * PSCs are served from memory so the walk does not fetch the root again.
 */
export function createKycSearchFetcher(token: string, root?: EntityCddData): OwnershipFetcher {
  const get = (path: string) => kycSearchGet(path, token)
  const isRoot = (n: string) => root?.companyNumber === n

  return {
    getProfile: async (n) => (isRoot(n) ? { status: 200, body: root!.companyProfile } : get(`/companies/${n}`)),
    getPscs: async (n) => (isRoot(n) ? { status: 200, body: { items: root!.pscs } } : get(`/companies/${n}/pscs`)),
    getPscStatements: async () => UNAVAILABLE,
    getExemptions: async () => UNAVAILABLE,
    getGleifParents: async () => null,
  }
}
