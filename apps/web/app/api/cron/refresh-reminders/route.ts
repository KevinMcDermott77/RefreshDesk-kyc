import { createClient } from '@supabase/supabase-js'
import { sendRefreshReminder } from '@/lib/resend/send-refresh-reminder'
import type { FirmDigest, DueClient } from '@/lib/resend/send-refresh-reminder'

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Fetch firms that have an MLR supervisor email configured
  const { data: firms, error: firmsError } = await supabase
    .from('firms')
    .select('id, name, mlr_supervisor, mlr_supervisor_email')
    .not('mlr_supervisor_email', 'is', null)

  if (firmsError) {
    return Response.json({ error: firmsError.message }, { status: 500 })
  }

  const firmList = firms ?? []
  if (firmList.length === 0) {
    return Response.json({ ok: true, results: [] })
  }

  const firmIds = firmList.map((f) => f.id)

  // Fetch active clients due within 30 days across those firms
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]

  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, display_name, client_type, risk_rating, refresh_due_date, firm_id')
    .eq('status', 'active')
    .in('firm_id', firmIds)
    .not('refresh_due_date', 'is', null)
    .lte('refresh_due_date', thirtyDaysFromNow)
    .order('firm_id')
    .order('refresh_due_date')

  if (clientsError) {
    return Response.json({ error: clientsError.message }, { status: 500 })
  }

  // Group clients by firm
  const byFirm = new Map<string, FirmDigest>()
  for (const c of clients ?? []) {
    if (!byFirm.has(c.firm_id)) {
      const firm = firmList.find((f) => f.id === c.firm_id)!
      byFirm.set(c.firm_id, {
        firm_id: c.firm_id,
        firm_name: firm.name,
        supervisor_name: firm.mlr_supervisor ?? 'MLR Supervisor',
        supervisor_email: firm.mlr_supervisor_email!,
        clients: [],
      })
    }
    byFirm.get(c.firm_id)!.clients.push({
      client_id: c.id,
      display_name: c.display_name,
      client_type: c.client_type,
      risk_rating: c.risk_rating,
      refresh_due_date: c.refresh_due_date,
    } satisfies DueClient)
  }

  // Send one email per firm; write audit event on success
  const results: string[] = []
  for (const digest of byFirm.values()) {
    // Skip firms with no due clients (firm had email but no matching clients after query filter)
    if (digest.clients.length === 0) continue

    try {
      await sendRefreshReminder(digest)

      await supabase.from('audit_events').insert({
        firm_id: digest.firm_id,
        actor_user_id: null,
        event_type: 'campaign.reminder_sent',
        entity_type: 'campaign',
        entity_id: null,
        payload: {
          recipient_email: digest.supervisor_email,
          client_count: digest.clients.length,
          due_within_days: 30,
        },
      })

      results.push(`sent: ${digest.firm_name} (${digest.clients.length} client${digest.clients.length === 1 ? '' : 's'})`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push(`error: ${digest.firm_name} — ${msg}`)
    }
  }

  return Response.json({ ok: true, results })
}
