'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { snapshotFingerprint } from '@/lib/packs/canonical'
import { packFirmId } from '@/lib/packs/offer'
import { packSigningSecret, verifyPackSignature } from '@/lib/packs/sign'
import { parseSnapshot } from '@/lib/packs/snapshot'

export type SavePackInput = {
  snapshot: unknown
  sha256: string
  issuedAt: string
  signature: string
}

export type SavePackResult = { id?: string; error?: string }

/**
 * Saves a run as a refresh pack. The snapshot must be the one the server built and signed for this
 * firm in the last hour; its fingerprint is recomputed here, never taken from the browser.
 */
export async function saveRefreshPackAction(input: SavePackInput): Promise<SavePackResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const secret = packSigningSecret()
  if (!secret) return { error: 'Saving refresh packs needs PACK_SIGNING_SECRET to be set on the server.' }

  const firmId = await packFirmId(supabase, user.id)
  if (!firmId) return { error: 'Only admins and members of a firm can save refresh packs.' }

  let snapshot
  try {
    snapshot = parseSnapshot(input.snapshot)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'The snapshot is not valid' }
  }

  const sha256 = await snapshotFingerprint(snapshot)
  if (sha256 !== input.sha256) return { error: 'The run was changed after it was made: run the walk again' }

  const verified = verifyPackSignature(secret, firmId, input.issuedAt, sha256, input.signature)
  if (!verified.ok) return { error: verified.reason }

  const { data, error } = await supabase.rpc('create_refresh_pack', {
    p_firm_id: firmId,
    p_subject: snapshot.subject.id,
    p_subject_name: snapshot.subject.name,
    p_policy: snapshot.policy,
    p_snapshot: snapshot,
    p_snapshot_sha256: sha256,
  })
  if (error || !data) return { error: error?.message ?? 'The pack could not be saved' }

  revalidatePath('/dashboard/packs')
  return { id: String(data) }
}

export type SignOffState = { error?: string; done?: boolean }

async function review(
  rpc: 'submit_refresh_pack' | 'approve_refresh_pack' | 'reject_refresh_pack',
  formData: FormData,
): Promise<SignOffState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const packId = String(formData.get('pack_id') ?? '').trim()
  if (!packId) return { error: 'Missing pack' }
  const note = String(formData.get('note') ?? '').trim()

  const args: Record<string, unknown> = { p_pack_id: packId }
  if (rpc !== 'submit_refresh_pack') args.p_note = note || null
  if (rpc === 'reject_refresh_pack' && !note) return { error: 'A note is required to reject a pack' }

  const { error } = await supabase.rpc(rpc, args)
  if (error) return { error: error.message }

  revalidatePath(`/dashboard/packs/${packId}`)
  revalidatePath('/dashboard/packs')
  return { done: true }
}

export async function submitPackAction(_prev: SignOffState, formData: FormData): Promise<SignOffState> {
  return review('submit_refresh_pack', formData)
}

export async function approvePackAction(_prev: SignOffState, formData: FormData): Promise<SignOffState> {
  return review('approve_refresh_pack', formData)
}

export async function rejectPackAction(_prev: SignOffState, formData: FormData): Promise<SignOffState> {
  return review('reject_refresh_pack', formData)
}
