import { describe, expect, it } from 'vitest'
import { walk } from '../walk'
import { edgeLabel, formatFetchedAt, formatRange, initials, summarise, toFlow } from '../to-flow'
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
    expect(plc.data.resolutionLabel).toBe('Listed company')
    expect(nodes.find((n) => n.id === 'GB:16565950')!.data.resolutionLabel).toBe('Intermediate')

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

    const person = nodes.find((n) => n.data.resolutionLabel === 'Individual')!
    expect(person.data.name).toBe('S.A.S.')
    expect(person.data.companyUrl).toBeUndefined()
    expect(JSON.stringify(nodes)).not.toMatch(/Schwarzman|Stephen/)
  })
})

describe('friendly labels', () => {
  it('keeps UNRESOLVED as its code and the individual as "Individual"', async () => {
    const { fetcher } = fixtureFetcher()
    const { nodes } = toFlow(await walk('OE005000', fetcher, { maxDepth: 10 }))
    expect(nodes.find((n) => n.data.resolutionLabel === 'Individual')!.data.resolutionLabel).toBe('Individual')
    const limited = toFlow(await walk('OE005000', fixtureFetcher().fetcher, { maxDepth: 6 })).nodes
    expect(limited.find((n) => n.data.reasonCode === 'DEPTH_LIMIT_REACHED')!.data.resolutionLabel).toBe('UNRESOLVED')
  })
})

describe('initials', () => {
  it('drops titles and handles surname-first names', () => {
    expect(initials('Mr Stephen Allen Schwarzman')).toBe('S.A.S.')
    expect(initials('SMITH, John Paul')).toBe('J.P.S.')
    expect(initials('')).toBe('?')
    expect(initials('S.A.S.')).toBe('S.A.S.')
    expect(initials('AB')).toBe('A.')
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

describe('summarise', () => {
  it('counts walked-through companies as intermediate, not as a resolution', async () => {
    const { fetcher } = fixtureFetcher()
    const summary = summarise(await walk('03261722', fetcher))
    expect(summary.intermediate).toBe(2)
    expect(summary.notReached).toBe(0)
    expect(summary.counts).toEqual({ RESOLVED_LISTED: 1 })
    expect(summary.sourceUnavailable).toBe(false)
  })

  it('flags SOURCE_UNAVAILABLE', async () => {
    const { fetcher } = fixtureFetcher()
    const summary = summarise(await walk('99999999', fetcher))
    expect(summary.sourceUnavailable).toBe(true)
  })
})

describe('formatting', () => {
  it('limits ranges to one decimal place', () => {
    expect(formatRange([23.7499, 100])).toBe('23.7-100%')
    expect(formatRange([18.75, 25])).toBe('18.8-25%')
    expect(formatRange(undefined)).toBeUndefined()
    expect(edgeLabel([18.75, 25], ['ownership-of-shares-25-to-50-percent'])).toContain('18.8-25%')
  })

  it('formats fetchedAt in London time', () => {
    expect(formatFetchedAt('2026-10-07T19:04:00Z')).toBe('7 Oct 2026, 20:04')
    expect(formatFetchedAt('2026-01-07T19:04:00Z')).toBe('7 Jan 2026, 19:04')
    expect(formatFetchedAt(undefined)).toBeUndefined()
  })
})
