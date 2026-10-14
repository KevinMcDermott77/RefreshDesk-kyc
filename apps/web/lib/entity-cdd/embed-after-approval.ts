export type AuditInsert = {
  from(table: 'audit_events'): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>
  }
}

type Input = {
  supabase: AuditInsert
  firmId: string
  clientId: string
  recordId: string
  userId: string
  /** Embeds the client, then the record; throws if either fails. */
  embed: () => Promise<void>
  log?: (message: string, detail?: unknown) => void
}

/**
 * Runs the search embedding after an approval has committed. The approval stands whatever
 * happens here: a failure is recorded as an `embedding.failed` audit event and logged, never
 * shown to the reviewer as if the approval had failed.
 */
export async function embedAfterApproval({
  supabase,
  firmId,
  clientId,
  recordId,
  userId,
  embed,
  log = console.error,
}: Input): Promise<{ ok: boolean }> {
  try {
    await embed()
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('[embedding] failed after approval', { recordId, clientId, message })
    try {
      const { error } = await supabase.from('audit_events').insert({
        firm_id: firmId,
        actor_user_id: userId,
        event_type: 'embedding.failed',
        entity_type: 'client',
        entity_id: clientId,
        payload: { client_id: clientId, record_id: recordId, error: message },
      })
      if (error) log('[embedding] could not record embedding.failed', error.message)
    } catch (auditErr) {
      log('[embedding] could not record embedding.failed', auditErr)
    }
    return { ok: false }
  }
}
