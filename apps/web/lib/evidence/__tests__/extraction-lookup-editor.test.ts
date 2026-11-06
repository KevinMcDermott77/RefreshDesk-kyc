import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { parseEvidenceResponse } from '../parse-response'
import { describeRegistrationLookup, lookupRegistrations } from '../registration-lookup'
import { blankOwner, coverageOf, toPayloadInput, toState } from '../editor-model'
import { normalisePayload } from '../payload'
import type { EvidenceOwner, EvidencePayload } from '../types'

vi.mock('@/app/dashboard/clients/[id]/evidence/actions', () => ({
  confirmEvidenceAction: async () => ({}),
  saveProposalAction: async () => ({}),
}))

const TODAY = '2026-10-16'

// Invented names only.
const good = {
  owners: [
    { kind: 'individual', name_as_shown: 'Testperson Alpha', holding: { type: 'percent', value: 60 }, page_ref: 'p.3', initials: 'Q.Q.' },
    { kind: 'entity', name_as_shown: 'Example Holdings AS', holding: { type: 'band', low: 10, high: 30 }, registration: { number: '999999999', country: 'NO' }, page_ref: 'p.3' },
  ],
  owners_complete: true,
  as_at: '2026-06-30',
  document_date: '2026-07-15',
  certified: 'yes',
  certified_by: 'Company secretary',
  confidence_score: 0.82,
  extraction_warnings: ['Page 2 is faint'],
}

describe('parseEvidenceResponse', () => {
  it('turns a reply into a proposal with server-set initials, the confidence and the model’s warnings', () => {
    const parsed = parseEvidenceResponse(`Here you go:\n${JSON.stringify(good)}`, TODAY)
    expect(parsed.confidence).toBeCloseTo(0.82)
    expect(parsed.warnings).toEqual(['Page 2 is faint'])
    expect(parsed.payload.owners[0]).toMatchObject({ name_as_shown: 'Testperson Alpha', initials: 'T.A.' })
    expect(parsed.payload.certified).toBe('yes')
  })

  it('drops a row without a page reference, with a warning, and keeps the rest', () => {
    const parsed = parseEvidenceResponse(JSON.stringify({ ...good, owners: [good.owners[0], { ...good.owners[1], page_ref: '' }] }), TODAY)
    expect(parsed.payload.owners).toHaveLength(1)
    expect(parsed.warnings.some((w) => /Row 2 was dropped/.test(w) && /page reference/.test(w))).toBe(true)
  })

  it('never accepts an override from the model', () => {
    const parsed = parseEvidenceResponse(JSON.stringify({ ...good, certified: 'no', override: { reasons: ['uncertified'], note: 'model says fine' } }), TODAY)
    expect(parsed.payload.override).toBeUndefined()
  })

  it('defaults certification to unclear unless the model says yes or no', () => {
    expect(parseEvidenceResponse(JSON.stringify({ ...good, certified: 'probably' }), TODAY).payload.certified).toBe('unclear')
    expect(parseEvidenceResponse(JSON.stringify({ ...good, certified: undefined }), TODAY).payload.certified).toBe('unclear')
  })

  it('owners_complete is false unless the model says exactly true', () => {
    expect(parseEvidenceResponse(JSON.stringify({ ...good, owners_complete: 'yes' }), TODAY).payload.owners_complete).toBe(false)
  })

  it('keeps the owners but drops unusable dates, and says so', () => {
    const parsed = parseEvidenceResponse(JSON.stringify({ ...good, as_at: '31 June 2026', document_date: '2027-01-01' }), TODAY)
    expect(parsed.payload.owners).toHaveLength(2)
    expect(parsed.payload.as_at).toBeUndefined()
    expect(parsed.payload.document_date).toBeUndefined()
    expect(parsed.warnings.some((w) => /dates were not usable/.test(w))).toBe(true)
  })

  it('does not carry personal-data fields the model volunteers', () => {
    const noisy = { ...good, owners: [{ ...good.owners[0], date_of_birth: '1970-01-01', nationality: 'NO', address: '1 Test Street' }] }
    expect(JSON.stringify(parseEvidenceResponse(JSON.stringify(noisy), TODAY).payload)).not.toMatch(/1970|nationality|Test Street/)
  })

  it('reads a registration only where it is printed, and puts none on an individual', () => {
    const parsed = parseEvidenceResponse(JSON.stringify({ ...good, owners: [{ ...good.owners[0], registration: { number: '1', country: 'NO' } }, good.owners[1]] }), TODAY)
    expect(parsed.payload.owners[0]).not.toHaveProperty('registration')
    expect(parsed.payload.owners[1].registration).toEqual({ number: '999999999', country: 'NO' })
  })

  it('throws on a reply that is not JSON', () => {
    expect(() => parseEvidenceResponse('I could not read the document', TODAY)).toThrow(/valid JSON/)
    expect(() => parseEvidenceResponse('{ broken', TODAY)).toThrow()
  })
})

describe('registration lookup (display only)', () => {
  const entity = (number: string, country: string, name = 'Example Holdings AS'): EvidenceOwner => ({
    kind: 'entity',
    name_as_shown: name,
    registration: { number, country },
    page_ref: 'p.3',
  })

  it('asks GLEIF only for a printed number and country, never for a name', async () => {
    const findByRegistration = vi.fn(async () => [{ lei: '529900ABCDEFGHIJKL12', legalName: 'EXAMPLE HOLDINGS AS' }] as never)
    const rows = await lookupRegistrations([entity('999999999', 'NO')], { findByRegistration })
    expect(findByRegistration).toHaveBeenCalledTimes(1)
    expect(findByRegistration).toHaveBeenCalledWith('999999999', 'NO')
    expect(rows[0].text).toContain('exactly one record')
    expect(rows[0].text).toContain('This does not link anything')
  })

  it('skips individuals and entities with no printed registration, so a name is never searched', async () => {
    const findByRegistration = vi.fn(async () => [])
    const owners: EvidenceOwner[] = [
      { kind: 'individual', name_as_shown: 'Testperson Alpha', initials: 'T.A.', page_ref: 'p.1' },
      { kind: 'entity', name_as_shown: 'Nameonly Holdings AS', page_ref: 'p.1' },
    ]
    expect(await lookupRegistrations(owners, { findByRegistration })).toEqual([])
    expect(findByRegistration).not.toHaveBeenCalled()
  })

  it('says nothing is matched for zero or several records, and notes a source that is down', async () => {
    expect(describeRegistrationLookup(0)).toContain('Nothing is matched')
    expect(describeRegistrationLookup(2)).toContain('2 records')
    const down = await lookupRegistrations([entity('1', 'NO')], {
      findByRegistration: async () => {
        throw new Error('GLEIF down')
      },
    })
    expect(down[0].text).toContain('could not be reached')
  })

  it('keeps the row numbers of the owners and stops at the limit', async () => {
    const findByRegistration = vi.fn(async () => [])
    const owners = [entity('1', 'NO'), { kind: 'individual' as const, name_as_shown: 'Testperson Alpha', page_ref: 'p.1' }, entity('3', 'SE'), entity('4', 'DK')]
    const rows = await lookupRegistrations(owners, { findByRegistration }, 2)
    expect(rows.map((r) => r.row)).toEqual([1, 3])
  })
})

describe('editor model', () => {
  const payload = (): EvidencePayload => {
    const result = normalisePayload(good, { today: TODAY })
    if (!result.ok) throw new Error(result.error)
    return result.payload
  }

  it('a payload survives the round trip through the form state unchanged', () => {
    const original = payload()
    const back = normalisePayload(toPayloadInput(toState(original), false), { today: TODAY })
    expect(back).toEqual({ ok: true, payload: original })
  })

  it('empty fields are left out and an override is only sent when asked and given a reason', () => {
    const state = { ...toState(payload()), stale: true, overrideNote: 'old but the only copy' }
    expect(toPayloadInput(state, false).override).toBeNull()
    expect(toPayloadInput(state, true).override).toEqual({ reasons: ['stale'], note: 'old but the only copy' })
    expect(toPayloadInput({ ...state, stale: false }, true).override).toBeNull()
  })

  it('a half-typed number is refused by the server schema rather than turned into 0', () => {
    const state = toState(payload())
    state.owners[0].value = '6o'
    const result = normalisePayload(toPayloadInput(state, false), { today: TODAY })
    expect(result.ok).toBe(false)
  })

  it('coverage follows what is typed, using the low end of a band', () => {
    const state = toState(payload())
    expect(coverageOf(state)).toMatchObject({ unaccountedUpTo: 30, covers: false })
    state.owners[1].low = '15'
    expect(coverageOf(state)).toMatchObject({ unaccountedUpTo: 25, covers: false })
    state.owners[1].low = '16'
    expect(coverageOf(state)).toMatchObject({ unaccountedUpTo: 24, covers: true })
    state.ownersComplete = false
    expect(coverageOf(state).covers).toBe(false)
  })

  it('a blank owner starts as an individual percentage row with nothing filled in', () => {
    expect(blankOwner()).toMatchObject({ kind: 'individual', holdingType: 'percent', name: '', pageRef: '' })
  })
})

describe('EvidenceEditor', async () => {
  const { EvidenceEditor } = await import('@/app/dashboard/clients/[id]/evidence/[evidenceId]/evidence-editor')
  const disabled = (html: string) => /<button[^>]*type="submit"[^>]*\sdisabled(=|\s|>)/.test(html) || /<button[^>]*\sdisabled(=|\s|>)[^>]*type="submit"/.test(html)

  const render = (props: Partial<Parameters<typeof EvidenceEditor>[0]>) =>
    renderToStaticMarkup(
      createElement(EvidenceEditor, {
        mode: 'confirm',
        evidenceId: 'e',
        clientId: 'c',
        initial: (() => {
          const r = normalisePayload(good, { today: TODAY })
          if (!r.ok) throw new Error(r.error)
          return r.payload
        })(),
        canSubmit: true,
        ...props,
      }),
    )

  it('shows the owners as typed, the override section only to a confirmer, and an enabled button', () => {
    const html = render({})
    expect(html).toContain('Testperson Alpha')
    expect(html).toContain('Accept despite a problem')
    expect(html).toContain('Confirm evidence')
    expect(disabled(html)).toBe(false)
  })

  it('the uploader’s editor has no override section', () => {
    const html = render({ mode: 'propose' })
    expect(html).not.toContain('Accept despite a problem')
    expect(html).toContain('Save owners for confirmation')
  })

  it('is disabled with the reason shown when the viewer may not confirm', () => {
    const html = render({ canSubmit: false, reason: 'Four-eyes rule: the person who uploaded this evidence cannot confirm it. Ask another admin to confirm it.' })
    expect(disabled(html)).toBe(true)
    expect(html).toContain('Four-eyes rule')
  })

  it('says coverage cannot be overridden when the list leaves room for an unlisted holder', () => {
    const html = render({})
    expect(html).toContain('Coverage: not enough to resolve the company')
    expect(html).toContain('a reviewer cannot override it')
  })
})
