import { createClient } from './server'

const BUCKET = 'kyc-documents'
const SIGNED_URL_EXPIRY_SECONDS = 3600

export function buildStoragePath(
  firmId: string,
  clientId: string,
  documentId: string,
  fileName: string,
): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `${firmId}/${clientId}/${documentId}/${safeName}`
}

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
