import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchEntityCdd } from '@/lib/companies-house/fetch-entity-cdd'
import { walk } from '../walk'
import { createKycSearchFetcher } from '../kyc-search-fetcher'

const FIXTURES = path.resolve(__dirname, '../../../../../__fixtures__')
const BASE = 'https://kyc.test'

type Route = { status: number; body?: unknown; headers?: Record<string, string> }

function recorded(companyNumber: string, file: string): Route {
  const { status, body } = JSON.parse(readFileSync(path.join(FIXTURES, 'ch', companyNumber, `${file}.json`), 'utf8'))
  return { status, body, headers: { 'X-Fetched-At': '2026-10-06T09:00:00Z' } }
}

function ok(body: unknown, fetchedAt = '2026-10-06T09:00:00Z'): Route {
  return { status: 200, body, headers: { 'X-Fetched-At': fetchedAt } }
}

const profile = (n: string, name = `COMPANY ${n}`) => ok({ company_number: n, company_name: name })

describe('createKycSearchFetcher', () => {
  const fetchMock = vi.fn()
  let routes: Record<string, Route>

  beforeEach(() => {
    routes = {}
    vi.stubEnv('KYC_SEARCH_URL', BASE)
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    fetchMock.mockImplementation(async (url: string) => {
      const route = routes[url.slice(BASE.length)]
      if (!route) return new Response(null, { status: 404 })
      const body = route.body === undefined ? null : JSON.stringify(route.body)
      return new Response(body, { status: route.status, headers: route.headers })
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    fetchMock.mockReset()
  })

  const paths = () => fetchMock.mock.calls.map(([url]) => (url as string).slice(BASE.length))

  it('serves the root from memory, fetches PSCs fresh, and records X-Fetched-At per company', async () => {
    routes = {
      '/companies/11111111': ok({ company_name: 'ROOT LTD' }, '2026-10-01T08:00:00Z'),
      '/companies/11111111/officers?fresh=true': ok({ items: [] }),
      '/companies/11111111/pscs?fresh=true': ok(
        {
          items: [
            {
              kind: 'corporate-entity-person-with-significant-control',
              name: 'Parent Ltd',
              identification: { registration_number: '22222222', country_registered: 'England' },
              natures_of_control: ['ownership-of-shares-75-to-100-percent'],
            },
          ],
        },
        '2026-10-06T09:00:00Z',
      ),
      '/companies/22222222': profile('22222222', 'PARENT LTD'),
      '/companies/22222222/pscs?fresh=true': ok(
        {
          items: [
            { kind: 'individual-person-with-significant-control', name: 'Owner', natures_of_control: ['ownership-of-shares-75-to-100-percent'] },
          ],
        },
        '2026-10-06T09:05:00Z',
      ),
    }

    const root = await fetchEntityCdd('11111111', 'token')
    fetchMock.mockClear()
    const result = await walk('11111111', createKycSearchFetcher('token', root))

    expect(paths()).toEqual([
      '/companies/11111111/exemptions',
      '/companies/22222222',
      '/companies/22222222/exemptions',
      '/companies/22222222/pscs?fresh=true',
    ])
    const byId = new Map(result.nodes.map((node) => [node.id, node]))
    expect(byId.get('GB:11111111')).toMatchObject({ name: 'ROOT LTD', fetchedAt: '2026-10-01T08:00:00Z' })
    expect(byId.get('GB:22222222')).toMatchObject({ name: 'PARENT LTD', fetchedAt: '2026-10-06T09:00:00Z' })
    expect(result.status).toBe('resolved')
  })

  it('requests officers and PSCs with ?fresh=true when loading the root', async () => {
    routes = {
      '/companies/11111111': ok({ company_name: 'ROOT LTD' }),
      '/companies/11111111/officers?fresh=true': ok({ items: [] }),
      '/companies/11111111/pscs?fresh=true': ok({ items: [] }),
    }

    const root = await fetchEntityCdd('11111111', 'token')

    expect(paths()).toEqual([
      '/companies/11111111',
      '/companies/11111111/officers?fresh=true',
      '/companies/11111111/pscs?fresh=true',
    ])
    expect(root.fetchedAt).toEqual({ profile: '2026-10-06T09:00:00Z', pscs: '2026-10-06T09:00:00Z' })
  })

  it('resolves J Sainsbury plc (00185647) as RESOLVED_LISTED via the exemptions endpoint', async () => {
    routes = {
      '/companies/00185647': recorded('00185647', 'profile'),
      '/companies/00185647/exemptions': recorded('00185647', 'exemptions'),
    }

    const result = await walk('00185647', createKycSearchFetcher('token'))

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]).toMatchObject({
      name: 'J SAINSBURY PLC',
      resolution: 'RESOLVED_LISTED',
      fetchedAt: '2026-10-06T09:00:00Z',
    })
    expect(result.status).toBe('resolved')
    expect(paths()).not.toContain('/companies/00185647/pscs?fresh=true')
  })

  it('ends PSC_STATEMENT for a company with no PSCs and an active statement', async () => {
    routes = {
      '/companies/33333333': profile('33333333'),
      '/companies/33333333/pscs?fresh=true': ok({ items: [] }),
      '/companies/33333333/pscs/statements': ok({
        items: [{ statement: 'no-individual-or-entity-with-signficant-control', notified_on: '2020-01-01' }],
      }),
    }

    const result = await walk('33333333', createKycSearchFetcher('token'))

    expect(result.nodes[0]).toMatchObject({
      resolution: 'UNRESOLVED',
      reasonCode: 'PSC_STATEMENT',
      statementCode: 'no-individual-or-entity-with-signficant-control',
    })
  })

  it('treats 404 on statements and exemptions as none on file: PSC_NONE_FILED', async () => {
    routes = {
      '/companies/44444444': profile('44444444'),
      '/companies/44444444/pscs?fresh=true': ok({ items: [] }),
    }

    const result = await walk('44444444', createKycSearchFetcher('token'))

    expect(paths()).toContain('/companies/44444444/pscs/statements')
    expect(paths()).toContain('/companies/44444444/exemptions')
    expect(result.nodes[0]).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'PSC_NONE_FILED' })
  })

  it('ends SOURCE_UNAVAILABLE on a 503 and records Retry-After', async () => {
    routes = {
      '/companies/55555555': profile('55555555'),
      '/companies/55555555/pscs?fresh=true': { status: 503, headers: { 'Retry-After': '30' } },
    }

    const result = await walk('55555555', createKycSearchFetcher('token'))

    expect(result.nodes[0]).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'SOURCE_UNAVAILABLE', retryAfter: '30' })
    expect(result.status).toBe('unresolved')
  })

  it('keeps a 5xx on statements as SOURCE_UNAVAILABLE, not PSC_NONE_FILED', async () => {
    routes = {
      '/companies/66666666': profile('66666666'),
      '/companies/66666666/pscs?fresh=true': ok({ items: [] }),
      '/companies/66666666/pscs/statements': { status: 502 },
    }

    const result = await walk('66666666', createKycSearchFetcher('token'))

    expect(result.nodes[0]).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'SOURCE_UNAVAILABLE' })
    expect(result.nodes[0].retryAfter).toBeUndefined()
  })
})
