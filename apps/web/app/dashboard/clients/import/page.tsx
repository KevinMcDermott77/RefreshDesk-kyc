import { ImportForm } from './import-form'

export default function ImportClientsPage() {
  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-3xl border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_22px_70px_rgba(44,36,22,0.11)] md:p-8">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
          Client management
        </p>
        <h1 className="text-3xl font-semibold">Import clients from CSV</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          Upload a CSV file. Valid rows are previewed before import. Invalid
          rows show inline errors and are skipped.
        </p>
        <ImportForm />
      </section>
    </main>
  )
}
