'use server'

import { createClient } from '@/lib/supabase/server'
import { fetchEntityCdd } from '@/lib/companies-house/fetch-entity-cdd'
import { fetchAuthToken } from '@/lib/companies-house/kyc-search-client'
import { walk } from '@/lib/ownership/walk'
import { createKycSearchFetcher, terminalChecksFor } from '@/lib/ownership/kyc-search-fetcher'
import { createGleifSource, createReferenceNames, isHistoric } from '@/lib/ownership/gleif-source'
import { resolveEntry } from '@/lib/ownership/resolve-entry'
import { summarise, toFlow, type FlowEdge, type FlowNode, type WalkSummary } from '@/lib/ownership/to-flow'
import {
  evaluateForeignProfile,
  evaluateProfile,
  listingDecision,
  ownershipSummary,
  type ProfileRow,
} from '@/lib/kyc-profile/evaluate'
import { fetchRawProfile } from '@/lib/kyc-profile/fetch-raw'
import { gleifHttp, lookupLei, withSourceLog } from '@/lib/kyc-profile/gleif'
import { createSourceLog, type SourceLog } from '@/lib/packs/source-log'
import { createPackOffer, packFirmId, type PackOfferResult } from '@/lib/packs/offer'
import { packSigningSecret } from '@/lib/packs/sign'
import type { PackPolicy, PackSubject } from '@/lib/packs/snapshot'
import type { CheckRun, Evidence, IndirectMethod, WalkPolicy } from '@/lib/ownership/types'

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
  result?: {
    nodes: FlowNode[]
    edges: FlowEdge[]
    summary: WalkSummary
    profile: ProfileRow[]
    /** The run as a signed snapshot, if it can be saved as a refresh pack; otherwise why not. */
    pack?: PackOfferResult
  }
}

const METHODS: IndirectMethod[] = ['either', 'multiply', 'majority']

/** Listing / authorisation evidence for a UK target's LEI. A source being down just means no evidence. */
async function terminalEvidence(lei: string, log: SourceLog): Promise<{ evidence: Evidence[]; checks: CheckRun[] }> {
  const evidence: Evidence[] = []
  const checks: CheckRun[] = []
  const terminals = terminalChecksFor(log)
  const runs: [CheckRun['check'], () => Promise<Evidence | null>][] = [
    ['esma_firds', () => terminals.listedEU(lei)],
    ['esma_upreg', () => terminals.regulatedEU(lei)],
  ]
  for (const [name, run] of runs) {
    try {
      const found = await run()
      if (found) evidence.push(found)
      checks.push({ check: name, outcome: found ? 'found' : 'none' })
    } catch {
      // The row says the source was unavailable; the walk itself does not depend on it.
      checks.push({ check: name, outcome: 'unavailable' })
    }
  }
  return { evidence, checks }
}

function packPolicy(policy: WalkPolicy): PackPolicy {
  return {
    threshold: policy.threshold ?? 25,
    maxDepth: policy.maxDepth ?? 6,
    indirectMethod: policy.indirectMethod ?? 'either',
    acceptRegulatedAsTerminal: policy.acceptRegulatedAsTerminal ?? true,
  }
}

/** Turns a finished run into a signed snapshot for "Save as refresh pack", or says why it cannot. */
async function offerPack(input: {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  subject: PackSubject
  policy: PackPolicy
  walked: Parameters<typeof createPackOffer>[0]['walked']
  profile: ProfileRow[]
  flow: { nodes: FlowNode[]; edges: FlowEdge[] }
  summary: WalkSummary
  log: SourceLog
  individualNames?: string[]
}): Promise<PackOfferResult> {
  const secret = packSigningSecret()
  if (!secret) return { unavailable: 'Saving refresh packs needs PACK_SIGNING_SECRET (16+ characters) to be set on the server.' }
  const firmId = await packFirmId(input.supabase, input.userId)
  if (!firmId) return { unavailable: 'Only admins and members of a firm can save refresh packs.' }
  try {
    const { supabase: _supabase, userId: _userId, log, ...rest } = input
    return { offer: await createPackOffer({ ...rest, sourceLog: log.entries() }, { firmId, secret }) }
  } catch (err) {
    return { unavailable: err instanceof Error ? err.message : 'The run could not be turned into a refresh pack.' }
  }
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
  // Every register fetch of this run goes in the log, which becomes part of a refresh pack.
  const log = createSourceLog()
  const gleifSource = createGleifSource(withSourceLog(gleifHttp, log))
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
      const walked = await walk(record.lei, createKycSearchFetcher(token, undefined, log), policy)
      const names = createReferenceNames(withSourceLog(gleifHttp, log))
      const [legalForm, registrationAuthority] = await Promise.all([
        record.legalForm ? names.legalForm(record.legalForm) : undefined,
        record.registeredAt ? names.registrationAuthority(record.registeredAt) : undefined,
      ])
      const profile = evaluateForeignProfile({
        record,
        labels: { legalForm, registrationAuthority },
        listingDecision: listingDecision(walked),
        ownership: ownershipSummary(walked, threshold),
        fetchedAt: new Date().toISOString(),
      })
      const flow = toFlow(walked)
      const summary = summarise(walked)
      const pack = await offerPack({
        supabase,
        userId: user.id,
        subject: { id: record.lei, kind: 'lei', name: record.legalName },
        policy: packPolicy(policy),
        walked,
        profile,
        flow,
        summary,
        log,
      })
      return { result: { ...flow, summary, profile, pack } }
    }

    const cdd = await fetchEntityCdd(resolution.companyNumber, token, log)
    const [walked, gleif, raw] = await Promise.all([
      walk(cdd.companyNumber, createKycSearchFetcher(token, cdd, log), policy),
      lookupLei(cdd.companyNumber, fetch, Date.now, log),
      // The panel needs Companies House field names, which the flattened cdd data lacks.
      fetchRawProfile(cdd.companyNumber, token, log),
    ])
    // The listing row follows the walk's own terminal decision; the target's LEI checks add to it.
    const targetChecks = gleif.lookup.status === 'found' ? await terminalEvidence(gleif.lookup.lei, log) : undefined
    const profile = evaluateProfile({
      listingDecision: listingDecision(walked, targetChecks),
      listingFetchedAt: new Date().toISOString(),
      profile: raw.profile,
      officers: raw.officers,
      gleif: gleif.lookup,
      gleifFetchedAt: gleif.fetchedAt,
      ownership: ownershipSummary(walked, threshold),
      fetchedAt: raw.fetchedAt,
    })
    const flow = toFlow(walked)
    const summary = summarise(walked)
    const companyName = typeof raw.profile.company_name === 'string' ? raw.profile.company_name : cdd.companyNumber
    const pack = await offerPack({
      supabase,
      userId: user.id,
      subject: { id: cdd.companyNumber, kind: /^OE/.test(cdd.companyNumber) ? 'overseas_entity' : 'company', name: companyName },
      policy: packPolicy(policy),
      walked,
      profile,
      flow,
      summary,
      log,
      // Officers' names are shown as initials; these full names are only used to check they did not leak.
      individualNames: raw.officers.map((o) => (typeof (o as { name?: unknown }).name === 'string' ? (o as { name: string }).name : '')).filter(Boolean),
    })
    return { result: { ...flow, summary, profile, pack } }
  } catch (err) {
    return { error: err instanceof Error ? `Lookup failed: ${err.message}` : 'Lookup failed' }
  }
}
