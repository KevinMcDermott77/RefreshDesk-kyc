import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from '@/lib/types/documents'

/**
 * What the "Fetch from Companies House" action accepts: a client, and either a company number or
 * the storage path of an incorporation document the browser has already uploaded. Nothing large is
 * ever posted to the action (Next.js refuses a Server Action body over 1 MB): the server fetches
 * the Companies House data itself, and a document travels browser -> Storage, not through the action.
 */

export const COMPANY_NUMBER_PATTERN = /^([0-9]{8}|[A-Z]{2}[0-9]{6})$/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STORAGE_PATH = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/[A-Za-z0-9._-]+$/i

/** Fields that carry fetched Companies House data. The server never accepts these from the browser. */
export const FORBIDDEN_PAYLOAD_FIELDS = [
  'company_profile',
  'officers',
  'pscs',
  'ownership_chain',
  'ubo_list',
  'psc_data_quality',
  'psc_warning',
  'payload',
  'snapshot',
] as const

export type FetchUpload = {
  /** Storage path of the uploaded incorporation document. */
  path: string
  name: string
  size: number
  type: (typeof ALLOWED_MIME_TYPES)[number]
}

export type FetchInput = {
  clientId: string
  /** Upper-cased company number, or '' when an upload is used instead. */
  companyNumber: string
  /** Set only when no company number was given. */
  upload: FetchUpload | null
}

export type ParsedFetchInput = { ok: true; input: FetchInput } | { ok: false; error: string }

function text(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/** Validates the action's form data. Unknown fields are ignored; fetched-data fields and file bodies are refused. */
export function parseFetchInput(formData: FormData): ParsedFetchInput {
  for (const field of FORBIDDEN_PAYLOAD_FIELDS) {
    if (formData.has(field)) {
      return { ok: false, error: 'The server fetches Companies House data itself: it cannot be sent from the browser.' }
    }
  }

  // The browser uploads documents to Storage and sends the path; a file body is never accepted here.
  if (hasFileBody(formData)) {
    return { ok: false, error: 'Upload the document to storage first: files are not accepted by this action.' }
  }

  const clientId = text(formData, 'client_id')
  if (!UUID.test(clientId)) return { ok: false, error: 'Missing client ID' }

  const companyNumber = text(formData, 'company_number').toUpperCase()
  if (companyNumber) {
    if (!COMPANY_NUMBER_PATTERN.test(companyNumber)) {
      return { ok: false, error: 'Company number must be 8 digits, or 2 letters followed by 6 digits' }
    }
    // A company number wins over any upload fields.
    return { ok: true, input: { clientId, companyNumber, upload: null } }
  }

  const uploaded = parseUploadFields(formData)
  if (!uploaded.ok) return uploaded
  if (!uploaded.upload) return { ok: false, error: 'Enter a company number or upload an incorporation document' }
  return { ok: true, input: { clientId, companyNumber: '', upload: uploaded.upload } }
}

export type ParsedUpload = { ok: true; upload: FetchUpload | null } | { ok: false; error: string }

/**
 * The details of a document the browser has already put in Storage (upload_path, upload_name,
 * upload_type, upload_size). { ok: true, upload: null } when none was sent; shared by every form that uploads.
 */
export function parseUploadFields(formData: FormData): ParsedUpload {
  const path = text(formData, 'upload_path')
  if (!path) return { ok: true, upload: null }

  const name = text(formData, 'upload_name')
  const type = text(formData, 'upload_type')
  const size = Number(text(formData, 'upload_size'))
  if (!STORAGE_PATH.test(path)) return { ok: false, error: 'The uploaded document path is not valid' }
  if (!name) return { ok: false, error: 'The uploaded document has no name' }
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(type)) return { ok: false, error: 'File must be PDF, JPEG, or PNG' }
  if (!Number.isInteger(size) || size <= 0) return { ok: false, error: 'The uploaded document is empty' }
  if (size > MAX_FILE_SIZE_BYTES) return { ok: false, error: 'File exceeds 10 MB limit' }
  return { ok: true, upload: { path, name, size, type: type as FetchUpload['type'] } }
}

/** A file body in a form: a non-empty File. Server Actions refuse bodies over 1 MB, so files go to Storage instead. */
export function hasFileBody(formData: FormData, field = 'file'): boolean {
  return formData.getAll(field).some((value) => typeof value !== 'string' && value.size > 0)
}

/** An upload must sit in this client's folder in this client's firm: {firm}/{client}/{document}/{file}. */
export function uploadBelongsTo(path: string, firmId: string, clientId: string): boolean {
  const match = STORAGE_PATH.exec(path)
  return !!match && match[1].toLowerCase() === firmId.toLowerCase() && match[2].toLowerCase() === clientId.toLowerCase()
}

/** Whether the bytes are really the type the browser claimed (the browser's word is not enough). */
export function matchesMimeType(bytes: Uint8Array, type: string): boolean {
  const starts = (...signature: number[]) => signature.every((b, i) => bytes[i] === b)
  if (type === 'application/pdf') return starts(0x25, 0x50, 0x44, 0x46) // %PDF
  if (type === 'image/png') return starts(0x89, 0x50, 0x4e, 0x47)
  if (type === 'image/jpeg') return starts(0xff, 0xd8, 0xff)
  return false
}
