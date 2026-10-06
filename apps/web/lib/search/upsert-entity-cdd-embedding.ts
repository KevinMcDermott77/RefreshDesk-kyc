import { createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { embedText } from '@/lib/voyage/embed'
import { buildEntityCddText } from '@/lib/search/build-extraction-text'
import type { EntityCddRecord } from '@/lib/types/entity-cdd'

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export async function upsertEntityCddEmbedding(entityCddId: string): Promise<void> {
  const supabase = await createClient()

  const { data: record } = await supabase
    .from('entity_cdd_records')
    .select('*')
    .eq('id', entityCddId)
    .single()
  if (!record) return

  const { data: client } = await supabase
    .from('clients')
    .select('display_name')
    .eq('id', record.client_id)
    .single()

  const text = buildEntityCddText(record as EntityCddRecord, client?.display_name ?? 'Unknown client')
  const contentHash = hashText(text)

  const { data: existing } = await supabase
    .from('extraction_embeddings')
    .select('content_hash')
    .eq('entity_cdd_id', entityCddId)
    .maybeSingle()

  if (existing?.content_hash === contentHash) return

  const embedding = await embedText(text)

  await supabase.rpc('upsert_entity_cdd_embedding', {
    p_entity_cdd_id: entityCddId,
    p_content_hash: contentHash,
    p_embedding: embedding,
  })
}
