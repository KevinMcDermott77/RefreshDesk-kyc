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
    expect(node(result, ALLIANZ).registerProfile).toMatchObject({ country: 'DE', uboAccess: 'restricted' })
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

  it('follows Equinor ASA although CH has "923609016" and GLEIF "923 609 016"', async () => {
    const { source, requested } = replayGleif('uk-01285743')
    const result = await walk('01285743', fixtureFetcher(undefined, source).fetcher)
    expectValid(result)
    expect(requested.some((p) => p.includes('registeredAs]=923%20609%20016'))).toBe(true)
    expect(node(result, 'LEI:OW6OFBNCKXC4US5C7523')).toMatchObject({
      name: 'EQUINOR ASA',
      depth: 1,
      reasonCode: 'GLEIF_EXCEPTION_NATURAL_PERSONS',
    })
    expect(result.edges[0]).toMatchObject({ source: 'ch', band: [75, 100] })
  })

  it('follows SAP SE although CH has "Hrb719915" and GLEIF "HRB 719915"', async () => {
    const { source, requested } = replayGleif('uk-02152073')
    const result = await walk('02152073', fixtureFetcher(undefined, source).fetcher)
    expectValid(result)
    expect(requested.some((p) => p.includes('registeredAs]=HRB%20719915'))).toBe(true)
    expect(node(result, 'LEI:529900D6BF99LW9R2E68')).toMatchObject({ name: 'SAP SE', reasonCode: 'GLEIF_NO_KNOWN_PERSON' })
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
    expect(psc).toMatchObject({ reasonCode: 'REGISTER_PAYWALLED' })
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
    expect(several.psc.reasonCode).toBe('REGISTER_PAYWALLED')

    const lapsed = await run(identification, [record('A'.repeat(20), 'LAPSED')])
    expect(lapsed.psc.reasonCode).toBe('REGISTER_PAYWALLED')
    expect(lapsed.searches).toEqual(['12345678|NL'])
  })

  it('does not follow when two normalised matches sit in different registration authorities', async () => {
    const make = (lei: string, registeredAt: string, registeredAs: string): GleifRecord => ({
      lei,
      legalName: 'Foreign Parent GmbH',
      country: 'DE',
      registeredAt,
      registeredAs,
      registrationStatus: 'ISSUED',
    })
    // HRB numbers are only unique per court: "HRB 719915" and "HRB-719915" are two companies.
    const { psc, result } = await run({ country_registered: 'Germany', registration_number: 'Hrb719915' }, [
      make('A'.repeat(20), 'RA000296', 'HRB 719915'),
      make('B'.repeat(20), 'RA000297', 'HRB-719915'),
    ])
    expect(psc).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'FREE_MANUAL_RETRIEVAL' })
    expect(result.nodes.some((n) => n.id.startsWith('LEI:'))).toBe(false)
  })

  it('ignores a returned record whose registration number does not normalise to the PSC\'s', async () => {
    const other: GleifRecord = {
      lei: 'C'.repeat(20),
      legalName: 'Someone Else',
      country: 'NO',
      registeredAs: '111 222 333',
      registrationStatus: 'ISSUED',
    }
    const { psc } = await run({ country_registered: 'Norway', registration_number: '923609016' }, [other])
    expect(psc.reasonCode).toBe('SHAREHOLDERS_NOT_FILED')
  })

  it('records Cayman\'s second reason as secondary only', async () => {
    const { psc } = await run({ country_registered: 'Cayman Islands', registration_number: 'MC-1' })
    expect(psc).toMatchObject({ reasonCode: 'REGISTER_PAYWALLED', secondaryReasons: ['UBO_REGISTER_RESTRICTED'] })
    expect(psc.registerProfile?.country).toBe('KY')
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

  it('marks only the unconfirmed profiles as unverified', () => {
    const unverified = Object.values(REGISTER_PROFILES).filter((p) => !p.verified).map((p) => p.country).sort()
    expect(unverified).toEqual(['CH', 'FI', 'GG', 'JE', 'SE', 'VG'])
  })

  it('uses the verified default reason codes', () => {
    const codes = Object.fromEntries(Object.values(REGISTER_PROFILES).map((p) => [p.country, p.defaultReasonCode]))
    expect(codes).toMatchObject({
      IE: 'UBO_REGISTER_RESTRICTED',
      LU: 'UBO_REGISTER_RESTRICTED',
      NL: 'REGISTER_PAYWALLED',
      DE: 'FREE_MANUAL_RETRIEVAL',
      FR: 'SHAREHOLDERS_NOT_FILED',
      ES: 'REGISTER_PAYWALLED',
      DK: 'UBO_REGISTER_RESTRICTED',
      NO: 'SHAREHOLDERS_NOT_FILED',
      US: 'REGISTER_PAYWALLED',
      KY: 'REGISTER_PAYWALLED',
    })
    expect(REGISTER_PROFILES.KY.secondaryReasonCodes).toEqual(['UBO_REGISTER_RESTRICTED'])
  })

  it('treats an unknown country as REGISTER_NOT_PROFILED', () => {
    expect(stopReasonFor('BM')).toBe('REGISTER_NOT_PROFILED')
    expect(stopReasonFor(undefined)).toBe('REGISTER_NOT_PROFILED')
    expect(profileFor('BM')).toBeUndefined()
    expect(stopReasonFor('de')).toBe('FREE_MANUAL_RETRIEVAL')
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
