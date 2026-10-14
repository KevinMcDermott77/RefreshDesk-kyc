import type { SourceLog } from '@/lib/packs/source-log'
import { fetchAuthToken, kycSearchGet, asArray, type KycSearchResponse } from './kyc-search-client'

export type EntityCddData = {
  companyNumber: string
  companyProfile: Record<string, unknown>
  officers: unknown[]
  pscs: unknown[]
  /** X-Fetched-At of each response, so the ownership walk can report freshness for the root. */
  fetchedAt?: { profile?: string; officers?: string; pscs?: string }
}

async function getOrThrow(path: string, token: string, log?: SourceLog): Promise<KycSearchResponse> {
  const response = await kycSearchGet(path, token, log)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`kyc-search request failed (${response.status}): ${path}`)
  }
  return response
}

export async function fetchEntityCdd(companyNumber: string, authToken?: string, log?: SourceLog): Promise<EntityCddData> {
  const normalised = companyNumber.trim().toUpperCase()
  const token = authToken ?? (await fetchAuthToken())

  const [profile, officers, pscs] = await Promise.all([
    getOrThrow(`/companies/${normalised}`, token, log),
    getOrThrow(`/companies/${normalised}/officers?fresh=true`, token, log),
    getOrThrow(`/companies/${normalised}/pscs?fresh=true`, token, log),
  ])

  return {
    companyNumber: normalised,
    companyProfile: (profile.body ?? {}) as Record<string, unknown>,
    officers: asArray(officers.body, 'items'),
    pscs: asArray(pscs.body, 'items'),
    fetchedAt: { profile: profile.fetchedAt, officers: officers.fetchedAt, pscs: pscs.fetchedAt },
  }
}
