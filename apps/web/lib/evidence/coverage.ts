import type { EvidenceOwner } from './types'

export const DEFAULT_THRESHOLD = 25

/** The smallest share a holding can be: the percentage, or the low end of a band. Nothing printed counts as 0. */
export function lowerBound(owner: Pick<EvidenceOwner, 'holding'>): number {
  const holding = owner.holding
  if (!holding) return 0
  return holding.type === 'percent' ? holding.value : holding.low
}

export type Coverage = {
  /** The most that holders not on the list could own: 100 minus the listed holders' lower bounds. */
  unaccountedUpTo: number
  /**
   * Whether the list rules out an unlisted holder at or above the threshold, which is what lets
   * a node resolve. A document that does not say it is complete never passes.
   */
  covers: boolean
  reason?: string
}

/**
 * The coverage rule (docs/slice7-client-evidence.md): if what the listed holders leave is still at
 * or above the threshold, an unlisted holder could be a beneficial owner, so the evidence does not
 * resolve the node. It cannot be overridden by a reviewer.
 */
export function coverage(
  owners: Pick<EvidenceOwner, 'holding'>[],
  ownersComplete: boolean,
  threshold = DEFAULT_THRESHOLD,
  /** The document states that no other person holds this percentage or more. */
  noOtherAtOrAbove?: number | null,
): Coverage {
  const listed = owners.reduce((sum, owner) => sum + lowerBound(owner), 0)
  const unaccountedUpTo = Math.max(0, Math.round((100 - listed) * 1e6) / 1e6)

  // "No other person holds X% or more", with X at or below the threshold, is the same assurance as a full list:
  // any holder not named holds less than X, so less than the threshold.
  if (typeof noOtherAtOrAbove === 'number' && noOtherAtOrAbove <= threshold) {
    return { unaccountedUpTo: Math.min(unaccountedUpTo, noOtherAtOrAbove), covers: true }
  }

  if (!ownersComplete) {
    return { unaccountedUpTo, covers: false, reason: 'The document does not say it lists every holder' }
  }
  if (unaccountedUpTo >= threshold) {
    return {
      unaccountedUpTo,
      covers: false,
      reason: `The listed holders leave up to ${unaccountedUpTo}% unaccounted for, which is at or above the ${threshold}% threshold`,
    }
  }
  return { unaccountedUpTo, covers: true }
}
