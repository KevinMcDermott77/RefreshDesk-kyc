import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { kycSearchGet } from '@/lib/companies-house/kyc-search-client'
import { createGleifHttp, createLimiter, withSourceLog } from '@/lib/kyc-profile/gleif'
import { createTerminalLookups } from '@/lib/ownership/terminal-sources'
import { replayFetch } from '@/lib/ownership/__tests__/terminal-fixtures'
import { LEIS } from '@/lib/ownership/__tests__/terminal-fixtures'
import { createSourceLog, scrubPath } from '../source-log'

describe('scrubPath', () => {
  it('keeps the path and query but drops the host, user info and fragment', () => {
    expect(scrubPath('https://user:pw@api.gleif.org/api/v1/lei-records?filter[lei]=ABC&page[size]=10#frag')).toBe(
      '/api/v1/lei-records?filter[lei]=ABC&page[size]=10',
    )
    expect(scrubPath('/companies/03261722/pscs/raw')).toBe('/companies/03261722/pscs/raw')
  })

  it('masks the value of credential-looking parameters', () => {
    expect(scrubPath('/x?api_key=SECRET&token=T&q=lei:ABC&Authorization=Bearer%20X&signature=S')).toBe(
      '/x?api_key=***&token=***&q=lei:ABC&Authorization=***&signature=***',
    )
  })

  it('does not throw on odd input', () => {
    expect(scrubPath('/x?q=100%')).toContain('/x?q=100%')
  })
})

describe('createSourceLog', () => {
  it('records entries in order and hands out copies', () => {
    const log = createSourceLog()
    log.record({ register: 'A', path: '/a', fetchedAt: '2026-01-01T00:00:00Z', status: 200 })
    log.record({ register: 'B', path: '/b', fetchedAt: '2026-01-01T00:00:01Z', status: 404, cached: true })
    const entries = log.entries()
    expect(entries.map((e) => e.register)).toEqual(['A', 'B'])
    entries[0].register = 'changed'
    expect(log.entries()[0].register).toBe('A')
  })
})

describe('Companies House fetches (kyc-search)', () => {
  const original = global.fetch
  beforeEach(() => {
    process.env.KYC_SEARCH_URL = 'https://kyc.private.example'
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })
  afterEach(() => {
    global.fetch = original
    vi.restoreAllMocks()
  })

  it('logs the path, status and CH fetch time, never the host or the token', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'x-fetched-at': '2026-10-14T08:59:00Z' } })) as typeof fetch
    const log = createSourceLog()
    await kycSearchGet('/companies/03261722/pscs/raw', 'TOKEN-123', log)
    expect(log.entries()).toEqual([
      { register: 'Companies House (via kyc-search)', path: '/companies/03261722/pscs/raw', fetchedAt: '2026-10-14T08:59:00Z', status: 200 },
    ])
    expect(JSON.stringify(log.entries())).not.toMatch(/TOKEN|private\.example/)
  })

  it('logs a 404 and a 503 as the fetches they were', async () => {
    const statuses = [404, 503]
    global.fetch = vi.fn(async () => new Response('', { status: statuses.shift()! })) as typeof fetch
    const log = createSourceLog()
    await kycSearchGet('/companies/X/exemptions', 't', log)
    await kycSearchGet('/companies/X/pscs/statements', 't', log)
    expect(log.entries().map((e) => e.status)).toEqual([404, 503])
  })

  it('logs nothing, and still works, without a log', async () => {
    global.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as typeof fetch
    await expect(kycSearchGet('/companies/X', 't')).resolves.toMatchObject({ status: 200 })
  })
})

describe('GLEIF fetches', () => {
  it('logs each request with its status, and marks a cached response with its original fetch time', async () => {
    let t = Date.parse('2026-10-14T09:00:00Z')
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200 }))
    const http = createGleifHttp({ fetchImpl: fetchImpl as unknown as typeof fetch, now: () => t, limiter: createLimiter(50), cache: new Map() })
    const log = createSourceLog()
    const logged = withSourceLog(http, log)

    await logged.get('/lei-records/AAAAAAAAAAAAAAAAAAAA')
    t += 60_000
    await logged.get('/lei-records/AAAAAAAAAAAAAAAAAAAA')

    expect(log.entries()).toEqual([
      { register: 'GLEIF', path: '/api/v1/lei-records/AAAAAAAAAAAAAAAAAAAA', fetchedAt: '2026-10-14T09:00:00.000Z', status: 200 },
      { register: 'GLEIF', path: '/api/v1/lei-records/AAAAAAAAAAAAAAAAAAAA', fetchedAt: '2026-10-14T09:00:00.000Z', status: 200, cached: true },
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('logs a failed request with status 0 and rethrows', async () => {
    const http = { get: async () => Promise.reject(new Error('GLEIF request failed (503)')) }
    const log = createSourceLog()
    await expect(withSourceLog(http, log).get('/lei-records/X')).rejects.toThrow('503')
    expect(log.entries()).toMatchObject([{ register: 'GLEIF', path: '/api/v1/lei-records/X', status: 0 }])
  })

  it('returns the client itself when there is no log', () => {
    const http = { get: async () => ({ status: 200, body: null }) }
    expect(withSourceLog(http, undefined)).toBe(http)
  })
})

describe('terminal register fetches', () => {
  it('logs every register used, and lists them again (cached, original time) on the next run', async () => {
    const { fetchImpl } = replayFetch()
    let t = Date.parse('2026-10-13T12:00:00Z')
    const lookups = createTerminalLookups({ fetchImpl, now: () => t, sleep: async () => undefined, secUserAgent: undefined, minGapMs: 0 })

    const first = createSourceLog()
    const view = lookups.withLog(first)
    await view.firdsEquities(LEIS.nordea)
    await view.regulatedMarkets()
    await view.isoMics()

    const registers = first.entries().map((e) => e.register)
    expect(registers).toEqual(['ESMA FIRDS', 'ESMA regulated markets', 'ISO 10383 MIC list'])
    expect(first.entries().every((e) => e.status === 200 && !e.cached)).toBe(true)
    expect(first.entries()[0].path).toContain('/solr/esma_registers_firds/select?q=lei:' + LEIS.nordea)
    expect(JSON.stringify(first.entries())).not.toMatch(/https?:\/\//)

    t += 3600_000
    const second = createSourceLog()
    const again = lookups.withLog(second)
    await again.firdsEquities(LEIS.nordea)
    await again.regulatedMarkets()
    expect(second.entries().map((e) => [e.register, e.cached, e.fetchedAt])).toEqual([
      ['ESMA FIRDS', true, '2026-10-13T12:00:00.000Z'],
      ['ESMA regulated markets', true, '2026-10-13T12:00:00.000Z'],
    ])
  })

  it('logs each ECB month tried, including the ones that were not there', async () => {
    const { fetchImpl } = replayFetch()
    const lookups = createTerminalLookups({ fetchImpl, now: () => Date.parse('2026-10-13T12:00:00Z'), sleep: async () => undefined, secUserAgent: undefined, minGapMs: 0 })
    const log = createSourceLog()
    await lookups.withLog(log).ecbSupervised()
    expect(log.entries().map((e) => [e.path.match(/entities(\d{6})/)![1], e.status])).toEqual([
      ['202610', 404],
      ['202609', 404],
      ['202608', 200],
    ])
  })

  it('records nothing for an unlogged view', async () => {
    const { fetchImpl } = replayFetch()
    const lookups = createTerminalLookups({ fetchImpl, now: () => 1, sleep: async () => undefined, secUserAgent: undefined, minGapMs: 0 })
    await expect(lookups.firdsEquities(LEIS.dnb)).resolves.toBeDefined()
  })
})
