export type Filing = {
  id: number
  transactionId: string
  description: string | null
  category: string | null
  type: string | null
  date: string | null
  documentUrl: string | null
}

export const PRIORITY_FILING_TYPES = [
  'CS01',
  'PSC01',
  'PSC07',
  'AP01',
  'TM01',
  'AP02',
  'AA',
  'NEWINC',
] as const

export const FILING_TYPE_LABELS: Record<string, string> = {
  CS01: 'Confirmation statement',
  PSC01: 'PSC notification',
  PSC07: 'PSC cessation',
  AP01: 'Director appointment',
  TM01: 'Director termination',
  AP02: 'Corporate director appointment',
  AA: 'Annual accounts',
  NEWINC: 'Certificate of incorporation',
}

export const HIGH_PRIORITY_FILING_TYPES = new Set(['CS01', 'PSC01', 'PSC07', 'NEWINC'])

export function filingLabel(filing: Pick<Filing, 'type' | 'description'>): string {
  if (filing.type && FILING_TYPE_LABELS[filing.type]) return FILING_TYPE_LABELS[filing.type]
  return filing.description ?? filing.type ?? 'Filing'
}

export function isPriorityFiling(filing: Pick<Filing, 'type'>): boolean {
  return filing.type !== null && (PRIORITY_FILING_TYPES as readonly string[]).includes(filing.type)
}

export function companiesHouseFilingUrl(companyNumber: string, transactionId: string): string {
  return `https://find-and-update.company-information.service.gov.uk/company/${companyNumber}/filing-history/${transactionId}`
}
