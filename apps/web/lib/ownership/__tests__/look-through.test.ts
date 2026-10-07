import { describe, expect, it } from 'vitest'
import { walk } from '../walk'
import { summarise } from '../to-flow'
import { corporatePsc, fixtureFetcher, profile, pscList, type CompanyFixture } from './fixture-fetcher'

const SHARES_75_100 = ['ownership-of-shares-75-to-100-percent', 'voting-rights-75-to-100-percent']
const SHARES_25_50 = ['ownership-of-shares-25-to-50-percent']

function person(natures: string[], extra: Record<string, unknown> = {}) {
  return { kind: 'individual-person-with-significant-control', name: 'Mr Test Person', natures_of_control: natures, ...extra }
}

function chain(companyName: string, psc: Record<string, unknown>): Record<string, CompanyFixture> {
  return { AA000001: { profile: profile('AA000001', companyName), pscs: pscList(psc) } }
}

async function individual(companyName: string, psc: Record<string, unknown>) {
  const { fetcher } = fixtureFetcher(chain(companyName, psc))
  const result = await walk('AA000001', fetcher)
  return result.nodes.find((n) => n.kind === 'individual')!
}

describe('PSC_LOOK_THROUGH_LIKELY', () => {
  it('flags the top individual of the OE005000 chain without changing its resolution', async () => {
    const { fetcher } = fixtureFetcher()
    const result = await walk('OE005000', fetcher, { maxDepth: 10 })
    const top = result.nodes.find((n) => n.kind === 'individual')!
    expect(top.secondaryReasons).toContain('PSC_LOOK_THROUGH_LIKELY')
    expect(top.resolution).toBe('RESOLVED_INDIVIDUAL')
    expect(top.reasonCode).toBeUndefined()
    expect(result.status).toBe('resolved')
    expect(summarise(result).pointsToCheck).toHaveLength(1)
  })

  it('does not flag a UK-resident individual above an ordinary trading company', async () => {
    const node = await individual('ACME TRADING LIMITED', person(SHARES_75_100, { country_of_residence: 'England' }))
    expect(node.secondaryReasons).toEqual([])
  })

  it('flags 75-100% when the holder lives outside the UK, even for an ordinary company name', async () => {
    const node = await individual('ACME TRADING LIMITED', person(SHARES_75_100, { country_of_residence: 'Bermuda' }))
    expect(node.secondaryReasons).toEqual(['PSC_LOOK_THROUGH_LIKELY'])
    expect(node.resolution).toBe('RESOLVED_INDIVIDUAL')
    expect(node.reasonCode).toBeUndefined()
  })

  it('never flags a 25-50% individual', async () => {
    const node = await individual('ACME TOPCO LIMITED', person(SHARES_25_50, { country_of_residence: 'Bermuda' }))
    expect(node.secondaryReasons).toEqual([])
  })

  it('flags 75-100% below a holding-company-style name', async () => {
    const node = await individual('ACME HOLDCO LIMITED', person(SHARES_75_100))
    expect(node.secondaryReasons).toEqual(['PSC_LOOK_THROUGH_LIKELY'])
  })

  it('uses company names higher on the path', async () => {
    const { fetcher } = fixtureFetcher({
      AA000001: { profile: profile('AA000001', 'ACME TRADING LIMITED'), pscs: pscList(corporatePsc('AA000002', SHARES_75_100)) },
      AA000002: { profile: profile('AA000002', 'ACME TOPCO LIMITED'), pscs: pscList(person(SHARES_75_100)) },
    })
    const result = await walk('AA000001', fetcher)
    expect(result.nodes.find((n) => n.kind === 'individual')!.secondaryReasons).toEqual(['PSC_LOOK_THROUGH_LIKELY'])
  })
})
