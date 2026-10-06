'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { upsertClientEmbedding } from '@/lib/search/upsert-client-embedding'
import { upsertEntityCddEmbedding } from '@/lib/search/upsert-entity-cdd-embedding'
import type { Client } from '@/lib/types/clients'

export type ReviewEntityCddState = { error?: string }

export async function reviewEntityCddAction(
  _prev: ReviewEntityCddState,
  formData: FormData,
): Promise<ReviewEntityCddState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const recordId = String(formData.get('record_id') ?? '').trim()
  const clientId = String(formData.get('client_id') ?? '').trim()
  const decision = String(formData.get('decision') ?? '').trim()
  const reviewerNotes = String(formData.get('reviewer_notes') ?? '').trim() || null

  if (!recordId) return { error: 'Missing record ID' }
  if (!clientId) return { error: 'Missing client ID' }
  if (decision !== 'approved' && decision !== 'rejected') return { error: 'Invalid decision' }

  const { error } = await supabase.rpc('review_entity_cdd', {
    p_record_id: recordId,
    p_decision: decision,
    p_reviewer_notes: reviewerNotes,
  })

  if (error) return { error: error.message }

  if (decision === 'approved') {
    const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).single()
    if (client) await upsertClientEmbedding(client as Client)
    await upsertEntityCddEmbedding(recordId)
  }

  revalidatePath(`/dashboard/clients/${clientId}`)
  redirect(`/dashboard/clients/${clientId}`)
}
