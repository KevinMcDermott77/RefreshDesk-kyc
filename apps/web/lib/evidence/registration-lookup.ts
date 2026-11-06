import type { EvidenceOwner } from './types'
import type { GleifSource } from '@/lib/ownership/types'

export type RegistrationLookup = {
  /** 1-based row number, as shown to the reviewer. */
  row: number
  ownerName: string
  number: string
  country: string
  /** What to show. It never links anything: the reviewer compares it with the document. */
  text: string
}

export function describeRegistrationLookup(count: number, record?: { legalName: string; lei: string }): string {
  if (count === 0) return 'GLEIF has no record with this registration number and country. Nothing is matched.'
  if (count === 1 && record) {
    return `GLEIF holds exactly one record with this number and country: ${record.legalName} (LEI ${record.lei}). Compare it with the name in the document. This does not link anything.`
  }
  return `GLEIF holds ${count} records with this number and country. Nothing is matched.`
}

/**
 * For each entity owner that has a printed registration number, what GLEIF holds under that exact
 * number and country. For the reviewer's eyes only: the proposal is never linked to a company or an
 * LEI because of it, and a name is never searched. A source that is down gives a plain note.
 */
export async function lookupRegistrations(owners: EvidenceOwner[], source: Pick<GleifSource, 'findByRegistration'>, limit = 10): Promise<RegistrationLookup[]> {
  const rows: RegistrationLookup[] = []
  for (const [index, owner] of owners.entries()) {
    if (rows.length >= limit) break
    if (owner.kind !== 'entity' || !owner.registration) continue
    const { number, country } = owner.registration
    let text: string
    try {
      const records = await source.findByRegistration(number, country)
      text = describeRegistrationLookup(records.length, records[0])
    } catch {
      text = 'GLEIF could not be reached, so this number was not looked up.'
    }
    rows.push({ row: index + 1, ownerName: owner.name_as_shown, number, country, text })
  }
  return rows
}
