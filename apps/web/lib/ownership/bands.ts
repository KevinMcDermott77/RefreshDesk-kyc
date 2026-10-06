import type { Range } from './types'

export type ParsedNatures = {
  shares: Range | null
  votes: Range | null
  control: boolean
  /** Holder controls the intermediate: a band of more than 50%, or the right to appoint directors or LLP members. */
  majority: boolean
}

const BANDED = /^(ownership-of-shares|voting-rights)-(25|50|75)-to-(50|75|100)-percent/
const OVERSEAS_ENTITY = /^(ownership-of-shares|voting-rights)-more-than-25-percent/
const CONTROL = /^(right-to-appoint-and-remove-|significant-influence-or-control)/
const APPOINT_DIRECTORS_OR_MEMBERS = /^right-to-appoint-and-remove-(directors|members)/

function widest(a: Range | null, b: Range): Range {
  if (!a) return b
  return [Math.max(a[0], b[0]), Math.max(a[1], b[1])]
}

/**
 * Parses Companies House natures_of_control into share and voting bands.
 * Band bounds follow CH wording: "25-to-50" means more than 25%, up to 50%.
 * Natures that grant control without a band set `control` only.
 */
export function parseNatures(natures: string[]): ParsedNatures {
  const parsed: ParsedNatures = { shares: null, votes: null, control: false, majority: false }

  for (const nature of natures) {
    const banded = nature.match(BANDED)
    const overseas = banded ? null : nature.match(OVERSEAS_ENTITY)
    const match = banded ?? overseas
    if (match) {
      const range: Range = banded ? [Number(banded[2]), Number(banded[3])] : [25, 100]
      if (match[1] === 'ownership-of-shares') parsed.shares = widest(parsed.shares, range)
      else parsed.votes = widest(parsed.votes, range)
      continue
    }
    if (CONTROL.test(nature)) parsed.control = true
    if (APPOINT_DIRECTORS_OR_MEMBERS.test(nature)) parsed.majority = true
  }

  if ((parsed.shares?.[0] ?? 0) >= 50 || (parsed.votes?.[0] ?? 0) >= 50) parsed.majority = true
  return parsed
}

/** The band that counts towards the threshold: the larger of shares and votes. */
export function governingBand(parsed: ParsedNatures): Range | null {
  if (!parsed.shares) return parsed.votes
  if (!parsed.votes) return parsed.shares
  return widest(parsed.shares, parsed.votes)
}

export function multiplyRanges([a, b]: Range, [c, d]: Range): Range {
  return [(a * c) / 100, (b * d) / 100]
}

/** Element-wise maximum: the interest if whichever method gives more applies. */
export function maxRanges([a, b]: Range, [c, d]: Range): Range {
  return [Math.max(a, c), Math.max(b, d)]
}

export function classify([lo, hi]: Range, threshold: number): 'above' | 'below' | 'straddles' {
  if (lo >= threshold) return 'above'
  if (hi <= threshold) return 'below'
  return 'straddles'
}
