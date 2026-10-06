import type { DocumentExtraction } from '@/lib/types/documents'
import { DOCUMENT_TYPE_LABELS, type DocumentType } from '@/lib/types/documents'
import type { EntityCddRecord } from '@/lib/types/entity-cdd'

export function buildExtractionText(extraction: DocumentExtraction, documentType: DocumentType): string {
  const lines = [`${DOCUMENT_TYPE_LABELS[documentType]} document`]

  for (const [key, value] of Object.entries(extraction.extracted_fields)) {
    if (value === null || value === undefined || value === '') continue
    lines.push(`${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
  }

  return lines.join('\n')
}

const OWNERSHIP_RANGE_LABELS: Record<string, string> = {
  'ownership-of-shares-25-to-50-percent': '25-50% ownership',
  'ownership-of-shares-50-to-75-percent': '50-75% ownership',
  'ownership-of-shares-75-to-100-percent': '75-100% ownership',
  'voting-rights-25-to-50-percent': '25-50% voting rights',
  'voting-rights-50-to-75-percent': '50-75% voting rights',
  'voting-rights-75-to-100-percent': '75-100% voting rights',
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function ownershipRangeLabel(naturesOfControl: unknown): string | null {
  if (!Array.isArray(naturesOfControl)) return null
  for (const entry of naturesOfControl) {
    if (typeof entry === 'string' && OWNERSHIP_RANGE_LABELS[entry]) return OWNERSHIP_RANGE_LABELS[entry]
  }
  return null
}

export function buildEntityCddText(record: EntityCddRecord, clientName: string): string {
  const profile = asRecord(record.company_profile)
  const companyName = str(profile.company_name) ?? record.company_number
  const status = str(profile.company_status)
  const incorporated = str(profile.date_of_creation)

  const segments = [`entity CDD for ${clientName}: company ${companyName} (${record.company_number})`]
  if (status) segments.push(`status ${status}`)
  if (incorporated) segments.push(`incorporated ${incorporated}`)

  const directors = (record.officers ?? [])
    .map(asRecord)
    .filter((officer) => !officer.resigned_on)
    .map((officer) => {
      const name = str(officer.name) ?? 'Unknown'
      const nationality = str(officer.nationality)
      return nationality ? `${name} (${nationality})` : name
    })
  if (directors.length > 0) segments.push(`directors: ${directors.join(', ')}`)

  const pscs = (record.pscs ?? [])
    .map(asRecord)
    .map((psc) => {
      const name = str(psc.name) ?? 'Unknown'
      const details = [ownershipRangeLabel(psc.natures_of_control), str(psc.nationality)].filter(
        (value): value is string => value !== null,
      )
      return details.length > 0 ? `${name} (${details.join(', ')})` : name
    })
  if (pscs.length > 0) segments.push(`PSCs: ${pscs.join(', ')}`)

  const ubos = (record.ubo_list ?? []).map((ubo) => ubo.name)
  if (ubos.length > 0) segments.push(`UBOs: ${ubos.join(', ')}`)

  return segments.join(', ')
}
