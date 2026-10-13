import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { createTerminalLookups, parseEcbLeis, parseSecTickers } from '../terminal-sources'
import {
  listedEU,
  matchRegulatedVenue,
  normaliseListingName,
  regulatedEU,
  usListing,
  type FirdsRow,
  type IsoMic,
  type TerminalLookups,
} from '../terminals'
import { LEIS, recordedLookups } from './terminal-fixtures'

const iso = (over: Partial<IsoMic> & { mic: string }): IsoMic => ({
  operatingMic: over.mic,
  category: 'RMKT',
  country: 'DE',
  name: over.mic,
  status: 'ACTIVE',
  ...over,
})

/** Lookups over small in-memory data, for the rules that the recording does not exercise. */
function stub(over: Partial<TerminalLookups> = {}): TerminalLookups {
  return {
    firdsEquities: async () => [],
    regulatedMarkets: async () => new Map(),
    isoMics: async () => new Map(),
    upregFirms: async () => [],
    ecbSupervised: async () => null,
    secTickers: async () => null,
    now: () => new Date('2026-10-13T12:00:00Z'),
    ...over,
  }
}

const equity = (mic: string, over: Partial<FirdsRow> = {}): FirdsRow => ({
  isin: 'XX0000000001',
  mic,
  cfi: 'ESVUFR',
  status: 'UNCH',
  latestReceived: true,
  ...over,
})

describe('listedEU — recorded ESMA responses', () => {
  it('Nordea Bank Abp is listed on Nasdaq Helsinki', async () => {
    const evidence = await listedEU(LEIS.nordea, recordedLookups())
    expect(evidence).toMatchObject({
      kind: 'listed_eu',
      source: 'ESMA FIRDS (instrument reference data)',
      details: { isin: 'FI4000297767', mic: 'XHEL', operatingMic: 'XHEL', venueName: 'Nasdaq Helsinki Oy', rule: 'mir' },
    })
    expect(evidence!.url).toContain('esma_registers_firds')
    expect(decodeURIComponent(evidence!.url)).toContain(`lei:${LEIS.nordea}`)
  })

  it('DNB Bank ASA is listed on Oslo Børs', async () => {
    expect((await listedEU(LEIS.dnb, recordedLookups()))!.details).toMatchObject({ isin: 'NO0010161896', mic: 'XOSL', rule: 'mir' })
  })

  it('Allianz SE is listed on a Frankfurt regulated-market segment', async () => {
    const evidence = await listedEU(LEIS.allianz, recordedLookups())
    expect(evidence!.details).toMatchObject({ isin: 'DE0008404005', rule: 'mir', operatingMic: 'XFRA' })
  })

  it("prefers the issuer's home market for the evidence", async () => {
    const mir = new Map([['EQTB', 'Equiduct Berlin'], ['XOSL', 'Oslo Børs Main Market']])
    const venues = new Map([
      ['EQTB', iso({ mic: 'EQTB', country: 'DE' })],
      ['XOSL', iso({ mic: 'XOSL', country: 'NO' })],
    ])
    const lookups = stub({
      firdsEquities: async () => [equity('EQTB', { isin: 'NO0010096985' }), equity('XOSL', { isin: 'NO0010096985' })],
      regulatedMarkets: async () => mir,
      isoMics: async () => venues,
    })
    expect((await listedEU('A'.repeat(20), lookups))!.details).toMatchObject({ mic: 'XOSL' })
  })

  it('caches: a second lookup makes no new requests', async () => {
    const lookups = recordedLookups()
    await listedEU(LEIS.nordea, lookups)
    const first = lookups.requested.length
    await listedEU(LEIS.nordea, lookups)
    expect(lookups.requested.length).toBe(first)
  })

  it('refuses a LEI that could alter the query', async () => {
    await expect(recordedLookups().firdsEquities('X) OR lei:*')).rejects.toThrow('not an LEI')
  })
})

describe('listedEU — what counts as listed', () => {
  const mir = new Map([['XHEL', 'Nasdaq Helsinki Oy']])

  it('does not treat a bond-only issuer as listed', async () => {
    const lookups = stub({
      firdsEquities: async () => [equity('XHEL', { cfi: 'DBXXFX' }), equity('XHEL', { cfi: 'DTFXFB' })],
      regulatedMarkets: async () => mir,
    })
    expect(await listedEU('A'.repeat(20), lookups)).toBeNull()
  })

  it('ignores terminated rows and past termination dates', async () => {
    const regulatedMarkets = async () => mir
    expect(await listedEU('A'.repeat(20), stub({ regulatedMarkets, firdsEquities: async () => [equity('XHEL', { status: 'TERM' })] }))).toBeNull()
    expect(
      await listedEU('A'.repeat(20), stub({ regulatedMarkets, firdsEquities: async () => [equity('XHEL', { terminationDate: '2020-12-31T22:59:59Z' })] })),
    ).toBeNull()
    expect(
      await listedEU('A'.repeat(20), stub({ regulatedMarkets, firdsEquities: async () => [equity('XHEL', { terminationDate: '9999-12-31T00:00:00Z' })] })),
    ).not.toBeNull()
    expect(await listedEU('A'.repeat(20), stub({ regulatedMarkets, firdsEquities: async () => [equity('XHEL', { latestReceived: false })] }))).toBeNull()
  })

  it('does not count an instrument that is only on an MTF', async () => {
    const lookups = stub({
      firdsEquities: async () => [equity('NSME')],
      regulatedMarkets: async () => mir,
      isoMics: async () => new Map([['NSME', iso({ mic: 'NSME', operatingMic: 'XNGM', category: 'MLTF', country: 'SE' })]]),
    })
    expect(await listedEU('A'.repeat(20), lookups)).toBeNull()
  })
})

describe('regulated-venue rules', () => {
  const mir = new Map([['XFRA', 'Frankfurt Stock Exchange']])

  it('rule a: the MIC is in the ESMA list', () => {
    expect(matchRegulatedVenue('XFRA', mir, new Map())).toMatchObject({ rule: 'mir', venueName: 'Frankfurt Stock Exchange' })
  })

  it('rule b: an ISO segment whose operating MIC is in the ESMA list', () => {
    const venues = new Map([['XFRB', iso({ mic: 'XFRB', operatingMic: 'XFRA', category: 'NSPD', name: 'FRANKFURT SEGMENT' })]])
    const match = matchRegulatedVenue('XFRB', new Map([['XFRA', 'Frankfurt Stock Exchange']]), venues)
    expect(match).toMatchObject({ rule: 'operating-mic', operatingMic: 'XFRA' })
  })

  it('rule b does not take an operator\'s multilateral trading facility for a regulated market', () => {
    const venues = new Map([['MERK', iso({ mic: 'MERK', operatingMic: 'XOSL', category: 'MLTF', country: 'NO' })]])
    expect(matchRegulatedVenue('MERK', new Map([['XOSL', 'Oslo Børs Main Market']]), venues)).toBeNull()
  })

  it('rule c: ISO says regulated market, in the EEA or GB', () => {
    const venues = new Map([
      ['XDEU', iso({ mic: 'XDEU', country: 'DE' })],
      ['XGBR', iso({ mic: 'XGBR', country: 'GB' })],
      ['XCAN', iso({ mic: 'XCAN', country: 'CA' })],
      ['XOFF', iso({ mic: 'XOFF', country: 'DE', status: 'EXPIRED' })],
    ])
    expect(matchRegulatedVenue('XDEU', new Map(), venues)).toMatchObject({ rule: 'iso-rmkt' })
    expect(matchRegulatedVenue('XGBR', new Map(), venues)).toMatchObject({ rule: 'iso-rmkt' })
    expect(matchRegulatedVenue('XCAN', new Map(), venues)).toBeNull()
    expect(matchRegulatedVenue('XOFF', new Map(), venues)).toBeNull()
  })

  it('records which rule matched in the evidence', async () => {
    const lookups = stub({
      firdsEquities: async () => [equity('XFRB')],
      regulatedMarkets: async () => mir,
      isoMics: async () => new Map([['XFRB', iso({ mic: 'XFRB', operatingMic: 'XFRA', category: 'NSPD' })]]),
    })
    expect((await listedEU('A'.repeat(20), lookups))!.details).toMatchObject({ mic: 'XFRB', operatingMic: 'XFRA', rule: 'operating-mic' })
  })

  it('an XETR-only row matches no rule: ISO lists XETR as its own operating MIC, category NSPD', async () => {
    // Known gap, not a feature: Xetra instruments are on Frankfurt's regulated market, but neither
    // ESMA's list nor ISO 10383 says so for the XETR MIC itself (ESMA lists XETA and XETU instead).
    const lookups = recordedLookups({ firdsEquities: async () => [equity('XETR', { isin: 'DE0008404005' })] })
    expect(await listedEU(LEIS.allianz, lookups)).toBeNull()
  })
})

describe('regulatedEU', () => {
  it('Nordea is an active MiFID investment firm (head office record)', async () => {
    const evidence = await regulatedEU(LEIS.nordea, recordedLookups())
    expect(evidence).toMatchObject({
      kind: 'regulated_eu',
      details: { register: 'ESMA upreg', authority: 'Finanssivalvonta (FSA)', status: 'Active', entity: 'Nordea Bank Abp' },
    })
  })

  it('DNB is an active MiFID investment firm', async () => {
    expect((await regulatedEU(LEIS.dnb, recordedLookups()))!.details.authority).toBe('Norwegian Financial Supervisory Authority')
  })

  it('Allianz SE is in neither register', async () => {
    expect(await regulatedEU(LEIS.allianz, recordedLookups())).toBeNull()
  })

  it('falls back to the ECB list, found by trying this month and the two before', async () => {
    const lookups = recordedLookups({ upregFirms: async () => [] })
    const evidence = await regulatedEU(LEIS.nordea, lookups)
    expect(evidence).toMatchObject({
      source: 'ECB list of supervised entities',
      details: { fileMonth: '202608', status: 'Supervised credit institution' },
    })
    const tried = lookups.requested.filter((u) => u.includes('listofsupervisedentities')).map((u) => u.match(/entities(\d{6})/)![1])
    expect(tried).toEqual(['202610', '202609', '202608'])
    expect(evidence!.url).toContain('202608')
  })

  it('ignores inactive and non-MiFID entries', async () => {
    const firms = [
      { name: 'Old', typeCode: 'MIF', typeLabel: 'Investment firm', status: 'Inactive', authority: 'X', officeType: 'Head office' },
      { name: 'SI', typeCode: 'MIS', typeLabel: 'Systematic internaliser', status: 'Active', authority: 'X', officeType: 'Head office' },
    ]
    expect(await regulatedEU('A'.repeat(20), stub({ upregFirms: async () => firms }))).toBeNull()
  })
})

describe('ECB workbook', () => {
  it('reads the LEIs out of the shared strings', () => {
    const xml = `<sst><si><t>Name</t></si><si><t>${LEIS.nordea}</t></si><si><t>Some Bank</t></si><si><t>NOTANLEI</t></si></sst>`
    const leis = parseEcbLeis(zipSync({ 'xl/sharedStrings.xml': strToU8(xml) }))
    expect([...leis]).toEqual([LEIS.nordea])
  })
})

describe('usListing', () => {
  const tickers = [
    { cik: '1', name: 'Acme Holdings Inc.', ticker: 'ACME', exchange: 'Nasdaq' },
    { cik: '2', name: 'Acme Holdings Inc.', ticker: 'ACMEX', exchange: 'OTC' },
    { cik: '3', name: 'Bigco Corporation', ticker: 'BIG', exchange: 'NYSE' },
  ]

  it('is skipped silently without a SEC User-Agent', async () => {
    const lookups = createTerminalLookups({ fetchImpl: (async () => { throw new Error('no request expected') }) as typeof fetch, secUserAgent: undefined })
    expect(await lookups.secTickers()).toBeNull()
    expect(await usListing('Acme Holdings', { ...stub(), secTickers: lookups.secTickers })).toBeNull()
  })

  it('matches an exact normalised name on NYSE or Nasdaq only, as evidence with ticker and exchange', async () => {
    const lookups = stub({ secTickers: async () => tickers })
    expect(await usListing('ACME HOLDINGS, INC', lookups)).toMatchObject({
      kind: 'us_listing',
      details: { ticker: 'ACME', exchange: 'Nasdaq' },
    })
    expect(await usListing('Bigco Corp', lookups)).toMatchObject({ details: { ticker: 'BIG', exchange: 'NYSE' } })
    expect(await usListing('Acme', lookups)).toBeNull()
    expect(await usListing('Acme Holdings Group Inc', lookups)).toBeNull()
  })

  it('parses the SEC file layout and sends the configured User-Agent', async () => {
    const body = { fields: ['cik', 'name', 'ticker', 'exchange'], data: [[320193, 'Apple Inc.', 'AAPL', 'Nasdaq']] }
    expect(parseSecTickers(body)).toEqual([{ cik: '320193', name: 'Apple Inc.', ticker: 'AAPL', exchange: 'Nasdaq' }])
    let agent = ''
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      agent = String((init?.headers as Record<string, string>)['user-agent'])
      return new Response(JSON.stringify(body), { status: 200 })
    }) as typeof fetch
    const lookups = createTerminalLookups({ fetchImpl, secUserAgent: 'Test Co test@example.com', minGapMs: 0 })
    expect(await lookups.secTickers()).toHaveLength(1)
    expect(agent).toBe('Test Co test@example.com')
  })

  it('normalises names', () => {
    expect(normaliseListingName('Apple Inc.')).toBe('apple')
    expect(normaliseListingName('AT&T Corp')).toBe('at and t')
  })
})
