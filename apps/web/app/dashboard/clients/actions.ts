'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { upsertClientEmbedding } from '@/lib/search/upsert-client-embedding'
import type { Client } from '@/lib/types/clients'

async function embedClientById(supabase: Awaited<ReturnType<typeof createClient>>, clientId: string) {
  const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).single()
  if (client) await upsertClientEmbedding(client as Client)
}

type ActionState = { error?: string; success?: string }

async function getActiveMembership() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { supabase: null, user: null, membership: null }

  const { data: membership } = await supabase
    .from('firm_members')
    .select('firm_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()

  return { supabase, user, membership }
}

export async function addClientAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase, membership } = await getActiveMembership()
  if (!supabase || !membership) return { error: 'Not authenticated' }

  const dueDateRaw = String(formData.get('refresh_due_date') ?? '').trim()

  const { data: clientId, error } = await supabase.rpc('create_client', {
    p_firm_id: membership.firm_id,
    p_client_type: String(formData.get('client_type') ?? ''),
    p_display_name: String(formData.get('display_name') ?? ''),
    p_risk_rating: String(formData.get('risk_rating') ?? ''),
    p_details: {},
    p_external_ref: String(formData.get('external_ref') ?? '').trim() || null,
    p_refresh_due_date: dueDateRaw || null,
  })

  if (error) return { error: error.message }

  if (clientId) await embedClientById(supabase, clientId as string)

  revalidatePath('/dashboard/clients')
  redirect('/dashboard/clients')
}

export async function editClientAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase } = await getActiveMembership()
  if (!supabase) return { error: 'Not authenticated' }

  const clientId = String(formData.get('client_id') ?? '').trim()
  if (!clientId) return { error: 'Missing client ID' }

  const patch: Record<string, unknown> = {}
  for (const key of [
    'client_type',
    'display_name',
    'risk_rating',
    'external_ref',
    'refresh_due_date',
  ]) {
    const val = formData.get(key)
    if (val !== null) {
      const str = String(val).trim()
      patch[key] = str === '' ? null : str
    }
  }

  const { error } = await supabase.rpc('update_client', {
    p_client_id: clientId,
    p_patch: patch,
  })

  if (error) return { error: error.message }

  await embedClientById(supabase, clientId)

  revalidatePath(`/dashboard/clients/${clientId}`)
  revalidatePath('/dashboard/clients')
  redirect(`/dashboard/clients/${clientId}`)
}

export async function archiveClientAction(formData: FormData): Promise<void> {
  const { supabase } = await getActiveMembership()
  if (!supabase) return

  const clientId = String(formData.get('client_id') ?? '').trim()
  if (!clientId) return

  await supabase.rpc('archive_client', { p_client_id: clientId })

  revalidatePath('/dashboard/clients')
  redirect('/dashboard/clients')
}

export type ImportResult = {
  error?: string
  inserted_count?: number
  row_errors?: { row_index: number; error_message: string }[]
}

export async function importClientsAction(
  _prev: ImportResult,
  formData: FormData
): Promise<ImportResult> {
  const { supabase, membership } = await getActiveMembership()
  if (!supabase || !membership) return { error: 'Not authenticated' }

  const rowsRaw = String(formData.get('rows') ?? '[]')
  let rows: unknown[]
  try {
    rows = JSON.parse(rowsRaw)
    if (!Array.isArray(rows)) throw new Error()
  } catch {
    return { error: 'Invalid rows payload' }
  }

  const { data, error } = await supabase.rpc('import_clients', {
    p_firm_id: membership.firm_id,
    p_rows: rows,
  })

  if (error) return { error: error.message }

  const result = data as { inserted_count?: number; errors?: { row_index: number; error_message: string }[] }
  if (typeof result?.inserted_count !== 'number') {
    return { error: 'Server returned invalid response format' }
  }

  return {
    inserted_count: result.inserted_count,
    row_errors: result.errors ?? [],
  }
}
