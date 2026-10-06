'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

type ActionState = { error?: string; success?: string }

export async function generateJoinCodeAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()
  const role = String(formData.get('role') ?? 'member')

  const { error } = await supabase.rpc('generate_join_code', {
    p_role: role,
    p_expires_at: null,
    p_max_uses: null,
  })

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return { success: 'Join code generated' }
}

export async function deactivateJoinCodeAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()
  const codeId = String(formData.get('code_id') ?? '')
  if (!codeId) return { error: 'Missing join code id' }

  const { error } = await supabase.rpc('deactivate_join_code', {
    p_code_id: codeId,
  })

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return { success: 'Join code deactivated' }
}

export async function updateMemberRoleAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()
  const userId = String(formData.get('user_id') ?? '')
  const role = String(formData.get('role') ?? '')
  if (!userId || !role) return { error: 'Missing member or role' }

  const { error } = await supabase.rpc('update_member_role', {
    p_user_id: userId,
    p_role: role,
  })

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return { success: 'Role updated' }
}

export async function removeMemberAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()
  const userId = String(formData.get('user_id') ?? '')
  if (!userId) return { error: 'Missing member' }

  const { error } = await supabase.rpc('remove_firm_member', {
    p_user_id: userId,
  })

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return { success: 'Member removed' }
}
