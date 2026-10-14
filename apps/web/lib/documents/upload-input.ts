import { hasFileBody, parseUploadFields, type FetchUpload } from '@/lib/entity-cdd/fetch-input'

export const UPLOADABLE_DOCUMENT_TYPES = ['passport', 'proof_of_address', 'incorporation', 'source_of_funds'] as const
export type UploadableDocumentType = (typeof UPLOADABLE_DOCUMENT_TYPES)[number]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type DocumentUploadInput = { clientId: string; documentType: UploadableDocumentType; upload: FetchUpload }
export type ParsedDocumentUpload = { ok: true; input: DocumentUploadInput } | { ok: false; error: string }

/**
 * What the "Upload document" action accepts: a client, a document type and the path of a file the
 * browser has already uploaded to Storage. A file body is refused (Server Actions cap bodies at 1 MB),
 * and fields it does not know are ignored.
 */
export function parseDocumentUploadInput(formData: FormData): ParsedDocumentUpload {
  if (hasFileBody(formData)) {
    return { ok: false, error: 'Upload the document to storage first: files are not accepted by this action.' }
  }

  const clientId = String(formData.get('client_id') ?? '').trim()
  if (!UUID.test(clientId)) return { ok: false, error: 'Missing client ID' }

  const documentType = String(formData.get('document_type') ?? '').trim()
  if (!(UPLOADABLE_DOCUMENT_TYPES as readonly string[]).includes(documentType)) return { ok: false, error: 'Invalid document type' }

  const uploaded = parseUploadFields(formData)
  if (!uploaded.ok) return uploaded
  if (!uploaded.upload) return { ok: false, error: 'No file selected' }

  return { ok: true, input: { clientId, documentType: documentType as UploadableDocumentType, upload: uploaded.upload } }
}
