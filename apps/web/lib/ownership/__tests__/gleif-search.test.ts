import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createGleifSource, isHistoric, sortByStanding, standing } from '../gleif-source'
import type { GleifRecord } from '../types'

const FILE = path.resolve(__dirname, '../../../../../__fixtures__/gleif/search/nordea-bank.json')
const recorded = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, { status: number; body: unknown }>

function replay(extra: Record<string, { status: number; body: unknown }> = {}) {
  const requested: string[] = []
  const all = { ...recorded, ...extra }
  const source = createGleifSource({
    async get(p) {
      requested.push(p)
      const hit = all[p]
      if (!hit) throw new Error(`GLEIF request not recorded: ${p}`)
      return hit
    },
  })
  return { source, requested }
}

const record = (lei: string, registrationStatus: string, entityStatus?: string): GleifRecord => ({
  lei,
  legalName: lei,
  registrationStatus,
  ...(entityStatus ? { entityStatus } : {}),
})

describe('name search — recorded autocompletions for "Nordea Bank"', () => {
  it('puts Nordea Bank Abp first among the active ISSUED results', async () => {
    const { source } = replay()
    const found = await source.searchByName('Nordea Bank', 10)

    expect(found[0]).toMatchObject({ lei: '529900ODI3047E2LIV03', legalName: 'Nordea Bank Abp', country: 'FI', entityStatus: 'ACTIVE', registrationStatus: 'ISSUED' })
    const ranks = found.map(standing)
    expect(ranks).toEqual([...ranks].sort())
    // Active and ISSUED, then LAPSED, then the historic rest.
    expect(found.slice(0, 2).map((r) => r.legalName)).toEqual(['Nordea Bank Abp', 'Nordea Bank S.A.'])
    expect(found[2]).toMatchObject({ legalName: 'NORDEA DIRECT BANK ASA', registrationStatus: 'LAPSED' })
    expect(found.slice(3).every((r) => standing(r) === 2)).toBe(true)
  })

  it('marks retired and inactive entities, and duplicates, as historic', async () => {
    const found = await replay().source.searchByName('Nordea Bank', 10)
    const byName = (name: string) => found.find((r) => r.legalName === name)!
    expect(isHistoric(byName('Nordea Bank Norge ASA'))).toBe(true)
    expect(isHistoric(byName('NORDEA BANK AB'))).toBe(true)
    expect(isHistoric(byName('Nordea Bank Abp'))).toBe(false)
    expect(isHistoric(byName('NORDEA DIRECT BANK ASA'))).toBe(false)
  })

  it('treats the NULL entity status GLEIF sends as missing', async () => {
    const found = await replay().source.searchByName('Nordea Bank', 10)
    const duplicate = found.find((r) => r.registrationStatus === 'DUPLICATE')!
    expect(duplicate.entityStatus).toBeUndefined()
  })

  it('uses autocompletions?field=fulltext and one batched lei-records call, no fuzzy search', async () => {
    const { source, requested } = replay()
    await source.searchByName('Nordea Bank', 10)
    expect(requested).toHaveLength(2)
    expect(requested[0]).toBe('/autocompletions?field=fulltext&q=Nordea%20Bank')
    expect(requested[1]).toMatch(/^\/lei-records\?filter\[lei\]=([A-Z0-9]{20},){9}[A-Z0-9]{20}&page\[size\]=10$/)
  })
})

describe('name search — fallback and ordering', () => {
  const completions = (...leis: string[]) => ({
    status: 200,
    body: { data: leis.map((id) => ({ type: 'completions', attributes: { value: id }, relationships: { 'lei-records': { data: { type: 'lei-records', id } } } })) },
  })
  const records = (...items: { lei: string; status: string; entity: string }[]) => ({
    status: 200,
    body: {
      data: items.map(({ lei, status, entity }) => ({
        id: lei,
        attributes: { lei, entity: { legalName: { name: lei }, status: entity }, registration: { status } },
      })),
    },
  })
  const A = 'A'.repeat(20)

  it('falls back to fuzzycompletions only when autocompletions finds nothing', async () => {
    const { source, requested } = replay({
      '/autocompletions?field=fulltext&q=Zed': completions(),
      '/fuzzycompletions?field=entity.legalName&q=Zed': completions(A),
      [`/lei-records?filter[lei]=${A}&page[size]=10`]: records({ lei: A, status: 'ISSUED', entity: 'ACTIVE' }),
    })
    const found = await source.searchByName('Zed', 10)
    expect(found.map((r) => r.lei)).toEqual([A])
    expect(requested.slice(0, 2)).toEqual(['/autocompletions?field=fulltext&q=Zed', '/fuzzycompletions?field=entity.legalName&q=Zed'])
  })

  it('returns nothing when both searches are empty', async () => {
    const { source } = replay({
      '/autocompletions?field=fulltext&q=Nope': completions(),
      '/fuzzycompletions?field=entity.legalName&q=Nope': completions(),
    })
    expect(await source.searchByName('Nope', 10)).toEqual([])
  })

  it('sorts active ISSUED, then LAPSED, then the rest, keeping relevance order within each', () => {
    const sorted = sortByStanding([
      record('RETIRED1', 'RETIRED', 'INACTIVE'),
      record('LAPSED1', 'LAPSED', 'ACTIVE'),
      record('OK1', 'ISSUED', 'ACTIVE'),
      record('PENDING', 'PENDING_TRANSFER', 'ACTIVE'),
      record('OK2', 'ISSUED', 'ACTIVE'),
      record('LAPSED2', 'LAPSED', 'INACTIVE'),
    ])
    expect(sorted.map((r) => r.lei)).toEqual(['OK1', 'OK2', 'LAPSED1', 'LAPSED2', 'RETIRED1', 'PENDING'])
  })
})
