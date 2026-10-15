import { coverage, type Coverage } from './coverage'
import type { Certified, EvidenceOwner, EvidencePayload } from './types'

/**
 * The editor keeps every field as text, the way a form does, and turns it into a payload on submit.
 * The server validates and normalises the payload again, so nothing here is trusted.
 */

export type OwnerRow = {
  kind: 'individual' | 'entity'
  name: string
  holdingType: 'none' | 'percent' | 'band'
  value: string
  low: string
  high: string
  regNumber: string
  regCountry: string
  lei: string
  pageRef: string
  shares: string
  uncertain: boolean
}

export type EditorState = {
  owners: OwnerRow[]
  ownersComplete: boolean
  asAt: string
  documentDate: string
  certified: Certified
  certifiedBy: string
  stale: boolean
  uncertifiedOverride: boolean
  overrideNote: string
}

export function blankOwner(): OwnerRow {
  return {
    kind: 'individual',
    name: '',
    holdingType: 'percent',
    value: '',
    low: '',
    high: '',
    regNumber: '',
    regCountry: '',
    lei: '',
    pageRef: '',
    shares: '',
    uncertain: false,
  }
}

export function toState(payload: EvidencePayload): EditorState {
  return {
    owners: payload.owners.map((owner) => ({
      kind: owner.kind,
      name: owner.name_as_shown,
      holdingType: owner.holding?.type ?? 'none',
      value: owner.holding?.type === 'percent' ? String(owner.holding.value) : '',
      low: owner.holding?.type === 'band' ? String(owner.holding.low) : '',
      high: owner.holding?.type === 'band' ? String(owner.holding.high) : '',
      regNumber: owner.registration?.number ?? '',
      regCountry: owner.registration?.country ?? '',
      lei: owner.lei_shown ?? '',
      pageRef: owner.page_ref,
      shares: owner.shares ?? '',
      uncertain: owner.uncertain ?? false,
    })),
    ownersComplete: payload.owners_complete,
    asAt: payload.as_at ?? '',
    documentDate: payload.document_date ?? '',
    certified: payload.certified,
    certifiedBy: payload.certified_by ?? '',
    stale: payload.override?.reasons.includes('stale') ?? false,
    uncertifiedOverride: payload.override?.reasons.includes('uncertified') ?? false,
    overrideNote: payload.override?.note ?? '',
  }
}

function number(text: string): number | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : NaN
}

/** The raw object sent to the server (unvalidated): empty fields are left out, bad numbers stay NaN-free as null so the server rejects them. */
export function toPayloadInput(state: EditorState, withOverride: boolean): Record<string, unknown> {
  const owners = state.owners.map((row) => {
    const holding =
      row.holdingType === 'percent'
        ? { type: 'percent', value: number(row.value) ?? null }
        : row.holdingType === 'band'
          ? { type: 'band', low: number(row.low) ?? null, high: number(row.high) ?? null }
          : null
    return {
      kind: row.kind,
      name_as_shown: row.name,
      holding,
      registration: row.regNumber.trim() || row.regCountry.trim() ? { number: row.regNumber, country: row.regCountry } : null,
      lei_shown: row.lei.trim() || null,
      page_ref: row.pageRef,
      shares: row.shares.trim() || null,
      uncertain: row.uncertain,
    }
  })

  const reasons = [...(state.stale ? ['stale'] : []), ...(state.uncertifiedOverride ? ['uncertified'] : [])]
  return {
    owners,
    owners_complete: state.ownersComplete,
    as_at: state.asAt.trim() || null,
    document_date: state.documentDate.trim() || null,
    certified: state.certified,
    certified_by: state.certifiedBy.trim() || null,
    override: withOverride && reasons.length > 0 ? { reasons, note: state.overrideNote } : null,
  }
}

/** The coverage rule on what is currently typed, so the reviewer sees the effect of an edit at once. */
export function coverageOf(state: EditorState, threshold?: number): Coverage {
  const owners: Pick<EvidenceOwner, 'holding'>[] = state.owners.map((row) => {
    if (row.holdingType === 'percent') {
      const value = number(row.value)
      return { holding: value !== undefined && Number.isFinite(value) ? { type: 'percent' as const, value } : undefined }
    }
    if (row.holdingType === 'band') {
      const low = number(row.low)
      return { holding: low !== undefined && Number.isFinite(low) ? { type: 'band' as const, low, high: low } : undefined }
    }
    return { holding: undefined }
  })
  return coverage(owners, state.ownersComplete, threshold)
}
