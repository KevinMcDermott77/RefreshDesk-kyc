import type { SupabaseClient } from '@supabase/supabase-js'
import { signPack } from './sign'
import { buildSnapshot, sealSnapshot, type BuildSnapshotInput, type PackSnapshot } from './snapshot'

/** A finished run, ready to be saved as a refresh pack: the snapshot, its fingerprint and a signature. */
export type PackOffer = {
  snapshot: PackSnapshot
  sha256: string
  issuedAt: string
  signature: string
}

export type PackOfferResult = { offer: PackOffer } | { unavailable: string }

/** Builds, fingerprints and signs the snapshot of a run. Pure given its inputs (and the clock). */
export async function createPackOffer(
  input: BuildSnapshotInput,
  options: { firmId: string; secret: string; now?: Date },
): Promise<PackOffer> {
  const now = options.now ?? new Date()
  const { snapshot, sha256 } = await sealSnapshot(buildSnapshot({ ...input, now }))
  const issuedAt = now.toISOString()
  return { snapshot, sha256, issuedAt, signature: signPack(options.secret, options.firmId, issuedAt, sha256) }
}

/**
 * The firm a new pack belongs to: the user's first active membership that can write. (The app has
 * no "current firm" yet; users in several firms get their earliest one.) Null if they cannot write anywhere.
 */
export async function packFirmId(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('firm_members')
    .select('firm_id, role')
    .eq('user_id', userId)
    .eq('status', 'active')
    .in('role', ['admin', 'member'])
    .order('created_at', { ascending: true })
    .limit(1)
  const row = (data as { firm_id: string }[] | null)?.[0]
  return row?.firm_id ?? null
}
