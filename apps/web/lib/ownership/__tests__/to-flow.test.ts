import { describe, expect, it } from 'vitest'
import { walk } from '../walk'
import { edgeLabel, initials, toFlow } from '../to-flow'
import { fixtureFetcher } from './fixture-fetcher'

describe('toFlow', () => {
  it('03261722 gives three nodes with J Sainsbury plc green, owners above the target', async () => {
    const { fetcher } = fixtureFetcher()
    const { nodes, edges } = toFlow(await walk('03261722', fetcher))

    expect(nodes).toHaveLength(3)
    expect(edges).toHaveLength(2)
    const plc = nodes.find((n) => n.id === 'GB:00185647')!
    expect(plc.data.tone).toBe('resolved')
    expect(plc.data.resolution).toBe('RESOLVED_LISTED')

    const root = nodes.find((n) => n.id === 'GB:03261722')!
    expect(plc.position.y).toBeLessThan(root.position.y)
    expect(edges.every((e) => e.label)).toBe(true)
  })

  it('OE005000 at maxDepth 6 has a DEPTH_LIMIT_REACHED node shown as unresolved', async () => {
    const { fetcher } = fixtureFetcher()
    const { nodes } = toFlow(await walk('OE005000', fetcher, { maxDepth: 6 }))

    const limit = nodes.filter((n) => n.data.reasonCode === 'DEPTH_LIMIT_REACHED')
    expect(limit).toHaveLength(1)
    expect(limit[0].data.tone).toBe('unresolved')
  })

  it('masks individuals to initials everywhere', async () => {
    const { fetcher } = fixtureFetcher()
    const { nodes } = toFlow(await walk('OE005000', fetcher, { maxDepth: 10 }))

    const person = nodes.find((n) => n.data.subtitle === 'individual')!
    expect(person.data.name).toBe('S.A.S.')
    expect(person.data.companyUrl).toBeUndefined()
    expect(JSON.stringify(nodes)).not.toMatch(/Schwarzman|Stephen/)
  })
})

describe('initials', () => {
  it('drops titles and handles surname-first names', () => {
    expect(initials('Mr Stephen Allen Schwarzman')).toBe('S.A.S.')
    expect(initials('SMITH, John Paul')).toBe('J.P.S.')
    expect(initials('')).toBe('?')
  })
})

describe('edgeLabel', () => {
  it('describes band and control', () => {
    expect(edgeLabel([75, 100], ['ownership-of-shares-75-to-100-percent'])).toBe('75-100% shares')
    expect(edgeLabel([25, 50], ['voting-rights-25-to-50-percent', 'right-to-appoint-and-remove-directors'])).toBe(
      '25-50% votes + control',
    )
    expect(edgeLabel(null, ['significant-influence-or-control'])).toBe('control')
  })
})
