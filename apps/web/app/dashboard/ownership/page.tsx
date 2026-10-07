import Link from 'next/link'
import { OwnershipViewer } from './ownership-viewer'

export default function OwnershipPage() {
  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-6xl">
        <header className="border-b border-[var(--line)] pb-6">
          <Link href="/dashboard" className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-3xl font-semibold">Ownership chain</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Walks the Companies House PSC register upwards from a company. Runs live; nothing is saved. Individuals
            are shown as initials only.
          </p>
        </header>
        <OwnershipViewer />
      </section>
    </main>
  )
}
