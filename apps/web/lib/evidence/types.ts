/**
 * Client-provided ownership evidence (Slice 7): the shapes the app and the database agree on.
 * The database check (ownership_evidence_payload_error, migration 20261016000000) enforces the same rules.
 */

export const EVIDENCE_KINDS = ['register_extract', 'shareholder_register', 'signed_structure_chart', 'annual_report_page'] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  register_extract: 'Register extract',
  shareholder_register: 'Shareholder register',
  signed_structure_chart: 'Signed structure chart',
  annual_report_page: 'Annual report page',
}

export const EVIDENCE_STATUSES = ['draft', 'proposed', 'confirmed', 'rejected', 'superseded'] as const
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number]

export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
  draft: 'Draft (no owners entered yet)',
  proposed: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  superseded: 'Superseded',
}

/** The label shown wherever confirmed evidence is used. */
export const EVIDENCE_LABEL = 'client-provided, reviewer-verified'

export type Certified = 'yes' | 'no' | 'unclear'

/** Who certified the document, by capacity: the person's name is never kept. */
export const CERTIFIER_CAPACITIES = ['notary', 'lawyer', 'accountant', 'company_officer', 'other', 'unclear'] as const
export type CertifierCapacity = (typeof CERTIFIER_CAPACITIES)[number]

export const CERTIFIER_CAPACITY_LABELS: Record<CertifierCapacity, string> = {
  notary: 'Notary',
  lawyer: 'Lawyer',
  accountant: 'Accountant',
  company_officer: 'Company officer (e.g. secretary or director)',
  other: 'Other',
  unclear: 'Unclear',
}

export type Holding = { type: 'percent'; value: number } | { type: 'band'; low: number; high: number }

export type EvidenceOwner = {
  kind: 'individual' | 'entity'
  /** Verbatim from the document. Never normalised, never completed. */
  name_as_shown: string
  /** Set by the server from the name, for individuals only. */
  initials?: string
  holding?: Holding
  /** Only as printed next to the owner. Matching to a company happens on this and the country, never on the name. */
  registration?: { number: string; country: string }
  lei_shown?: string
  /** Page and section the row came from. Required. */
  page_ref: string
  /** Share counts as printed; to help the reviewer only, never used for a percentage. */
  shares?: string
  /** The model was guessing a field. */
  uncertain?: boolean
}

export type EvidenceOverride = { reasons: ('stale' | 'uncertified')[]; note: string }

export type EvidencePayload = {
  owners: EvidenceOwner[]
  /** The document says it lists every holder. */
  owners_complete: boolean
  /** The date the holdings are stated for (yyyy-mm-dd). */
  as_at?: string
  /** The date of the document (yyyy-mm-dd). */
  document_date?: string
  certified: Certified
  certified_by?: string
  /** In what capacity the certifier signed. Set only when the document is certified (or may be). */
  certifier_capacity?: CertifierCapacity
  /** The date on the certification itself (yyyy-mm-dd). */
  certification_date?: string
  document_title?: string
  signed?: boolean
  override?: EvidenceOverride
}

/** The node the evidence is about: an LEI, or a registration number with its country. Never a name alone. */
export type NodeIdentity = { lei?: string; country?: string; registration_number?: string }
