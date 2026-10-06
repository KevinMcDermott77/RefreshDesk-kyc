'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { buildStoragePath, uploadDocument } from '@/lib/supabase/storage'
import { extractDocument, PROMPT_VERSION } from '@/lib/claude/extract-document'
import type { DocumentType } from '@/lib/types/documents'
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from '@/lib/types/documents'

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

  const clientId = String(formData.get('client_id') ?? '').trim()
  const documentType = String(formData.get('document_type') ?? '').trim() as DocumentType
  const file = formData.get('file') as File | null

  if (!clientId) return { error: 'Missing client ID' }
  if (!['passport', 'proof_of_address', 'incorporation', 'source_of_funds'].includes(documentType)) {
    return { error: 'Invalid document type' }
  }
  if (!file || file.size === 0) return { error: 'No file selected' }
  if (file.size > MAX_FILE_SIZE_BYTES) return { error: 'File exceeds 10 MB limit' }
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { error: 'File must be PDF, JPEG, or PNG' }
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Get firm membership to build storage path
  const { data: membership } = await supabase
    .from('firm_members')
    .select('firm_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()

  if (!membership) return { error: 'Not a member of any firm' }

  // Generate a storage ID for the path (distinct from the DB document ID)
  const storageId = crypto.randomUUID()
  const storagePath = buildStoragePath(membership.firm_id, clientId, storageId, file.name)

  // Upload to Supabase Storage
  const { error: uploadError } = await uploadDocument(storagePath, buffer, file.type)
  if (uploadError) return { error: `Upload failed: ${uploadError}` }

  // Register document in DB
  const { data: documentId, error: registerError } = await supabase.rpc('register_document', {
    p_client_id: clientId,
    p_document_type: documentType,
    p_storage_path: storagePath,
    p_file_name: file.name,
    p_file_size_bytes: file.size,
    p_mime_type: file.type,
  })

  if (registerError || !documentId) {
    return { error: registerError?.message ?? 'Failed to register document' }
  }

  // Run Claude extraction
  let extractionOutput
  try {
    extractionOutput = await extractDocument(buffer, file.type, documentType)
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
