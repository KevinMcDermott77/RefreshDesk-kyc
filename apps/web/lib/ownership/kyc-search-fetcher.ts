import { kycSearchGet } from '@/lib/companies-house/kyc-search-client'
import type { EntityCddData } from '@/lib/companies-house/fetch-entity-cdd'
import type { OwnershipFetcher } from './types'

/**
 * `root` is the company fetchEntityCdd has already loaded; its profile and
 * PSCs are served from memory so the walk does not fetch the root again.
 *
 * kyc-search maps Companies House 404 to 404 (the walker reads it as "none on
 * file") and CH 429 to 503 with Retry-After (SOURCE_UNAVAILABLE). Statements
 * and exemptions are always live; PSCs are requested with ?fresh=true.
 * kyc-search has no GLEIF data.
 */
export function createKycSearchFetcher(token: string, root?: EntityCddData): OwnershipFetcher {
  const get = (path: string) => kycSearchGet(path, token)
  const isRoot = (n: string) => root?.companyNumber === n

  return {
    getProfile: async (n) =>
      isRoot(n)
        ? { status: 200, body: root!.companyProfile, fetchedAt: root!.fetchedAt?.profile }
        : get(`/companies/${n}`),
    getPscs: async (n) =>
      isRoot(n)
        ? { status: 200, body: { items: root!.pscs }, fetchedAt: root!.fetchedAt?.pscs }
        : get(`/companies/${n}/pscs?fresh=true`),
    getPscStatements: async (n) => get(`/companies/${n}/pscs/statements`),
    getExemptions: async (n) => get(`/companies/${n}/exemptions`),
    getGleifParents: async () => null,
  }
}
