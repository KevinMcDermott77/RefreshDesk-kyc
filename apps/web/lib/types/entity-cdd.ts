export type PscDataQuality = 'full' | 'partial' | 'none'

export type EntityCddStatus = 'pending_review' | 'approved' | 'rejected'

export type OwnershipNodeKind = 'individual' | 'corporate' | 'legal_person'

export type OwnershipNode = {
  name: string
  kind: OwnershipNodeKind
  ownership_percentage: number | null
  nature_of_control: string[]
  is_ubo: boolean
  company_number?: string
  address?: string
}

export type EntityCddRecord = {
  id: string
  firm_id: string
  client_id: string
  company_number: string
  source_document_id: string | null
  company_profile: Record<string, unknown>
  officers: unknown[]
  pscs: unknown[]
  ownership_chain: OwnershipNode[]
  ubo_list: OwnershipNode[]
  psc_data_quality: PscDataQuality
  psc_warning: string | null
  status: EntityCddStatus
  reviewed_by: string | null
  reviewed_at: string | null
  reviewer_notes: string | null
  fetched_at: string
  created_at: string
}

export const PSC_DATA_QUALITY_LABELS: Record<PscDataQuality, string> = {
  full: 'Full',
  partial: 'Partial',
  none: 'None',
}
