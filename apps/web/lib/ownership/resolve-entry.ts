import { COMPANIES_HOUSE_RA, UK_COMPANY_NUMBER } from './walk'
import type { GleifRecord, GleifSource } from './types'

const LEI = /^[A-Z0-9]{20}$/

export type EntryResolution =
  /** Walk Companies House from this number. */
  | { kind: 'company'; companyNumber: string }
  /** A GLEIF record with no Companies House registration: start a GLEIF walk. */
  | { kind: 'lei'; record: GleifRecord }
  /** A name matched several entities: the user picks one. */
  | { kind: 'candidates'; candidates: GleifRecord[] }
  | { kind: 'error'; message: string }

export type SearchableGleif = GleifSource & { searchByName(query: string, limit?: number): Promise<GleifRecord[]> }

/** The UK company number in a GLEIF record's Companies House registration, if it has one. */
export function companiesHouseNumber(record: GleifRecord): string | null {
  const number = record.registeredAs?.replace(/\s/g, '').toUpperCase()
  return record.registeredAt === COMPANIES_HOUSE_RA && number && UK_COMPANY_NUMBER.test(number) ? number : null
}

/**
 * Works out what the user typed into the ownership form: a UK company number,
 * an LEI, or a name to search GLEIF for.
 */
export async function resolveEntry(input: string, gleif: SearchableGleif): Promise<EntryResolution> {
  const entry = input.trim()
  if (!entry) return { kind: 'error', message: 'Enter a company number, an LEI or a company name' }

  const upper = entry.toUpperCase().replace(/\s/g, '')
  if (UK_COMPANY_NUMBER.test(upper)) return { kind: 'company', companyNumber: upper }

  try {
    if (LEI.test(upper)) {
      const record = await gleif.getRecord(upper)
      if (!record) return { kind: 'error', message: `No GLEIF record found for LEI ${upper}` }
      const number = companiesHouseNumber(record)
      return number ? { kind: 'company', companyNumber: number } : { kind: 'lei', record }
    }

    if (entry.length < 3) return { kind: 'error', message: 'Enter at least 3 characters of the company name' }
    const candidates = await gleif.searchByName(entry, 10)
    return candidates.length > 0
      ? { kind: 'candidates', candidates }
      : { kind: 'error', message: `No GLEIF matches for "${entry}"` }
  } catch {
    return { kind: 'error', message: 'GLEIF is unavailable; try again shortly' }
  }
}
