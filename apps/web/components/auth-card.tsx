import { ShieldCheck } from "lucide-react";

export function AuthCard({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-6xl items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="max-w-xl">
          <div className="mb-8 inline-flex h-11 w-11 items-center justify-center rounded-sm border border-[var(--line)] bg-[var(--panel)]">
            <ShieldCheck className="h-5 w-5 text-[var(--accent)]" />
          </div>
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
            RefreshDesk
          </p>
          <h1 className="text-4xl font-semibold leading-tight text-[#111815] md:text-5xl">
            Audit-ready KYC refresh without spreadsheet drift.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-[var(--muted)]">
            Launch overdue refresh workflows, record every state change, and keep
            the paper trail clean from the first client touch.
          </p>
        </section>
        <section className="border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_22px_70px_rgba(44,36,22,0.11)] md:p-8">
          <h2 className="text-2xl font-semibold">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {description}
          </p>
          <div className="mt-8">{children}</div>
        </section>
      </div>
    </main>
  );
}
