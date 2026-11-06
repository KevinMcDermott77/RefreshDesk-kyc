import { describe, expect, it, vi } from 'vitest'
import { walk } from '../walk'
import { ownershipNodeSchema, ownershipEdgeSchema, type ClientEvidenceItem, type ClientEvidenceOwner, type GleifRecord, type GleifSource, type TerminalChecks, type WalkResult } from '../types'
import { addMonths, assessEvidence, EVIDENCE_ELIGIBLE_REASONS, holdingRange, matchEvidence } from '@/lib/evidence/apply'
import { fixtureFetcher, profile, pscList } from './fixture-fetcher'

// Invented data only. Individuals reach the walk as initials, never as names.

const NOW = '2026-10-16T12:00:00.000Z'

function node(result: WalkResult, id: string) {
  const found = result.nodes.find((n) => n.id === id)
  if (!found) throw new Error(`no node ${id}`)
  return found
}
function expectValid(result: WalkResult) {
  for (const n of result.nodes) ownershipNodeSchema.parse(n)
  for (const e of result.edges) ownershipEdgeSchema.parse(e)
}

const person = (label: string, value: number): ClientEvidenceOwner => ({
  kind: 'individual',
  label,
  holding: { type: 'percent', value },
  registration: null,
  leiShown: null,
  pageRef: 'p.2 table 1',
})
const company = (label: string, value: number, registration: { number: string; country: string } | null = null, leiShown: string | null = null): ClientEvidenceOwner => ({
  kind: 'entity',
  label,
  holding: { type: 'percent', value },
  registration,
  leiShown,
  pageRef: 'p.2 table 1',
})

function item(over: Partial<ClientEvidenceItem> = {}): ClientEvidenceItem {
  return {
    id: 'ev-1',
    nodeIdentity: { country: 'NO', registrationNumber: '923 609 016' },
    evidenceKind: 'shareholder_register',
    asAt: '2026-06-30',
    documentDate: '2026-07-15',
    certified: 'yes',
    certifierCapacity: 'company_officer',
    certificationDate: '2026-07-15',
    confirmedByCapacity: null,
    confirmationDate: null,
    receivedAs: null,
    noOtherHolderAtOrAbove: null,
    confirmedBy: 'admin-1',
    confirmedAt: '2026-08-01T09:00:00.000Z',
    edited: false,
    documentSha256: 'b'.repeat(64),
    owners: [person('T.A.', 80), person('K.E.', 15), person('M.S.', 5)],
    ownersComplete: true,
    override: null,
    ...over,
  }
}

/** A UK company owned 75-100% by a Norwegian company the registers cannot open (SHAREHOLDERS_NOT_FILED). */
function ukOverNorway(items: ClientEvidenceItem[] | (() => Promise<ClientEvidenceItem[]>), gleif?: Partial<GleifSource>) {
  const searches: string[] = []
  const source: GleifSource = {
    getRecord: async () => null,
    findByRegistration: async (number, country) => {
      searches.push(`${number}|${country}`)
      return []
    },
    getDirectParent: async () => ({}),
    ...gleif,
  }
  const { fetcher } = fixtureFetcher(
    {
      AA000001: {
        profile: profile('AA000001'),
        pscs: pscList({
          kind: 'corporate-entity-person-with-significant-control',
          name: 'Fjordholding AS',
          natures_of_control: ['ownership-of-shares-75-to-100-percent'],
          identification: { country_registered: 'Norway', registration_number: '923609016' },
        }),
      },
    },
    source,
  )
  return {
    fetcher: { ...fetcher, clientEvidence: typeof items === 'function' ? items : async () => items },
    searches,
    psc: (result: WalkResult) => node(result, 'GB:AA000001/psc/0'),
  }
}

const run = (setup: ReturnType<typeof ukOverNorway>, policy = {}) => walk('AA000001', setup.fetcher, { now: NOW, ...policy })

describe('client evidence in the walk', () => {
  it('without evidence the Norwegian owner stays an unresolved register stop (unchanged)', async () => {
    const setup = ukOverNorway([])
    const result = await run(setup)
    expect(setup.psc(result)).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'SHAREHOLDERS_NOT_FILED' })
    expect(result.status).toBe('unresolved')
  })

  it('resolves the owner on confirmed evidence: owners become initials-only nodes, and the status says so', async () => {
    const setup = ukOverNorway([item()])
    const result = await run(setup)
    expectValid(result)

    const psc = setup.psc(result)
    expect(psc).toMatchObject({ resolution: 'PENDING' })
    expect(psc.reasonCode).toBeUndefined()
    // The register stop is kept beside the new fact.
    expect(psc.secondaryReasons).toEqual(expect.arrayContaining(['SHAREHOLDERS_NOT_FILED', 'CLIENT_EVIDENCE_APPLIED']))
    expect(psc.clientEvidence).toMatchObject({ id: 'ev-1', applied: true, certified: 'yes', edited: false })

    const owners = result.nodes.filter((n) => n.viaClientEvidence === 'ev-1')
    expect(owners.map((n) => [n.name, n.kind, n.resolution])).toEqual([
      ['T.A.', 'individual', 'RESOLVED_INDIVIDUAL'],
      ['K.E.', 'individual', 'RESOLVED_INDIVIDUAL'],
      ['M.S.', 'individual', 'RESOLVED_INDIVIDUAL'],
    ])
    // 75-100% of the UK company, then 80% of that: a band, never a midpoint.
    expect(owners[0].effectiveRangeMultiply).toEqual([60, 80])
    expect(owners[1].effectiveRangeMultiply).toEqual([11.25, 15])
    expect(result.edges.filter((e) => e.source === 'client')).toEqual([
      { parentId: owners[0].id, childId: psc.id, source: 'client', basis: 'client_evidence', band: [80, 80], natures: [] },
      { parentId: owners[1].id, childId: psc.id, source: 'client', basis: 'client_evidence', band: [15, 15], natures: [] },
      { parentId: owners[2].id, childId: psc.id, source: 'client', basis: 'client_evidence', band: [5, 5], natures: [] },
    ])
    expect(result.status).toBe('resolved_client_evidence')
    expect(JSON.stringify(result)).not.toMatch(/Testperson|Company secretary/)
  })

  it('a stated holding above 50% passes the full interest through, like a majority link in Companies House', async () => {
    const setup = ukOverNorway([item({ owners: [person('T.A.', 60), person('K.E.', 40)] })])
    const result = await run(setup)
    const top = result.nodes.find((n) => n.name === 'T.A.')!
    expect(top.effectiveRangeMultiply).toEqual([45, 60])
    expect(top.effectiveRangeMajority).toEqual([100, 100])
    expect(top.effectiveRange).toEqual([100, 100])
  })

  it('flags an individual whose stated holding is a band straddling the threshold', async () => {
    const owners = [person('T.A.', 70), { ...person('K.E.', 0), holding: { type: 'band' as const, low: 20, high: 30 } }]
    const result = await run(ukOverNorway([item({ owners })]))
    expect(result.nodes.find((n) => n.name === 'K.E.')).toMatchObject({ reasonCode: 'BAND_STRADDLES_THRESHOLD' })
  })

  it('is partial, not unresolved, when something else in the walk did resolve', async () => {
    const searches: string[] = []
    const { fetcher } = fixtureFetcher(
      {
        AA000001: {
          profile: profile('AA000001'),
          pscs: pscList(
            { kind: 'individual-person-with-significant-control', name: 'Testperson Beta', natures_of_control: ['ownership-of-shares-25-to-50-percent'] },
            {
              kind: 'corporate-entity-person-with-significant-control',
              name: 'Fjordholding AS',
              natures_of_control: ['ownership-of-shares-50-to-75-percent'],
              identification: { country_registered: 'Norway', registration_number: '923609016' },
            },
          ),
        },
      },
      { getRecord: async () => null, findByRegistration: async (n, c) => (searches.push(`${n}|${c}`), []), getDirectParent: async () => ({}) },
    )
    const stale = item({ asAt: '2024-01-01', documentDate: null })
    const result = await walk('AA000001', { ...fetcher, clientEvidence: async () => [stale] }, { now: NOW })
    expect(result.status).toBe('partial')
    const fresh = await walk('AA000001', { ...fetcher, clientEvidence: async () => [item()] }, { now: NOW })
    expect(fresh.status).toBe('resolved_client_evidence')
  })

  describe('policy: acceptClientEvidenceAsResolved', () => {
    it('off: the evidence is shown but the branch stays unresolved and the walk partial', async () => {
      const setup = ukOverNorway([item()])
      const result = await run(setup, { acceptClientEvidenceAsResolved: false })
      const psc = setup.psc(result)
      expect(psc).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'SHAREHOLDERS_NOT_FILED' })
      expect(psc.secondaryReasons).toContain('CLIENT_EVIDENCE_NOT_ACCEPTED')
      expect(psc.clientEvidence).toMatchObject({ applied: false, notApplied: ['policy'] })
      expect(result.nodes.some((n) => n.viaClientEvidence)).toBe(false)
      expect(result.status).toBe('unresolved')
    })
  })

  describe('age and certification', () => {
    it('stale evidence is not applied: the primary reason says so and the register stop moves down', async () => {
      const setup = ukOverNorway([item({ asAt: '2025-01-01', documentDate: '2025-01-05' })])
      const result = await run(setup)
      const psc = setup.psc(result)
      expect(psc).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'CLIENT_EVIDENCE_STALE' })
      expect(psc.secondaryReasons).toContain('SHAREHOLDERS_NOT_FILED')
      expect(psc.clientEvidence).toMatchObject({ applied: false, notApplied: ['stale'] })
      expect(result.status).toBe('unresolved')
    })

    it('is exactly on the limit at 12 months and stale a day later (measured from as_at)', async () => {
      const onLimit = await run(ukOverNorway([item({ asAt: '2025-10-16', documentDate: null })]))
      expect(onLimit.status).toBe('resolved_client_evidence')
      const dayOver = await run(ukOverNorway([item({ asAt: '2025-10-15', documentDate: null })]))
      expect(dayOver.status).toBe('unresolved')
    })

    it('falls back to the document date when there is no as-at date', async () => {
      const fresh = await run(ukOverNorway([item({ asAt: null, documentDate: '2026-07-15' })]))
      expect(fresh.status).toBe('resolved_client_evidence')
      const old = await run(ukOverNorway([item({ asAt: null, documentDate: '2024-07-15' })]))
      expect(old.status).toBe('unresolved')
    })

    it('uses the policy’s age limit', async () => {
      const evidence = item({ asAt: '2026-01-01', documentDate: null })
      expect((await run(ukOverNorway([evidence]), { maxEvidenceAgeMonths: 12 })).status).toBe('resolved_client_evidence')
      expect((await run(ukOverNorway([evidence]), { maxEvidenceAgeMonths: 6 })).status).toBe('unresolved')
    })

    it('uncertified evidence is not applied, whether certified is "no" or "unclear"', async () => {
      for (const certified of ['no', 'unclear'] as const) {
        const setup = ukOverNorway([item({ certified })])
        const result = await run(setup)
        expect(setup.psc(result)).toMatchObject({ reasonCode: 'CLIENT_EVIDENCE_UNCERTIFIED' })
        expect(result.status).toBe('unresolved')
      }
    })

    it('an override for "uncertified" lets uncertified evidence resolve, and says so', async () => {
      const setup = ukOverNorway([item({ certified: 'no', override: { reasons: ['uncertified'], note: 'client cannot get a certified copy' } })])
      const result = await run(setup)
      expect(setup.psc(result).clientEvidence).toMatchObject({ applied: true, certified: 'no', override: { reasons: ['uncertified'] } })
      expect(JSON.stringify(setup.psc(result))).not.toContain('cannot get a certified copy')
      expect(result.status).toBe('resolved_client_evidence')
    })

    it('an uncertified override does not bypass the age limit', async () => {
      const setup = ukOverNorway([item({ certified: 'no', asAt: '2024-01-01', documentDate: null, override: { reasons: ['uncertified'], note: 'x' } })])
      const result = await run(setup)
      expect(setup.psc(result)).toMatchObject({ reasonCode: 'CLIENT_EVIDENCE_STALE' })
      expect(result.status).toBe('unresolved')
    })

    it('a stale override applies only for the age limit after the day it was confirmed', async () => {
      const old = { asAt: '2024-01-01', documentDate: null }
      const open = item({ ...old, confirmedAt: '2026-03-01T00:00:00.000Z', override: { reasons: ['stale'], note: 'only copy that exists' } })
      expect((await run(ukOverNorway([open]))).status).toBe('resolved_client_evidence')
      const lapsed = item({ ...old, confirmedAt: '2025-09-01T00:00:00.000Z', override: { reasons: ['stale'], note: 'only copy that exists' } })
      const result = await run(ukOverNorway([lapsed]))
      expect(result.status).toBe('unresolved')
    })

    it('uncertified and stale together need both overrides, and both blockers are recorded', async () => {
      const both = item({ certified: 'unclear', asAt: '2024-01-01', documentDate: null })
      const setup = ukOverNorway([both])
      const result = await run(setup)
      expect(setup.psc(result).clientEvidence?.notApplied).toEqual(['stale', 'uncertified'])
      expect(setup.psc(result)).toMatchObject({ reasonCode: 'CLIENT_EVIDENCE_STALE' })
      expect(setup.psc(result).secondaryReasons).toEqual(expect.arrayContaining(['CLIENT_EVIDENCE_UNCERTIFIED', 'SHAREHOLDERS_NOT_FILED']))
      const overridden = item({ ...both, override: { reasons: ['stale', 'uncertified'], note: 'accepted' }, confirmedAt: '2026-08-01T00:00:00.000Z' })
      expect((await run(ukOverNorway([overridden]))).status).toBe('resolved_client_evidence')
    })
  })

  describe('coverage', () => {
    it('does not resolve when the list leaves room for an unlisted holder at or above the threshold', async () => {
      const setup = ukOverNorway([item({ owners: [person('T.A.', 75)] })])
      const result = await run(setup)
      expect(setup.psc(result)).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'CLIENT_EVIDENCE_INCOMPLETE' })
      expect(setup.psc(result).secondaryReasons).toContain('SHAREHOLDERS_NOT_FILED')
      expect(result.status).toBe('unresolved')
    })

    it('does not resolve a document that does not say it lists every holder', async () => {
      const result = await run(ukOverNorway([item({ ownersComplete: false })]))
      expect(result.status).toBe('unresolved')
    })

    it('a holding that is not printed counts as 0, so it cannot complete the picture', async () => {
      const unprinted: ClientEvidenceOwner = { ...person('K.E.', 0), holding: null }
      const result = await run(ukOverNorway([item({ owners: [person('T.A.', 50), unprinted] })]))
      expect(result.status).toBe('unresolved')
      expect(holdingRange(unprinted)).toEqual([0, 100])
    })

    it('no override can waive coverage: the blockers are checked independently of any override', () => {
      const incomplete = item({ owners: [person('T.A.', 10)], override: { reasons: ['stale', 'uncertified'], note: 'x' } })
      const assessment = assessEvidence(incomplete, { accept: true, maxAgeMonths: 12, threshold: 25, now: NOW })
      expect(assessment.apply).toBe(false)
      expect(assessment.blockers).toContain('incomplete')
    })
  })

  describe('matching and eligibility', () => {
    it('matches on the registration number and country, ignoring spacing, and never on a name', async () => {
      const setup = ukOverNorway([item({ nodeIdentity: { country: 'NO', registrationNumber: '923609016' } })])
      expect((await run(setup)).status).toBe('resolved_client_evidence')
      // The registers were asked for the number and country only.
      expect(setup.searches).toEqual(['923609016|NO'])
    })

    it('does not use evidence for a different number, or the same number in another country', async () => {
      expect((await run(ukOverNorway([item({ nodeIdentity: { country: 'NO', registrationNumber: '111111111' } })]))).status).toBe('unresolved')
      expect((await run(ukOverNorway([item({ nodeIdentity: { country: 'SE', registrationNumber: '923609016' } })]))).status).toBe('unresolved')
    })

    it('does not use evidence whose identity is only a name-like thing: it needs an LEI or a number with a country', () => {
      const nameless = item({ nodeIdentity: {} })
      expect(matchEvidence([nameless], { country: 'NO', registrationNumber: '923609016' })).toBeNull()
      expect(matchEvidence([nameless], { lei: '529900ABCDEFGHIJKL12' })).toBeNull()
    })

    it('uses the newest confirmed item when two match', () => {
      const older = item({ id: 'old', confirmedAt: '2026-01-01T00:00:00.000Z' })
      const newer = item({ id: 'new', confirmedAt: '2026-09-01T00:00:00.000Z' })
      expect(matchEvidence([older, newer], { country: 'NO', registrationNumber: '923609016' })?.id).toBe('new')
    })

    it('only register-stop and GLEIF-exception reasons are eligible', () => {
      for (const never of ['PSC_STATEMENT', 'PSC_SUPER_SECURE', 'PSC_NONE_FILED', 'CIRCULAR_OWNERSHIP', 'DEPTH_LIMIT_REACHED', 'SOURCE_UNAVAILABLE', 'BAND_STRADDLES_THRESHOLD'] as const) {
        expect(EVIDENCE_ELIGIBLE_REASONS).not.toContain(never)
      }
      expect(EVIDENCE_ELIGIBLE_REASONS).toEqual(expect.arrayContaining(['REGISTER_PAYWALLED', 'SHAREHOLDERS_NOT_FILED', 'GLEIF_EXCEPTION_NATURAL_PERSONS', 'GLEIF_NO_KNOWN_PERSON']))
    })

    it('leaves a node alone when the registers were down (SOURCE_UNAVAILABLE): absence of data is not evidence', async () => {
      const setup = ukOverNorway([item()], {
        findByRegistration: async () => {
          throw new Error('GLEIF down')
        },
      })
      const result = await run(setup)
      expect(setup.psc(result)).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'SOURCE_UNAVAILABLE' })
      expect(setup.psc(result).clientEvidence).toBeUndefined()
    })

    it('does not touch a Companies House finding such as a PSC statement', async () => {
      const { fetcher } = fixtureFetcher({
        AA000002: { profile: profile('AA000002'), pscs: pscList(), psc_statements: { status: 200, body: { items: [{ statement: 'no-individual-or-entity-with-significant-control' }] } } },
      })
      const loader = vi.fn(async () => [item({ nodeIdentity: { country: 'GB', registrationNumber: 'AA000002' } })])
      const result = await walk('AA000002', { ...fetcher, clientEvidence: loader }, { now: NOW })
      expect(node(result, 'GB:AA000002')).toMatchObject({ reasonCode: 'PSC_STATEMENT' })
      expect(result.nodes.every((n) => !n.clientEvidence)).toBe(true)
    })

    it('a failure to load evidence means no evidence, and the walk carries on unresolved', async () => {
      const setup = ukOverNorway(async () => {
        throw new Error('database down')
      })
      const result = await run(setup)
      expect(setup.psc(result)).toMatchObject({ reasonCode: 'SHAREHOLDERS_NOT_FILED' })
      expect(result.status).toBe('unresolved')
    })

    it('loads the evidence once for the whole walk', async () => {
      const loader = vi.fn(async () => [item()])
      await run(ukOverNorway(loader))
      expect(loader).toHaveBeenCalledTimes(1)
    })
  })

  describe('a foreign target (LEI root)', () => {
    const LEI = '529900ABCDEFGHIJKL12'
    const record: GleifRecord = { lei: LEI, legalName: 'Fjordvik Test Holding AS', country: 'NO', registeredAs: '999000001', registrationStatus: 'ISSUED', entityStatus: 'ACTIVE' }

    function gleifRoot(items: ClientEvidenceItem[], terminals?: TerminalChecks) {
      const source: GleifSource = {
        getRecord: async (lei) => (lei === LEI ? record : null),
        findByRegistration: async () => [],
        getDirectParent: async () => ({ exception: 'NATURAL_PERSONS' }),
      }
      const { fetcher } = fixtureFetcher({}, source)
      return { ...fetcher, clientEvidence: async () => items, ...(terminals ? { terminals } : {}) }
    }

    it('resolves a GLEIF exception stop on evidence matched by the exact LEI, with no consolidation edge to cap it', async () => {
      const result = await walk(LEI, gleifRoot([item({ nodeIdentity: { lei: LEI } })]), { now: NOW })
      expect(node(result, `LEI:${LEI}`)).toMatchObject({ resolution: 'PENDING' })
      expect(node(result, `LEI:${LEI}`).secondaryReasons).toEqual(expect.arrayContaining(['GLEIF_EXCEPTION_NATURAL_PERSONS', 'CLIENT_EVIDENCE_APPLIED']))
      // The root is held 100%: 80% of it is [80, 80], and a majority link passes the full interest through.
      const top = result.nodes.find((n) => n.name === 'T.A.')
      expect(top?.effectiveRangeMultiply).toEqual([80, 80])
      expect(top?.effectiveRange).toEqual([100, 100])
      expect(result.status).toBe('resolved_client_evidence')
    })

    it('also matches on registration number and country from the GLEIF record', async () => {
      const result = await walk(LEI, gleifRoot([item({ nodeIdentity: { country: 'NO', registrationNumber: '999 000 001' } })]), { now: NOW })
      expect(result.status).toBe('resolved_client_evidence')
    })

    it('does not touch a listed company', async () => {
      const terminals: TerminalChecks = {
        listedEU: async () => ({ kind: 'listed_eu', source: 's', url: 'u', details: { isin: 'X', mic: 'XOSL', operatingMic: 'XOSL', venueName: 'v', rule: 'mir' } }),
        regulatedEU: async () => null,
        usListing: async () => null,
      }
      const result = await walk(LEI, gleifRoot([item({ nodeIdentity: { lei: LEI } })], terminals), { now: NOW })
      expect(node(result, `LEI:${LEI}`)).toMatchObject({ resolution: 'RESOLVED_LISTED' })
      expect(node(result, `LEI:${LEI}`).clientEvidence).toBeUndefined()
      expect(result.status).toBe('resolved')
    })
  })

  describe('company owners named by the evidence', () => {
    const OWNER_LEI = '529900QRSTUVWXYZ0123'
    const ownerRecord: GleifRecord = { lei: OWNER_LEI, legalName: 'Nordlys Invest Test AS', country: 'NO', registeredAs: '999000002', registrationStatus: 'ISSUED' }

    it('follows a company owner only when its printed registration number and country match exactly one record', async () => {
      const searches: string[] = []
      const setup = ukOverNorway(
        [item({ owners: [person('T.A.', 70), company('Nordlys Invest Test AS', 30, { number: '999 000 002', country: 'NO' })] })],
        {
          findByRegistration: async (number, country) => {
            searches.push(`${number}|${country}`)
            return number.replace(/\D/g, '') === '999000002' ? [ownerRecord] : []
          },
        },
      )
      const result = await run(setup)
      expect(searches).toContain('999 000 002|NO')
      expect(searches.every((s) => !/Nordlys/.test(s))).toBe(true)
      const followed = node(result, `LEI:${OWNER_LEI}`)
      expect(followed).toMatchObject({ viaClientEvidence: 'ev-1' })
      expect(result.edges.some((e) => e.parentId === followed.id && e.source === 'client')).toBe(true)
    })

    it('leaves a company owner with no printed registration number unresolved, and never searches by its name', async () => {
      const setup = ukOverNorway([item({ owners: [person('T.A.', 70), company('Nameonly Holdings AS', 30)] })])
      const result = await run(setup)
      const stop = node(result, 'GB:AA000001/psc/0/ev/1')
      expect(stop).toMatchObject({ kind: 'corporate', resolution: 'UNRESOLVED', reasonCode: 'FOREIGN_ENTITY_UNMATCHED', name: 'Nameonly Holdings AS' })
      // The only search made was for the Norwegian PSC's own number.
      expect(setup.searches).toEqual(['923609016|NO'])
      // One individual is resolved and one company is not: partial.
      expect(result.status).toBe('partial')
    })

    it('does not follow when the printed number and the printed LEI point at different records', async () => {
      const other: GleifRecord = { ...ownerRecord, lei: 'A'.repeat(20) }
      const setup = ukOverNorway(
        [item({ owners: [person('T.A.', 70), company('Nordlys Invest Test AS', 30, { number: '999000002', country: 'NO' }, 'A'.repeat(20))] })],
        {
          findByRegistration: async (number) => (number === '999000002' ? [ownerRecord] : []),
          getRecord: async (lei) => (lei === 'A'.repeat(20) ? other : null),
        },
      )
      const result = await run(setup)
      expect(result.nodes.some((n) => n.id.startsWith('LEI:'))).toBe(false)
      expect(node(result, 'GB:AA000001/psc/0/ev/1')).toMatchObject({ resolution: 'UNRESOLVED' })
    })

    it('an owner whose effective share is below the threshold is pruned, not chased', async () => {
      const searches: string[] = []
      const setup = ukOverNorway(
        [item({ owners: [person('T.A.', 90), company('Small Holder AS', 10, { number: '999000003', country: 'NO' })] })],
        {
          findByRegistration: async (number, country) => {
            searches.push(`${number}|${country}`)
            return []
          },
        },
      )
      const result = await run(setup)
      expect(node(result, 'GB:AA000001/psc/0/ev/1')).toMatchObject({ resolution: 'PRUNED' })
      expect(searches).not.toContain('999000003|NO')
    })

    it('one item cannot resolve itself in a loop: an owner with the node’s own number is not resolved by the same item', async () => {
      const setup = ukOverNorway([item({ owners: [person('T.A.', 70), company('Fjordholding AS again', 30, { number: '923609016', country: 'NO' })] })])
      const result = await run(setup)
      const again = node(result, 'GB:AA000001/psc/0/ev/1')
      expect(again.resolution).toBe('UNRESOLVED')
      expect(again.clientEvidence).toBeUndefined()
    })
  })
})

describe('evidence rules', () => {
  it('adds whole months in UTC and clamps to the end of a shorter month', () => {
    expect(addMonths('2025-10-16', 12).toISOString().slice(0, 10)).toBe('2026-10-16')
    expect(addMonths('2026-01-31', 1).toISOString().slice(0, 10)).toBe('2026-02-28')
    expect(addMonths('2024-02-29', 12).toISOString().slice(0, 10)).toBe('2025-02-28')
    expect(addMonths('2026-11-30T10:00:00Z', 3).toISOString().slice(0, 10)).toBe('2027-02-28')
  })

  it('a holding that is a band stays a band, and a percentage is exact', () => {
    expect(holdingRange({ holding: { type: 'percent', value: 40 } })).toEqual([40, 40])
    expect(holdingRange({ holding: { type: 'band', low: 10, high: 30 } })).toEqual([10, 30])
  })
})
