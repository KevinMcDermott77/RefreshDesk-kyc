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
    // GLEIF sends the string "NULL" for an entity with no status.
    ...(str(entity.status) && str(entity.status) !== 'NULL' ? { entityStatus: str(entity.status) } : {}),
    ...(str(registration.nextRenewalDate) ? { nextRenewalDate: str(registration.nextRenewalDate) } : {}),
  }
}

function parseList(body: unknown): GleifRecord[] {
  const data = rec(body).data
  return (Array.isArray(data) ? data : []).map(parseRecord).filter((r): r is GleifRecord => r !== null)
}

const encode = (value: string) => encodeURIComponent(value)

/** LEIs behind a (fuzzy)completions response, in GLEIF's relevance order, without repeats. */
function leiIds(response: { body: unknown }, limit: number): string[] {
  const ids: string[] = []
  const data = rec(response.body).data
  for (const item of Array.isArray(data) ? data : []) {
    const id = str(rec(rec(rec(rec(item).relationships)['lei-records']).data).id)
    if (id && !ids.includes(id)) ids.push(id)
    if (ids.length >= limit) break
  }
  return ids
}

/** 0 active and ISSUED, 1 LAPSED, 2 everything else (retired, inactive, ...). */
export function standing(record: GleifRecord): 0 | 1 | 2 {
  if (record.registrationStatus === 'ISSUED' && record.entityStatus === 'ACTIVE') return 0
  return record.registrationStatus === 'LAPSED' ? 1 : 2
}

/** An inactive entity or a retired, duplicate, annulled or merged registration: shown, greyed out as historic. */
export function isHistoric(record: GleifRecord): boolean {
  return record.entityStatus === 'INACTIVE' || ['RETIRED', 'DUPLICATE', 'ANNULLED', 'MERGED'].includes(record.registrationStatus)
}

/** Stable: GLEIF's relevance order is kept within each standing. */
export function sortByStanding(records: GleifRecord[]): GleifRecord[] {
  return records.map((record, index) => ({ record, index })).sort((a, b) => standing(a.record) - standing(b.record) || a.index - b.index).map((x) => x.record)
}

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
      // Full-text autocompletion first; the legal-name fuzzy search only when that finds nothing.
      let ids = leiIds(await http.get(`/autocompletions?field=fulltext&q=${encode(query)}`), limit)
      if (ids.length === 0) {
        ids = leiIds(await http.get(`/fuzzycompletions?field=entity.legalName&q=${encode(query)}`), limit)
      }
      if (ids.length === 0) return []

      // One batched call for name, country and statuses, then live entities first.
      const records = await http.get(`/lei-records?filter[lei]=${ids.join(',')}&page[size]=${limit}`)
      const byLei = new Map(parseList(records.body).map((r) => [r.lei, r]))
      const found = ids.map((id) => byLei.get(id)).filter((r): r is GleifRecord => r !== undefined)
      return sortByStanding(found)
    },
  }
}

export const REFERENCE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * "Julkinen osakeyhtiö (K6VE)": the local name and the ELF code, with GLEIF's transliterated
 * name when it differs from the local one. A code GLEIF cannot name is shown as the code alone.
 */
export function describeLegalForm(code: string, body: unknown): string {
  const names = rec(rec(rec(body).data).attributes).names
  const first = (Array.isArray(names) ? names : []).map(rec).find((n) => str(n.localName))
  const local = str(first?.localName)
  if (!local) return code
  const transliterated = str(first?.transliteratedName)
  return `${local}${transliterated && transliterated !== local ? ` / ${transliterated}` : ''} (${code})`
}

/** "The Business Information System (BIS), Finnish Patent and Registration Office (RA000188)". */
export function describeAuthority(code: string, body: unknown): string {
  const attributes = rec(rec(rec(body).data).attributes)
  const name = str(attributes.internationalName)
  if (!name) return code
  const organisation = str(attributes.internationalOrganizationName)
  return `${name}${organisation && organisation !== name ? `, ${organisation}` : ''} (${code})`
}

/** Legal form and registration authority names for the profile panel. Cached 30 days; the code stands in when GLEIF has no name. */
export function createReferenceNames(http: GleifHttp) {
  const lookup = async (kind: string, code: string, describe: (code: string, body: unknown) => string) => {
    try {
      const response = await http.get(`/${kind}/${encode(code)}`, { ttlMs: REFERENCE_TTL_MS })
      return response.status === 200 ? describe(code, response.body) : code
    } catch {
      return code
    }
  }
  return {
    legalForm: (code: string) => lookup('entity-legal-forms', code, describeLegalForm),
    registrationAuthority: (code: string) => lookup('registration-authorities', code, describeAuthority),
  }
}

export type GleifSourceWithSearch = ReturnType<typeof createGleifSource>
