'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { buildStoragePath, uploadDocument } from '@/lib/supabase/storage'
import { fetchFilings, fetchFilingDocument } from '@/lib/companies-house/fetch-filings'
import { filingLabel } from '@/lib/types/filings'

export type SaveFilingsState = { error?: string; saved?: string[] }

export async function saveFilingsAction(
  _prev: SaveFilingsState,
  formData: FormData,
): Promise<SaveFilingsState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const clientId = String(formData.get('client_id') ?? '').trim()
  if (!clientId) return { error: 'Missing client ID' }

  const transactionIds = formData.getAll('transaction_id').map(String).filter(Boolean)
  if (transactionIds.length === 0) return { error: 'Select at least one filing to save' }

  const { data: client } = await supabase
    .from('clients')
    .select('id, client_type, firm_id')
    .eq('id', clientId)
    .single()

  if (!client) return { error: 'Client not found' }
  if (client.client_type !== 'entity') return { error: 'Filings can only be saved for entity clients' }

  const { data: membership } = await supabase
    .from('firm_members')
    .select('firm_id, role')
    .eq('user_id', user.id)
    .eq('firm_id', client.firm_id)
    .eq('status', 'active')
    .single()

  if (!membership || membership.role === 'read_only') {
    return { error: 'You do not have permission to do this' }
  }

  const { data: approvedCdd } = await supabase
    .from('entity_cdd_records')
    .select('company_number')
    .eq('client_id', clientId)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!approvedCdd) return { error: 'No approved Companies House record for this client' }

  const companyNumber = approvedCdd.company_number as string

  let filings
  try {
    filings = await fetchFilings(companyNumber)
  } catch (err) {
    return {
      error: err instanceof Error ? `Companies House lookup failed: ${err.message}` : 'Companies House lookup failed',
    }
  }

  const selected = filings.filter((filing) => transactionIds.includes(filing.transactionId))
  if (selected.length === 0) return { error: 'Selected filings could not be found' }

  const saved: string[] = []

  for (const filing of selected) {
    let buffer: Buffer
    try {
      buffer = await fetchFilingDocument(companyNumber, filing.transactionId)
    } catch (err) {
      return {
        error: err instanceof Error ? `Failed to download ${filing.transactionId}: ${err.message}` : 'Failed to download filing document',
        saved,
      }
    }
    console.log(`[saveFilings] ${filing.transactionId}: downloaded PDF, ${buffer.byteLength} bytes`)

    const fileName = `${filing.type ?? 'Filing'} - ${filingLabel(filing)}.pdf`
    const storageId = crypto.randomUUID()
    const storagePath = buildStoragePath(membership.firm_id, clientId, storageId, fileName)

    const { error: uploadError } = await uploadDocument(storagePath, buffer, 'application/pdf')
    console.log(`[saveFilings] ${filing.transactionId}: storage upload →`, { storagePath, uploadError })
    if (uploadError) return { error: `Upload failed: ${uploadError}`, saved }

    const { data: documentId, error: registerError } = await supabase.rpc('register_document', {
      p_client_id: clientId,
      p_document_type: 'filing',
      p_storage_path: storagePath,
      p_file_name: fileName,
      p_file_size_bytes: buffer.byteLength,
      p_mime_type: 'application/pdf',
    })
    console.log(`[saveFilings] ${filing.transactionId}: register_document →`, { documentId, registerError })

    if (registerError || !documentId) {
      return { error: registerError?.message ?? 'Failed to register document', saved }
    }

    const { data: approvedId, error: approveError } = await supabase.rpc('approve_filing_document', {
      p_document_id: documentId,
    })
    console.log(`[saveFilings] ${filing.transactionId}: approve_filing_document →`, { approvedId, approveError })

    if (approveError) return { error: approveError.message, saved }

    saved.push(filing.transactionId)
  }

  revalidatePath(`/dashboard/clients/${clientId}`)
  revalidatePath(`/dashboard/clients/${clientId}/filings`)

  return { saved }
}
