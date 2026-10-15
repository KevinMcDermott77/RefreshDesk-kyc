import { createElement } from 'react'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PackReport, type PackMeta } from '@/app/dashboard/packs/_components/PackReport'
import { DEMO_COMPANY_NAME, DEMO_SUBJECT, demoFetcher } from '@/lib/demo/fjordvik'
import { snapshotFingerprint } from '@/lib/packs/canonical'
import { buildSnapshot, parseSnapshot } from '@/lib/packs/snapshot'
import { REASON_TEXT, REQUEST_CONFIRMATION } from '@/lib/ownership/reason-text'
import { summarise, toFlow } from '@/lib/ownership/to-flow'
import type { ClientEvidenceItem } from '@/lib/ownership/types'
import { walk } from '@/lib/ownership/walk'
import { assessEvidence, BLOCKER_CODE } from '../apply'
import { coverage } from '../coverage'
import { coverageOf, toPayloadInput, toState } from '../editor-model'
import { parseEvidenceUploadInput } from '../input'
import { toClientEvidenceItems } from '../load'
import { parseEvidenceResponse } from '../parse-response'
import { normalisePayload } from '../payload'
import { CONFIRMATION_KINDS, EVIDENCE_KINDS, isConfirmationKind, OFFERED_EVIDENCE_KINDS } from '../types'

// Invented data only. Signatories' names never appear: only their capacity.
const NOW = '2026-10-16T12:00:00.000Z'
const TODAY = '2026-10-16'

const letter = (over: Partial<ClientEvidenceItem> = {}): ClientEvidenceItem => ({
  id: 'ev-letter',
  nodeIdentity: { country: 'NO', registrationNumber: '999 000 001' },
  evidenceKind: 'client_ownership_confirmation',
  asAt: '2026-06-30',
  documentDate: '2026-07-16',
  certified: 'unclear',
  certifierCapacity: null,
  certificationDate: null,
  confirmedByCapacity: 'director',
  confirmationDate: '2026-07-16',
  receivedAs: 'signed_letter',
  noOtherHolderAtOrAbove: 25,
  confirmedBy: 'admin-1',
  confirmedAt: '2026-10-15T09:00:00.000Z',
  edited: false,
  documentSha256: 'd'.repeat(64),
  ownersComplete: false,
  override: null,
  owners: [
    { kind: 'individual', label: 'Ø.Å.T.', holding: { type: 'percent', value: 45 }, registration: null, leiShown: null, pageRef: 'para 2' },
    { kind: 'entity', label: 'Nordlys Invest Test AS', holding: { type: 'percent', value: 20 }, registration: { number: '999 000 002', country: 'NO' }, leiShown: null, pageRef: 'para 2' },
    { kind: 'individual', label: 'K.E.', holding: { type: 'percent', value: 20 }, registration: null, leiShown: null, pageRef: 'para 2' },
    { kind: 'individual', label: 'B.P.', holding: { type: 'percent', value: 10 }, registration: null, leiShown: null, pageRef: 'para 2' },
    { kind: 'individual', label: 'M.S.', holding: { type: 'percent', value: 5 }, registration: null, leiShown: null, pageRef: 'para 2' },
  ],
  ...over,
})

const policy = { accept: true, maxAgeMonths: 12, threshold: 25, now: NOW }

describe('evidence kinds', () => {
  it('a client’s written confirmation is the first thing offered; the older signed-chart kind is folded into it', () => {
    expect(OFFERED_EVIDENCE_KINDS[0]).toBe('client_ownership_confirmation')
    expect(OFFERED_EVIDENCE_KINDS).toEqual(['client_ownership_confirmation', 'shareholder_register', 'register_extract', 'annual_report_page'])
    expect(EVIDENCE_KINDS).toContain('signed_structure_chart')
    expect(CONFIRMATION_KINDS).toEqual(['client_ownership_confirmation', 'signed_structure_chart'])
    expect(isConfirmationKind('client_ownership_confirmation')).toBe(true)
    expect(isConfirmationKind('signed_structure_chart')).toBe(true)
    expect(isConfirmationKind('shareholder_register')).toBe(false)
    expect(isConfirmationKind(undefined)).toBe(false)
  })

  it('the upload step accepts the new kind', () => {
    const form = new FormData()
    const fields: Record<string, string> = {
      client_id: '3f2c1d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
      subject_id: 'DEMO-FJORDVIK',
      node_name: 'Fjordvik Test Holding AS',
      country: 'NO',
      registration_number: '999 000 001',
      evidence_kind: 'client_ownership_confirmation',
      upload_path: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d/3f2c1d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f/11111111-2222-4333-8444-555555555555/l.pdf',
      upload_name: 'l.pdf',
      upload_type: 'application/pdf',
      upload_size: '1000',
    }
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    expect(parseEvidenceUploadInput(form)).toMatchObject({ ok: true, input: { kind: 'client_ownership_confirmation' } })
  })
})

describe('"no other person holds X% or more"', () => {
  const pct = (value: number) => ({ holding: { type: 'percent' as const, value } })

  it('completes the picture when X is at or below the threshold, with or without a full list', () => {
    expect(coverage([pct(45)], false, 25, 25)).toMatchObject({ covers: true })
    expect(coverage([], false, 25, 10)).toMatchObject({ covers: true, unaccountedUpTo: 10 })
    expect(coverage([pct(45)], true, 25, 25).covers).toBe(true)
  })

  it('does not help when X is above the threshold: someone holding between the two could still be an owner', () => {
    const result = coverage([pct(45)], false, 25, 30)
    expect(result.covers).toBe(false)
    expect(result.reason).toBe('The document does not say it lists every holder')
    expect(coverage([pct(45)], true, 25, 30).covers).toBe(false)
  })

  it('without the statement the old rules are unchanged', () => {
    expect(coverage([pct(45)], false, 25, null).covers).toBe(false)
    expect(coverage([pct(45)], false, 25, undefined).covers).toBe(false)
    expect(coverage([pct(80)], true, 25, null).covers).toBe(true)
  })

  it('follows a different policy threshold', () => {
    expect(coverage([], false, 10, 10).covers).toBe(true)
    expect(coverage([], false, 10, 25).covers).toBe(false)
  })
})

describe('normalising a confirmation', () => {
  const base = {
    owners: [{ kind: 'individual', name_as_shown: 'Testperson Alpha', holding: { type: 'percent', value: 100 }, page_ref: 'para 2' }],
    owners_complete: false,
    no_other_holder_at_or_above: 25,
    confirmation_date: '2026-07-16',
    confirmed_by_capacity: 'director',
    received_as: 'signed_letter',
    certified: 'yes',
    certified_by: 'Some Person, Notary',
    certifier_capacity: 'notary',
    certification_date: '2026-07-01',
  }
  const ok = (input: unknown, options = {}) => {
    const r = normalisePayload(input, { today: TODAY, kind: 'client_ownership_confirmation', ...options })
    if (!r.ok) throw new Error(r.error)
    return r.payload
  }

  it('has no certification at all, and keeps who confirmed it (by capacity), when and how', () => {
    const payload = ok(base)
    expect(payload).toMatchObject({ certified: 'unclear', confirmed_by_capacity: 'director', received_as: 'signed_letter', confirmation_date: '2026-07-16', no_other_holder_at_or_above: 25 })
    for (const key of ['certified_by', 'certifier_capacity', 'certification_date']) expect(payload).not.toHaveProperty(key)
    expect(JSON.stringify(payload)).not.toContain('Some Person')
  })

  it('says "unclear" and "other" rather than assuming a capacity or a channel', () => {
    const { confirmed_by_capacity: _c, received_as: _r, ...bare } = base
    expect(ok(bare)).toMatchObject({ confirmed_by_capacity: 'unclear', received_as: 'other' })
  })

  it('has no uncertified override, but a stale one is fine', () => {
    const uncertified = normalisePayload({ ...base, override: { reasons: ['uncertified'], note: 'x' } }, { today: TODAY, kind: 'client_ownership_confirmation' })
    expect(uncertified).toMatchObject({ ok: false, error: expect.stringContaining('no uncertified override') })
    expect(ok({ ...base, override: { reasons: ['stale'], note: 'only copy' } }).override).toEqual({ reasons: ['stale'], note: 'only copy' })
  })

  it('measures age from the confirmation date when there is no as-at date, and needs one of them to confirm', () => {
    const { as_at: _a, ...rest } = { ...base, as_at: undefined } as Record<string, unknown>
    expect(ok(rest, { forConfirm: true }).confirmation_date).toBe('2026-07-16')
    const noDates = normalisePayload({ ...base, confirmation_date: null }, { today: TODAY, kind: 'client_ownership_confirmation', forConfirm: true })
    expect(noDates).toMatchObject({ ok: false, error: expect.stringContaining('date of the confirmation') })
  })

  it('refuses a confirmation date in the future and a nonsense "no other holder" percentage', () => {
    expect(normalisePayload({ ...base, confirmation_date: '2026-10-17' }, { today: TODAY, kind: 'client_ownership_confirmation' })).toMatchObject({ ok: false })
    expect(normalisePayload({ ...base, no_other_holder_at_or_above: 150 }, { today: TODAY, kind: 'client_ownership_confirmation' })).toMatchObject({ ok: false })
  })

  it('another kind keeps its certification and drops the confirmation fields', () => {
    const payload = ok(base, { kind: 'shareholder_register' })
    expect(payload).toMatchObject({ certified: 'yes', certifier_capacity: 'notary', certification_date: '2026-07-01' })
    for (const key of ['confirmed_by_capacity', 'received_as', 'confirmation_date']) expect(payload).not.toHaveProperty(key)
    // The statement may be on any document.
    expect(payload.no_other_holder_at_or_above).toBe(25)
  })

  it('the database check accepts these keys: none is a personal-data key', () => {
    const forbidden = /"(date_of_birth|dateofbirth|dob|nationality|country_of_residence|countryofresidence|occupation)"\s*:/i
    expect(forbidden.test(JSON.stringify(ok(base)))).toBe(false)
  })
})

describe('using a confirmation', () => {
  it('needs no certification: an uncertified-looking confirmation is not blocked for it', () => {
    expect(assessEvidence(letter(), policy)).toMatchObject({ apply: true, blockers: [] })
    expect(assessEvidence(letter({ certified: 'no' }), policy).blockers).toEqual([])
  })

  it('a register still needs certification, as before', () => {
    const register = letter({ evidenceKind: 'shareholder_register', certified: 'unclear', confirmedByCapacity: null, receivedAs: null })
    expect(assessEvidence(register, policy).blockers).toEqual(['uncertified'])
  })

  it('the age rule still applies, measured from the confirmation date when nothing else is dated', () => {
    expect(assessEvidence(letter({ asAt: null, documentDate: null, confirmationDate: '2025-10-16' }), policy).apply).toBe(true)
    expect(assessEvidence(letter({ asAt: null, documentDate: null, confirmationDate: '2025-10-15' }), policy).blockers).toEqual(['stale'])
    expect(assessEvidence(letter({ asAt: '2024-01-01' }), policy).blockers).toEqual(['stale'])
  })

  it('an emailed confirmation stays partial when the policy does not accept email, and a signed letter or chart does not', () => {
    const emailed = letter({ receivedAs: 'email' })
    expect(assessEvidence(emailed, { ...policy, acceptEmail: false })).toMatchObject({ apply: false, blockers: ['email'] })
    expect(BLOCKER_CODE.email).toBe('CLIENT_EVIDENCE_EMAIL_NOT_ACCEPTED')
    expect(assessEvidence(emailed, { ...policy, acceptEmail: true }).apply).toBe(true)
    // The default accepts email.
    expect(assessEvidence(emailed, policy).apply).toBe(true)
    for (const receivedAs of ['signed_letter', 'signed_chart', 'other'] as const) {
      expect(assessEvidence(letter({ receivedAs }), { ...policy, acceptEmail: false }).apply).toBe(true)
    }
  })

  it('the "no other holder" statement is what makes an incomplete list enough', () => {
    expect(assessEvidence(letter({ noOtherHolderAtOrAbove: null }), policy).blockers).toEqual(['incomplete'])
    expect(assessEvidence(letter({ noOtherHolderAtOrAbove: 30 }), policy).blockers).toEqual(['incomplete'])
    expect(assessEvidence(letter({ owners: [letter().owners[0]] }), policy).apply).toBe(true)
  })
})

describe('in the sample walk', () => {
  const run = (item: ClientEvidenceItem, extra = {}) => walk(DEMO_SUBJECT, { ...demoFetcher(NOW), clientEvidence: async () => [item] }, { now: NOW, ...extra })

  it('the letter resolves the walk on client evidence; the 20% company is pruned', async () => {
    const result = await run(letter())
    expect(result.status).toBe('resolved_client_evidence')
    expect(result.nodes.find((n) => n.name === 'Nordlys Invest Test AS')).toMatchObject({ resolution: 'PRUNED' })
    const stop = result.nodes.find((n) => n.clientEvidence)!
    expect(stop.clientEvidence).toMatchObject({ applied: true, confirmedByCapacity: 'director', confirmationDate: '2026-07-16', receivedAs: 'signed_letter' })
    expect(stop.clientEvidence).not.toHaveProperty('certified')
    expect(JSON.stringify(result)).not.toMatch(/Sample Signatory|Øystein|Eksempel/)
  })

  it('an emailed confirmation under a policy that does not accept email stays partial, with its own reason', async () => {
    const result = await run(letter({ receivedAs: 'email' }), { acceptEmailConfirmation: false })
    const stop = result.nodes.find((n) => n.clientEvidence)!
    expect(result.status).toBe('unresolved')
    expect(stop).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'CLIENT_EVIDENCE_EMAIL_NOT_ACCEPTED' })
    expect(stop.secondaryReasons).toContain('SHAREHOLDERS_NOT_FILED')
    expect(stop.clientEvidence).toMatchObject({ applied: false, notApplied: ['email'], receivedAs: 'email' })
    expect(REASON_TEXT.CLIENT_EVIDENCE_EMAIL_NOT_ACCEPTED).toContain('signed letter')
  })

  it('the summary and the pack carry capacity, date and channel, no certification, and no name', async () => {
    const result = await run(letter())
    const summary = summarise(result)
    expect(summary.clientEvidence[0]).toMatchObject({ confirmedByCapacity: 'director', confirmationDate: '2026-07-16', receivedAs: 'signed_letter' })
    expect(summary.clientEvidence[0]).not.toHaveProperty('certified')

    const snapshot = buildSnapshot({
      subject: { id: DEMO_SUBJECT, kind: 'company', name: DEMO_COMPANY_NAME },
      policy: { threshold: 25, maxDepth: 6, indirectMethod: 'either', acceptRegulatedAsTerminal: true, acceptClientEvidenceAsResolved: true, acceptEmailConfirmation: false, maxEvidenceAgeMonths: 12 },
      walked: result,
      profile: [],
      flow: toFlow(result),
      summary,
      sourceLog: [],
      sample: true,
      individualNames: ['Øystein Åsmund Testersen', 'Sample Signatory'],
      now: new Date(NOW),
    })
    expect(snapshot.clientEvidence?.[0]).toMatchObject({ kind: 'client_ownership_confirmation', confirmedByCapacity: 'director', confirmationDate: '2026-07-16', receivedAs: 'signed_letter', overrideExists: false })
    expect(snapshot.clientEvidence?.[0]).not.toHaveProperty('certified')
    expect(() => parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).not.toThrow()
    expect(JSON.stringify(snapshot)).not.toMatch(/Sample Signatory|Øystein/)

    const fingerprint = await snapshotFingerprint(snapshot)
    const meta: PackMeta = { id: 'p', status: 'draft', fingerprint, verified: true, recomputed: fingerprint, createdByName: 'x', createdAt: NOW, submittedAt: null, reviewedByName: null, reviewedAt: null, reviewNote: null }
    const html = renderToStaticMarkup(createElement(PackReport, { snapshot, meta }))
    expect(html).toContain('written confirmation from the client (signed letter), by a director, 2026-07-16; no certification applies')
    expect(html).toContain('emailed confirmations not accepted')
    expect(html).not.toContain('certification unclear')
  })
})

describe('the loader', () => {
  it('reads the confirmation fields and the statement, and never a signatory’s name', () => {
    const [item] = toClientEvidenceItems([
      {
        id: 'e',
        node_identity: { country: 'NO', registration_number: '1' },
        evidence_kind: 'client_ownership_confirmation',
        as_at: '2026-06-30',
        certified: 'unclear',
        confirmed_by: 'admin-1',
        confirmed_at: '2026-10-15T09:00:00Z',
        document_sha256: 'a'.repeat(64),
        payload: {
          owners: [],
          owners_complete: false,
          confirmed_by_capacity: 'company_secretary',
          confirmation_date: '2026-07-16',
          received_as: 'email',
          no_other_holder_at_or_above: 25,
          certified_by: 'Some Person',
        },
      },
    ])
    expect(item).toMatchObject({ confirmedByCapacity: 'company_secretary', confirmationDate: '2026-07-16', receivedAs: 'email', noOtherHolderAtOrAbove: 25 })
    expect(JSON.stringify(item)).not.toContain('Some Person')
  })

  it('an ordinary item has none of them', () => {
    const [item] = toClientEvidenceItems([
      { id: 'e', node_identity: { lei: '529900ABCDEFGHIJKL12' }, evidence_kind: 'shareholder_register', certified: 'yes', confirmed_at: '2026-10-15T09:00:00Z', document_sha256: 'a'.repeat(64), payload: { owners: [], owners_complete: true } },
    ])
    expect(item).toMatchObject({ confirmedByCapacity: null, confirmationDate: null, receivedAs: null, noOtherHolderAtOrAbove: null })
  })
})

describe('reading a confirmation', () => {
  const reply = {
    owners: [{ kind: 'individual', name_as_shown: 'Testperson Alpha', holding: { type: 'percent', value: 100 }, page_ref: 'para 2' }],
    owners_complete: false,
    no_other_holder_at_or_above: 25,
    as_at: '2026-06-30',
    document_date: '2026-07-16',
    confirmation_date: '2026-07-16',
    confirmed_by_capacity: 'director',
    received_as: 'signed_letter',
    signed: false,
    confidence_score: 0.9,
  }

  it('keeps the statement, the capacity, the date and the channel', () => {
    const { payload } = parseEvidenceResponse(JSON.stringify(reply), TODAY, 'client_ownership_confirmation')
    expect(payload).toMatchObject({ confirmed_by_capacity: 'director', received_as: 'signed_letter', confirmation_date: '2026-07-16', no_other_holder_at_or_above: 25, certified: 'unclear' })
  })

  it('an unreadable confirmation date costs the date, not the owners', () => {
    const { payload, warnings } = parseEvidenceResponse(JSON.stringify({ ...reply, confirmation_date: 'sixteenth of July' }), TODAY, 'client_ownership_confirmation')
    expect(payload.owners).toHaveLength(1)
    expect(payload.confirmation_date).toBeUndefined()
    expect(warnings.some((w) => /dates were not usable/.test(w))).toBe(true)
  })

  it('ignores a "no other holder" value that is not a number', () => {
    const { payload } = parseEvidenceResponse(JSON.stringify({ ...reply, no_other_holder_at_or_above: '25%' }), TODAY, 'client_ownership_confirmation')
    expect(payload.no_other_holder_at_or_above).toBeUndefined()
  })

  it('never takes a certification from a confirmation, even if the model offers one', () => {
    const { payload } = parseEvidenceResponse(JSON.stringify({ ...reply, certified: 'yes', certified_by: 'Some Person', certifier_capacity: 'notary' }), TODAY, 'client_ownership_confirmation')
    expect(payload.certified).toBe('unclear')
    expect(payload).not.toHaveProperty('certified_by')
    expect(payload).not.toHaveProperty('certifier_capacity')
  })
})

describe('the editor', () => {
  const payload = () => {
    const r = normalisePayload(
      {
        owners: [{ kind: 'individual', name_as_shown: 'Testperson Alpha', holding: { type: 'percent', value: 45 }, page_ref: 'para 2' }],
        owners_complete: false,
        no_other_holder_at_or_above: 25,
        confirmation_date: '2026-07-16',
        confirmed_by_capacity: 'director',
        received_as: 'email',
      },
      { today: TODAY, kind: 'client_ownership_confirmation' },
    )
    if (!r.ok) throw new Error(r.error)
    return r.payload
  }

  it('round-trips a confirmation, and sends no certification or uncertified override', () => {
    const original = payload()
    const input = toPayloadInput({ ...toState(original), uncertifiedOverride: true, stale: true, overrideNote: 'old' }, true, 'client_ownership_confirmation')
    expect(input).toMatchObject({ confirmed_by_capacity: 'director', received_as: 'email', confirmation_date: '2026-07-16', no_other_holder_at_or_above: 25, override: { reasons: ['stale'] } })
    expect(input).not.toHaveProperty('certifier_capacity')
    const back = normalisePayload(toPayloadInput(toState(original), false, 'client_ownership_confirmation'), { today: TODAY, kind: 'client_ownership_confirmation' })
    expect(back).toEqual({ ok: true, payload: original })
  })

  it('the live coverage uses the statement', () => {
    const state = toState(payload())
    expect(coverageOf(state)).toMatchObject({ covers: true })
    state.noOtherHolder = ''
    expect(coverageOf(state).covers).toBe(false)
    state.noOtherHolder = '30'
    expect(coverageOf(state).covers).toBe(false)
  })

  it('shows the confirmer fields, not the certification ones, for a confirmation', async () => {
    vi.doMock('@/app/dashboard/clients/[id]/evidence/actions', () => ({ confirmEvidenceAction: async () => ({}), saveProposalAction: async () => ({}) }))
    const { EvidenceEditor } = await import('@/app/dashboard/clients/[id]/evidence/[evidenceId]/evidence-editor')
    const html = (kind: string) =>
      renderToStaticMarkup(createElement(EvidenceEditor, { mode: 'confirm', evidenceId: 'e', clientId: 'c', initial: payload(), kind, canSubmit: true }))
    const letterHtml = html('client_ownership_confirmation')
    expect(letterHtml).toContain('Confirmed by (capacity')
    expect(letterHtml).toContain('Received as')
    expect(letterHtml).toContain('No other person holds')
    expect(letterHtml).not.toContain('Certified?')
    expect(letterHtml).not.toContain('Accept although it is not certified')
    expect(letterHtml).toContain('Accept although it is older')
    const registerHtml = html('shareholder_register')
    expect(registerHtml).toContain('Certified?')
    expect(registerHtml).toContain('Accept although it is not certified')
  })
})

describe('what to ask the client for', () => {
  it('leads with written confirmation wherever a register cannot be read', () => {
    expect(REQUEST_CONFIRMATION).toBe('Request written confirmation of ownership from the client (a signed letter or email, ideally with a structure chart)')
    for (const code of ['SHAREHOLDERS_NOT_FILED', 'UBO_REGISTER_RESTRICTED', 'REGISTER_PAYWALLED', 'GLEIF_NO_KNOWN_PERSON', 'GLEIF_EXCEPTION_NON_PUBLIC', 'REGISTER_NOT_PROFILED'] as const) {
      expect(REASON_TEXT[code].toLowerCase()).toContain('written confirmation of ownership from the client')
    }
    // The register-specific fallback survives where it helps.
    expect(REASON_TEXT.SHAREHOLDERS_NOT_FILED).toContain('shareholder register is a fallback')
    expect(REASON_TEXT.REGISTER_PAYWALLED).toContain('paid extract')
  })
})

describe('the SAMPLE documents', () => {
  const dir = path.resolve(__dirname, '../../../../../__fixtures__/evidence')

  it('has both: the client’s confirmation letter and the register', () => {
    for (const name of ['SAMPLE-ownership-confirmation.pdf', 'SAMPLE-shareholder-register.pdf']) {
      const file = path.join(dir, name)
      expect(existsSync(file)).toBe(true)
      const bytes = readFileSync(file)
      expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
      expect(bytes.toString('latin1')).toContain('SAMPLE')
      expect(bytes.length).toBeGreaterThan(1500)
    }
  })
})
