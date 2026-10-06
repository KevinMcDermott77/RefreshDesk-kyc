import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { semanticSearch } from '@/lib/search/semantic-search'

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const query = (q ?? '').trim()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('firm_members')
    .select('firm_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()

  if (!membership) redirect('/onboarding')

  const results = query ? await semanticSearch(query) : []

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-6xl">
        <header className="border-b border-[var(--line)] pb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
            RefreshDesk
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Search results</h1>
          {query ? (
            <p className="mt-2 text-sm text-[var(--muted)]">
              Showing matches for &ldquo;{query}&rdquo;
            </p>
          ) : (
            <p className="mt-2 text-sm text-[var(--muted)]">Enter a search term to find clients.</p>
          )}
        </header>

        {query && results.length === 0 ? (
          <p className="mt-8 text-sm text-[var(--muted)]">No matching clients found.</p>
        ) : null}

        {results.length > 0 ? (
          <ul className="mt-8 divide-y divide-[var(--line)] border border-[var(--line)]">
            {results.map((result) => (
              <li key={result.clientId} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <Link
                    href={`/dashboard/clients/${result.clientId}`}
                    className="font-semibold text-[var(--accent)] hover:underline"
                  >
                    {result.clientName}
                  </Link>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Matched on {result.matchType === 'client' ? 'client profile' : 'document content'}
                  </p>
                </div>
                <span className="text-xs font-semibold text-[var(--muted)]">
                  {Math.round(result.similarity * 100)}% match
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  )
}
