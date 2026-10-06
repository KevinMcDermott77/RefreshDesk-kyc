import { createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { embedText } from '@/lib/voyage/embed'
import { buildClientText } from '@/lib/search/build-client-text'
import type { Client } from '@/lib/types/clients'

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export async function upsertClientEmbedding(client: Client): Promise<void> {
  const text = buildClientText(client)
  const contentHash = hashText(text)

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('client_embeddings')
    .select('content_hash')
    .eq('client_id', client.id)
    .maybeSingle()

  if (existing?.content_hash === contentHash) return

  const embedding = await embedText(text)

  await supabase.rpc('upsert_client_embedding', {
    p_client_id: client.id,
    p_content_hash: contentHash,
    p_embedding: embedding,
  })
}
