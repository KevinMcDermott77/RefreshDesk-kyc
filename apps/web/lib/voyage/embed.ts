import { VoyageAIClient } from 'voyageai'

const EMBED_MODEL = 'voyage-3-lite'

const client = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY! })

export async function embedText(text: string): Promise<number[]> {
  const result = await client.embed({ input: [text], model: EMBED_MODEL })
  const embedding = result.data?.[0]?.embedding
  if (!embedding) throw new Error('Voyage AI returned no embedding')
  return embedding
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const result = await client.embed({ input: texts, model: EMBED_MODEL })
  const data = result.data
  if (!data || data.length !== texts.length) throw new Error('Voyage AI returned an unexpected number of embeddings')
  return data.map((item) => {
    if (!item.embedding) throw new Error('Voyage AI returned no embedding')
    return item.embedding
  })
}
