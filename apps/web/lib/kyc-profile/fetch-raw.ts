import { kycSearchGet } from '@/lib/companies-house/kyc-search-client'

export type RawProfileData = {
  /** Companies House company profile, JSON unchanged. */
  profile: Record<string, unknown>
  /** Companies House officer list items, JSON unchanged. */
  officers: unknown[]
  fetchedAt: { profile?: string; officers?: string }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/**
 * The KYC profile panel reads Companies House's own field names (accounts,
 * confirmation_statement, officer_role, resigned_on), which only kyc-search's
 * /raw endpoints preserve. Separate from fetchEntityCdd, whose flattened data
 * feeds the CDD screens and storage.
 */
export async function fetchRawProfile(companyNumber: string, token: string): Promise<RawProfileData> {
  const number = companyNumber.trim().toUpperCase()
  const [profile, officers] = await Promise.all([
    kycSearchGet(`/companies/${number}/raw`, token),
    kycSearchGet(`/companies/${number}/officers/raw`, token),
  ])
  if (profile.status !== 200) throw new Error(`kyc-search request failed (${profile.status}): /companies/${number}/raw`)
  // A company with no officers on file is a 404 from Companies House.
  if (officers.status !== 200 && officers.status !== 404) {
    throw new Error(`kyc-search request failed (${officers.status}): /companies/${number}/officers/raw`)
  }

  const items = asRecord(officers.body).items
  return {
    profile: asRecord(profile.body),
    officers: Array.isArray(items) ? items : [],
    fetchedAt: { profile: profile.fetchedAt, officers: officers.fetchedAt },
  }
}
