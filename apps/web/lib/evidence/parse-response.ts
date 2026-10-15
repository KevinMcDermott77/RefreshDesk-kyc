import { normalisePayload } from './payload'
import type { EvidencePayload } from './types'

export type ParsedExtraction = {
  payload: EvidencePayload
  /** 0 to 1, as the model reported it. */
  confidence: number
  /** Things the reviewer should know: rows dropped, fields the model could not read. */
  warnings: string[]
}

type Rec = Record<string, unknown>

function rec(value: unknown): Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : {}
}

/**
 * Turns Claude's reply into a proposal. The model is only a reader: it is never asked to look
 * anything up, and nothing it says is matched to a company or an LEI. Rows without a page
 * reference or a name are dropped with a warning, an override is never accepted from the model,
 * and certification defaults to "unclear" unless the document visibly says otherwise.
 */
export function parseEvidenceResponse(raw: string, today?: string): ParsedExtraction {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Claude did not return valid JSON')

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    throw new Error('Failed to parse Claude JSON response')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Unexpected response shape from Claude')

  const obj = rec(parsed)
  const warnings: string[] = Array.isArray(obj.extraction_warnings)
    ? (obj.extraction_warnings as unknown[]).filter((w): w is string => typeof w === 'string')
    : []

  const certified = obj.certified === 'yes' || obj.certified === 'no' ? obj.certified : 'unclear'
  const base = {
    owners_complete: obj.owners_complete === true,
    as_at: obj.as_at,
    document_date: obj.document_date,
    certified,
    certified_by: obj.certified_by,
    certifier_capacity: obj.certifier_capacity,
    certification_date: obj.certification_date,
    document_title: obj.document_title,
    signed: obj.signed,
    // An override is a reviewer's act. The model cannot make one.
  }
  const options = { today }

  const rawOwners = Array.isArray(obj.owners) ? obj.owners : []
  const kept: unknown[] = []
  rawOwners.forEach((owner, index) => {
    const check = normalisePayload({ ...base, as_at: undefined, document_date: undefined, owners: [owner] }, options)
    if (check.ok) kept.push(owner)
    else warnings.push(`Row ${index + 1} was dropped: ${check.error.replace(/^Owner 1: /, '')}`)
  })

  let result = normalisePayload({ ...base, owners: kept }, options)
  if (!result.ok) {
    // Most likely an unreadable or impossible date: keep the owners and leave the dates for the reviewer.
    warnings.push(`The dates were not usable (${result.error}); enter them by hand.`)
    result = normalisePayload({ ...base, as_at: undefined, document_date: undefined, owners: kept }, options)
  }
  if (!result.ok) throw new Error(`The extraction could not be used: ${result.error}`)

  if (result.payload.owners.length === 0 && rawOwners.length > 0) warnings.push('No owner row could be used; enter the owners by hand.')

  const confidence = typeof obj.confidence_score === 'number' ? Math.min(1, Math.max(0, obj.confidence_score)) : 0
  return { payload: result.payload, confidence, warnings }
}
