import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { walk } from '../walk'
import { createKycSearchFetcher } from '../kyc-search-fetcher'

describe('createKycSearchFetcher', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubEnv('KYC_SEARCH_URL', 'https://kyc.test')
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://kyc.test/companies/22222222') {
        return new Response(JSON.stringify({ company_name: 'PARENT LTD' }), { status: 200 })
      }
      if (url === 'https://kyc.test/companies/22222222/pscs') {
        return new Response(
          JSON.stringify({
            items: [{ kind: 'individual-person-with-significant-control', name: 'Owner', natures_of_control: ['ownership-of-shares-75-to-100-percent'] }],
          }),
          { status: 200 },
        )
      }
      return new Response(null, { status: 404 })
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    fetchMock.mockReset()
  })

  it('serves the root from memory and only fetches the companies above it', async () => {
    const fetcher = createKycSearchFetcher('token', {
      companyNumber: '11111111',
      companyProfile: { company_name: 'ROOT LTD' },
      officers: [],
      pscs: [
        {
          kind: 'corporate-entity-person-with-significant-control',
          name: 'Parent Ltd',
          identification: { registration_number: '22222222', country_registered: 'England' },
          natures_of_control: ['ownership-of-shares-75-to-100-percent'],
        },
      ],
    })

    const result = await walk('11111111', fetcher)

    const urls = fetchMock.mock.calls.map(([url]) => url)
    expect(urls).toEqual(['https://kyc.test/companies/22222222', 'https://kyc.test/companies/22222222/pscs'])
    expect(result.nodes[0].name).toBe('ROOT LTD')
    expect(result.status).toBe('resolved')
  })
})
