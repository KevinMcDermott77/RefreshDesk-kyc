'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { buildStoragePath, uploadDocument } from '@/lib/supabase/storage'
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from '@/lib/types/documents'
import { extractCompanyNumber, PROMPT_VERSION } from '@/lib/claude/extract-company-number'
import { fetchEntityCdd } from '@/lib/companies-house/fetch-entity-cdd'
import { fetchAuthToken } from '@/lib/companies-house/kyc-search-client'
import { walk } from '@/lib/ownership/walk'
import { createKycSearchFetcher } from '@/lib/ownership/kyc-search-fetcher'
import { toEntityCddOwnership } from '@/lib/ownership/to-entity-cdd'

export type FetchEntityCddState = { error?: string }

const MODEL_USED = 'claude-sonnet-4-20250514'
const COMPANY_NUMBER_PATTERN = /^([0-9]{8}|[A-Z]{2}[0-9]{6})$/

export async function fetchEntityCddAction(
  _prev: FetchEntityCddState,
  formData: FormData,
): Promise<FetchEntityCddState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const clientId = String(formData.get('client_id') ?? '').trim()
  if (!clientId) return { error: 'Missing client ID' }

  const { data: client } = await supabase
    .from('clients')
    .select('id, client_type, firm_id')
    .eq('id', clientId)
    .single()

  if (!client) return { error: 'Client not found' }
  if (client.client_type !== 'entity') {
    return { error: 'Entity CDD can only be fetched for entity clients' }
  }

  const { data: membership } = await supabase
    .from('firm_members')
    .select('firm_id, role')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()

  if (!membership || membership.role === 'read_only') {
    return { error: 'You do not have permission to do this' }
  }

  let companyNumber = String(formData.get('company_number') ?? '').trim().toUpperCase()
  const file = formData.get('file') as File | null
  let sourceDocumentId: string | null = null
  let extractionModelUsed: string | null = null
  let extractionPromptVersion: string | null = null

  if (!companyNumber) {
    if (!file || file.size === 0) {
      return { error: 'Enter a company number or upload an incorporation document' }
    }
    if (file.size > MAX_FILE_SIZE_BYTES) return { error: 'File exceeds 10 MB limit' }
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
      return { error: 'File must be PDF, JPEG, or PNG' }
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const storageId = crypto.randomUUID()
    const storagePath = buildStoragePath(membership.firm_id, clientId, storageId, file.name)

    const { error: uploadError } = await uploadDocument(storagePath, buffer, file.type)
    if (uploadError) return { error: `Upload failed: ${uploadError}` }

    const { data: documentId, error: registerError } = await supabase.rpc('register_document', {
      p_client_id: clientId,
      p_document_type: 'incorporation',
      p_storage_path: storagePath,
      p_file_name: file.name,
      p_file_size_bytes: file.size,
      p_mime_type: file.type,
    })

    if (registerError || !documentId) {
      return { error: registerError?.message ?? 'Failed to register document' }
    }
    sourceDocumentId = documentId

    let extraction
    try {
      extraction = await extractCompanyNumber(buffer, file.type)
    } catch (err) {
      return {
        error: err instanceof Error ? `Extraction failed: ${err.message}` : 'Extraction failed',
      }
    }

    if (!extraction.result.company_number) {
      return {
        error: 'Could not find a company number in the uploaded document — try entering it manually',
      }
    }

    companyNumber = extraction.result.company_number.trim().toUpperCase()
    extractionModelUsed = MODEL_USED
    extractionPromptVersion = PROMPT_VERSION
  }

  if (!COMPANY_NUMBER_PATTERN.test(companyNumber)) {
    return { error: 'Company number must be 8 digits, or 2 letters followed by 6 digits' }
  }

  let cdd
  let ownership
  try {
    const token = await fetchAuthToken()
    cdd = await fetchEntityCdd(companyNumber, token)
    ownership = toEntityCddOwnership(await walk(cdd.companyNumber, createKycSearchFetcher(token, cdd)))
  } catch (err) {
    return {
      error: err instanceof Error ? `Companies House lookup failed: ${err.message}` : 'Companies House lookup failed',
    }
  }

  const { ownershipChain, uboList, pscDataQuality, pscWarning } = ownership

  const { data: recordId, error: saveError } = await supabase.rpc('save_entity_cdd', {
    p_client_id: clientId,
    p_company_number: cdd.companyNumber,
    p_source_document_id: sourceDocumentId,
    p_company_profile: cdd.companyProfile,
    p_officers: cdd.officers,
    p_pscs: cdd.pscs,
    p_ownership_chain: ownershipChain,
    p_ubo_list: uboList,
    p_psc_data_quality: pscDataQuality,
    p_psc_warning: pscWarning,
    p_extraction_model_used: extractionModelUsed,
    p_extraction_prompt_version: extractionPromptVersion,
  })

  if (saveError || !recordId) {
    return { error: saveError?.message ?? 'Failed to save entity CDD record' }
  }

  revalidatePath(`/dashboard/clients/${clientId}`)
  redirect(`/dashboard/clients/${clientId}/entity-cdd/${recordId}/review`)
}
