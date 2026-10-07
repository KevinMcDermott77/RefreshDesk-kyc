'use server'

import { createClient } from '@/lib/supabase/server'
import { fetchEntityCdd } from '@/lib/companies-house/fetch-entity-cdd'
import { fetchAuthToken } from '@/lib/companies-house/kyc-search-client'
import { walk, UK_COMPANY_NUMBER } from '@/lib/ownership/walk'
import { createKycSearchFetcher } from '@/lib/ownership/kyc-search-fetcher'
import { summarise, toFlow, type FlowEdge, type FlowNode, type WalkSummary } from '@/lib/ownership/to-flow'
import { evaluateProfile, ownershipSummary, type ProfileRow } from '@/lib/kyc-profile/evaluate'
import { lookupLei } from '@/lib/kyc-profile/gleif'
import type { IndirectMethod } from '@/lib/ownership/types'

export type OwnershipViewState = {
  error?: string
  result?: { nodes: FlowNode[]; edges: FlowEdge[]; summary: WalkSummary; profile: ProfileRow[] }
}

const METHODS: IndirectMethod[] = ['either', 'multiply', 'majority']

export async function walkOwnershipAction(
  _prev: OwnershipViewState,
  formData: FormData,
): Promise<OwnershipViewState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const companyNumber = String(formData.get('company_number') ?? '').trim().toUpperCase()
  if (!UK_COMPANY_NUMBER.test(companyNumber)) {
    return { error: 'Company number must be 8 digits, or 2 letters followed by 6 digits' }
  }

  const maxDepth = Number(formData.get('max_depth'))
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 15) {
    return { error: 'Max depth must be a whole number from 1 to 15' }
  }
  const threshold = Number(formData.get('threshold'))
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 100) {
    return { error: 'Threshold must be a percentage between 0 and 100' }
  }
  const indirectMethod = String(formData.get('indirect_method')) as IndirectMethod
  if (!METHODS.includes(indirectMethod)) return { error: 'Unknown indirect method' }

  try {
    const token = await fetchAuthToken()
    const cdd = await fetchEntityCdd(companyNumber, token)
    const [walked, gleif] = await Promise.all([
      walk(cdd.companyNumber, createKycSearchFetcher(token, cdd), { maxDepth, threshold, indirectMethod }),
      lookupLei(cdd.companyNumber),
    ])
    const profile = evaluateProfile({
      profile: cdd.companyProfile,
      officers: cdd.officers,
      gleif: gleif.lookup,
      gleifFetchedAt: gleif.fetchedAt,
      ownership: ownershipSummary(walked, threshold),
      fetchedAt: { profile: cdd.fetchedAt?.profile, officers: cdd.fetchedAt?.officers },
    })
    return { result: { ...toFlow(walked), summary: summarise(walked), profile } }
  } catch (err) {
    return { error: err instanceof Error ? `Companies House lookup failed: ${err.message}` : 'Companies House lookup failed' }
  }
}
