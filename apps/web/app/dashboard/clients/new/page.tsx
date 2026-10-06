import { ClientForm } from '../client-form'
import { addClientAction } from '../actions'

export default function NewClientPage() {
  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-3xl border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_22px_70px_rgba(44,36,22,0.11)] md:p-8">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
          Client management
        </p>
        <h1 className="text-3xl font-semibold">Add client</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          Refresh due date defaults to the firm cadence for the selected risk
          rating unless overridden.
        </p>
        <div className="mt-8">
          <ClientForm
            action={addClientAction}
            submitLabel="Add client"
            cancelHref="/dashboard/clients"
          />
        </div>
      </section>
    </main>
  )
}
