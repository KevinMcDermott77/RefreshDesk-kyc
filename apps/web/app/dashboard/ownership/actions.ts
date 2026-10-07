'use server'

import { createClient } from '@/lib/supabase/server'
import { fetchEntityCdd } from '@/lib/companies-house/fetch-entity-cdd'
import { fetchAuthToken } from '@/lib/companies-house/kyc-search-client'
import { walk, UK_COMPANY_NUMBER } from '@/lib/ownership/walk'
import { createKycSearchFetcher } from '@/lib/ownership/kyc-search-fetcher'
import { summarise, toFlow, type FlowEdge, type FlowNode, type WalkSummary } from '@/lib/ownership/to-flow'
import type { IndirectMethod } from '@/lib/ownership/types'

export type OwnershipViewState = {
  error?: string
  result?: { nodes: FlowNode[]; edges: FlowEdge[]; summary: WalkSummary }
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
    const walked = await walk(cdd.companyNumber, createKycSearchFetcher(token, cdd), {
      maxDepth,
      threshold,
      indirectMethod,
    })
    return { result: { ...toFlow(walked), summary: summarise(walked) } }
  } catch (err) {
    return { error: err instanceof Error ? `Companies House lookup failed: ${err.message}` : 'Companies House lookup failed' }
  }
}
