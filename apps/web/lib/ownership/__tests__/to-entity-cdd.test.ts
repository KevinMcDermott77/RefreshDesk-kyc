import { describe, expect, it } from 'vitest'
import { walk } from '../walk'
import { toEntityCddOwnership } from '../to-entity-cdd'
import { fixtureFetcher } from './fixture-fetcher'

describe('toEntityCddOwnership', () => {
  it('maps a resolved walk to full quality with direct owners only', async () => {
    const { fetcher } = fixtureFetcher()
    const stored = toEntityCddOwnership(await walk('03261722', fetcher))

    expect(stored.pscDataQuality).toBe('full')
    expect(stored.pscWarning).toBeNull()
    expect(stored.ownershipChain).toEqual([
      expect.objectContaining({ company_number: '16565950', kind: 'corporate', ownership_percentage: null, is_ubo: false }),
    ])
    expect(stored.uboList).toEqual([])
  })

  it('names the unresolved branch and statement in the warning', async () => {
    const { fetcher } = fixtureFetcher()
    const stored = toEntityCddOwnership(await walk('11391321', fetcher))

    expect(stored.pscDataQuality).toBe('none')
    expect(stored.pscWarning).toContain('13383560')
    expect(stored.pscWarning).toContain('PSC_STATEMENT: no-individual-or-entity-with-signficant-control')
  })

  it('lists an indirect individual as a UBO', async () => {
    const { fetcher } = fixtureFetcher()
    const stored = toEntityCddOwnership(await walk('OE005000', fetcher, { maxDepth: 10 }))

    expect(stored.uboList.map((u) => u.name)).toEqual(['Mr Stephen Allen Schwarzman'])
    expect(stored.ownershipChain).toHaveLength(1)
  })
})
