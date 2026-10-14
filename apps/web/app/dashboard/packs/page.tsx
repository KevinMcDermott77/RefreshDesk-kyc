import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatFetchedAt } from '@/lib/ownership/to-flow'
import { PACK_STATUS_LABELS, type PackStatus } from '@/lib/packs/sign-off'

type PackRow = {
  id: string
  firm_id: string
  subject: string
  subject_name: string
  status: PackStatus
  created_by: string
  created_at: string
}

const STATUS_STYLE: Record<PackStatus, string> = {
  draft: 'text-[var(--muted)]',
  submitted: 'text-amber-700 font-semibold',
  approved: 'text-emerald-700',
  rejected: 'text-red-700',
}

export default async function PacksPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Row-level security limits this to the user's own firms.
  const { data } = await supabase
    .from('refresh_packs')
    .select('id, firm_id, subject, subject_name, status, created_by, created_at')
    .order('created_at', { ascending: false })
    .limit(200)
  const packs = (data ?? []) as PackRow[]

  const { data: members } = await supabase.from('firm_members').select('user_id, full_name')
  const names = new Map<string, string>((members ?? []).map((m) => [m.user_id as string, m.full_name as string]))

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-6xl">
        <header className="border-b border-[var(--line)] pb-6">
          <Link href="/dashboard" className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-3xl font-semibold">Refresh packs</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Saved, unchangeable records of ownership runs. Start one from the{' '}
            <Link href="/dashboard/ownership" className="underline">
              ownership chain
            </Link>{' '}
            page with “Save as refresh pack”.
          </p>
        </header>

        {packs.length === 0 ? (
          <p className="py-12 text-center text-sm text-[var(--muted)]">No refresh packs yet.</p>
        ) : (
          <table className="mt-6 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                <th className="py-2 pr-4">Subject</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Created by</th>
                <th className="py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {packs.map((pack) => (
                <tr key={pack.id} className="border-b border-[var(--line)]">
                  <td className="py-3 pr-4">
                    <Link href={`/dashboard/packs/${pack.id}`} className="font-semibold text-[var(--accent-strong)] hover:underline">
                      {pack.subject_name}
                    </Link>
                    <span className="block text-xs text-[var(--muted)]">{pack.subject}</span>
                  </td>
                  <td className={`py-3 pr-4 ${STATUS_STYLE[pack.status]}`}>{PACK_STATUS_LABELS[pack.status]}</td>
                  <td className="py-3 pr-4">{names.get(pack.created_by) ?? 'Unknown'}</td>
                  <td className="py-3 whitespace-nowrap">{formatFetchedAt(pack.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
