import { fetchAuthToken, kycSearchGetJson, asArray } from './kyc-search-client'

export type EntityCddData = {
  companyNumber: string
  companyProfile: Record<string, unknown>
  officers: unknown[]
  pscs: unknown[]
}

export async function fetchEntityCdd(companyNumber: string, authToken?: string): Promise<EntityCddData> {
  const normalised = companyNumber.trim().toUpperCase()
  const token = authToken ?? (await fetchAuthToken())

  const [profile, officers, pscs] = await Promise.all([
    kycSearchGetJson(`/companies/${normalised}`, token),
    kycSearchGetJson(`/companies/${normalised}/officers`, token),
    kycSearchGetJson(`/companies/${normalised}/pscs`, token),
  ])

  return {
    companyNumber: normalised,
    companyProfile: (profile ?? {}) as Record<string, unknown>,
    officers: asArray(officers, 'items'),
    pscs: asArray(pscs, 'items'),
  }
}
