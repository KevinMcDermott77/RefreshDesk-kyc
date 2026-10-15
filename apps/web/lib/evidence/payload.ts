import { z } from 'zod'
import { initials } from '@/lib/ownership/to-flow'
import type { EvidencePayload } from './types'

/**
 * Validates and normalises an evidence payload that came from the browser (the editor) or from
 * Claude. Unknown keys are dropped, so a date of birth, nationality or address cannot ride along.
 * Initials are always set here from the name: whatever the client sent is ignored.
 */

const optionalText = z
  .string()
  .nullish()
  .transform((value) => {
    const trimmed = value?.trim()
    return trimmed ? trimmed : undefined
  })

const isoDate = z
  .string()
  .nullish()
  .transform((value, ctx) => {
    const trimmed = value?.trim()
    if (!trimmed) return undefined
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
    const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null
    if (!match || !date || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
      ctx.addIssue({ code: 'custom', message: 'Dates must be real dates in the form yyyy-mm-dd' })
      return z.NEVER
    }
    return trimmed
  })

const percent = z.number().min(0, 'A holding must be between 0 and 100').max(100, 'A holding must be between 0 and 100')

const holdingSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('percent'), value: percent }),
    z.object({ type: z.literal('band'), low: percent, high: percent }),
  ])
  .refine((holding) => holding.type !== 'band' || holding.low <= holding.high, 'A band needs low to be at or below high')

const registrationSchema = z.object({
  number: z.string().trim().min(1, 'A registration needs a number'),
  country: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}$/, 'A registration needs a two-letter country code')),
})

const ownerSchema = z.object({
  kind: z.enum(['individual', 'entity']),
  name_as_shown: z.string().trim().min(1, 'Every owner needs the name as shown'),
  holding: holdingSchema.nullish().transform((value) => value ?? undefined),
  registration: registrationSchema.nullish().transform((value) => value ?? undefined),
  lei_shown: z
    .string()
    .nullish()
    .transform((value) => value?.trim().toUpperCase() || undefined)
    .pipe(z.string().regex(/^[A-Z0-9]{20}$/, 'An LEI is 20 letters and digits').optional()),
  page_ref: z.string().trim().min(1, 'Every owner needs a page reference'),
  shares: optionalText,
  uncertain: z.boolean().nullish().transform((value) => value || undefined),
})

const overrideSchema = z.object({
  reasons: z
    .array(z.enum(['stale', 'uncertified']))
    .min(1, 'An override needs a reason: stale and/or uncertified')
    .transform((reasons) => [...new Set(reasons)]),
  note: z.string().trim().min(1, 'An override needs a note'),
})

const payloadSchema = z.object({
  owners: z.array(ownerSchema),
  owners_complete: z.boolean(),
  as_at: isoDate,
  document_date: isoDate,
  certified: z.enum(['yes', 'no', 'unclear']),
  certified_by: optionalText,
  document_title: optionalText,
  signed: z.boolean().nullish().transform((value) => (typeof value === 'boolean' ? value : undefined)),
  override: overrideSchema.nullish().transform((value) => value ?? undefined),
})

export type NormalisedPayload = { ok: true; payload: EvidencePayload } | { ok: false; error: string }

export type NormaliseOptions = {
  /** A confirmation needs a date to measure age from. A proposal need not have one. */
  forConfirm?: boolean
  /** Today (yyyy-mm-dd), for the "not in the future" rule. */
  today?: string
}

function describe(error: z.ZodError): string {
  const issue = error.issues[0]
  const path = issue.path.filter((part) => typeof part === 'number' || typeof part === 'string')
  const ownerAt = path[0] === 'owners' && typeof path[1] === 'number' ? `Owner ${path[1] + 1}: ` : ''
  return `${ownerAt}${issue.message}`
}

export function normalisePayload(input: unknown, options: NormaliseOptions = {}): NormalisedPayload {
  const parsed = payloadSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: describe(parsed.error) }

  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const value = parsed.data
  if ((value.as_at && value.as_at > today) || (value.document_date && value.document_date > today)) {
    return { ok: false, error: 'The as-at date and document date cannot be in the future' }
  }
  if (options.forConfirm && !value.as_at && !value.document_date) {
    return { ok: false, error: "Enter the as-at date or the document date: it is needed to measure the evidence's age" }
  }
  if (value.override?.reasons.includes('uncertified') && value.certified === 'yes') {
    return { ok: false, error: 'An uncertified override cannot be given for a certified document' }
  }

  const owners = value.owners.map((owner) => {
    const base = {
      kind: owner.kind,
      name_as_shown: owner.name_as_shown,
      ...(owner.kind === 'individual' ? { initials: initials(owner.name_as_shown) } : {}),
      ...(owner.holding ? { holding: owner.holding } : {}),
      // A registration or LEI belongs to an entity; an individual never has one.
      ...(owner.kind === 'entity' && owner.registration ? { registration: owner.registration } : {}),
      ...(owner.kind === 'entity' && owner.lei_shown ? { lei_shown: owner.lei_shown } : {}),
      page_ref: owner.page_ref,
      ...(owner.shares ? { shares: owner.shares } : {}),
      ...(owner.uncertain ? { uncertain: true } : {}),
    }
    return base
  })

  const payload: EvidencePayload = {
    owners,
    owners_complete: value.owners_complete,
    ...(value.as_at ? { as_at: value.as_at } : {}),
    ...(value.document_date ? { document_date: value.document_date } : {}),
    certified: value.certified,
    ...(value.certified_by ? { certified_by: value.certified_by } : {}),
    ...(value.document_title ? { document_title: value.document_title } : {}),
    ...(typeof value.signed === 'boolean' ? { signed: value.signed } : {}),
    ...(value.override ? { override: { reasons: value.override.reasons, note: value.override.note } } : {}),
  }
  return { ok: true, payload }
}

/** A blank payload for a draft: nothing is assumed, certification is "unclear" until someone says otherwise. */
export function emptyPayload(): EvidencePayload {
  return { owners: [], owners_complete: false, certified: 'unclear' }
}
