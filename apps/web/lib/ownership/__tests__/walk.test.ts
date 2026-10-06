import { describe, expect, it } from 'vitest'
import { walk } from '../walk'
import { classify } from '../bands'
import { ownershipEdgeSchema, ownershipNodeSchema, type WalkPolicy, type WalkResult } from '../types'
import { corporatePsc, fixtureFetcher, individualPsc, profile, pscList, type CompanyFixture } from './fixture-fetcher'

const SHARES_75_100 = ['ownership-of-shares-75-to-100-percent', 'voting-rights-75-to-100-percent']
const SHARES_50_75 = ['ownership-of-shares-50-to-75-percent']
const SHARES_25_50 = ['ownership-of-shares-25-to-50-percent']

function node(result: WalkResult, id: string) {
  const found = result.nodes.find((n) => n.id === id)
  if (!found) throw new Error(`no node ${id}`)
  return found
}

function companyNumbers(result: WalkResult) {
  return result.nodes.filter((n) => n.kind === 'corporate' && n.id.startsWith('GB:')).map((n) => n.companyNumber)
}

function expectValidShape(result: WalkResult) {
  for (const n of result.nodes) ownershipNodeSchema.parse(n)
  for (const e of result.edges) ownershipEdgeSchema.parse(e)
}

describe('walk — recorded Companies House chains', () => {
  it('03261722 resolves to J Sainsbury plc via the UK regulated market exemption', async () => {
    const { fetcher, misses } = fixtureFetcher()
    const result = await walk('03261722', fetcher)

    expect(misses).toEqual([])
    expectValidShape(result)
    expect(result.status).toBe('resolved')
    expect(companyNumbers(result)).toEqual(['03261722', '16565950', '00185647'])

    const plc = node(result, 'GB:00185647')
    expect(plc.resolution).toBe('RESOLVED_LISTED')
    expect(plc.depth).toBe(2)
    expect(plc.lei).toBe('213800VGZAAJIKJ9Y484')

    // The ceased direct holding by J Sainsbury plc is ignored: one owner of the root.
    expect(result.edges.filter((e) => e.childId === 'GB:03261722')).toHaveLength(1)
  })

  it('11391321 ends on a PSC statement at 13383560 after six levels', async () => {
    const { fetcher, misses } = fixtureFetcher()
    const result = await walk('11391321', fetcher)

    expect(misses).toEqual([])
    expectValidShape(result)
    expect(result.status).toBe('unresolved')
    expect(companyNumbers(result)).toEqual([
      '11391321',
      '11417685',
      '11415952',
      '13383544',
      '15850122',
      '13383560',
    ])

    const end = node(result, 'GB:13383560')
    expect(end.resolution).toBe('UNRESOLVED')
    expect(end.reasonCode).toBe('PSC_STATEMENT')
    expect(end.depth).toBe(5)
    expect(end.statementCode).toBe('no-individual-or-entity-with-signficant-control')
  })

  it('01854213 stops at depth 1 on a corporate PSC with no registration number', async () => {
    const { fetcher, misses, calls } = fixtureFetcher()
    const result = await walk('01854213', fetcher)

    expect(misses).toEqual([])
    expect(result.status).toBe('unresolved')
    expect(calls.every((c) => c.startsWith('01854213/'))).toBe(true)

    const owners = result.nodes.filter((n) => n.depth === 1)
    expect(owners).toHaveLength(1)
    expect(owners[0]).toMatchObject({
      name: 'Pret A Manger Limited',
      resolution: 'UNRESOLVED',
      reasonCode: 'FOREIGN_ENTITY_UNMATCHED',
    })
  })

  it('OE005000 hits the depth limit at maxDepth 6', async () => {
    const { fetcher, misses } = fixtureFetcher()
    const result = await walk('OE005000', fetcher, { maxDepth: 6 })

    expect(misses).toEqual([])
    expect(result.status).toBe('unresolved')
    expect(node(result, 'GB:12467857')).toMatchObject({
      depth: 6,
      resolution: 'UNRESOLVED',
      reasonCode: 'DEPTH_LIMIT_REACHED',
    })
    expect(result.nodes.some((n) => n.companyNumber === '12467359')).toBe(false)
  })

  it('OE005000 resolves to an individual at depth 8 with maxDepth 10', async () => {
    const { fetcher, misses } = fixtureFetcher()
    const result = await walk('OE005000', fetcher, { maxDepth: 10 })

    expect(misses).toEqual([])
    expectValidShape(result)
    expect(result.status).toBe('resolved')

    const individuals = result.nodes.filter((n) => n.kind === 'individual')
    expect(individuals).toHaveLength(1)
    expect(individuals[0]).toMatchObject({
      name: 'Mr Stephen Allen Schwarzman',
      resolution: 'RESOLVED_INDIVIDUAL',
      depth: 8,
    })
  })

  it('emits ranges, never midpoint percentages', async () => {
    const { fetcher } = fixtureFetcher()
    const result = await walk('03261722', fetcher, { indirectMethod: 'multiply' })
    expect(node(result, 'GB:16565950').effectiveRange).toEqual([75, 100])
    expect(node(result, 'GB:00185647').effectiveRange).toEqual([56.25, 100])
    expect(JSON.stringify(result)).not.toMatch(/37\.5|62\.5|87\.5|percentage/)

    // 75-100 links are majority links, so the default (either) passes the full interest through.
    const byDefault = await walk('03261722', fetcher)
    expect(node(byDefault, 'GB:00185647')).toMatchObject({
      effectiveRange: [100, 100],
      effectiveRangeMultiply: [56.25, 100],
      effectiveRangeMajority: [100, 100],
    })
  })
})

describe('walk — synthetic cases', () => {
  const run = (companies: Record<string, CompanyFixture>, policy: WalkPolicy = {}) => {
    const { fetcher, misses } = fixtureFetcher(companies)
    return walk('SY000001', fetcher, policy).then((result) => ({ result, misses }))
  }

  it('flags circular ownership A -> B -> A', async () => {
    const { result, misses } = await run({
      SY000001: { profile: profile('SY000001'), pscs: pscList(corporatePsc('SY000002', SHARES_75_100)) },
      SY000002: { profile: profile('SY000002'), pscs: pscList(corporatePsc('SY000001', SHARES_75_100)) },
    })

    expect(misses).toEqual([])
    expect(result.status).toBe('unresolved')
    const loop = result.nodes.find((n) => n.reasonCode === 'CIRCULAR_OWNERSHIP')
    expect(loop).toMatchObject({ companyNumber: 'SY000001', resolution: 'UNRESOLVED', depth: 2 })
  })

  it('reports PSC_NONE_FILED when there are no PSCs, statements or exemptions', async () => {
    const { result } = await run({
      SY000001: { profile: profile('SY000001'), pscs: pscList() },
    })

    expect(result.status).toBe('unresolved')
    expect(node(result, 'GB:SY000001')).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'PSC_NONE_FILED' })
  })

  it('reports SOURCE_UNAVAILABLE rather than PSC_NONE_FILED when statements fail to load', async () => {
    const { result } = await run({
      SY000001: { profile: profile('SY000001'), pscs: pscList(), psc_statements: { status: 503, body: null } },
    })

    expect(node(result, 'GB:SY000001').reasonCode).toBe('SOURCE_UNAVAILABLE')
  })

  it('treats a super-secure PSC as unresolved', async () => {
    const { result } = await run({
      SY000001: {
        profile: profile('SY000001'),
        pscs: pscList({ kind: 'super-secure-person-with-significant-control', description: 'super-secure-persons-with-significant-control' }),
      },
    })

    expect(result.status).toBe('unresolved')
    expect(result.nodes.find((n) => n.depth === 1)).toMatchObject({
      kind: 'super_secure',
      resolution: 'UNRESOLVED',
      reasonCode: 'PSC_SUPER_SECURE',
    })
  })

  it('is partial with one individual and one unresolved corporate (8-digit non-UK number is not matched)', async () => {
    const { result, misses } = await run({
      SY000001: {
        profile: profile('SY000001'),
        pscs: pscList(
          individualPsc('Jane Owner', SHARES_50_75),
          corporatePsc('12345678', SHARES_25_50, {
            identification: { registration_number: '12345678', country_registered: 'Delaware', place_registered: 'Delaware Division of Corporations' },
          }),
        ),
      },
    })

    expect(misses).toEqual([])
    expect(result.status).toBe('partial')
    expect(result.nodes.find((n) => n.kind === 'corporate' && n.depth === 1)).toMatchObject({
      resolution: 'UNRESOLVED',
      reasonCode: 'FOREIGN_ENTITY_UNMATCHED',
    })
  })

  it('keeps an unresolved branch whose band straddles 25% material (multiply)', async () => {
    const { result } = await run({
      SY000001: {
        profile: profile('SY000001'),
        pscs: pscList(individualPsc('Jane Owner', SHARES_50_75), corporatePsc('SY000002', SHARES_25_50)),
      },
      SY000002: {
        profile: profile('SY000002'),
        pscs: pscList(individualPsc('Indirect Owner', SHARES_75_100), {
          kind: 'corporate-entity-person-with-significant-control',
          name: 'Offshore Co',
          natures_of_control: SHARES_75_100,
        }),
      },
    }, { indirectMethod: 'multiply' })

    // 25-50 x 75-100 = 18.75-50: may or may not exceed 25%.
    const offshore = result.nodes.find((n) => n.name === 'Offshore Co')
    expect(offshore).toMatchObject({ effectiveRange: [18.75, 50], resolution: 'UNRESOLVED' })
    expect(result.nodes.find((n) => n.name === 'Indirect Owner')).toMatchObject({
      resolution: 'RESOLVED_INDIVIDUAL',
      reasonCode: 'BAND_STRADDLES_THRESHOLD',
    })
    expect(result.status).toBe('partial')
  })

  it('prunes a corporate branch entirely below 25% instead of walking it', async () => {
    const { result, misses } = await run({
      SY000001: {
        profile: profile('SY000001'),
        pscs: pscList(individualPsc('Jane Owner', SHARES_50_75), corporatePsc('SY000002', SHARES_25_50)),
      },
      SY000002: {
        profile: profile('SY000002'),
        pscs: pscList(corporatePsc('SY000003', SHARES_25_50)),
      },
    })

    // 25-50 x 25-50 = 6.25-25: cannot exceed 25%, so SY000003 is never fetched.
    expect(misses).toEqual([])
    expect(result.nodes.find((n) => n.depth === 2)).toMatchObject({ resolution: 'PRUNED', effectiveRange: [6.25, 25] })
    expect(result.status).toBe('resolved')
  })
})

describe('walk — GLEIF secondary reasons', () => {
  it('adds GLEIF reporting exceptions without changing the CH resolution', async () => {
    const { fetcher } = fixtureFetcher()
    const sainsbury = await walk('03261722', fetcher)
    expect(node(sainsbury, 'GB:00185647')).toMatchObject({
      resolution: 'RESOLVED_LISTED',
      secondaryReasons: ['GLEIF_NO_KNOWN_PERSON'],
    })

    const pret = await walk('11391321', fetcher)
    expect(node(pret, 'GB:11391321')).toMatchObject({
      resolution: 'PENDING',
      secondaryReasons: ['GLEIF_EXCEPTION_NON_PUBLIC'],
    })
    expect(node(pret, 'GB:13383560')).toMatchObject({ reasonCode: 'PSC_STATEMENT', secondaryReasons: [] })

    const oe = await walk('OE005000', fetcher, { maxDepth: 10 })
    expect(node(oe, 'GB:12474076').secondaryReasons).toEqual(['GLEIF_EXCEPTION_NO_LEI'])
  })

  it('never lets GLEIF override an unresolved CH outcome', async () => {
    const { fetcher } = fixtureFetcher({
      SY000001: {
        profile: profile('SY000001'),
        pscs: pscList(),
        gleif: { lei: 'TESTLEI0000000000001', reportingExceptions: ['NATURAL_PERSONS', 'NON_CONSOLIDATING', 'UNKNOWN_REASON'] },
      },
    })
    const result = await walk('SY000001', fetcher)

    expect(result.status).toBe('unresolved')
    expect(node(result, 'GB:SY000001')).toMatchObject({
      resolution: 'UNRESOLVED',
      reasonCode: 'PSC_NONE_FILED',
      lei: 'TESTLEI0000000000001',
      secondaryReasons: ['GLEIF_EXCEPTION_NATURAL_PERSONS', 'GLEIF_EXCEPTION_NON_CONSOLIDATING'],
    })
  })
})

describe('walk — control rights are never pruned', () => {
  it.each(['right-to-appoint-and-remove-directors', 'significant-influence-or-control'])(
    'walks a branch held only via %s, even below a sub-threshold link',
    async (control) => {
      const { fetcher, misses } = fixtureFetcher({
        // SY000002 holds 25-50 of the root; SY000003 controls SY000002 with no
        // band; SY000004 holds 25-50 of SY000003. Banded links alone would give
        // 25-50 x 25-50 = 6.25-25 and be pruned.
        SY000001: { profile: profile('SY000001'), pscs: pscList(corporatePsc('SY000002', SHARES_25_50)) },
        SY000002: { profile: profile('SY000002'), pscs: pscList(corporatePsc('SY000003', [control])) },
        SY000003: { profile: profile('SY000003'), pscs: pscList(corporatePsc('SY000004', SHARES_25_50)) },
        SY000004: { profile: profile('SY000004'), pscs: pscList(individualPsc('Controller', SHARES_75_100)) },
      })
      const result = await walk('SY000001', fetcher)

      expect(misses).toEqual([])
      expect(result.nodes.some((n) => n.resolution === 'PRUNED')).toBe(false)
      expect(node(result, 'GB:SY000003')).toMatchObject({ resolution: 'PENDING', depth: 2 })
      // A band-less link has no product under multiply.
      expect(node(result, 'GB:SY000003').effectiveRangeMultiply).toBeUndefined()
      expect(result.nodes.find((n) => n.name === 'Controller')).toMatchObject({ resolution: 'RESOLVED_INDIVIDUAL', depth: 4 })
      expect(result.status).toBe('resolved')
    },
  )
})

describe('walk — pruning rules and indirect method', () => {
  const METHODS = ['multiply', 'majority', 'either'] as const
  const SHARES_25_50_APPOINT = ['ownership-of-shares-25-to-50-percent', 'right-to-appoint-and-remove-directors']

  // Root SY000001 <- SY000002 (inner link) <- SY000003 (outer link) <- individual.
  function chain(inner: string[], outer: string[]): Record<string, CompanyFixture> {
    return {
      SY000001: { profile: profile('SY000001'), pscs: pscList(corporatePsc('SY000002', inner)) },
      SY000002: { profile: profile('SY000002'), pscs: pscList(corporatePsc('SY000003', outer)) },
      SY000003: { profile: profile('SY000003'), pscs: pscList(individualPsc('Top Owner', SHARES_75_100)) },
    }
  }

  async function walkChain(companies: Record<string, CompanyFixture>, indirectMethod: (typeof METHODS)[number]) {
    const { fetcher, misses } = fixtureFetcher(companies)
    const result = await walk('SY000001', fetcher, { indirectMethod })
    expect(misses).toEqual([])
    return result
  }

  it.each(METHODS)('never prunes a 25-50 + appoint-directors link under a 25-50 link (%s)', async (method) => {
    const companies = chain(SHARES_25_50, SHARES_25_50_APPOINT)
    // A 25-50% holder above the control link must not be pruned either.
    companies.SY000003 = { profile: profile('SY000003'), pscs: pscList(corporatePsc('SY000004', SHARES_25_50)) }
    companies.SY000004 = { profile: profile('SY000004'), pscs: pscList(individualPsc('Top Owner', SHARES_75_100)) }
    const result = await walkChain(companies, method)

    expect(result.nodes.some((n) => n.resolution === 'PRUNED')).toBe(false)
    expect(node(result, 'GB:SY000003')).toMatchObject({ resolution: 'PENDING', effectiveRangeMultiply: [6.25, 25] })
    expect(node(result, 'GB:SY000004').resolution).toBe('PENDING')
    expect(result.edges.find((e) => e.parentId === 'GB:SY000003')?.band).toEqual([25, 50])
  })

  it.each([
    ['multiply', [25, 56.25]],
    ['majority', [100, 100]],
    ['either', [100, 100]],
  ] as const)('treats 60 of 60 (50-75 at both levels) as above the threshold (%s gives %j)', async (method, range) => {
    const result = await walkChain(chain(SHARES_50_75, SHARES_50_75), method)
    const outer = node(result, 'GB:SY000003')

    expect(outer).toMatchObject({ effectiveRangeMultiply: [25, 56.25], effectiveRangeMajority: [100, 100] })
    expect(outer.effectiveRange).toEqual(range)
    expect(classify(outer.effectiveRange!, 25)).toBe('above')
    expect(result.status).toBe('resolved')
  })

  it.each(METHODS)('prunes 25-50 under 25-50 as below the threshold (%s)', async (method) => {
    const result = await walkChain(chain(SHARES_25_50, SHARES_25_50), method)
    // Pruned holders are leaves: SY000003 is never fetched or given a company node.
    const outer = result.nodes.find((n) => n.depth === 2)

    expect(result.nodes.some((n) => n.id === 'GB:SY000003')).toBe(false)
    expect(outer).toMatchObject({
      resolution: 'PRUNED',
      effectiveRange: [6.25, 25],
      effectiveRangeMultiply: [6.25, 25],
      effectiveRangeMajority: [6.25, 25],
    })
  })

  it.each([
    ['multiply', [12.5, 37.5], 'straddles'],
    ['majority', [25, 50], 'above'],
    ['either', [25, 50], 'above'],
  ] as const)('50-75 under 25-50 with %s gives %j, which %s', async (method, range, expected) => {
    const result = await walkChain(chain(SHARES_25_50, SHARES_50_75), method)
    const outer = node(result, 'GB:SY000003')

    expect(outer).toMatchObject({ effectiveRangeMultiply: [12.5, 37.5], effectiveRangeMajority: [25, 50] })
    expect(outer.effectiveRange).toEqual(range)
    expect(classify(outer.effectiveRange!, 25)).toBe(expected)
  })

  it('defaults to either', async () => {
    const result = await walk('SY000001', fixtureFetcher(chain(SHARES_25_50, SHARES_50_75)).fetcher)
    expect(node(result, 'GB:SY000003').effectiveRange).toEqual([25, 50])
  })

  it.each([
    'right-to-appoint-and-remove-members-limited-liability-partnership',
    'right-to-appoint-and-remove-members-as-firm-limited-liability-partnership',
    'right-to-appoint-and-remove-members-as-trust-limited-liability-partnership',
  ])('treats %s as a majority link', async (nature) => {
    const result = await walkChain(chain(SHARES_25_50, [nature]), 'majority')
    expect(node(result, 'GB:SY000003').effectiveRange).toEqual([25, 50])
  })

  it('is never less conclusive than majority alone', async () => {
    // Every 3-link chain over these links; the top company has one individual owner.
    const LINKS = [
      SHARES_25_50,
      SHARES_50_75,
      SHARES_75_100,
      ['right-to-appoint-and-remove-directors'],
      ['significant-influence-or-control'],
      SHARES_25_50_APPOINT,
    ]
    let compared = 0

    for (const a of LINKS) {
      for (const b of LINKS) {
        for (const c of LINKS) {
          const companies: Record<string, CompanyFixture> = {
            SY000001: { profile: profile('SY000001'), pscs: pscList(corporatePsc('SY000002', a)) },
            SY000002: { profile: profile('SY000002'), pscs: pscList(corporatePsc('SY000003', b)) },
            SY000003: { profile: profile('SY000003'), pscs: pscList(corporatePsc('SY000004', c)) },
            SY000004: { profile: profile('SY000004'), pscs: pscList(individualPsc('Top Owner', SHARES_75_100)) },
          }
          const majority = await walk('SY000001', fixtureFetcher(companies).fetcher, { indirectMethod: 'majority' })
          const either = await walk('SY000001', fixtureFetcher(companies).fetcher, { indirectMethod: 'either' })

          for (const m of majority.nodes) {
            const e = either.nodes.find((n) => n.id === m.id)
            // Either may walk past a node majority pruned (it then has a different id),
            // but never prunes or loses a node that majority keeps...
            if (!e && m.resolution === 'PRUNED') continue
            expect(e, `${m.id} missing under either`).toBeDefined()
            if (!m.effectiveRange) continue
            // ...and its range is at least majority's at both bounds,
            expect(e!.effectiveRange![0]).toBeGreaterThanOrEqual(m.effectiveRange[0])
            expect(e!.effectiveRange![1]).toBeGreaterThanOrEqual(m.effectiveRange[1])
            // so anything majority puts above the threshold, either does too.
            if (classify(m.effectiveRange, 25) === 'above') expect(classify(e!.effectiveRange!, 25)).toBe('above')
            compared++
          }
          if (majority.status === 'resolved') expect(either.status).toBe('resolved')
        }
      }
    }

    expect(compared).toBeGreaterThan(LINKS.length ** 3)
  })
})
