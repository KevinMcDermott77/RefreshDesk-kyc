import type { SupabaseClient } from '@supabase/supabase-js'

export type Membership = { firm_id: string; role: string }

/**
 * The user's active membership of one firm. Filtering on the firm matters: a user in
 * several firms has several rows, and an unfiltered .single() fails for them (and would
 * pick the wrong firm for the storage path).
 */
export async function getMembership(
  supabase: SupabaseClient,
  userId: string,
  firmId: string,
): Promise<Membership | null> {
  const { data } = await supabase
    .from('firm_members')
    .select('firm_id, role')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('firm_id', firmId)
    .maybeSingle()
  return (data as Membership | null) ?? null
}
