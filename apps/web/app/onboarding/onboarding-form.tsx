"use client";

import { useActionState } from "react";
import { createFirm } from "@/app/actions";
import { FormError } from "@/components/form-error";

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createFirm, {});

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-3xl border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_22px_70px_rgba(44,36,22,0.11)] md:p-8">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
          Firm setup
        </p>
        <h1 className="text-3xl font-semibold">Create your firm workspace</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          These details anchor tenant membership and the first audit event. MLR
          supervisor details stay editable in firm settings.
        </p>
        <form action={action} className="mt-8 grid gap-5">
          <label className="block">
            <span className="text-sm font-medium">Your full name</span>
            <input
              className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--accent)]"
              name="full_name"
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Firm name</span>
            <input
              className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--accent)]"
              name="name"
              required
            />
          </label>
          <div className="grid gap-5 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">MLR supervisor</span>
              <input
                className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--accent)]"
                name="mlr_supervisor"
                placeholder="HMRC, FCA, ICAEW"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Firm reference number</span>
              <input
                className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--accent)]"
                name="firm_reference_number"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium">Brand colour</span>
            <input
              className="mt-2 h-12 w-full border border-[var(--line)] bg-white px-2 py-2 outline-none focus:border-[var(--accent)]"
              name="brand_primary"
              type="color"
              defaultValue="#0f766e"
            />
          </label>
          <FormError message={state.error} />
          <button
            className="bg-[var(--accent)] px-4 py-3 font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
            disabled={pending}
            type="submit"
          >
            {pending ? "Creating workspace..." : "Create workspace"}
          </button>
        </form>
      </section>
    </main>
  );
}
