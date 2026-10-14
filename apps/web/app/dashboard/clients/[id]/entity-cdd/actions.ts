'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { downloadDocument } from '@/lib/supabase/storage'
import { MAX_FILE_SIZE_BYTES } from '@/lib/types/documents'
import { COMPANY_NUMBER_PATTERN, matchesMimeType, parseFetchInput, uploadBelongsTo } from '@/lib/entity-cdd/fetch-input'
import { extractCompanyNumber, PROMPT_VERSION } from '@/lib/claude/extract-company-number'
import { fetchEntityCdd } from '@/lib/companies-house/fetch-entity-cdd'
import { fetchAuthToken } from '@/lib/companies-house/kyc-search-client'
import { walk } from '@/lib/ownership/walk'
import { createKycSearchFetcher } from '@/lib/ownership/kyc-search-fetcher'
import { getMembership } from '@/lib/entity-cdd/membership'
import { canWrite } from '@/lib/entity-cdd/permissions'
import { toEntityCddOwnership } from '@/lib/ownership/to-entity-cdd'

export type FetchEntityCddState = { error?: string }

const MODEL_USED = 'claude-sonnet-4-20250514'

export async function fetchEntityCddAction(
  _prev: FetchEntityCddState,
  formData: FormData,
): Promise<FetchEntityCddState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Only a client, and a company number or the path of an uploaded document, come from the browser.
  const parsed = parseFetchInput(formData)
  if (!parsed.ok) return { error: parsed.error }
  const { clientId, upload } = parsed.input

  const { data: client } = await supabase
    .from('clients')
    .select('id, client_type, firm_id')
    .eq('id', clientId)
    .single()

  if (!client) return { error: 'Client not found' }
  if (client.client_type !== 'entity') {
    return { error: 'Entity CDD can only be fetched for entity clients' }
  }

  // The client's firm, not "the" firm: a user in several firms has several memberships.
  const membership = await getMembership(supabase, user.id, client.firm_id)

  if (!membership || !canWrite(membership.role)) {
    return { error: 'You do not have permission to do this' }
  }

  let companyNumber = parsed.input.companyNumber
  let sourceDocumentId: string | null = null
  let extractionModelUsed: string | null = null
  let extractionPromptVersion: string | null = null

  if (!companyNumber && upload) {
    // The browser uploaded the document straight to Storage; only its path reached this action.
    if (!uploadBelongsTo(upload.path, membership.firm_id, clientId)) {
      return { error: "The uploaded document is not in this client's folder" }
    }
    const buffer = await downloadDocument(upload.path)
    if (!buffer) return { error: 'The uploaded document could not be found in storage' }
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_FILE_SIZE_BYTES) return { error: 'File exceeds 10 MB limit' }
    if (!matchesMimeType(buffer, upload.type)) return { error: 'The uploaded file is not a valid PDF, JPEG or PNG' }

    const { data: documentId, error: registerError } = await supabase.rpc('register_document', {
      p_client_id: clientId,
      p_document_type: 'incorporation',
      p_storage_path: upload.path,
      p_file_name: upload.name,
      p_file_size_bytes: buffer.byteLength,
      p_mime_type: upload.type,
    })

    if (registerError || !documentId) {
      return { error: registerError?.message ?? 'Failed to register document' }
    }
    sourceDocumentId = documentId

    let extraction
    try {
      extraction = await extractCompanyNumber(buffer, upload.type)
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
