import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PackReport, type PackMeta } from '@/app/dashboard/packs/_components/PackReport'
import {
  DEMO_COMPANY_NAME,
  DEMO_OWNER_REGISTRATION,
  DEMO_SUBJECT,
  SAMPLE_NOTE,
  demoAllowed,
  demoFetcher,
  demoFirmSlugs,
  demoOfficers,
  demoRawProfile,
  demoSourceLog,
  isDemoSubject,
  labelAsSample,
} from '@/lib/demo/fjordvik'
import { evaluateProfile, listingDecision, ownershipSummary } from '@/lib/kyc-profile/evaluate'
import { snapshotFingerprint } from '@/lib/packs/canonical'
import { unconfirmedEvidence } from '@/lib/packs/evidence-check'
import { buildSnapshot, parseSnapshot } from '@/lib/packs/snapshot'
import { summarise, toFlow } from '@/lib/ownership/to-flow'
import { walk } from '@/lib/ownership/walk'
import type { ClientEvidenceItem } from '@/lib/ownership/types'
import { evidenceLink } from '../entry-link'
import { toState, toPayloadInput } from '../editor-model'
import { toClientEvidenceItems } from '../load'
import { normalisePayload } from '../payload'
import { parseEvidenceResponse } from '../parse-response'

// Invented data only.
const NOW = '2026-10-16T12:00:00.000Z'

const sampleItem = (over: Partial<ClientEvidenceItem> = {}): ClientEvidenceItem => ({
  id: 'ev-sample',
  nodeIdentity: { country: 'NO', registrationNumber: '999 000 001' },
  evidenceKind: 'shareholder_register',
  asAt: '2026-06-30',
  documentDate: '2026-07-15',
  certified: 'yes',
  certifierCapacity: 'company_officer',
  certificationDate: '2026-07-15',
  confirmedBy: 'admin-1',
  confirmedAt: '2026-10-15T09:00:00.000Z',
  edited: false,
  documentSha256: 'a'.repeat(64),
  ownersComplete: true,
  override: null,
  owners: [
    { kind: 'individual', label: 'Ø.Å.T.', holding: { type: 'percent', value: 40 }, registration: null, leiShown: null, pageRef: 'p.2 table 1' },
    { kind: 'entity', label: 'Nordlys Invest Test AS', holding: { type: 'percent', value: 30 }, registration: { number: '999 000 002', country: 'NO' }, leiShown: null, pageRef: 'p.2 table 1' },
    { kind: 'individual', label: 'K.E.F.', holding: { type: 'percent', value: 15 }, registration: null, leiShown: null, pageRef: 'p.2 table 1' },
    { kind: 'individual', label: 'B.P.', holding: { type: 'percent', value: 10 }, registration: null, leiShown: null, pageRef: 'p.2 table 1' },
    { kind: 'individual', label: 'M.S.', holding: { type: 'percent', value: 5 }, registration: null, leiShown: null, pageRef: 'p.2 table 1' },
  ],
  ...over,
})

async function demoWalk(items: ClientEvidenceItem[], policy = {}) {
  return walk(DEMO_SUBJECT, { ...demoFetcher(NOW), clientEvidence: async () => items }, { now: NOW, ...policy })
}

describe('the sample subject', () => {
  it('is for allow-listed firms only: bubble-up by default, or the slugs in DEMO_SUBJECT_FIRM_SLUGS', () => {
    expect(demoFirmSlugs(undefined)).toEqual(['bubble-up'])
    expect(demoFirmSlugs('')).toEqual(['bubble-up'])
    expect(demoFirmSlugs(' a-firm , other ')).toEqual(['a-firm', 'other'])
    expect(demoAllowed('bubble-up', undefined)).toBe(true)
    expect(demoAllowed('test-co', undefined)).toBe(false)
    expect(demoAllowed(undefined, undefined)).toBe(false)
    expect(demoAllowed('other', 'a-firm,other')).toBe(true)
    expect(demoAllowed('bubble-up', 'a-firm,other')).toBe(false)
  })

  it('is recognised by its name, in any case, and nothing else is', () => {
    expect(isDemoSubject(' demo-fjordvik ')).toBe(true)
    expect(isDemoSubject('03261722')).toBe(false)
    expect(isDemoSubject('DEMO-FJORDVIK-2')).toBe(false)
  })

  it('walks with no network at all and stops at the fictional Norwegian owner as an unresolved foreign node', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const result = await demoWalk([])
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()

    expect(result.status).toBe('unresolved')
    const root = result.nodes.find((n) => n.id === `GB:${DEMO_SUBJECT}`)!
    expect(root.name).toBe(DEMO_COMPANY_NAME)
    expect(root.name.startsWith('SAMPLE DATA')).toBe(true)
    const stop = result.nodes.find((n) => n.name === 'Fjordvik Test Holding AS')!
    expect(stop).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'SHAREHOLDERS_NOT_FILED' })
    // What the evidence is matched on, and what the "Add client evidence" form is filled in from.
    expect(stop.identity).toEqual({ country: 'NO', registrationNumber: DEMO_OWNER_REGISTRATION })
  })

  it('is resolved by evidence for the registration number printed in the SAMPLE PDF (company owner chased only by number and country)', async () => {
    const result = await demoWalk([sampleItem()])
    expect(result.status).toBe('partial')
    // The 30% company has no register to read: it stays an open branch. Individuals are resolved, as initials.
    expect(result.nodes.filter((n) => n.viaClientEvidence).map((n) => n.name)).toEqual(expect.arrayContaining(['Ø.Å.T.', 'K.E.F.', 'B.P.', 'M.S.', 'Nordlys Invest Test AS']))
    expect(result.nodes.find((n) => n.name === 'Nordlys Invest Test AS')).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'SHAREHOLDERS_NOT_FILED' })

    // With only individuals named, the whole walk is resolved on client evidence.
    const individualsOnly = await demoWalk([
      sampleItem({ owners: [sampleItem().owners[0], { ...sampleItem().owners[2], holding: { type: 'percent', value: 60 } }] }),
    ])
    expect(individualsOnly.status).toBe('resolved_client_evidence')
    expect(summarise(individualsOnly).clientEvidence[0]).toMatchObject({ applied: true, certifierCapacity: 'company_officer', certificationDate: '2026-07-15' })
  })

  it('labels every profile row as sample data and drops the links to registers that have no such entry', async () => {
    const walked = await demoWalk([])
    const rows = labelAsSample(
      evaluateProfile({
        listingDecision: listingDecision(walked),
        profile: demoRawProfile,
        officers: demoOfficers,
        gleif: { status: 'none' },
        ownership: ownershipSummary(walked, 25),
        fetchedAt: { profile: NOW, officers: NOW },
      }),
      NOW,
    )
    expect(rows.length).toBeGreaterThan(5)
    for (const row of rows) {
      expect(row.note).toContain(SAMPLE_NOTE)
      expect(row.source).toBeUndefined()
      expect(row.links).toBeUndefined()
    }
    expect(rows.find((r) => r.key === 'identity')!.lines[0]).toContain('SAMPLE DATA')
    // Officers are shown as initials only.
    expect(JSON.stringify(rows)).not.toMatch(/DEMO, Sam|EXAMPLE, Alex/)
    expect(demoSourceLog(NOW)[0].register).toContain('SAMPLE DATA')
  })

  it('a pack built from it says so in the snapshot, the subject name, the source log and the report', async () => {
    const walked = await demoWalk([sampleItem({ owners: [sampleItem().owners[0], { ...sampleItem().owners[2], holding: { type: 'percent', value: 60 } }] })])
    const summary = summarise(walked)
    const snapshot = buildSnapshot({
      subject: { id: DEMO_SUBJECT, kind: 'company', name: DEMO_COMPANY_NAME },
      policy: { threshold: 25, maxDepth: 6, indirectMethod: 'either', acceptRegulatedAsTerminal: true, acceptClientEvidenceAsResolved: true, maxEvidenceAgeMonths: 12 },
      walked,
      profile: [],
      flow: toFlow(walked),
      summary,
      sourceLog: demoSourceLog(NOW),
      sample: true,
      individualNames: ['DEMO, Sam', 'EXAMPLE, Alex', 'Øystein Åsmund Testersen'],
      now: new Date(NOW),
    })
    expect(snapshot.sample).toBe(true)
    expect(snapshot.subject.name).toContain('SAMPLE DATA')
    expect(snapshot.sourceLog.map((e) => e.register)).toEqual(['SAMPLE DATA (built-in fixture, not a register)', 'Client-provided evidence (reviewer-verified)'])
    expect(() => parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).not.toThrow()

    const fingerprint = await snapshotFingerprint(snapshot)
    const meta: PackMeta = {
      id: 'p', status: 'draft', fingerprint, verified: true, recomputed: fingerprint, createdByName: 'x', createdAt: NOW,
      submittedAt: null, reviewedByName: null, reviewedAt: null, reviewNote: null,
    }
    const out = renderToStaticMarkup(createElement(PackReport, { snapshot, meta }))
    expect(out).toContain('Sample data: built from the built-in demo subject')
    expect(out).toContain('SAMPLE DATA: Fjordvik Demo (UK) Limited')
    expect(out).toContain('Client-provided evidence')
    expect(out).toContain('Fingerprint verified')
  })

  it('a real run has no sample flag and no banner', async () => {
    const walked = await demoWalk([])
    const snapshot = buildSnapshot({
      subject: { id: '03261722', kind: 'company', name: 'ACME LTD' },
      policy: { threshold: 25, maxDepth: 6, indirectMethod: 'either', acceptRegulatedAsTerminal: true },
      walked, profile: [], flow: toFlow(walked), summary: summarise(walked), sourceLog: [],
    })
    expect(snapshot.sample).toBeUndefined()
    expect(snapshot.clientEvidence).toBeUndefined()
  })
})

describe('client evidence in a pack', () => {
  const onlyIndividuals = sampleItem({
    owners: [sampleItem().owners[0], { ...sampleItem().owners[2], holding: { type: 'percent', value: 60 } }],
    override: { reasons: ['uncertified'], note: 'a private note that must stay out of the pack' },
    certified: 'no',
    certifierCapacity: 'unclear',
  })

  it('carries certified, capacity, date, confirmer, document fingerprint and "override exists", and nothing private', async () => {
    const walked = await demoWalk([onlyIndividuals])
    const snapshot = buildSnapshot({
      subject: { id: DEMO_SUBJECT, kind: 'company', name: DEMO_COMPANY_NAME },
      policy: { threshold: 25, maxDepth: 6, indirectMethod: 'either', acceptRegulatedAsTerminal: true },
      walked, profile: [], flow: toFlow(walked), summary: summarise(walked), sourceLog: [], sample: true, now: new Date(NOW),
    })
    expect(snapshot.clientEvidence).toEqual([
      {
        id: 'ev-sample',
        kind: 'shareholder_register',
        nodeName: 'Fjordvik Test Holding AS',
        asAt: '2026-06-30',
        documentDate: '2026-07-15',
        certified: 'no',
        certifierCapacity: 'unclear',
        certificationDate: '2026-07-15',
        confirmedAt: '2026-10-15T09:00:00.000Z',
        confirmedBy: 'admin-1',
        edited: false,
        documentSha256: 'a'.repeat(64),
        label: 'client-provided, reviewer-verified',
        overrideExists: true,
        applied: true,
      },
    ])
    expect(JSON.stringify(snapshot)).not.toMatch(/private note|Company secretary|Testersen/)
    expect(snapshot.sourceLog.at(-1)).toEqual({
      register: 'Client-provided evidence (reviewer-verified)',
      path: `evidence/ev-sample#sha256:${'a'.repeat(64)}`,
      fetchedAt: '2026-10-15T09:00:00.000Z',
      status: 200,
      cached: false,
    })
  })

  it('the fingerprint covers the evidence references', async () => {
    const make = async (sha: string) => {
      const walked = await demoWalk([{ ...onlyIndividuals, documentSha256: sha }])
      return snapshotFingerprint(
        buildSnapshot({
          subject: { id: DEMO_SUBJECT, kind: 'company', name: DEMO_COMPANY_NAME },
          policy: { threshold: 25, maxDepth: 6, indirectMethod: 'either', acceptRegulatedAsTerminal: true },
          walked, profile: [], flow: toFlow(walked), summary: summarise(walked), sourceLog: [], now: new Date(NOW),
        }),
      )
    }
    expect(await make('a'.repeat(64))).not.toBe(await make('b'.repeat(64)))
    expect(await make('a'.repeat(64))).toBe(await make('a'.repeat(64)))
  })

  it('refuses to save a run whose evidence was superseded, rejected or changed since', () => {
    const snapshot = { clientEvidence: [{ id: 'e1', documentSha256: 'a'.repeat(64) }, { id: 'e2', documentSha256: 'b'.repeat(64) }] } as never
    expect(unconfirmedEvidence(snapshot, [{ id: 'e1', status: 'confirmed', document_sha256: 'a'.repeat(64) }, { id: 'e2', status: 'confirmed', document_sha256: 'b'.repeat(64) }])).toEqual([])
    expect(unconfirmedEvidence(snapshot, [{ id: 'e1', status: 'superseded', document_sha256: 'a'.repeat(64) }, { id: 'e2', status: 'confirmed', document_sha256: 'b'.repeat(64) }])).toEqual(['e1'])
    expect(unconfirmedEvidence(snapshot, [{ id: 'e1', status: 'confirmed', document_sha256: 'a'.repeat(64) }])).toEqual(['e2'])
    expect(unconfirmedEvidence(snapshot, [{ id: 'e1', status: 'confirmed', document_sha256: 'c'.repeat(64) }, { id: 'e2', status: 'confirmed', document_sha256: 'b'.repeat(64) }])).toEqual(['e1'])
    expect(unconfirmedEvidence({} as never, [])).toEqual([])
  })
})

describe('certifier capacity and certification date', () => {
  const base = {
    owners: [{ kind: 'individual', name_as_shown: 'Testperson Alpha', holding: { type: 'percent', value: 100 }, page_ref: 'p.2' }],
    owners_complete: true,
    as_at: '2026-06-30',
    certified: 'yes',
  }
  const ok = (input: unknown) => {
    const r = normalisePayload(input, { today: '2026-10-16' })
    if (!r.ok) throw new Error(r.error)
    return r.payload
  }

  it('keeps a stated capacity and date, and says "unclear" rather than assuming one', () => {
    expect(ok({ ...base, certifier_capacity: 'notary', certification_date: '2026-07-01' })).toMatchObject({ certifier_capacity: 'notary', certification_date: '2026-07-01' })
    expect(ok(base)).toMatchObject({ certifier_capacity: 'unclear' })
    expect(ok(base)).not.toHaveProperty('certification_date')
    expect(ok({ ...base, certified: 'unclear' })).toMatchObject({ certifier_capacity: 'unclear' })
  })

  it('has neither on a document that is not certified', () => {
    const payload = ok({ ...base, certified: 'no', certifier_capacity: 'notary', certification_date: '2026-07-01' })
    expect(payload).not.toHaveProperty('certifier_capacity')
    expect(payload).not.toHaveProperty('certification_date')
  })

  it('refuses an unknown capacity, an impossible date and a date in the future', () => {
    expect(normalisePayload({ ...base, certifier_capacity: 'wizard' }, { today: '2026-10-16' }).ok).toBe(false)
    expect(normalisePayload({ ...base, certification_date: '2026-02-30' }, { today: '2026-10-16' }).ok).toBe(false)
    expect(normalisePayload({ ...base, certification_date: '2026-10-17' }, { today: '2026-10-16' })).toMatchObject({ ok: false, error: expect.stringContaining('certification date') })
  })

  it('is read from Claude’s reply (an unknown capacity falls back to "unclear" via the owner rows being kept)', () => {
    const parsed = parseEvidenceResponse(JSON.stringify({ ...base, certifier_capacity: 'notary', certification_date: '2026-07-01', confidence_score: 0.9 }), '2026-10-16')
    expect(parsed.payload).toMatchObject({ certifier_capacity: 'notary', certification_date: '2026-07-01' })
  })

  it('survives the editor round trip and the database loader, with the certifier’s own text left out', () => {
    const payload = ok({ ...base, certifier_capacity: 'lawyer', certification_date: '2026-07-01', certified_by: 'Some Person, Solicitor' })
    const back = normalisePayload(toPayloadInput(toState(payload), false), { today: '2026-10-16' })
    expect(back).toEqual({ ok: true, payload })

    const [item] = toClientEvidenceItems([
      {
        id: 'e', node_identity: { country: 'NO', registration_number: '1' }, evidence_kind: 'register_extract', as_at: '2026-06-30', certified: 'yes',
        certified_by: 'Some Person, Solicitor', confirmed_by: 'admin-1', confirmed_at: '2026-10-15T09:00:00Z', document_sha256: 'a'.repeat(64),
        payload: { owners: [], owners_complete: true, certifier_capacity: 'lawyer', certification_date: '2026-07-01', certified_by: 'Some Person, Solicitor' },
      },
    ])
    expect(item).toMatchObject({ certifierCapacity: 'lawyer', certificationDate: '2026-07-01', confirmedBy: 'admin-1' })
    expect(JSON.stringify(item)).not.toContain('Some Person')
  })

  it('the database check does not reject these keys: they are not personal-data keys', () => {
    const forbidden = /"(date_of_birth|dateofbirth|dob|nationality|country_of_residence|countryofresidence|occupation)"\s*:/i
    expect(forbidden.test(JSON.stringify(ok({ ...base, certifier_capacity: 'notary', certification_date: '2026-07-01' })))).toBe(false)
  })
})

describe('the "Add client evidence" link', () => {
  const node = (over: Record<string, unknown> = {}) =>
    ({
      name: 'Fjordvik Test Holding AS',
      tone: 'unresolved',
      reasonCode: 'SHAREHOLDERS_NOT_FILED',
      identity: { country: 'NO', registrationNumber: '999 000 001' },
      ...over,
    }) as never

  it('is filled in from the node’s facts and filed against the walk subject', () => {
    const link = evidenceLink('client-1', DEMO_SUBJECT, node())!
    expect(link.label).toBe('Add client evidence')
    const url = new URL(link.href, 'http://x')
    expect(url.pathname).toBe('/dashboard/clients/client-1/evidence/new')
    expect(Object.fromEntries(url.searchParams)).toEqual({ subject: DEMO_SUBJECT, name: 'Fjordvik Test Holding AS', country: 'NO', registration: '999 000 001' })
  })

  it('offers newer or fuller evidence when what was provided could not be used', () => {
    expect(evidenceLink('c', 's', node({ reasonCode: 'CLIENT_EVIDENCE_STALE' }))!.label).toBe('Add newer or fuller client evidence')
  })

  it('is absent without a client, without something to identify the node, on resolved nodes and on reasons evidence cannot resolve', () => {
    expect(evidenceLink(undefined, 's', node())).toBeNull()
    expect(evidenceLink('c', undefined, node())).toBeNull()
    expect(evidenceLink('c', 's', node({ identity: { country: 'NO' } }))).toBeNull()
    expect(evidenceLink('c', 's', node({ identity: undefined }))).toBeNull()
    expect(evidenceLink('c', 's', node({ tone: 'resolved' }))).toBeNull()
    expect(evidenceLink('c', 's', node({ reasonCode: 'PSC_STATEMENT' }))).toBeNull()
    expect(evidenceLink('c', 's', node({ reasonCode: 'SOURCE_UNAVAILABLE' }))).toBeNull()
  })

  it('works for a node identified by LEI alone', () => {
    const url = new URL(evidenceLink('c', 's', node({ identity: { lei: '529900ABCDEFGHIJKL12' } }))!.href, 'http://x')
    expect(url.searchParams.get('lei')).toBe('529900ABCDEFGHIJKL12')
  })
})

describe('the SAMPLE shareholder register, as in __fixtures__/evidence/SAMPLE-shareholder-register.pdf', () => {
  // What a reviewer confirms after Claude reads the PDF: five holders adding to 100%, one printed number.
  const proposal = () => {
    const r = normalisePayload(
      {
        owners: [
          { kind: 'individual', name_as_shown: 'Øystein Åsmund Testersen', holding: { type: 'percent', value: 45 }, page_ref: 'page 2, table 1' },
          { kind: 'entity', name_as_shown: 'Nordlys Invest Test AS', holding: { type: 'percent', value: 20 }, registration: { number: '999 000 002', country: 'NO' }, page_ref: 'page 2, table 1' },
          { kind: 'individual', name_as_shown: 'Kari Eksempel-Fjeld', holding: { type: 'percent', value: 20 }, page_ref: 'page 2, table 1' },
          { kind: 'individual', name_as_shown: 'Bjørn Prøve', holding: { type: 'percent', value: 10 }, page_ref: 'page 2, table 1' },
          { kind: 'individual', name_as_shown: 'Mia Sampleby', holding: { type: 'percent', value: 5 }, page_ref: 'page 2, table 1' },
        ],
        owners_complete: true,
        as_at: '2026-06-30',
        document_date: '2026-07-15',
        certified: 'yes',
        certified_by: 'Sample Signatory, Company secretary',
        certifier_capacity: 'company_officer',
        certification_date: '2026-07-15',
      },
      { today: '2026-10-16' },
    )
    if (!r.ok) throw new Error(r.error)
    return r.payload
  }

  it('sets initials the way the chart shows them', () => {
    expect(proposal().owners.map((o) => o.initials ?? o.name_as_shown)).toEqual(['Ø.Å.T.', 'Nordlys Invest Test AS', 'K.E.', 'B.P.', 'M.S.'])
  })

  it('ends the sample walk as "Resolved (client evidence)": the 20% company is below the threshold and pruned', async () => {
    const p = proposal()
    const item: ClientEvidenceItem = {
      id: 'ev-pdf',
      nodeIdentity: { country: 'NO', registrationNumber: DEMO_OWNER_REGISTRATION },
      evidenceKind: 'shareholder_register',
      asAt: p.as_at ?? null,
      documentDate: p.document_date ?? null,
      certified: p.certified,
      certifierCapacity: p.certifier_capacity ?? null,
      certificationDate: p.certification_date ?? null,
      confirmedBy: 'admin-1',
      confirmedAt: '2026-10-16T09:00:00.000Z',
      edited: false,
      documentSha256: 'c'.repeat(64),
      ownersComplete: p.owners_complete,
      override: null,
      owners: p.owners.map((o) => ({
        kind: o.kind,
        label: o.kind === 'individual' ? (o.initials as string) : o.name_as_shown,
        holding: o.holding ?? null,
        registration: o.registration ?? null,
        leiShown: null,
        pageRef: o.page_ref,
      })),
    }
    const result = await walk(DEMO_SUBJECT, { ...demoFetcher(NOW), clientEvidence: async () => [item] }, { now: NOW })
    expect(result.status).toBe('resolved_client_evidence')
    expect(result.nodes.find((n) => n.name === 'Nordlys Invest Test AS')).toMatchObject({ resolution: 'PRUNED' })
    expect(result.nodes.filter((n) => n.resolution === 'RESOLVED_INDIVIDUAL').map((n) => n.name)).toEqual(['Ø.Å.T.', 'K.E.', 'B.P.', 'M.S.'])
    // Only the 45% holder is a beneficial owner at the 25% threshold.
    expect(ownershipSummary(result, 25).owners).toEqual(['Ø.Å.T.'])
    expect(JSON.stringify(result)).not.toMatch(/Øystein|Eksempel|Prøve|Sampleby|Sample Signatory/)
  })
})

describe('initials', () => {
  it('leaves initials that are already initials alone, including non-English letters', async () => {
    const { initials } = await import('@/lib/ownership/to-flow')
    expect(initials('T.A.')).toBe('T.A.')
    expect(initials('Ø.Å.T.')).toBe('Ø.Å.T.')
    expect(initials('Øystein Åsmund Testersen')).toBe('Ø.Å.T.')
    expect(initials('Kari Eksempel-Fjeld')).toBe('K.E.')
  })
})
