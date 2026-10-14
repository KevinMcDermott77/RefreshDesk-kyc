/**
 * Canonical JSON: object keys sorted, no whitespace, so the same data always serialises to the
 * same text whatever order its keys were built in (and whichever way Postgres jsonb stored them).
 * Like JSON.stringify, properties whose value is undefined are left out. Values JSON cannot
 * represent faithfully (NaN, Infinity, bigint, functions) are rejected rather than silently changed.
 */
export function canonicalJson(value: unknown): string {
  return serialise(value, 'value')
}

function serialise(value: unknown, path: string): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`cannot hash a non-finite number at ${path}`)
      // -0 and 0 are the same JSON number.
      return JSON.stringify(value === 0 ? 0 : value)
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item, index) => (item === undefined ? 'null' : serialise(item, `${path}[${index}]`))).join(',')}]`
      }
      const record = value as Record<string, unknown>
      const parts: string[] = []
      for (const key of Object.keys(record).sort()) {
        if (record[key] === undefined) continue
        parts.push(`${JSON.stringify(key)}:${serialise(record[key], `${path}.${key}`)}`)
      }
      return `{${parts.join(',')}}`
    }
    default:
      throw new Error(`cannot hash a ${typeof value} at ${path}`)
  }
}

/** SHA-256 of UTF-8 text, as lower-case hex. Works in Node and in the browser. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The fingerprint of a snapshot: SHA-256 of its canonical JSON. */
export async function snapshotFingerprint(snapshot: unknown): Promise<string> {
  return sha256Hex(canonicalJson(snapshot))
}
