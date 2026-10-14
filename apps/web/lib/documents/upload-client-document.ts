'use client'

import type { FetchUpload } from '@/lib/entity-cdd/fetch-input'
import { createClient } from '@/lib/supabase/client'
import { DOCUMENT_BUCKET, buildStoragePath } from '@/lib/supabase/storage-path'
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from '@/lib/types/documents'

/**
 * Uploads a client document straight from the browser to Storage, under the user's own session
 * (the storage policy lets members write to their firm's folder). The server action then receives
 * only the path: a Server Action body over 1 MB is refused, so files cannot go through it.
 */
export async function uploadClientDocument(
  file: File,
  firmId: string,
  clientId: string,
): Promise<{ upload: FetchUpload } | { error: string }> {
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) return { error: 'File must be PDF, JPEG, or PNG' }
  if (file.size === 0) return { error: 'The selected file is empty' }
  if (file.size > MAX_FILE_SIZE_BYTES) return { error: 'File exceeds 10 MB limit' }

  const path = buildStoragePath(firmId, clientId, crypto.randomUUID(), file.name)
  const { error } = await createClient().storage.from(DOCUMENT_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (error) return { error: `Upload failed: ${error.message}` }

  return { upload: { path, name: file.name, size: file.size, type: file.type as FetchUpload['type'] } }
}
