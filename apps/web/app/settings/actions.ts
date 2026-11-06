'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

type ActionState = { error?: string; success?: string }

export async function setEvidenceExtractionAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const firmId = String(formData.get('firm_id') ?? '').trim()
  if (!firmId) return { error: 'Missing firm' }
  const enabled = formData.get('enabled') === 'on'

  const { error } = await supabase.rpc('set_evidence_extraction', { p_firm_id: firmId, p_enabled: enabled })
  if (error) return { error: error.message }

  revalidatePath('/settings')
  return { success: enabled ? 'Document extraction is on' : 'Document extraction is off' }
}

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
