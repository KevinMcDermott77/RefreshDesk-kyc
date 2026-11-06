'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { downloadDocument } from '@/lib/supabase/storage'
import { getMembership } from '@/lib/entity-cdd/membership'
import { canReview, canWrite } from '@/lib/entity-cdd/permissions'
import { matchesMimeType, uploadBelongsTo } from '@/lib/entity-cdd/fetch-input'
import { MAX_FILE_SIZE_BYTES } from '@/lib/types/documents'
import { sha256Hex } from '@/lib/evidence/hash'
import { parseEvidenceUploadInput } from '@/lib/evidence/input'
import { normalisePayload } from '@/lib/evidence/payload'
import { extractOwnershipEvidence, EVIDENCE_MODEL, EVIDENCE_PROMPT_VERSION } from '@/lib/evidence/extract'
import { classifyExtractionError } from '@/lib/evidence/extraction-failure'

export type EvidenceActionState = { error?: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function itemPath(clientId: string, evidenceId: string, notice?: string, reason?: string): string {
  const query = notice ? `?notice=${notice}${reason ? `&reason=${reason}` : ''}` : ''
  return `/dashboard/clients/${clientId}/evidence/${evidenceId}${query}`
}

/** Opens an evidence item from a file the browser has already put in Storage, and runs extraction if asked and allowed. */
export async function createEvidenceAction(_prev: EvidenceActionState, formData: FormData): Promise<EvidenceActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Only a client, a node, a kind and the path of a file already in Storage come from the browser.
  const parsed = parseEvidenceUploadInput(formData)
  if (!parsed.ok) return { error: parsed.error }
  const { clientId, subjectId, nodeKey, nodeName, identity, kind, upload, wantExtraction } = parsed.input

  const { data: client } = await supabase.from('clients').select('id, firm_id').eq('id', clientId).maybeSingle()
  if (!client) return { error: 'Client not found' }
  const membership = await getMembership(supabase, user.id, client.firm_id)
  if (!membership) return { error: 'Not a member of this firm' }
  if (!canWrite(membership.role)) return { error: 'You do not have permission to do this' }

  if (!uploadBelongsTo(upload.path, membership.firm_id, clientId)) {
    return { error: "The uploaded document is not in this client's folder" }
  }
  const buffer = await downloadDocument(upload.path)
  if (!buffer) return { error: 'The uploaded document could not be found in storage' }
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_FILE_SIZE_BYTES) return { error: 'File exceeds 10 MB limit' }
  if (!matchesMimeType(buffer, upload.type)) return { error: 'The uploaded file is not a valid PDF, JPEG or PNG' }

  const { data: evidenceId, error: createError } = await supabase.rpc('create_ownership_evidence', {
    p_client_id: clientId,
    p_subject_id: subjectId,
    p_node_key: nodeKey,
    p_node_name: nodeName,
    p_node_identity: identity,
    p_evidence_kind: kind,
    p_storage_path: upload.path,
    p_file_name: upload.name,
    p_file_size_bytes: buffer.byteLength,
    p_mime_type: upload.type,
    p_document_sha256: sha256Hex(buffer),
  })
  if (createError || !evidenceId) return { error: createError?.message ?? 'Failed to open the evidence item' }

  let notice: string | undefined
  let reason: string | undefined
  if (wantExtraction) {
    const { data: firm } = await supabase.from('firms').select('evidence_extraction_enabled').eq('id', client.firm_id).maybeSingle()
    if (!firm?.evidence_extraction_enabled) {
      notice = 'extraction_off'
    } else {
      try {
        const extraction = await extractOwnershipEvidence(buffer, upload.type, kind)
        const { error: saveError } = await supabase.rpc('save_evidence_proposal', {
          p_evidence_id: evidenceId,
          p_source: 'extraction',
          p_proposal: extraction.payload,
          p_model_used: EVIDENCE_MODEL,
          p_prompt_version: EVIDENCE_PROMPT_VERSION,
          p_confidence: extraction.confidence,
          p_raw_response: extraction.rawResponse,
        })
        if (saveError) {
          notice = 'extraction_failed'
          reason = 'save_failed'
          console.error('[evidence-extraction] proposal not saved', { evidenceId, kind, model: EVIDENCE_MODEL, message: saveError.message })
        }
      } catch (err) {
        // The upload is kept: the item stays a draft and the owners can be entered by hand. The log has the
        // code, status and Anthropic's request id: never the document or the model's reply.
        const failure = classifyExtractionError(err)
        notice = 'extraction_failed'
        reason = failure.code
        console.error('[evidence-extraction] failed', {
          evidenceId,
          kind,
          model: EVIDENCE_MODEL,
          mime: upload.type,
          bytes: buffer.byteLength,
          code: failure.code,
          status: failure.status,
          requestId: failure.requestId,
        })
      }
    }
  }

  revalidatePath(`/dashboard/clients/${clientId}`)
  revalidatePath('/dashboard/evidence')
  redirect(itemPath(clientId, evidenceId, notice, reason))
}

function readIds(formData: FormData): { evidenceId: string; clientId: string } | { error: string } {
  const evidenceId = String(formData.get('evidence_id') ?? '').trim()
  const clientId = String(formData.get('client_id') ?? '').trim()
  if (!UUID.test(evidenceId)) return { error: 'Missing evidence ID' }
  if (!UUID.test(clientId)) return { error: 'Missing client ID' }
  return { evidenceId, clientId }
}

/** The kind of an evidence item (it decides which fields apply). Row-level security limits this to the user's firm. */
async function kindOf(supabase: Awaited<ReturnType<typeof createClient>>, evidenceId: string): Promise<string | undefined> {
  const { data } = await supabase.from('ownership_evidence').select('evidence_kind').eq('id', evidenceId).maybeSingle()
  return (data as { evidence_kind?: string } | null)?.evidence_kind
}

function readPayload(formData: FormData): unknown {
  try {
    return JSON.parse(String(formData.get('payload') ?? ''))
  } catch {
    return undefined
  }
}

/** The uploader types (or corrects) the owners. The server sets every individual's initials from the name. */
export async function saveProposalAction(_prev: EvidenceActionState, formData: FormData): Promise<EvidenceActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const ids = readIds(formData)
  if ('error' in ids) return ids

  const normalised = normalisePayload(readPayload(formData), { kind: await kindOf(supabase, ids.evidenceId) })
  if (!normalised.ok) return { error: normalised.error }

  const { error } = await supabase.rpc('save_evidence_proposal', {
    p_evidence_id: ids.evidenceId,
    p_source: 'manual',
    p_proposal: normalised.payload,
  })
  if (error) return { error: error.message }

  revalidatePath('/dashboard/evidence')
  redirect(itemPath(ids.clientId, ids.evidenceId))
}

/** An admin, who is not the uploader when four-eyes is on, confirms the proposal as it is or with edits. */
export async function confirmEvidenceAction(_prev: EvidenceActionState, formData: FormData): Promise<EvidenceActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const ids = readIds(formData)
  if ('error' in ids) return ids

  const { data: client } = await supabase.from('clients').select('firm_id').eq('id', ids.clientId).maybeSingle()
  const membership = client ? await getMembership(supabase, user.id, client.firm_id) : null
  if (!membership || !canReview(membership.role)) return { error: 'Only an admin (reviewer) can confirm client evidence' }

  const normalised = normalisePayload(readPayload(formData), { forConfirm: true, kind: await kindOf(supabase, ids.evidenceId) })
  if (!normalised.ok) return { error: normalised.error }

  const note = String(formData.get('note') ?? '').trim() || null
  const { error } = await supabase.rpc('confirm_ownership_evidence', {
    p_evidence_id: ids.evidenceId,
    p_confirmed: normalised.payload,
    p_note: note,
  })
  if (error) return { error: error.message }

  revalidatePath('/dashboard/evidence')
  revalidatePath(`/dashboard/clients/${ids.clientId}`)
  redirect('/dashboard/evidence')
}

/** An admin rejects, or the uploader withdraws. A note is required; the item is kept. */
export async function rejectEvidenceAction(_prev: EvidenceActionState, formData: FormData): Promise<EvidenceActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const ids = readIds(formData)
  if ('error' in ids) return ids

  const note = String(formData.get('note') ?? '').trim()
  if (!note) return { error: 'A note is required to reject or withdraw evidence' }

  const { error } = await supabase.rpc('reject_ownership_evidence', { p_evidence_id: ids.evidenceId, p_note: note })
  if (error) return { error: error.message }

  revalidatePath('/dashboard/evidence')
  redirect('/dashboard/evidence')
}
