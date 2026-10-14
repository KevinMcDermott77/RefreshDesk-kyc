import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { getMembership } from '../membership'

type Row = { user_id: string; firm_id: string; status: string; role: string }

/** A stand-in for supabase.from('firm_members') that applies the filters it is given. */
function stubSupabase(rows: Row[]) {
  const calls: string[] = []
  const client = {
    from(table: string) {
      calls.push(`from:${table}`)
      const filters: Record<string, string> = {}
      const builder = {
        select(columns: string) {
          calls.push(`select:${columns}`)
          return builder
        },
        eq(column: string, value: string) {
          calls.push(`eq:${column}=${value}`)
          filters[column] = value
          return builder
        },
        single() {
          throw new Error('single() must not be used: a user in several firms has several rows')
        },
        async maybeSingle() {
          calls.push('maybeSingle')
          const matches = rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k as keyof Row] === v))
          if (matches.length > 1) return { data: null, error: { message: 'multiple rows' } }
          return { data: matches[0] ?? null, error: null }
        },
      }
      return builder
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

const rows: Row[] = [
  { user_id: 'u1', firm_id: 'firm-a', status: 'active', role: 'admin' },
  { user_id: 'u1', firm_id: 'firm-b', status: 'active', role: 'read_only' },
  { user_id: 'u2', firm_id: 'firm-a', status: 'disabled', role: 'member' },
]

describe('getMembership', () => {
  it('filters on the firm, so a user in two firms gets the right role for each', async () => {
    const { client } = stubSupabase(rows)
    expect(await getMembership(client, 'u1', 'firm-a')).toMatchObject({ firm_id: 'firm-a', role: 'admin' })
    expect(await getMembership(client, 'u1', 'firm-b')).toMatchObject({ firm_id: 'firm-b', role: 'read_only' })
  })

  it('asks for the user, active status and firm, and never uses single()', async () => {
    const { client, calls } = stubSupabase(rows)
    await getMembership(client, 'u1', 'firm-a')
    expect(calls).toEqual(
      expect.arrayContaining(['from:firm_members', 'eq:user_id=u1', 'eq:status=active', 'eq:firm_id=firm-a', 'maybeSingle']),
    )
  })

  it('returns null for a firm the user is not in, or an inactive membership', async () => {
    const { client } = stubSupabase(rows)
    expect(await getMembership(client, 'u1', 'firm-c')).toBeNull()
    expect(await getMembership(client, 'u2', 'firm-a')).toBeNull()
  })
})
