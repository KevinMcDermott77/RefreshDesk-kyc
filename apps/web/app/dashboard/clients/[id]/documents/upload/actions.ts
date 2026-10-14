'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { downloadDocument } from '@/lib/supabase/storage'
import { getMembership } from '@/lib/entity-cdd/membership'
import { canWrite } from '@/lib/entity-cdd/permissions'
import { matchesMimeType, uploadBelongsTo } from '@/lib/entity-cdd/fetch-input'
import { parseDocumentUploadInput } from '@/lib/documents/upload-input'
import { extractDocument, PROMPT_VERSION } from '@/lib/claude/extract-document'
import { MAX_FILE_SIZE_BYTES } from '@/lib/types/documents'

const MODEL_USED = 'claude-sonnet-4-20250514'

export type UploadState = { error?: string }

export async function uploadDocumentAction(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Only a client, a document type and the path of a file already in Storage come from the browser.
  const parsed = parseDocumentUploadInput(formData)
  if (!parsed.ok) return { error: parsed.error }
  const { clientId, documentType, upload } = parsed.input

  // The client's firm, not "the" firm: a user in several firms has several memberships.
  const { data: client } = await supabase.from('clients').select('id, firm_id').eq('id', clientId).maybeSingle()
  if (!client) return { error: 'Client not found' }
  const membership = await getMembership(supabase, user.id, client.firm_id)
  if (!membership) return { error: 'Not a member of this firm' }
  if (!canWrite(membership.role)) return { error: 'You do not have permission to do this' }

  if (!uploadBelongsTo(upload.path, membership.firm_id, clientId)) {
    return { error: "The uploaded document is not in this client's folder" }
  }
  const buffer = await downloadDocument(upload.path)
  if (!buffer) return { error: 'The uploaded document could not be found in storage' }
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_FILE_SIZE_BYTES) return { error: 'File exceeds 10 MB limit' }
  if (!matchesMimeType(buffer, upload.type)) return { error: 'The uploaded file is not a valid PDF, JPEG or PNG' }
  const storagePath = upload.path

  // Register document in DB
  const { data: documentId, error: registerError } = await supabase.rpc('register_document', {
    p_client_id: clientId,
    p_document_type: documentType,
    p_storage_path: storagePath,
    p_file_name: upload.name,
    p_file_size_bytes: buffer.byteLength,
    p_mime_type: upload.type,
  })

  if (registerError || !documentId) {
    return { error: registerError?.message ?? 'Failed to register document' }
  }

  // Run Claude extraction
  let extractionOutput
  try {
    extractionOutput = await extractDocument(buffer, upload.type, documentType)
  } catch (err) {
    return {
      error: err instanceof Error ? `Extraction failed: ${err.message}` : 'Extraction failed',
    }
  }

  const { result, rawResponse } = extractionOutput

  // Save extraction result
  const { data: extractionId, error: saveError } = await supabase.rpc('save_extraction', {
    p_document_id: documentId,
    p_extracted_fields: {
      fields: result.fields,
      confidence_notes: result.confidence_notes,
      extraction_warnings: result.extraction_warnings,
    },
    p_confidence_score: result.confidence_score,
    p_model_used: MODEL_USED,
    p_prompt_version: PROMPT_VERSION,
    p_raw_response: rawResponse,
  })

  if (saveError || !extractionId) {
    return { error: saveError?.message ?? 'Failed to save extraction' }
  }

  revalidatePath(`/dashboard/clients/${clientId}`)
  redirect(`/dashboard/clients/${clientId}/documents/${documentId}/review`)
}
