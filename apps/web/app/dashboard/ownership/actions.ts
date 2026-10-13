'use server'

import { createClient } from '@/lib/supabase/server'
import { fetchEntityCdd } from '@/lib/companies-house/fetch-entity-cdd'
import { fetchAuthToken } from '@/lib/companies-house/kyc-search-client'
import { walk } from '@/lib/ownership/walk'
import { createKycSearchFetcher, sharedTerminals } from '@/lib/ownership/kyc-search-fetcher'
import { createGleifSource, isHistoric } from '@/lib/ownership/gleif-source'
import { resolveEntry } from '@/lib/ownership/resolve-entry'
import { summarise, toFlow, type FlowEdge, type FlowNode, type WalkSummary } from '@/lib/ownership/to-flow'
import {
  evaluateForeignProfile,
  evaluateProfile,
  ownershipSummary,
  type ProfileRow,
} from '@/lib/kyc-profile/evaluate'
import { fetchRawProfile } from '@/lib/kyc-profile/fetch-raw'
import { gleifHttp, lookupLei } from '@/lib/kyc-profile/gleif'
import type { Evidence, IndirectMethod, WalkPolicy } from '@/lib/ownership/types'

export type EntryCandidate = {
  lei: string
  name: string
  country?: string
  registrationStatus: string
  entityStatus?: string
  /** Inactive entity or retired registration. */
  historic: boolean
}

export type OwnershipViewState = {
  error?: string
  /** Several GLEIF matches for a name: the user picks one. */
  candidates?: EntryCandidate[]
  result?: { nodes: FlowNode[]; edges: FlowEdge[]; summary: WalkSummary; profile: ProfileRow[] }
}

const METHODS: IndirectMethod[] = ['either', 'multiply', 'majority']

/** Listing / authorisation evidence for a UK target's LEI. A source being down just means no evidence. */
async function terminalEvidence(lei: string): Promise<Evidence[]> {
  const found: Evidence[] = []
  for (const check of [() => sharedTerminals.listedEU(lei), () => sharedTerminals.regulatedEU(lei)]) {
    try {
      const evidence = await check()
      if (evidence) found.push(evidence)
    } catch {
      // Reported as "not found"; the walk itself does not depend on it.
    }
  }
  return found
}

export async function walkOwnershipAction(
  _prev: OwnershipViewState,
  formData: FormData,
): Promise<OwnershipViewState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

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
  const policy: WalkPolicy = { maxDepth, threshold, indirectMethod }

  // A pick from the name-search list arrives as an LEI.
  const entry = String(formData.get('picked_lei') || formData.get('entry') || '')
  const gleifSource = createGleifSource(gleifHttp)
  const resolution = await resolveEntry(entry, gleifSource)

  if (resolution.kind === 'error') return { error: resolution.message }
  if (resolution.kind === 'candidates') {
    return {
      candidates: resolution.candidates.map((r) => ({
        lei: r.lei,
        name: r.legalName,
        country: r.country,
        registrationStatus: r.registrationStatus,
        entityStatus: r.entityStatus,
        historic: isHistoric(r),
      })),
    }
  }

  try {
    const token = await fetchAuthToken()

    if (resolution.kind === 'lei') {
      const { record } = resolution
      const walked = await walk(record.lei, createKycSearchFetcher(token), policy)
      const profile = evaluateForeignProfile({
        record,
        listing: walked.nodes.find((n) => n.id === walked.rootId)?.evidence,
        ownership: ownershipSummary(walked, threshold),
        fetchedAt: new Date().toISOString(),
      })
      return { result: { ...toFlow(walked), summary: summarise(walked), profile } }
    }

    const cdd = await fetchEntityCdd(resolution.companyNumber, token)
    const [walked, gleif, raw] = await Promise.all([
      walk(cdd.companyNumber, createKycSearchFetcher(token, cdd), policy),
      lookupLei(cdd.companyNumber),
      // The panel needs Companies House field names, which the flattened cdd data lacks.
      fetchRawProfile(cdd.companyNumber, token),
    ])
    const listing = gleif.lookup.status === 'found' ? await terminalEvidence(gleif.lookup.lei) : []
    const profile = evaluateProfile({
      listing,
      listingFetchedAt: new Date().toISOString(),
      profile: raw.profile,
      officers: raw.officers,
      gleif: gleif.lookup,
      gleifFetchedAt: gleif.fetchedAt,
      ownership: ownershipSummary(walked, threshold),
      fetchedAt: raw.fetchedAt,
    })
    return { result: { ...toFlow(walked), summary: summarise(walked), profile } }
  } catch (err) {
    return { error: err instanceof Error ? `Lookup failed: ${err.message}` : 'Lookup failed' }
  }
}
