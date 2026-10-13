import { describe, expect, it } from 'vitest'
import { walk } from '../walk'
import { ownershipNodeSchema, ownershipEdgeSchema, type GleifRecord, type GleifSource, type WalkResult } from '../types'
import { stopReasonFor, profileFor, REGISTER_PROFILES } from '../register-profiles'
import { countryCode } from '../countries'
import { fixtureFetcher, profile, pscList, replayGleif } from './fixture-fetcher'

function node(result: WalkResult, id: string) {
  const found = result.nodes.find((n) => n.id === id)
  if (!found) throw new Error(`no node ${id}`)
  return found
}

function expectValid(result: WalkResult) {
  for (const n of result.nodes) ownershipNodeSchema.parse(n)
  for (const e of result.edges) ownershipEdgeSchema.parse(e)
}

/** The edges that came from GLEIF, and the nodes they point down to. */
function gleifChildren(result: WalkResult) {
  return result.edges.filter((e) => e.source === 'gleif').map((e) => node(result, e.childId))
}

const ALLIANZ = 'LEI:529900K9B0N5BT694847'

describe('GLEIF walk — recorded responses', () => {
  it('walks a non-UK target up to its GLEIF direct parent', async () => {
    const { source, requested } = replayGleif('lu-1')
    const { fetcher } = fixtureFetcher({}, source)
    const result = await walk('529900H9Q8LI6GGZB203', fetcher)

    expectValid(result)
    expect(requested.every((p) => p.includes('/lei-records'))).toBe(true)
    expect(node(result, 'LEI:529900H9Q8LI6GGZB203')).toMatchObject({
      name: 'Private Debt Secondaries II',
      jurisdiction: 'LU',
      resolution: 'PENDING',
    })
    expect(result.edges).toEqual([
      {
        parentId: ALLIANZ,
        childId: 'LEI:529900H9Q8LI6GGZB203',
        source: 'gleif',
        basis: 'consolidation',
        band: null,
        natures: [],
      },
    ])
    // Allianz SE reports "no known person": a GLEIF exception, with DE's register attached.
    expect(node(result, ALLIANZ)).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'GLEIF_NO_KNOWN_PERSON' })
    expect(node(result, ALLIANZ).registerProfile).toMatchObject({ country: 'DE', uboAccess: 'obliged_entity' })
  })

  it('turns a GLEIF reporting exception into its GLEIF reason code', async () => {
    const nordea = await walk('529900ODI3047E2LIV03', fixtureFetcher({}, replayGleif('nordea').source).fetcher)
    expect(node(nordea, 'LEI:529900ODI3047E2LIV03')).toMatchObject({
      resolution: 'UNRESOLVED',
      reasonCode: 'GLEIF_EXCEPTION_NATURAL_PERSONS',
    })
    expect(node(nordea, 'LEI:529900ODI3047E2LIV03').registerProfile?.country).toBe('FI')

    const dnb = await walk('549300GKFG0RYRRQ1414', fixtureFetcher({}, replayGleif('dnb').source).fetcher)
    expect(node(dnb, 'LEI:549300GKFG0RYRRQ1414')).toMatchObject({
      reasonCode: 'GLEIF_EXCEPTION_NON_CONSOLIDATING',
    })
    expect(node(dnb, 'LEI:549300GKFG0RYRRQ1414').registerProfile?.country).toBe('NO')
  })

  it('follows a foreign PSC matched by registration number and country', async () => {
    const { source, requested } = replayGleif('lu-match')
    const { fetcher } = fixtureFetcher(
      {
        AA000001: {
          profile: profile('AA000001', 'ACME UK HOLDINGS LIMITED'),
          pscs: pscList({
            kind: 'corporate-entity-person-with-significant-control',
            name: 'Allianz Strategic Investments Sarl',
            natures_of_control: ['ownership-of-shares-75-to-100-percent'],
            identification: {
              legal_authority: 'Luxembourg',
              country_registered: 'Luxembourg',
              place_registered: 'Luxembourg',
              registration_number: 'B144833',
            },
          }),
        },
      },
      source,
    )
    const result = await walk('AA000001', fetcher)

    expectValid(result)
    expect(requested[0]).toContain('filter[entity.registeredAs]=B144833')
    expect(requested[0]).toContain('filter[entity.legalAddress.country]=LU')
    const lu = node(result, 'LEI:529900B1YQQQ0BH7UQ67')
    expect(lu).toMatchObject({ depth: 1, resolution: 'PENDING', jurisdiction: 'LU' })
    // The PSC link is a Companies House edge with its band; the next hop is GLEIF's.
    expect(result.edges.find((e) => e.parentId === lu.id)).toMatchObject({ source: 'ch', band: [75, 100] })
    expect(result.edges.find((e) => e.childId === lu.id)).toMatchObject({ source: 'gleif', basis: 'consolidation' })
    expect(node(result, ALLIANZ).reasonCode).toBe('GLEIF_NO_KNOWN_PERSON')
  })

  it("stops a foreign PSC with no GLEIF match at its country's register profile code", async () => {
    // GLEIF holds Equinor ASA as "923 609 016"; CH has "923609016". No match, so no guess.
    const equinor = replayGleif('uk-01285743')
    const result = await walk('01285743', fixtureFetcher(undefined, equinor.source).fetcher)
    expectValid(result)
    const psc = node(result, 'GB:01285743/psc/0')
    expect(psc).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'UBO_REGISTER_RESTRICTED' })
    expect(psc.registerProfile).toMatchObject({ country: 'NO', registerName: expect.stringContaining('Brønnøysund') })

    const sap = replayGleif('uk-02152073')
    const sapResult = await walk('02152073', fixtureFetcher(undefined, sap.source).fetcher)
    expect(node(sapResult, 'GB:02152073/psc/0')).toMatchObject({ reasonCode: 'UBO_REGISTER_RESTRICTED' })
    expect(node(sapResult, 'GB:02152073/psc/0').registerProfile?.country).toBe('DE')
  })

  it('never lets a GLEIF edge resolve anything', async () => {
    for (const [scenario, root] of [
      ['lu-1', '529900H9Q8LI6GGZB203'],
      ['lu-2', '529900NCVUCTCD8Z1P88'],
      ['lu-3', '529900X5D7405ZT3D867'],
      ['nordea', '529900ODI3047E2LIV03'],
    ] as const) {
      const result = await walk(root, fixtureFetcher({}, replayGleif(scenario).source).fetcher)
      expect(result.status).not.toBe('resolved')
      for (const child of gleifChildren(result)) expect(child.resolution).not.toMatch(/^RESOLVED_/)
      for (const n of result.nodes.filter((n) => n.id.startsWith('LEI:'))) expect(n.resolution).not.toMatch(/^RESOLVED_/)
    }
  })

  it('keeps Companies House behaviour when the fetcher has no GLEIF source', async () => {
    const result = await walk('01285743', fixtureFetcher().fetcher)
    expect(node(result, 'GB:01285743/psc/0')).toMatchObject({ reasonCode: 'FOREIGN_ENTITY_UNMATCHED' })
    expect(node(result, 'GB:01285743/psc/0').registerProfile).toBeUndefined()
  })
})

describe('GLEIF walk — synthetic cases', () => {
  const foreignPsc = (identification: Record<string, unknown> | undefined, name = 'Foreign Parent') => ({
    kind: 'corporate-entity-person-with-significant-control',
    name,
    natures_of_control: ['ownership-of-shares-75-to-100-percent'],
    ...(identification ? { identification } : {}),
  })

  function stub(records: GleifRecord[] = []) {
    const searches: string[] = []
    const source: GleifSource = {
      getRecord: async () => null,
      findByRegistration: async (number, country) => {
        searches.push(`${number}|${country}`)
        return records
      },
      getDirectParent: async () => ({}),
    }
    return { source, searches }
  }

  async function run(identification: Record<string, unknown> | undefined, records: GleifRecord[] = []) {
    const { source, searches } = stub(records)
    const { fetcher } = fixtureFetcher(
      { AA000001: { profile: profile('AA000001'), pscs: pscList(foreignPsc(identification)) } },
      source,
    )
    const result = await walk('AA000001', fetcher)
    return { psc: node(result, 'AA000001'.replace(/^/, 'GB:') + '/psc/0'), searches, result }
  }

  it('reports an unknown country as REGISTER_NOT_PROFILED, without searching by name', async () => {
    const { psc, searches } = await run({ country_registered: 'Bermuda', registration_number: '12345' })
    expect(psc).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'REGISTER_NOT_PROFILED' })
    expect(psc.registerProfile).toBeUndefined()
    expect(searches).toEqual([])
  })

  it('reports FOREIGN_ENTITY_UNMATCHED only when there is no country at all', async () => {
    const { psc } = await run({ registration_number: '12345' })
    expect(psc.reasonCode).toBe('FOREIGN_ENTITY_UNMATCHED')
    const { psc: bare } = await run(undefined)
    expect(bare.reasonCode).toBe('FOREIGN_ENTITY_UNMATCHED')
  })

  it('does not search when the PSC has a country but no registration number', async () => {
    const { psc, searches } = await run({ country_registered: 'Netherlands' })
    expect(searches).toEqual([])
    expect(psc).toMatchObject({ reasonCode: 'UBO_REGISTER_RESTRICTED' })
    expect(psc.registerProfile?.country).toBe('NL')
  })

  it('stops when several ISSUED records match, or when the only match is not ISSUED', async () => {
    const record = (lei: string, registrationStatus: string): GleifRecord => ({
      lei,
      legalName: 'Foreign Parent',
      country: 'NL',
      registeredAs: '12345678',
      registrationStatus,
    })
    const identification = { country_registered: 'Netherlands', registration_number: '12345678' }

    const several = await run(identification, [record('A'.repeat(20), 'ISSUED'), record('B'.repeat(20), 'ISSUED')])
    expect(several.psc.reasonCode).toBe('UBO_REGISTER_RESTRICTED')

    const lapsed = await run(identification, [record('A'.repeat(20), 'LAPSED')])
    expect(lapsed.psc.reasonCode).toBe('UBO_REGISTER_RESTRICTED')
    expect(lapsed.searches).toEqual(['12345678|NL'])
  })

  it('reports GLEIF being down as SOURCE_UNAVAILABLE', async () => {
    const source: GleifSource = {
      getRecord: async () => null,
      findByRegistration: async () => {
        throw new Error('down')
      },
      getDirectParent: async () => ({}),
    }
    const { fetcher } = fixtureFetcher(
      {
        AA000001: {
          profile: profile('AA000001'),
          pscs: pscList(foreignPsc({ country_registered: 'Luxembourg', registration_number: 'B1' })),
        },
      },
      source,
    )
    const result = await walk('AA000001', fetcher)
    expect(node(result, 'GB:AA000001/psc/0').reasonCode).toBe('SOURCE_UNAVAILABLE')
  })
})

describe('register profiles', () => {
  it('has the profiled jurisdictions and the not-profiled ones', () => {
    for (const code of ['GB', 'IE', 'LU', 'NL', 'DE', 'FR', 'ES', 'DK', 'NO', 'SE', 'FI', 'US', 'KY']) {
      expect(REGISTER_PROFILES[code].notProfiled).toBeUndefined()
      expect(REGISTER_PROFILES[code].lastVerified).toBe('2026-10-05')
    }
    for (const code of ['JE', 'GG', 'VG', 'CH']) {
      expect(REGISTER_PROFILES[code]).toMatchObject({ notProfiled: true, defaultReasonCode: 'REGISTER_NOT_PROFILED' })
    }
    expect(Object.keys(REGISTER_PROFILES)).toHaveLength(17)
  })

  it('treats an unknown country as REGISTER_NOT_PROFILED', () => {
    expect(stopReasonFor('BM')).toBe('REGISTER_NOT_PROFILED')
    expect(stopReasonFor(undefined)).toBe('REGISTER_NOT_PROFILED')
    expect(profileFor('BM')).toBeUndefined()
    expect(stopReasonFor('de')).toBe('UBO_REGISTER_RESTRICTED')
  })
})

describe('countryCode', () => {
  it('maps register text to ISO codes', () => {
    expect(countryCode('Luxembourg')).toBe('LU')
    expect(countryCode('The Netherlands')).toBe('NL')
    expect(countryCode('Delaware')).toBe('US')
    expect(countryCode('Cayman Islands')).toBe('KY')
    expect(countryCode('England')).toBe('GB')
    expect(countryCode('New South Wales')).toBe('AU')
    expect(countryCode('Bermuda')).toBeUndefined()
    expect(countryCode('')).toBeUndefined()
  })
})
