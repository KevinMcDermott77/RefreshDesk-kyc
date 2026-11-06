import { sameRegistration } from '@/lib/ownership/registration-number'
import type { ClientEvidenceItem, ClientEvidenceOwner, Range, ReasonCode } from '@/lib/ownership/types'
import { coverage } from './coverage'
import { isConfirmationKind } from './types'

/**
 * The rules for using confirmed client evidence in an ownership walk (docs/slice7-client-evidence.md).
 * Pure: the walk passes in the run's date and the policy.
 */

/** The reasons a foreign node stops for when it has no usable register: the only ones evidence may resolve. */
export const EVIDENCE_ELIGIBLE_REASONS: readonly ReasonCode[] = [
  'REGISTER_PAYWALLED',
  'UBO_REGISTER_RESTRICTED',
  'SHAREHOLDERS_NOT_FILED',
  'FREE_MANUAL_RETRIEVAL',
  'REGISTER_NOT_PROFILED',
  'FOREIGN_ENTITY_UNMATCHED',
  'GLEIF_EXCEPTION_NATURAL_PERSONS',
  'GLEIF_EXCEPTION_NON_CONSOLIDATING',
  'GLEIF_EXCEPTION_NO_LEI',
  'GLEIF_EXCEPTION_NON_PUBLIC',
  'GLEIF_NO_KNOWN_PERSON',
]

export type NodeFacts = { lei?: string; country?: string; registrationNumber?: string }

/**
 * The newest confirmed item whose identity equals this node's: an exact LEI, or an exact registration
 * number (compared normalised) with the same country. A name is never compared.
 */
export function matchEvidence(items: ClientEvidenceItem[], facts: NodeFacts): ClientEvidenceItem | null {
  const lei = facts.lei?.trim().toUpperCase()
  const country = facts.country?.trim().toUpperCase()
  const matches = items.filter((item) => {
    const identity = item.nodeIdentity
    if (lei && identity.lei && identity.lei.toUpperCase() === lei) return true
    return (
      !!country &&
      !!identity.country &&
      identity.country.toUpperCase() === country &&
      sameRegistration(identity.registrationNumber, facts.registrationNumber)
    )
  })
  if (matches.length === 0) return null
  return matches.reduce((newest, item) => (Date.parse(item.confirmedAt) > Date.parse(newest.confirmedAt) ? item : newest))
}

/** yyyy-mm-dd (or a full ISO timestamp) plus whole months, in UTC; the day is clamped to the end of a shorter month. */
export function addMonths(isoDate: string, months: number): Date {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, lastDay))
  return target
}

export type EvidenceBlocker = 'incomplete' | 'stale' | 'uncertified' | 'email'

export type EvidencePolicy = {
  accept: boolean
  /** An emailed confirmation may resolve a branch. Off: it stays partial. */
  acceptEmail?: boolean
  maxAgeMonths: number
  threshold: number
  /** The run's date and time (ISO). */
  now: string
}

export type EvidenceAssessment = {
  /** True only if the item may resolve the node. */
  apply: boolean
  blockers: EvidenceBlocker[]
  /** The policy does not accept client evidence as resolving. */
  policyOff: boolean
  stale: boolean
}

/**
 * Whether an item can resolve its node:
 * - certified "yes", or an override for "uncertified". A client's written confirmation is nobody's certification, so
 *   this does not apply to it, and it has no uncertified override;
 * - an emailed confirmation only if the policy accepts one;
 * - not older than maxEvidenceAgeMonths (from as_at, else the confirmation or document date), or an override for "stale"
 *   that is itself still inside maxEvidenceAgeMonths of the day it was confirmed. An uncertified override
 *   never waives age;
 * - the coverage rule passes. Nothing overrides that;
 * - the policy accepts client evidence as resolving.
 */
export function assessEvidence(item: ClientEvidenceItem, policy: EvidencePolicy): EvidenceAssessment {
  const reasons = item.override?.reasons ?? []
  const blockers: EvidenceBlocker[] = []

  const confirmation = isConfirmationKind(item.evidenceKind)
  const basis = item.asAt ?? (confirmation ? item.confirmationDate : null) ?? item.documentDate
  // Whole days: evidence from 16 Oct 2025 is still in date on 16 Oct 2026, whatever the time of day.
  const today = policy.now.slice(0, 10)
  const lastDay = (from: string) => addMonths(from, policy.maxAgeMonths).toISOString().slice(0, 10)
  const stale = basis ? today > lastDay(basis) : true
  const staleOverrideOpen = reasons.includes('stale') && today <= lastDay(item.confirmedAt)

  const listed = item.owners.map((owner) => ({ holding: owner.holding ?? undefined }))
  if (!coverage(listed, item.ownersComplete, policy.threshold, item.noOtherHolderAtOrAbove).covers) blockers.push('incomplete')
  if (stale && !staleOverrideOpen) blockers.push('stale')
  if (!confirmation && item.certified !== 'yes' && !reasons.includes('uncertified')) blockers.push('uncertified')
  if (confirmation && item.receivedAs === 'email' && policy.acceptEmail === false) blockers.push('email')

  return { apply: blockers.length === 0 && policy.accept, blockers, policyOff: !policy.accept, stale }
}

/** The share range a holding states. A holding that is not printed could be anything, so it is [0, 100]. */
export function holdingRange(owner: Pick<ClientEvidenceOwner, 'holding'>): Range {
  const holding = owner.holding
  if (!holding) return [0, 100]
  return holding.type === 'percent' ? [holding.value, holding.value] : [holding.low, holding.high]
}

/** The reason code a blocker becomes on the node. */
export const BLOCKER_CODE: Record<EvidenceBlocker, ReasonCode> = {
  incomplete: 'CLIENT_EVIDENCE_INCOMPLETE',
  stale: 'CLIENT_EVIDENCE_STALE',
  uncertified: 'CLIENT_EVIDENCE_UNCERTIFIED',
  email: 'CLIENT_EVIDENCE_EMAIL_NOT_ACCEPTED',
}
