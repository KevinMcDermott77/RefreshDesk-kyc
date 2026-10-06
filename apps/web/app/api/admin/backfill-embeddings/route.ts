import { createHash } from 'crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { embedBatch } from '@/lib/voyage/embed'
import { buildClientText } from '@/lib/search/build-client-text'
import { buildExtractionText, buildEntityCddText } from '@/lib/search/build-extraction-text'
import type { Client } from '@/lib/types/clients'
import type { DocumentExtraction, DocumentType } from '@/lib/types/documents'
import type { EntityCddRecord } from '@/lib/types/entity-cdd'

const BATCH_SIZE = 20

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

type BackfillCounts = { embedded: number; skipped: number }

async function backfillClients(supabase: SupabaseClient): Promise<BackfillCounts> {
  const { data: clients, error } = await supabase.from('clients').select('*').eq('status', 'active')
  if (error) throw new Error(`Failed to load clients: ${error.message}`)

  const counts: BackfillCounts = { embedded: 0, skipped: 0 }
  const all = (clients ?? []) as Client[]

  for (let i = 0; i < all.length; i += BATCH_SIZE) {
    const batch = all.slice(i, i + BATCH_SIZE)
    const texts = batch.map(buildClientText)
    const hashes = texts.map(hashText)

    const { data: existing } = await supabase
      .from('client_embeddings')
      .select('client_id, content_hash')
      .in('client_id', batch.map((c) => c.id))

    const existingHashByClientId = new Map((existing ?? []).map((e) => [e.client_id as string, e.content_hash as string]))

    const toEmbed: { client: Client; text: string; hash: string }[] = []
    for (let j = 0; j < batch.length; j++) {
      if (existingHashByClientId.get(batch[j].id) === hashes[j]) {
        counts.skipped++
      } else {
        toEmbed.push({ client: batch[j], text: texts[j], hash: hashes[j] })
      }
    }

    if (toEmbed.length === 0) continue

    const embeddings = await embedBatch(toEmbed.map((entry) => entry.text))

    const rows = toEmbed.map((entry, idx) => ({
      firm_id: entry.client.firm_id,
      client_id: entry.client.id,
      content_hash: entry.hash,
      embedding: embeddings[idx],
      updated_at: new Date().toISOString(),
    }))

    const { error: upsertError } = await supabase.from('client_embeddings').upsert(rows, { onConflict: 'client_id' })
    if (upsertError) throw new Error(`Failed to upsert client embeddings: ${upsertError.message}`)

    counts.embedded += toEmbed.length
  }

  return counts
}

async function backfillExtractions(supabase: SupabaseClient): Promise<BackfillCounts> {
  const { data: extractions, error } = await supabase
    .from('document_extractions')
    .select('*, client_documents(document_type)')
    .eq('status', 'approved')
  if (error) throw new Error(`Failed to load extractions: ${error.message}`)

  const counts: BackfillCounts = { embedded: 0, skipped: 0 }
  const all = ((extractions ?? []) as (DocumentExtraction & { client_documents: { document_type: DocumentType } | null })[])
    .filter((e): e is DocumentExtraction & { client_documents: { document_type: DocumentType } } => e.client_documents !== null)

  for (let i = 0; i < all.length; i += BATCH_SIZE) {
    const batch = all.slice(i, i + BATCH_SIZE)

    const texts = batch.map((e) => buildExtractionText(e, e.client_documents.document_type))
    const hashes = texts.map(hashText)

    const { data: existing } = await supabase
      .from('extraction_embeddings')
      .select('extraction_id, content_hash')
      .in('extraction_id', batch.map((e) => e.id))

    const existingHashByExtractionId = new Map((existing ?? []).map((e) => [e.extraction_id as string, e.content_hash as string]))

    const toEmbed: { extraction: DocumentExtraction; text: string; hash: string }[] = []
    for (let j = 0; j < batch.length; j++) {
      if (existingHashByExtractionId.get(batch[j].id) === hashes[j]) {
        counts.skipped++
      } else {
        toEmbed.push({ extraction: batch[j], text: texts[j], hash: hashes[j] })
      }
    }

    if (toEmbed.length === 0) continue

    const embeddings = await embedBatch(toEmbed.map((entry) => entry.text))

    const rows = toEmbed.map((entry, idx) => ({
      firm_id: entry.extraction.firm_id,
      client_id: entry.extraction.client_id,
      extraction_id: entry.extraction.id,
      content_hash: entry.hash,
      embedding: embeddings[idx],
      updated_at: new Date().toISOString(),
    }))

    const { error: upsertError } = await supabase
      .from('extraction_embeddings')
      .upsert(rows, { onConflict: 'extraction_id' })
    if (upsertError) throw new Error(`Failed to upsert extraction embeddings: ${upsertError.message}`)

    counts.embedded += toEmbed.length
  }

  return counts
}

async function backfillEntityCdd(supabase: SupabaseClient): Promise<BackfillCounts> {
  const { data: records, error } = await supabase
    .from('entity_cdd_records')
    .select('*, clients(display_name)')
    .eq('status', 'approved')
  if (error) throw new Error(`Failed to load entity CDD records: ${error.message}`)

  const counts: BackfillCounts = { embedded: 0, skipped: 0 }
  const all = ((records ?? []) as (EntityCddRecord & { clients: { display_name: string } | null })[])
    .filter((r): r is EntityCddRecord & { clients: { display_name: string } } => r.clients !== null)

  for (let i = 0; i < all.length; i += BATCH_SIZE) {
    const batch = all.slice(i, i + BATCH_SIZE)

    const texts = batch.map((r) => buildEntityCddText(r, r.clients.display_name))
    const hashes = texts.map(hashText)

    const { data: existing } = await supabase
      .from('extraction_embeddings')
      .select('entity_cdd_id, content_hash')
      .in('entity_cdd_id', batch.map((r) => r.id))

    const existingHashByEntityCddId = new Map((existing ?? []).map((e) => [e.entity_cdd_id as string, e.content_hash as string]))

    const toEmbed: { record: EntityCddRecord; text: string; hash: string }[] = []
    for (let j = 0; j < batch.length; j++) {
      if (existingHashByEntityCddId.get(batch[j].id) === hashes[j]) {
        counts.skipped++
      } else {
        toEmbed.push({ record: batch[j], text: texts[j], hash: hashes[j] })
      }
    }

    if (toEmbed.length === 0) continue

    const embeddings = await embedBatch(toEmbed.map((entry) => entry.text))

    const rows = toEmbed.map((entry, idx) => ({
      firm_id: entry.record.firm_id,
      client_id: entry.record.client_id,
      entity_cdd_id: entry.record.id,
      content_hash: entry.hash,
      embedding: embeddings[idx],
      updated_at: new Date().toISOString(),
    }))

    const { error: upsertError } = await supabase
      .from('extraction_embeddings')
      .upsert(rows, { onConflict: 'entity_cdd_id' })
    if (upsertError) throw new Error(`Failed to upsert entity CDD embeddings: ${upsertError.message}`)

    counts.embedded += toEmbed.length
  }

  return counts
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    const [clients, extractions, entityCdd] = await Promise.all([
      backfillClients(supabase),
      backfillExtractions(supabase),
      backfillEntityCdd(supabase),
    ])

    return Response.json({ ok: true, clients, extractions, entityCdd })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backfill failed'
    return Response.json({ error: message }, { status: 500 })
  }
}
