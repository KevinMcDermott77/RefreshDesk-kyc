import { createClient } from './server'
import { DOCUMENT_BUCKET, buildStoragePath } from './storage-path'

export { buildStoragePath }

const BUCKET = DOCUMENT_BUCKET
const SIGNED_URL_EXPIRY_SECONDS = 3600

export async function uploadDocument(
  path: string,
  file: Buffer | Uint8Array,
  mimeType: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: mimeType, upsert: false })
  return { error: error?.message ?? null }
}

export async function createSignedUrl(path: string): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

export async function downloadDocument(path: string): Promise<Buffer | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) return null
  const arrayBuffer = await data.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
