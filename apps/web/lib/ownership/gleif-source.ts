import type { GleifHttp } from '@/lib/kyc-profile/gleif'
import { registrationVariants, sameRegistration } from './registration-number'
import type { GleifParentResult, GleifRecord, GleifSource } from './types'

function rec(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/** Parses one JSON:API lei-records item ({ id, attributes }). */
export function parseRecord(item: unknown): GleifRecord | null {
  const data = rec(item)
  const attributes = rec(data.attributes)
  const entity = rec(attributes.entity)
  const registration = rec(attributes.registration)
  const lei = str(attributes.lei) ?? str(data.id)
  const legalName = str(rec(entity.legalName).name)
  if (!lei || !legalName) return null

  const address = rec(entity.legalAddress)
  const lines = Array.isArray(address.addressLines) ? address.addressLines.filter((l): l is string => typeof l === 'string') : []
  const addressText = [...lines, address.city, address.postalCode, address.country]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(', ')
  const legalForm = rec(entity.legalForm)

  return {
    lei,
    legalName,
    ...(str(legalForm.other) ?? str(legalForm.id) ? { legalForm: str(legalForm.other) ?? str(legalForm.id) } : {}),
    ...(str(address.country) ? { country: str(address.country) } : {}),
    ...(str(entity.jurisdiction) ? { jurisdiction: str(entity.jurisdiction) } : {}),
    ...(addressText ? { address: addressText } : {}),
    ...(str(rec(entity.registeredAt).id) ? { registeredAt: str(rec(entity.registeredAt).id) } : {}),
    ...(str(entity.registeredAs) ? { registeredAs: str(entity.registeredAs) } : {}),
    registrationStatus: str(registration.status) ?? 'UNKNOWN',
    ...(str(entity.status) ? { entityStatus: str(entity.status) } : {}),
    ...(str(registration.nextRenewalDate) ? { nextRenewalDate: str(registration.nextRenewalDate) } : {}),
  }
}

function parseList(body: unknown): GleifRecord[] {
  const data = rec(body).data
  return (Array.isArray(data) ? data : []).map(parseRecord).filter((r): r is GleifRecord => r !== null)
}

const encode = (value: string) => encodeURIComponent(value)

/** GLEIF Level 1 / Level 2 access for the walker, over a rate-limited, cached HTTP client. */
export function createGleifSource(http: GleifHttp): GleifSource & {
  /** Fuzzy legal-name search; up to `limit` matches with their records. */
  searchByName(query: string, limit?: number): Promise<GleifRecord[]>
} {
  const source: GleifSource = {
    async getRecord(lei) {
      const response = await http.get(`/lei-records/${encode(lei)}`)
      return response.status === 200 ? parseRecord(rec(response.body).data) : null
    },

    async findByRegistration(registeredAs, country) {
      // GLEIF filters on the exact stored string, so query each spelling and compare normalised.
      const search = async (filter: string) => {
        const found = new Map<string, GleifRecord>()
        for (const variant of registrationVariants(registeredAs)) {
          const response = await http.get(
            `/lei-records?filter[entity.registeredAs]=${encode(variant)}&page[size]=10&${filter}=${encode(country)}`,
          )
          if (response.status !== 200) continue
          for (const record of parseList(response.body)) {
            if (sameRegistration(record.registeredAs, registeredAs)) found.set(record.lei, record)
          }
        }
        return [...found.values()]
      }
      const byAddress = await search('filter[entity.legalAddress.country]')
      return byAddress.length > 0 ? byAddress : search('filter[entity.jurisdiction]')
    },

    async getDirectParent(lei): Promise<GleifParentResult> {
      const parent = await http.get(`/lei-records/${encode(lei)}/direct-parent`)
      if (parent.status === 200) {
        const record = parseRecord(rec(parent.body).data)
        if (record) return { parent: record }
      }
      const exception = await http.get(`/lei-records/${encode(lei)}/direct-parent-reporting-exception`)
      if (exception.status === 200) {
        const reason = str(rec(rec(rec(exception.body).data).attributes).reason)
        if (reason) return { exception: reason }
      }
      return {}
    },
  }

  return {
    ...source,
    async searchByName(query, limit = 10) {
      const completions = await http.get(`/fuzzycompletions?field=entity.legalName&q=${encode(query)}`)
      const ids: string[] = []
      const data = rec(completions.body).data
      for (const item of Array.isArray(data) ? data : []) {
        const id = str(rec(rec(rec(rec(item).relationships)['lei-records']).data).id)
        if (id && !ids.includes(id)) ids.push(id)
        if (ids.length >= limit) break
      }
      if (ids.length === 0) return []
      const records = await http.get(`/lei-records?filter[lei]=${ids.join(',')}&page[size]=${limit}`)
      const byLei = new Map(parseList(records.body).map((r) => [r.lei, r]))
      // Keep GLEIF's relevance order.
      return ids.map((id) => byLei.get(id)).filter((r): r is GleifRecord => r !== undefined)
    },
  }
}

export type GleifSourceWithSearch = ReturnType<typeof createGleifSource>
