"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login } from "@/app/actions";
import { AuthCard } from "@/components/auth-card";
import { FormError } from "@/components/form-error";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, {});

  return (
    <AuthCard
      title="Log in"
      description="Return to your firm workspace and continue the refresh queue."
    >
      <form action={action} className="space-y-5">
        <FormError message={state.error} />
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input
            className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--accent)]"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Password</span>
          <input
            className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--accent)]"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <button
          className="w-full bg-[var(--accent)] px-4 py-3 font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Logging in..." : "Log in"}
        </button>
      </form>
      <p className="mt-6 text-sm text-[var(--muted)]">
        New to RefreshDesk?{" "}
        <Link
          className="font-semibold text-[var(--accent-strong)]"
          href="/signup"
        >
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}
