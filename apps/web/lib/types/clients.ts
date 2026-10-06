export type RiskRating = 'low' | 'standard' | 'high'
export type ClientType = 'individual' | 'entity'
export type ClientStatus = 'active' | 'archived'
export type ClientFilter = 'overdue' | 'due_soon' | 'complete' | 'all'

export type Client = {
  id: string
  firm_id: string
  client_type: ClientType
  display_name: string
  risk_rating: RiskRating
  refresh_due_date: string | null
  last_refreshed_at: string | null
  status: ClientStatus
  details: Record<string, unknown>
  external_ref: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type FirmRefreshRule = {
  id: string
  firm_id: string
  risk_rating: RiskRating
  cadence_months: number
  created_at: string
  updated_at: string
}
