import { describe, expect, it } from 'vitest'
import { coverage, lowerBound } from '../coverage'
import { parseNodeIdentity } from '../node'

describe('parseNodeIdentity', () => {
  it('accepts an LEI on its own', () => {
    expect(parseNodeIdentity({ lei: '529900abcdefghijkl12' })).toEqual({
      ok: true,
      identity: { lei: '529900ABCDEFGHIJKL12' },
      key: 'LEI:529900ABCDEFGHIJKL12',
    })
  })

  it('accepts a registration number with its country, and builds the key from the normalised number', () => {
    expect(parseNodeIdentity({ country: 'no', registrationNumber: '999 999-999' })).toEqual({
      ok: true,
      identity: { country: 'NO', registration_number: '999 999-999' },
      key: 'REG:NO:999999999',
    })
  })

  it('keeps both when both are given, and the LEI decides the key', () => {
    const result = parseNodeIdentity({ lei: '529900ABCDEFGHIJKL12', country: 'NO', registrationNumber: '123' })
    expect(result).toMatchObject({ ok: true, key: 'LEI:529900ABCDEFGHIJKL12', identity: { lei: '529900ABCDEFGHIJKL12', country: 'NO', registration_number: '123' } })
  })

  it('refuses a name alone, a number without a country, and a country without a number', () => {
    expect(parseNodeIdentity({})).toMatchObject({ ok: false, error: expect.stringContaining('A name alone cannot identify') })
    expect(parseNodeIdentity({ registrationNumber: '123' })).toMatchObject({ ok: false })
    expect(parseNodeIdentity({ country: 'NO' })).toMatchObject({ ok: false })
  })

  it('refuses a malformed LEI or country', () => {
    expect(parseNodeIdentity({ lei: 'SHORT' })).toMatchObject({ ok: false, error: expect.stringContaining('20 letters') })
    expect(parseNodeIdentity({ country: 'NOR', registrationNumber: '1' })).toMatchObject({ ok: false, error: expect.stringContaining('two-letter') })
  })
})

describe('coverage rule', () => {
  const pct = (value: number) => ({ holding: { type: 'percent' as const, value } })
  const band = (low: number, high: number) => ({ holding: { type: 'band' as const, low, high } })

  it('uses the lower end of a band, and 0 for a holding that is not printed', () => {
    expect(lowerBound(pct(60))).toBe(60)
    expect(lowerBound(band(10, 30))).toBe(10)
    expect(lowerBound({})).toBe(0)
  })

  it('covers when what is left is below the threshold', () => {
    expect(coverage([pct(60), pct(20)], true)).toEqual({ unaccountedUpTo: 20, covers: true })
    expect(coverage([pct(76)], true)).toMatchObject({ unaccountedUpTo: 24, covers: true })
  })

  it('does not cover at exactly the threshold: an unlisted 25% holder would be a beneficial owner', () => {
    const result = coverage([pct(75)], true)
    expect(result).toMatchObject({ unaccountedUpTo: 25, covers: false })
    expect(result.reason).toMatch(/at or above the 25% threshold/)
  })

  it('counts a band at its low end, so a band can leave room for an unlisted holder', () => {
    expect(coverage([band(40, 60), band(10, 30)], true)).toMatchObject({ unaccountedUpTo: 50, covers: false })
  })

  it('never covers a document that does not say it lists every holder', () => {
    const result = coverage([pct(100)], false)
    expect(result).toMatchObject({ covers: false, reason: 'The document does not say it lists every holder' })
  })

  it('treats missing holdings as 0 and follows a different threshold', () => {
    expect(coverage([{}, {}], true)).toMatchObject({ unaccountedUpTo: 100, covers: false })
    expect(coverage([pct(85)], true, 10)).toMatchObject({ unaccountedUpTo: 15, covers: false })
    expect(coverage([pct(95)], true, 10)).toMatchObject({ unaccountedUpTo: 5, covers: true })
  })

  it('does not go below 0 when holdings add to more than 100', () => {
    expect(coverage([pct(80), pct(80)], true)).toMatchObject({ unaccountedUpTo: 0, covers: true })
  })
})
