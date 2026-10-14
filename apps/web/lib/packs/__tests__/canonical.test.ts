import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256Hex, snapshotFingerprint } from '../canonical'

describe('canonicalJson', () => {
  it('sorts keys and uses no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe('{"a":{"c":"x","d":[1,2]},"b":1}')
  })

  it('is the same whatever order the keys were built in', () => {
    const one = { x: 1, y: { p: true, q: null }, z: [{ b: 1, a: 2 }] }
    const two = { z: [{ a: 2, b: 1 }], y: { q: null, p: true }, x: 1 }
    expect(canonicalJson(one)).toBe(canonicalJson(two))
  })

  it('keeps array order, which is meaningful', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
  })

  it('leaves out undefined properties like JSON.stringify, and writes -0 as 0', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
    expect(canonicalJson({ n: -0 })).toBe('{"n":0}')
  })

  it('escapes strings exactly as JSON does, and keeps unicode', () => {
    expect(canonicalJson({ s: 'a"b\\c\n', u: 'Brønnøysund ✓' })).toBe('{"s":"a\\"b\\\\c\\n","u":"Brønnøysund ✓"}')
  })

  it('refuses values JSON cannot represent', () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(/non-finite/)
    expect(() => canonicalJson({ n: Infinity })).toThrow(/non-finite/)
    expect(() => canonicalJson({ n: BigInt(1) })).toThrow(/bigint/)
    expect(() => canonicalJson({ f: () => 1 })).toThrow(/function/)
  })
})

describe('sha256Hex', () => {
  it('matches the standard test vectors', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('snapshotFingerprint', () => {
  const snapshot = { version: 1, subject: { id: '03261722' }, nodes: [{ id: 'a', range: [25, 50] }], note: 'x' }

  it('does not depend on key order', async () => {
    const reordered = { note: 'x', nodes: [{ range: [25, 50], id: 'a' }], subject: { id: '03261722' }, version: 1 }
    expect(await snapshotFingerprint(reordered)).toBe(await snapshotFingerprint(snapshot))
  })

  it('is the hash of the canonical JSON', async () => {
    expect(await snapshotFingerprint({ b: 1, a: 2 })).toBe(await sha256Hex('{"a":2,"b":1}'))
  })

  it('changes when any value changes, at any depth', async () => {
    const base = await snapshotFingerprint(snapshot)
    expect(await snapshotFingerprint({ ...snapshot, note: 'y' })).not.toBe(base)
    expect(await snapshotFingerprint({ ...snapshot, version: 2 })).not.toBe(base)
    expect(await snapshotFingerprint({ ...snapshot, nodes: [{ id: 'a', range: [25, 51] }] })).not.toBe(base)
    expect(await snapshotFingerprint({ ...snapshot, subject: { id: '03261723' } })).not.toBe(base)
  })

  it('changes when a key or an element is added or removed', async () => {
    const base = await snapshotFingerprint(snapshot)
    expect(await snapshotFingerprint({ ...snapshot, extra: null })).not.toBe(base)
    expect(await snapshotFingerprint({ ...snapshot, nodes: [] })).not.toBe(base)
  })

  it('survives a trip through Postgres jsonb, which re-orders keys and normalises numbers', async () => {
    // jsonb stores keys in its own order and numbers as numerics; what comes back parses to the same value.
    const stored = JSON.parse(JSON.stringify({ z: 1.5, a: { y: 100, b: [0.1, 23.7, 25] }, m: 'ü' }))
    const reordered = JSON.parse('{"a":{"b":[0.1,23.7,25],"y":100},"m":"ü","z":1.5}')
    expect(await snapshotFingerprint(reordered)).toBe(await snapshotFingerprint(stored))
  })
})
