import { describe, expect, it } from 'vitest'
import { classify, governingBand, maxRanges, multiplyRanges, parseNatures } from '../bands'

describe('parseNatures', () => {
  it.each([
    ['ownership-of-shares-25-to-50-percent', [25, 50]],
    ['ownership-of-shares-50-to-75-percent', [50, 75]],
    ['ownership-of-shares-75-to-100-percent', [75, 100]],
    ['ownership-of-shares-25-to-50-percent-as-trust', [25, 50]],
    ['ownership-of-shares-more-than-25-percent-registered-overseas-entity', [25, 100]],
  ] as const)('reads %s as shares %j', (nature, range) => {
    expect(parseNatures([nature])).toEqual({ shares: range, votes: null, control: false, majority: range[0] >= 50 })
  })

  it('keeps shares and voting rights separate', () => {
    expect(
      parseNatures(['ownership-of-shares-25-to-50-percent', 'voting-rights-75-to-100-percent']),
    ).toEqual({ shares: [25, 50], votes: [75, 100], control: false, majority: true })
  })

  it('reads overseas-entity voting rights as [25, 100]', () => {
    expect(parseNatures(['voting-rights-more-than-25-percent-registered-overseas-entity']).votes).toEqual([25, 100])
  })

  it.each([
    ['right-to-appoint-and-remove-directors', true],
    ['right-to-appoint-and-remove-directors-as-firm', true],
    ['right-to-appoint-and-remove-directors-as-trust', true],
    ['right-to-appoint-and-remove-directors-registered-overseas-entity', true],
    ['right-to-appoint-and-remove-members-limited-liability-partnership', true],
    ['right-to-appoint-and-remove-members-as-firm-limited-liability-partnership', true],
    ['right-to-appoint-and-remove-members-as-trust-limited-liability-partnership', true],
    ['significant-influence-or-control', false],
    ['significant-influence-or-control-as-firm', false],
    ['significant-influence-or-control-as-trust', false],
    ['significant-influence-or-control-registered-overseas-entity', false],
  ] as const)('treats %s as control with no band (majority: %s)', (nature, majority) => {
    expect(parseNatures([nature])).toEqual({ shares: null, votes: null, control: true, majority })
  })

  it('marks 50-to-75 and 75-to-100 bands (shares or votes) as majority, not 25-to-50', () => {
    expect(parseNatures(['voting-rights-50-to-75-percent']).majority).toBe(true)
    expect(parseNatures(['ownership-of-shares-75-to-100-percent-as-firm']).majority).toBe(true)
    expect(parseNatures(['ownership-of-shares-25-to-50-percent']).majority).toBe(false)
    expect(parseNatures(['ownership-of-shares-more-than-25-percent-registered-overseas-entity']).majority).toBe(false)
  })

  it('ignores natures it does not recognise', () => {
    expect(parseNatures(['something-new'])).toEqual({ shares: null, votes: null, control: false, majority: false })
  })
})

describe('governingBand', () => {
  it('takes the larger of shares and votes', () => {
    expect(governingBand({ shares: [25, 50], votes: [75, 100], control: false, majority: true })).toEqual([75, 100])
  })

  it('is null for control-only', () => {
    expect(governingBand({ shares: null, votes: null, control: true, majority: false })).toBeNull()
  })
})

describe('multiplyRanges', () => {
  it('multiplies bounds as percentages', () => {
    expect(multiplyRanges([75, 100], [25, 50])).toEqual([18.75, 50])
    expect(multiplyRanges([100, 100], [50, 75])).toEqual([50, 75])
  })
})

describe('maxRanges', () => {
  it('takes the element-wise maximum', () => {
    expect(maxRanges([12.5, 37.5], [25, 50])).toEqual([25, 50])
    expect(maxRanges([25, 56.25], [100, 100])).toEqual([100, 100])
  })
})

describe('classify', () => {
  it.each([
    [[25, 50], 'above'],
    [[50, 75], 'above'],
    [[6.25, 25], 'below'],
    [[0, 10], 'below'],
    [[18.75, 50], 'straddles'],
  ] as const)('%j vs 25 is %s', (range, expected) => {
    expect(classify([range[0], range[1]], 25)).toBe(expected)
  })
})
