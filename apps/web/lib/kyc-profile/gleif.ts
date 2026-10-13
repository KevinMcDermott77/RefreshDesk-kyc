import type { GleifLookup } from './evaluate'

const GLEIF_URL = 'https://api.gleif.org/api/v1/lei-records'
const TIMEOUT_MS = 10_000
const CACHE_MS = 24 * 60 * 60 * 1000

type Cached = { lookup: GleifLookup; fetchedAt: string; expires: number }
const cache = new Map<string, Cached>()

function rec(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** Picks the ISSUED record if GLEIF returns several, else the first. */
export function parseGleif(body: unknown): GleifLookup {
  const data = rec(body).data
  const records = Array.isArray(data) ? data.map(rec) : []
  if (records.length === 0) return { status: 'none' }

  const attributes = (r: Record<string, unknown>) => rec(r.attributes)
  const chosen = records.find((r) => rec(attributes(r).registration).status === 'ISSUED') ?? records[0]
  const a = attributes(chosen)
  const registration = rec(a.registration)
  const lei = typeof a.lei === 'string' ? a.lei : typeof chosen.id === 'string' ? chosen.id : ''
  const legalName = rec(rec(a.entity).legalName).name
  if (!lei || typeof legalName !== 'string') return { status: 'unavailable' }

  return {
    status: 'found',
    lei,
    legalName,
    registrationStatus: typeof registration.status === 'string' ? registration.status : 'UNKNOWN',
    ...(typeof registration.nextRenewalDate === 'string' ? { nextRenewalDate: registration.nextRenewalDate } : {}),
  }
}

/**
 * Looks a UK company up in GLEIF by registration number. No API key; 10s
 * timeout; results (including "no LEI") cached in memory for 24h. Failures are
 * returned as 'unavailable' and not cached.
 */
export async function lookupLei(
  companyNumber: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<{ lookup: GleifLookup; fetchedAt: string }> {
  const hit = cache.get(companyNumber)
  if (hit && hit.expires > now()) return { lookup: hit.lookup, fetchedAt: hit.fetchedAt }

  const url = new URL(GLEIF_URL)
  url.searchParams.set('filter[entity.registeredAs]', companyNumber)
  url.searchParams.set('filter[entity.legalAddress.country]', 'GB')

  const fetchedAt = new Date(now()).toISOString()
  try {
    await defaultLimiter.acquire(now)
    const response = await fetchImpl(url, {
      headers: { accept: 'application/vnd.api+json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) return { lookup: { status: 'unavailable' }, fetchedAt }
    const lookup = parseGleif(await response.json())
    if (lookup.status !== 'unavailable') cache.set(companyNumber, { lookup, fetchedAt, expires: now() + CACHE_MS })
    return { lookup, fetchedAt }
  } catch {
    return { lookup: { status: 'unavailable' }, fetchedAt }
  }
}

export function clearGleifCache() {
  cache.clear()
  httpCache.clear()
}

// --- Shared GLEIF HTTP access: rate limit (50 requests a minute) and 24h cache ---

export const GLEIF_RATE_LIMIT = 50
const WINDOW_MS = 60_000

export type Limiter = { acquire(now?: () => number, sleep?: (ms: number) => Promise<void>): Promise<void> }

/** Sliding-window limiter: waits when `limit` requests have started in the last minute. */
export function createLimiter(limit = GLEIF_RATE_LIMIT): Limiter {
  const starts: number[] = []
  return {
    async acquire(now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
      for (;;) {
        const t = now()
        while (starts.length > 0 && starts[0] <= t - WINDOW_MS) starts.shift()
        if (starts.length < limit) {
          starts.push(t)
          return
        }
        await sleep(starts[0] + WINDOW_MS - t)
      }
    },
  }
}

const defaultLimiter = createLimiter()

export type GleifResponse = { status: number; body: unknown }

/** GET against the GLEIF API (path after /api/v1). 200 and 404 are returned; anything else throws. */
export type GleifHttp = { get(path: string): Promise<GleifResponse> }

const httpCache = new Map<string, { response: GleifResponse; expires: number }>()
const API = 'https://api.gleif.org/api/v1'

export function createGleifHttp(
  options: {
    fetchImpl?: typeof fetch
    now?: () => number
    sleep?: (ms: number) => Promise<void>
    limiter?: Limiter
    cache?: Map<string, { response: GleifResponse; expires: number }>
  } = {},
): GleifHttp {
  const { fetchImpl = fetch, now = Date.now, sleep, limiter = defaultLimiter, cache: store = httpCache } = options
  return {
    async get(path) {
      const hit = store.get(path)
      if (hit && hit.expires > now()) return hit.response

      await limiter.acquire(now, sleep)
      const response = await fetchImpl(`${API}${path}`, {
        headers: { accept: 'application/vnd.api+json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (response.status !== 200 && response.status !== 404) {
        throw new Error(`GLEIF request failed (${response.status}): ${path}`)
      }
      const result: GleifResponse = { status: response.status, body: await response.json().catch(() => null) }
      store.set(path, { response: result, expires: now() + CACHE_MS })
      return result
    },
  }
}

/** The shared instance: one process-wide limiter and cache. */
export const gleifHttp: GleifHttp = createGleifHttp()
