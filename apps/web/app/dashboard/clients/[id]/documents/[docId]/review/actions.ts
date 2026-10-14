'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { upsertExtractionEmbedding } from '@/lib/search/upsert-extraction-embedding'
import type { DocumentExtraction, DocumentType } from '@/lib/types/documents'
import { getMembership } from '@/lib/entity-cdd/membership'
import { canReview } from '@/lib/entity-cdd/permissions'

export type ReviewState = { error?: string }

export async function reviewExtractionAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const extractionId = String(formData.get('extraction_id') ?? '').trim()
  const clientId = String(formData.get('client_id') ?? '').trim()
  const decision = String(formData.get('decision') ?? '').trim()
  const reviewerNotes = String(formData.get('reviewer_notes') ?? '').trim() || null

  if (!extractionId) return { error: 'Missing extraction ID' }
  if (!clientId) return { error: 'Missing client ID' }
  if (decision !== 'approved' && decision !== 'rejected') return { error: 'Invalid decision' }

  // Reviewing needs an admin (reviewer); the database enforces it, this gives a clear message first.
  const { data: client } = await supabase.from('clients').select('firm_id').eq('id', clientId).maybeSingle()
  const membership = client ? await getMembership(supabase, user.id, client.firm_id) : null
  if (!membership || !canReview(membership.role)) {
    return { error: 'Only an admin (reviewer) can approve or reject documents' }
  }

  const { error } = await supabase.rpc('review_extraction', {
    p_extraction_id: extractionId,
    p_decision: decision,
    p_reviewer_notes: reviewerNotes,
  })

  if (error) return { error: error.message }

  if (decision === 'approved') {
    const { data: extraction } = await supabase
      .from('document_extractions')
      .select('*, client_documents(document_type)')
      .eq('id', extractionId)
      .single()

    if (extraction) {
      const { client_documents, ...extractionRow } = extraction as DocumentExtraction & {
        client_documents: { document_type: DocumentType } | null
      }
      if (client_documents) {
        await upsertExtractionEmbedding(extractionRow, client_documents.document_type)
      }
    }
  }

  revalidatePath(`/dashboard/clients/${clientId}`)
  redirect(`/dashboard/clients/${clientId}`)
}
