import { fetchAuthToken, kycSearchGetJson, kycSearchGetBinary, asArray } from './kyc-search-client'
import type { Filing } from '@/lib/types/filings'

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value) || 0
}

function toFiling(raw: unknown): Filing {
  const f = asRecord(raw)
  return {
    id: num(f.id),
    transactionId: str(f.transaction_id) ?? '',
    description: str(f.description),
    category: str(f.category),
    type: str(f.type),
    date: str(f.date),
    documentUrl: str(f.document_url),
  }
}

export async function fetchFilings(companyNumber: string): Promise<Filing[]> {
  const normalised = companyNumber.trim().toUpperCase()
  const token = await fetchAuthToken()

  const raw = await kycSearchGetJson(`/companies/${normalised}/filings`, token)
  return asArray(raw, 'items').map(toFiling)
}

export async function fetchFilingDocument(companyNumber: string, transactionId: string): Promise<Buffer> {
  const normalised = companyNumber.trim().toUpperCase()
  const token = await fetchAuthToken()

  return kycSearchGetBinary(`/companies/${normalised}/filings/${transactionId}/document`, token)
}
