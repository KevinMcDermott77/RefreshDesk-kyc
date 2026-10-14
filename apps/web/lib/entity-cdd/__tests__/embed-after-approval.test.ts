import { describe, expect, it, vi } from 'vitest'
import { embedAfterApproval, type AuditInsert } from '../embed-after-approval'

function auditStub(result: { error: { message: string } | null } | Error = { error: null }) {
  const rows: Record<string, unknown>[] = []
  const supabase: AuditInsert = {
    from: () => ({
      insert: async (row) => {
        rows.push(row)
        if (result instanceof Error) throw result
        return result
      },
    }),
  }
  return { supabase, rows }
}

const input = { firmId: 'firm-1', clientId: 'client-1', recordId: 'rec-1', userId: 'user-1' }

describe('embedAfterApproval', () => {
  it('records nothing when embedding works', async () => {
    const { supabase, rows } = auditStub()
    const embed = vi.fn(async () => undefined)
    expect(await embedAfterApproval({ ...input, supabase, embed, log: vi.fn() })).toEqual({ ok: true })
    expect(embed).toHaveBeenCalledOnce()
    expect(rows).toEqual([])
  })

  it('does not throw when embedding fails: it audits embedding.failed and logs', async () => {
    const { supabase, rows } = auditStub()
    const log = vi.fn()
    const result = await embedAfterApproval({
      ...input,
      supabase,
      embed: async () => {
        throw new Error('Voyage 429')
      },
      log,
    })

    expect(result).toEqual({ ok: false })
    expect(rows).toEqual([
      {
        firm_id: 'firm-1',
        actor_user_id: 'user-1',
        event_type: 'embedding.failed',
        entity_type: 'client',
        entity_id: 'client-1',
        payload: { client_id: 'client-1', record_id: 'rec-1', error: 'Voyage 429' },
      },
    ])
    expect(log).toHaveBeenCalled()
  })

  it('still does not throw when the audit insert itself fails', async () => {
    const failing = embedAfterApproval({
      ...input,
      supabase: auditStub({ error: { message: 'rls' } }).supabase,
      embed: async () => Promise.reject(new Error('boom')),
      log: vi.fn(),
    })
    await expect(failing).resolves.toEqual({ ok: false })

    const throwing = embedAfterApproval({
      ...input,
      supabase: auditStub(new Error('network')).supabase,
      embed: async () => Promise.reject('plain string'),
      log: vi.fn(),
    })
    await expect(throwing).resolves.toEqual({ ok: false })
  })
})
