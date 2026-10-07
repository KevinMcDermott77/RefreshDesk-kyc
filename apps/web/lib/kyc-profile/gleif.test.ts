import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearGleifCache, lookupLei, parseGleif } from './gleif'

const record = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../../__fixtures__/gleif/03261722/record.json'), 'utf8'),
)

function respond(body: unknown, ok = true) {
  return vi.fn(async (_url: URL | string) => ({ ok, json: async () => body }) as Response)
}

beforeEach(clearGleifCache)

describe('gleif', () => {
  it('parses a recorded record', () => {
    expect(parseGleif({ data: [record] })).toMatchObject({
      status: 'found',
      lei: '213800KMLDLT2PROXX14',
      registrationStatus: 'ISSUED',
      legalName: "SAINSBURY'S SUPERMARKETS LTD",
    })
    expect(parseGleif({ data: [] })).toEqual({ status: 'none' })
  })

  it('queries by registration number for GB and caches for 24h', async () => {
    const fetchImpl = respond({ data: [record] })
    let t = 0
    const first = await lookupLei('03261722', fetchImpl as unknown as typeof fetch, () => t)
    expect(first.lookup.status).toBe('found')
    const url = decodeURIComponent(String(fetchImpl.mock.calls[0][0]))
    expect(url).toContain('filter[entity.registeredAs]=03261722')
    expect(url).toContain('filter[entity.legalAddress.country]=GB')

    t = 23 * 3600 * 1000
    await lookupLei('03261722', fetchImpl as unknown as typeof fetch, () => t)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    t = 25 * 3600 * 1000
    await lookupLei('03261722', fetchImpl as unknown as typeof fetch, () => t)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('reports failures as unavailable and does not cache them', async () => {
    const bad = respond({}, false)
    expect((await lookupLei('03261722', bad as unknown as typeof fetch)).lookup.status).toBe('unavailable')
    const good = respond({ data: [record] })
    expect((await lookupLei('03261722', good as unknown as typeof fetch)).lookup.status).toBe('found')
  })
})
