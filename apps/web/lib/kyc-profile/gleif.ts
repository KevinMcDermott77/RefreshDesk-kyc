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
}
