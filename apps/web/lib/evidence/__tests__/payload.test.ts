import { describe, expect, it } from 'vitest'
import { emptyPayload, normalisePayload } from '../payload'

// Invented names only: the repository is public.
const base = {
  owners: [
    { kind: 'individual', name_as_shown: 'Testperson Alpha', holding: { type: 'percent', value: 60 }, page_ref: 'p.3 table 2' },
    {
      kind: 'entity',
      name_as_shown: 'Example Holdings AS',
      holding: { type: 'band', low: 10, high: 30 },
      registration: { number: '999 999 999', country: 'no' },
      page_ref: 'p.3 table 2',
    },
  ],
  owners_complete: true,
  as_at: '2026-06-30',
  document_date: '2026-07-15',
  certified: 'yes',
  certified_by: 'Company secretary',
}

const TODAY = '2026-10-16'

function ok(input: unknown, options = {}) {
  const result = normalisePayload(input, { today: TODAY, ...options })
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`)
  return result.payload
}
function fails(input: unknown, pattern: RegExp, options = {}) {
  const result = normalisePayload(input, { today: TODAY, ...options })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toMatch(pattern)
}

describe('normalisePayload', () => {
  it('accepts a good payload and sets the initials itself', () => {
    const payload = ok(base)
    expect(payload.owners[0]).toMatchObject({ kind: 'individual', name_as_shown: 'Testperson Alpha', initials: 'T.A.' })
    expect(payload.owners[1]).toMatchObject({ kind: 'entity', registration: { number: '999 999 999', country: 'NO' } })
    expect(payload.owners[1]).not.toHaveProperty('initials')
  })

  it('ignores initials sent by the browser or the model', () => {
    const forged = { ...base, owners: [{ ...base.owners[0], initials: 'X.Y.Z.' }] }
    expect(ok(forged).owners[0].initials).toBe('T.A.')
  })

  it('keeps the name as shown, untouched apart from trimming', () => {
    const payload = ok({ ...base, owners: [{ ...base.owners[0], name_as_shown: '  SMITH, Testperson Paul  ' }] })
    expect(payload.owners[0].name_as_shown).toBe('SMITH, Testperson Paul')
    expect(payload.owners[0].initials).toBe('T.P.S.')
  })

  it('drops personal-data keys instead of passing them on', () => {
    const withPersonalData = {
      ...base,
      owners: [{ ...base.owners[0], date_of_birth: '1970-01-01', nationality: 'NO', country_of_residence: 'NO', occupation: 'x' }],
      dob: '1970-01-01',
    }
    const text = JSON.stringify(ok(withPersonalData))
    expect(text).not.toMatch(/date_of_birth|nationality|country_of_residence|occupation|dob|1970/)
  })

  it('does not carry a registration or an LEI on an individual', () => {
    const payload = ok({
      ...base,
      owners: [{ ...base.owners[0], registration: { number: '1', country: 'NO' }, lei_shown: '529900ABCDEFGHIJKL12' }],
    })
    expect(payload.owners[0]).not.toHaveProperty('registration')
    expect(payload.owners[0]).not.toHaveProperty('lei_shown')
  })

  it('needs a page reference and a name on every owner', () => {
    fails({ ...base, owners: [{ ...base.owners[0], page_ref: '  ' }] }, /Owner 1: .*page reference/)
    fails({ ...base, owners: [base.owners[0], { ...base.owners[1], name_as_shown: '' }] }, /Owner 2: .*name as shown/)
  })

  it('checks holdings: 0 to 100, band order', () => {
    fails({ ...base, owners: [{ ...base.owners[0], holding: { type: 'percent', value: 101 } }] }, /between 0 and 100/)
    fails({ ...base, owners: [{ ...base.owners[0], holding: { type: 'percent', value: -1 } }] }, /between 0 and 100/)
    fails({ ...base, owners: [{ ...base.owners[1], holding: { type: 'band', low: 40, high: 20 } }] }, /low to be at or below high/)
    expect(ok({ ...base, owners: [{ ...base.owners[0], holding: null }] }).owners[0]).not.toHaveProperty('holding')
  })

  it('needs a two-letter country with a registration number, and an LEI of 20 characters', () => {
    fails({ ...base, owners: [{ ...base.owners[1], registration: { number: '1', country: 'NOR' } }] }, /two-letter country/)
    fails({ ...base, owners: [{ ...base.owners[1], registration: { number: ' ', country: 'NO' } }] }, /needs a number/)
    fails({ ...base, owners: [{ ...base.owners[1], lei_shown: 'SHORT' }] }, /20 letters and digits/)
  })

  it('needs certified to be yes, no or unclear', () => {
    fails({ ...base, certified: 'maybe' }, /./)
    expect(ok({ ...base, certified: 'unclear', certified_by: null }).certified).toBe('unclear')
  })

  it('refuses impossible and future dates', () => {
    fails({ ...base, as_at: '2026-02-30' }, /real dates/)
    fails({ ...base, as_at: '30/06/2026' }, /real dates/)
    fails({ ...base, document_date: '2026-10-17' }, /cannot be in the future/)
  })

  it('a confirmation needs a date to measure the age from; a proposal does not', () => {
    const undated = { ...base, as_at: null, document_date: null }
    expect(ok(undated).as_at).toBeUndefined()
    fails(undated, /age/, { forConfirm: true })
    expect(ok({ ...undated, document_date: '2026-07-15' }, { forConfirm: true }).document_date).toBe('2026-07-15')
  })

  it('an override needs a reason and a note, and an uncertified override only suits an uncertified document', () => {
    const noted = { reasons: ['uncertified'], note: 'client cannot get a certified copy in time' }
    fails({ ...base, certified: 'no', override: { reasons: ['uncertified'], note: ' ' } }, /needs a note/)
    fails({ ...base, certified: 'no', override: { reasons: [], note: 'x' } }, /needs a reason/)
    fails({ ...base, certified: 'no', override: { reasons: ['coverage'], note: 'x' } }, /./)
    fails({ ...base, certified: 'yes', override: noted }, /certified document/)
    expect(ok({ ...base, certified: 'no', certified_by: null, override: noted }).override).toEqual(noted)
    expect(ok({ ...base, override: { reasons: ['stale', 'stale'], note: 'old but the only copy' } }).override?.reasons).toEqual(['stale'])
  })

  it('needs owners_complete to be a real boolean', () => {
    fails({ ...base, owners_complete: 'yes' }, /./)
  })

  it('emptyPayload is a blank draft that is not certified', () => {
    expect(emptyPayload()).toEqual({ owners: [], owners_complete: false, certified: 'unclear' })
  })
})
