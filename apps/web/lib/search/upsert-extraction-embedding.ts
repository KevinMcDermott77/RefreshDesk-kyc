import { createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { embedText } from '@/lib/voyage/embed'
import { buildExtractionText } from '@/lib/search/build-extraction-text'
import type { DocumentExtraction, DocumentType } from '@/lib/types/documents'

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export async function upsertExtractionEmbedding(
  extraction: DocumentExtraction,
  documentType: DocumentType,
): Promise<void> {
  const text = buildExtractionText(extraction, documentType)
  const contentHash = hashText(text)

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('extraction_embeddings')
    .select('content_hash')
    .eq('extraction_id', extraction.id)
    .maybeSingle()

  if (existing?.content_hash === contentHash) return

  const embedding = await embedText(text)

  await supabase.rpc('upsert_extraction_embedding', {
    p_extraction_id: extraction.id,
    p_content_hash: contentHash,
    p_embedding: embedding,
  })
}
