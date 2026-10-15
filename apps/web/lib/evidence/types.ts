/**
 * Client-provided ownership evidence (Slice 7): the shapes the app and the database agree on.
 * The database check (ownership_evidence_payload_error, migration 20261016000000) enforces the same rules.
 */

/**
 * What the client provided. In institutional KYC the first thing asked for is the client's own written confirmation
 * of its ownership (a signed letter, an email, or a signed structure chart): a register is the fallback. A
 * written confirmation is not "certified" by anyone; it is the client's statement, so it has no certification.
 */
export const EVIDENCE_KINDS = [
  'client_ownership_confirmation',
  'shareholder_register',
  'register_extract',
  'signed_structure_chart',
  'annual_report_page',
] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

/** What the upload form offers. signed_structure_chart is an older kind, now a received_as of a confirmation. */
export const OFFERED_EVIDENCE_KINDS: readonly EvidenceKind[] = ['client_ownership_confirmation', 'shareholder_register', 'register_extract', 'annual_report_page']

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  client_ownership_confirmation: "Client's written confirmation of ownership (signed letter, email or signed structure chart)",
  shareholder_register: 'Shareholder register',
  register_extract: 'Register extract',
  signed_structure_chart: 'Signed structure chart (older kind)',
  annual_report_page: 'Annual report page',
}

/** The kinds that are the client's own statement: no certification, but a confirmer's capacity and how it arrived. */
export const CONFIRMATION_KINDS: readonly string[] = ['client_ownership_confirmation', 'signed_structure_chart']

export function isConfirmationKind(kind: string | null | undefined): boolean {
  return !!kind && CONFIRMATION_KINDS.includes(kind)
}

/** In what capacity the client's signatory confirmed: the person's name is never kept. */
export const CONFIRMER_CAPACITIES = ['director', 'company_secretary', 'authorised_signatory', 'compliance_officer', 'other', 'unclear'] as const
export type ConfirmerCapacity = (typeof CONFIRMER_CAPACITIES)[number]

export const CONFIRMER_CAPACITY_LABELS: Record<ConfirmerCapacity, string> = {
  director: 'Director',
  company_secretary: 'Company secretary',
  authorised_signatory: 'Authorised signatory',
  compliance_officer: 'Compliance officer',
  other: 'Other',
  unclear: 'Unclear',
}

export const RECEIVED_AS = ['signed_letter', 'email', 'signed_chart', 'other'] as const
export type ReceivedAs = (typeof RECEIVED_AS)[number]

export const RECEIVED_AS_LABELS: Record<ReceivedAs, string> = {
  signed_letter: 'Signed letter',
  email: 'Email',
  signed_chart: 'Signed structure chart',
  other: 'Other',
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

/** What a payload says about certification: a client's own written confirmation is nobody's, so it says not_applicable. */
export type PayloadCertified = Certified | 'not_applicable'

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
  certified: PayloadCertified
  certified_by?: string
  /** In what capacity the certifier signed. Set only when the document is certified (or may be). */
  certifier_capacity?: CertifierCapacity
  /** The date on the certification itself (yyyy-mm-dd). */
  certification_date?: string
  /** A client's written confirmation: the capacity of whoever confirmed it (never their name). */
  confirmed_by_capacity?: ConfirmerCapacity
  /** The date of the confirmation (yyyy-mm-dd). */
  confirmation_date?: string
  /** How it reached us. */
  received_as?: ReceivedAs
  /** A statement that no other person holds this percentage or more. At or below the threshold, it completes the picture. */
  no_other_holder_at_or_above?: number
  document_title?: string
  signed?: boolean
  override?: EvidenceOverride
}

/** The node the evidence is about: an LEI, or a registration number with its country. Never a name alone. */
export type NodeIdentity = { lei?: string; country?: string; registration_number?: string }
