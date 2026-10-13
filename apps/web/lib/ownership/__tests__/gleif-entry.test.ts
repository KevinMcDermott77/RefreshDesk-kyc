import { describe, expect, it, vi } from 'vitest'
import { createGleifHttp, createLimiter } from '@/lib/kyc-profile/gleif'
import { evaluateForeignProfile, NOT_FREE_NOTE } from '@/lib/kyc-profile/evaluate'
import { resolveEntry, type SearchableGleif } from '../resolve-entry'
import { GLEIF_EDGE_LABEL, toFlow } from '../to-flow'
import { walk } from '../walk'
import type { GleifRecord } from '../types'
import { fixtureFetcher, replayGleif } from './fixture-fetcher'

const record = (over: Partial<GleifRecord> = {}): GleifRecord => ({
  lei: '529900ODI3047E2LIV03',
  legalName: 'Nordea Bank Abp',
  country: 'FI',
  registeredAt: 'RA000188',
  registeredAs: '2858394-9',
  registrationStatus: 'ISSUED',
  entityStatus: 'ACTIVE',
  ...over,
})

function gleifStub(over: Partial<SearchableGleif> = {}): SearchableGleif {
  return {
    getRecord: async () => null,
    findByRegistration: async () => [],
    getDirectParent: async () => ({}),
    searchByName: async () => [],
    ...over,
  }
}

describe('resolveEntry', () => {
  it('routes a UK company number to the Companies House walk', async () => {
    expect(await resolveEntry(' 03261722 ', gleifStub())).toEqual({ kind: 'company', companyNumber: '03261722' })
    expect(await resolveEntry('oe005000', gleifStub())).toEqual({ kind: 'company', companyNumber: 'OE005000' })
  })

  it('routes an LEI with a Companies House registration to the CH walk, others to GLEIF', async () => {
    const uk = record({ lei: '213800KMLDLT2PROXX14', registeredAt: 'RA000585', registeredAs: '03261722', country: 'GB' })
    const getRecord = vi.fn(async (lei: string) => (lei === uk.lei ? uk : record()))
    expect(await resolveEntry(uk.lei, gleifStub({ getRecord }))).toEqual({ kind: 'company', companyNumber: '03261722' })
    expect(await resolveEntry('529900ODI3047E2LIV03', gleifStub({ getRecord }))).toMatchObject({ kind: 'lei' })
    // registeredAt is Companies House but registeredAs is not a UK number: not routed.
    const odd = record({ registeredAt: 'RA000585', registeredAs: 'not-a-number' })
    expect(await resolveEntry('529900ODI3047E2LIV03', gleifStub({ getRecord: async () => odd }))).toMatchObject({ kind: 'lei' })
  })

  it('searches GLEIF by name and offers the matches', async () => {
    const searchByName = vi.fn(async () => [record(), record({ lei: 'X'.repeat(20), legalName: 'Nordea Bank S.A.', country: 'LU' })])
    const result = await resolveEntry('Nordea Bank', gleifStub({ searchByName }))
    expect(searchByName).toHaveBeenCalledWith('Nordea Bank', 10)
    expect(result.kind === 'candidates' && result.candidates).toHaveLength(2)
  })

  it('reports empty input, no matches, an unknown LEI and an outage', async () => {
    expect(await resolveEntry('  ', gleifStub())).toMatchObject({ kind: 'error' })
    expect(await resolveEntry('ab', gleifStub())).toMatchObject({ kind: 'error' })
    expect(await resolveEntry('No Such Company', gleifStub())).toMatchObject({ kind: 'error', message: expect.stringContaining('No GLEIF matches') })
    expect(await resolveEntry('529900ODI3047E2LIV03', gleifStub())).toMatchObject({ kind: 'error', message: expect.stringContaining('No GLEIF record') })
    const down = gleifStub({ searchByName: async () => Promise.reject(new Error('x')) })
    expect(await resolveEntry('Nordea', down)).toMatchObject({ kind: 'error', message: expect.stringContaining('unavailable') })
  })
})

describe('toFlow for GLEIF chains', () => {
  it('dashes GLEIF edges, labels them and carries country and register profile', async () => {
    const result = await walk('529900H9Q8LI6GGZB203', fixtureFetcher({}, replayGleif('lu-1').source).fetcher)
    const { nodes, edges } = toFlow(result)

    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ label: GLEIF_EDGE_LABEL, dashed: true })
    const target = nodes.find((n) => n.id === 'LEI:529900H9Q8LI6GGZB203')!
    expect(target.data).toMatchObject({ country: 'LU', subtitle: 'LEI 529900H9Q8LI6GGZB203', resolutionLabel: 'Intermediate' })
    const stop = nodes.find((n) => n.id === 'LEI:529900K9B0N5BT694847')!
    expect(stop.data).toMatchObject({ country: 'DE', reasonCode: 'GLEIF_NO_KNOWN_PERSON' })
    expect(stop.data.registerProfile?.documentToRequest).toBeTruthy()
    // Owners above the owned entity.
    expect(stop.position.y).toBeLessThan(target.position.y)
  })

  it('does not dash Companies House edges', async () => {
    const { edges } = toFlow(await walk('01285743', fixtureFetcher().fetcher))
    expect(edges.every((e) => !e.dashed)).toBe(true)
  })
})

describe('evaluateForeignProfile', () => {
  const ownership = { status: 'unresolved' as const, threshold: 25, owners: [], possibleOwners: [] }

  it('takes identity from GLEIF and marks filings and officers INFO', () => {
    const rows = evaluateForeignProfile({ record: record({ legalForm: 'K6VE', address: 'Satamaradankatu 5, HELSINKI, FI' }), ownership })
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(byKey.identity.mark).toBe('PASS')
    expect(byKey.identity.lines).toEqual([
      'Legal name: Nordea Bank Abp',
      'Legal form: K6VE',
      'Legal address: Satamaradankatu 5, HELSINKI, FI',
      'Registration authority: RA000188, number 2858394-9',
      'Entity status: ACTIVE',
    ])
    expect(byKey.filings).toMatchObject({ mark: 'INFO', lines: [NOT_FREE_NOTE] })
    expect(byKey.officers).toMatchObject({ mark: 'INFO', lines: [NOT_FREE_NOTE] })
    expect(byKey.lei.mark).toBe('PASS')
    expect(byKey.lei.note).toMatch(/does not endorse/)
    expect(byKey.ownership.mark).toBe('GAP')
    expect(rows.map((r) => r.key)).toEqual(['identity', 'filings', 'officers', 'lei', 'ownership', 'not-covered'])
  })

  it('flags an inactive entity or lapsed LEI as a GAP', () => {
    const rows = evaluateForeignProfile({ record: record({ entityStatus: 'INACTIVE', registrationStatus: 'RETIRED' }), ownership })
    expect(rows.find((r) => r.key === 'identity')!.mark).toBe('GAP')
    expect(rows.find((r) => r.key === 'lei')!.mark).toBe('GAP')
  })
})

describe('GLEIF HTTP', () => {
  it('limits to 50 requests a minute by waiting for the window to move', async () => {
    let t = 0
    const slept: number[] = []
    const limiter = createLimiter(50)
    const sleep = async (ms: number) => {
      slept.push(ms)
      t += ms
    }
    for (let i = 0; i < 50; i++) await limiter.acquire(() => t, sleep)
    expect(slept).toEqual([])
    await limiter.acquire(() => t, sleep)
    expect(slept).toEqual([60_000])
  })

  it('caches 200 and 404 responses for 24h and throws on server errors', async () => {
    let t = 0
    const responses = [
      { status: 200, json: async () => ({ data: 1 }) },
      { status: 404, json: async () => ({ errors: [] }) },
      { status: 503, json: async () => ({}) },
    ]
    const fetchImpl = vi.fn(async () => responses.shift() as unknown as Response)
    const http = createGleifHttp({ fetchImpl: fetchImpl as unknown as typeof fetch, now: () => t, limiter: createLimiter(50), cache: new Map() })

    expect((await http.get('/a')).status).toBe(200)
    expect((await http.get('/a')).status).toBe(200)
    expect((await http.get('/b')).status).toBe(404)
    expect((await http.get('/b')).status).toBe(404)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    t = 25 * 3600 * 1000
    await expect(http.get('/a')).rejects.toThrow('503')
  })
})
