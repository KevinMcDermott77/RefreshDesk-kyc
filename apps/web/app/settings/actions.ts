'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

type ActionState = { error?: string; success?: string }

export async function updateSupervisorEmailAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const email = String(formData.get('mlr_supervisor_email') ?? '').trim()
  if (!email) return { error: 'Email is required' }

  const { error } = await supabase.rpc('update_firm_supervisor_email', {
    p_supervisor_email: email,
  })

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return { success: 'Saved' }
}
