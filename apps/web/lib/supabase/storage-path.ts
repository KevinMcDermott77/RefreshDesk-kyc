/** The bucket documents are stored in. */
export const DOCUMENT_BUCKET = 'kyc-documents'

/**
 * Where a document lives: {firm_id}/{client_id}/{document_id}/{filename}. The first segment is what
 * the storage policies check against the user's firms. Pure, so the browser can use it too.
 */
export function buildStoragePath(firmId: string, clientId: string, documentId: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `${firmId}/${clientId}/${documentId}/${safeName}`
}
