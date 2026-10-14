import { describe, expect, it } from 'vitest'
import { snapshotFingerprint } from '../canonical'
import {
  assertNoPersonalNames,
  buildSnapshot,
  findForbiddenKeys,
  parseSnapshot,
  sealSnapshot,
  type PackSnapshot,
} from '../snapshot'
import { buildFixtureInput, buildFixtureSnapshot, SOURCE_LOG } from './fixtures'

describe('buildSnapshot', () => {
  it('shows individuals as initials only, everywhere', async () => {
    const snapshot = await buildFixtureSnapshot()
    const text = JSON.stringify(snapshot)

    const person = snapshot.chart.nodes.find((n) => n.data.resolutionLabel === 'Individual')!
    expect(person.data.name).toBe('S.A.S.')
    expect(text).not.toMatch(/Schwarzman|Stephen/i)
    expect(text).not.toMatch(/date_of_birth|nationality|country_of_residence|occupation/i)
  })

  it('carries the source log, the policy and the subject unchanged', async () => {
    const snapshot = await buildFixtureSnapshot()
    expect(snapshot.sourceLog).toEqual(SOURCE_LOG)
    expect(snapshot.sourceLog.every((e) => e.register && e.path && e.fetchedAt && typeof e.status === 'number')).toBe(true)
    expect(snapshot.policy).toEqual({ threshold: 25, maxDepth: 10, indirectMethod: 'either', acceptRegulatedAsTerminal: true })
    expect(snapshot.subject).toEqual({ id: 'OE005000', kind: 'overseas_entity', name: 'Test Overseas Entity' })
    expect(snapshot.version).toBe(1)
    expect(snapshot.generatedAt).toBe('2026-10-14T10:00:00.000Z')
  })

  it('holds what the page renders: profile, summary, points to check, chart', async () => {
    const snapshot = await buildFixtureSnapshot()
    expect(snapshot.profile.map((r) => r.key)).toContain('ownership')
    expect(snapshot.chart.nodes.length).toBeGreaterThan(2)
    expect(snapshot.chart.edges.length).toBeGreaterThan(1)
    expect(snapshot.summary.walkStatus).toBe('resolved')
    expect(snapshot.summary.openBranches).toBe(0)
    expect(snapshot.summary.status).toBe('complete')
    expect(Array.isArray(snapshot.pointsToCheck)).toBe(true)
  })

  it('is partial, with the open branches counted, when the walk stops short', async () => {
    const input = await buildFixtureInput()
    const shallow = await buildFixtureInput({ policy: { ...input.policy, maxDepth: 6 } })
    // Re-walk at depth 6 for the same fixture.
    const { walk } = await import('@/lib/ownership/walk')
    const { fixtureFetcher } = await import('@/lib/ownership/__tests__/fixture-fetcher')
    const { summarise, toFlow } = await import('@/lib/ownership/to-flow')
    const walked = await walk('OE005000', fixtureFetcher().fetcher, { maxDepth: 6 })
    const snapshot = buildSnapshot({ ...shallow, walked, flow: toFlow(walked), summary: summarise(walked) })

    expect(snapshot.summary.status).toBe('partial')
    expect(snapshot.summary.openBranches).toBe(1)
    expect(snapshot.summary.unresolved[0]).toMatchObject({ reasonCode: 'DEPTH_LIMIT_REACHED' })
  })

  it('is plain JSON: no undefined, so what is hashed is what is stored', async () => {
    const snapshot = await buildFixtureSnapshot()
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
  })

  it('refuses to build if an individual\'s full name has leaked into a profile line', async () => {
    const input = await buildFixtureInput()
    const leaky = { ...input, profile: [...input.profile, { key: 'officers' as const, label: 'Officers', mark: 'INFO' as const, lines: ['Mr Stephen Allen Schwarzman — director'] }] }
    expect(() => buildSnapshot(leaky)).toThrow(/must not contain individuals/)
  })

  it('also catches an officer\'s name written surname-first or in the other order', async () => {
    const input = await buildFixtureInput()
    const lines = (line: string) => ({ ...input, individualNames: ['GRANT, Nicolas Stuart'], profile: [{ key: 'officers' as const, label: 'Officers', mark: 'INFO' as const, lines: [line] }] })
    expect(() => buildSnapshot(lines('Nicolas Stuart GRANT — secretary'))).toThrow(/must not contain individuals/)
    expect(() => buildSnapshot(lines('GRANT, Nicolas Stuart — secretary'))).toThrow(/must not contain individuals/)
    expect(() => buildSnapshot(lines('N.S.G. — secretary'))).not.toThrow()
  })

  it('refuses personal-data keys anywhere', async () => {
    const input = await buildFixtureInput()
    const nodes = structuredClone(input.flow.nodes) as unknown as Record<string, unknown>[]
    ;(nodes[0].data as Record<string, unknown>).nationality = 'British'
    expect(() => buildSnapshot({ ...input, flow: { nodes: nodes as never, edges: input.flow.edges } })).toThrow(/personal data/)
  })
})

describe('assertNoPersonalNames / findForbiddenKeys', () => {
  it('ignores very short names and matches case-insensitively', () => {
    expect(() => assertNoPersonalNames({ a: 'Jo' }, ['Jo'])).not.toThrow()
    expect(() => assertNoPersonalNames({ a: 'MR JOHN SMITH' }, ['John Smith'])).toThrow()
  })

  it('finds forbidden keys at any depth, in any case or separator style', () => {
    expect(findForbiddenKeys({ a: [{ b: { Date_Of_Birth: 1 } }], c: { 'country-of-residence': 'x' } })).toEqual([
      'snapshot.a[0].b.Date_Of_Birth',
      'snapshot.c.country-of-residence',
    ])
    expect(findForbiddenKeys({ ok: { name: 'S.A.S.' } })).toEqual([])
  })
})

describe('sealSnapshot / parseSnapshot', () => {
  it('seals with the fingerprint of its canonical JSON', async () => {
    const snapshot = await buildFixtureSnapshot()
    const sealed = await sealSnapshot(snapshot)
    expect(sealed.sha256).toBe(await snapshotFingerprint(snapshot))
    expect(sealed.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('accepts a built snapshot, also after a JSON round trip', async () => {
    const snapshot = await buildFixtureSnapshot()
    const stored = JSON.parse(JSON.stringify(snapshot)) as PackSnapshot
    expect(parseSnapshot(stored)).toEqual(snapshot)
  })

  it('rejects a snapshot that is malformed or holds personal data', async () => {
    const snapshot = await buildFixtureSnapshot()
    expect(() => parseSnapshot({ ...snapshot, version: 2 })).toThrow(/Not a valid refresh pack snapshot/)
    expect(() => parseSnapshot({ ...snapshot, sourceLog: 'none' })).toThrow(/Not a valid/)
    expect(() => parseSnapshot({ ...snapshot, extra: { date_of_birth: '1970-01-01' } })).toThrow(/personal data/)
  })
})
