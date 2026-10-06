import { createClient } from '@/lib/supabase/server'
import { embedText } from '@/lib/voyage/embed'

const SIMILARITY_THRESHOLD = 0.10
const MATCH_COUNT = 20

export type SearchResult = {
  clientId: string
  clientName: string
  similarity: number
  matchType: 'client' | 'extraction'
}

type EmbeddingMatch = { client_id: string; similarity: number }

export async function semanticSearch(query: string): Promise<SearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const embedding = await embedText(trimmed)
  const supabase = await createClient()

  const [{ data: clientMatches }, { data: extractionMatches }] = await Promise.all([
    supabase.rpc('search_client_embeddings', { p_query_embedding: embedding, p_match_count: MATCH_COUNT }),
    supabase.rpc('search_extraction_embeddings', { p_query_embedding: embedding, p_match_count: MATCH_COUNT }),
  ])

  const bestByClient = new Map<string, { similarity: number; matchType: 'client' | 'extraction' }>()

  const consider = (matches: EmbeddingMatch[] | null, matchType: 'client' | 'extraction') => {
    for (const match of matches ?? []) {
      if (match.similarity < SIMILARITY_THRESHOLD) continue
      const existing = bestByClient.get(match.client_id)
      if (!existing || match.similarity > existing.similarity) {
        bestByClient.set(match.client_id, { similarity: match.similarity, matchType })
      }
    }
  }

  consider(clientMatches, 'client')
  consider(extractionMatches, 'extraction')

  if (bestByClient.size === 0) return []

  const clientIds = [...bestByClient.keys()]
  const { data: clients } = await supabase.from('clients').select('id, display_name').in('id', clientIds)
  const nameById = new Map((clients ?? []).map((c) => [c.id as string, c.display_name as string]))

  return clientIds
    .map((clientId) => {
      const best = bestByClient.get(clientId)!
      return {
        clientId,
        clientName: nameById.get(clientId) ?? 'Unknown client',
        similarity: best.similarity,
        matchType: best.matchType,
      }
    })
    .sort((a, b) => b.similarity - a.similarity)
}
