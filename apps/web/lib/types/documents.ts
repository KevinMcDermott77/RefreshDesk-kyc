export type DocumentType = 'passport' | 'proof_of_address' | 'incorporation' | 'source_of_funds' | 'filing'

export type DocumentStatus = 'uploaded' | 'extracting' | 'pending_review' | 'approved' | 'rejected'

export type ExtractionStatus = 'pending_review' | 'approved' | 'rejected'

export type ClientDocument = {
  id: string
  firm_id: string
  client_id: string
  uploaded_by: string
  document_type: DocumentType
  storage_path: string
  file_name: string
  file_size_bytes: number
  mime_type: string
  status: DocumentStatus
  created_at: string
}

export type DocumentExtraction = {
  id: string
  document_id: string
  firm_id: string
  client_id: string
  extracted_fields: Record<string, unknown>
  confidence_score: number | null
  model_used: string
  prompt_version: string
  raw_response: string | null
  status: ExtractionStatus
  reviewed_by: string | null
  reviewed_at: string | null
  reviewer_notes: string | null
  created_at: string
}

export type PassportFields = {
  full_name: string | null
  date_of_birth: string | null
  nationality: string | null
  passport_number: string | null
  expiry_date: string | null
  issuing_country: string | null
}

export type ProofOfAddressFields = {
  full_name: string | null
  address_line_1: string | null
  address_line_2: string | null
  city: string | null
  postcode: string | null
  document_date: string | null
  issuing_organisation: string | null
}

export type IncorporationFields = {
  company_name: string | null
  company_number: string | null
  incorporation_date: string | null
  registered_address: string | null
  directors: string[] | null
}

export type SourceOfFundsFields = {
  description: string | null
  amount_or_range: string | null
  supporting_evidence: string | null
}

export type ExtractedFields =
  | PassportFields
  | ProofOfAddressFields
  | IncorporationFields
  | SourceOfFundsFields

export type ExtractionResult = {
  document_type: DocumentType
  fields: Record<string, unknown>
  confidence_score: number
  confidence_notes: string
  extraction_warnings: string[]
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  passport: 'Passport',
  proof_of_address: 'Proof of address',
  incorporation: 'Incorporation',
  source_of_funds: 'Source of funds',
  filing: 'Filing',
}

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  uploaded: 'Uploaded',
  extracting: 'Extracting',
  pending_review: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
}

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
