import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getMembership } from '@/lib/entity-cdd/membership'
import { createClient } from '@/lib/supabase/server'
import { snapshotFingerprint } from '@/lib/packs/canonical'
import { packSignOffGate, type PackStatus } from '@/lib/packs/sign-off'
import { parseSnapshot, type PackSnapshot } from '@/lib/packs/snapshot'
import { PackReport, type PackMeta } from '../_components/PackReport'
import { PrintButton } from '../_components/PrintButton'
import { SignOffPanel } from '../_components/SignOffPanel'

type PackRecord = {
  id: string
  firm_id: string
  snapshot: unknown
  snapshot_sha256: string
  status: PackStatus
  created_by: string
  created_at: string
  submitted_at: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
}

export default async function PackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabase.from('refresh_packs').select('*').eq('id', id).maybeSingle()
  if (!data) notFound()
  const pack = data as PackRecord

  // Everything below the header comes from the stored snapshot; the only other inputs are the
  // pack's own record and who the user is. No register is contacted.
  const recomputed = await snapshotFingerprint(pack.snapshot)
  const verified = recomputed === pack.snapshot_sha256

  let snapshot: PackSnapshot | null = null
  try {
    snapshot = parseSnapshot(pack.snapshot)
  } catch {
    snapshot = null
  }

  const [membership, { data: firm }, { data: members }] = await Promise.all([
    getMembership(supabase, user.id, pack.firm_id),
    supabase.from('firms').select('four_eyes').eq('id', pack.firm_id).maybeSingle(),
    supabase.from('firm_members').select('user_id, full_name').eq('firm_id', pack.firm_id),
  ])
  const names = new Map<string, string>((members ?? []).map((m) => [m.user_id as string, m.full_name as string]))

  const gate = packSignOffGate({
    role: membership?.role,
    userId: user.id,
    createdBy: pack.created_by,
    status: pack.status,
    fourEyes: firm?.four_eyes ?? true,
  })

  const meta: PackMeta = {
    id: pack.id,
    status: pack.status,
    fingerprint: pack.snapshot_sha256,
    verified,
    recomputed,
    createdByName: names.get(pack.created_by) ?? 'Unknown',
    createdAt: pack.created_at,
    submittedAt: pack.submitted_at,
    reviewedByName: pack.reviewed_by ? (names.get(pack.reviewed_by) ?? 'Unknown') : null,
    reviewedAt: pack.reviewed_at,
    reviewNote: pack.review_note,
  }

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-5xl">
        <p className="no-print mb-4">
          <Link href="/dashboard/packs" className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
            ← Refresh packs
          </Link>
        </p>

        {snapshot ? (
          <>
            <PackReport snapshot={snapshot} meta={meta} controls={<PrintButton />} />
            <SignOffPanel packId={pack.id} gate={gate} />
          </>
        ) : (
          <p role="alert" className="border border-red-600 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
            This pack&apos;s snapshot could not be read. Its stored fingerprint is {pack.snapshot_sha256}.
            {verified ? '' : ' The snapshot also does not match that fingerprint.'}
          </p>
        )}
      </section>
    </main>
  )
}
