"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signUp } from "@/app/actions";
import { AuthCard } from "@/components/auth-card";
import { FormError } from "@/components/form-error";

export function SignupForm() {
  const [state, action, pending] = useActionState(signUp, {});
  const [mode, setMode] = useState<"create" | "join">("create");

  return (
    <AuthCard
      title="Create your account"
      description="Start with the firm owner account. The first active member becomes the firm admin."
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
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Firm</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              value="create"
              checked={mode === "create"}
              onChange={() => setMode("create")}
            />
            Create a new firm
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              value="join"
              checked={mode === "join"}
              onChange={() => setMode("join")}
            />
            Join an existing firm
          </label>
        </fieldset>

        {mode === "join" ? (
          <>
            <label className="block">
              <span className="text-sm font-medium">Your name</span>
              <input
                className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--accent)]"
                name="full_name"
                type="text"
                autoComplete="name"
                required={mode === "join"}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Join code</span>
              <input
                className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--accent)] uppercase"
                name="join_code"
                type="text"
                placeholder="e.g. XKCD7291"
                maxLength={8}
                required={mode === "join"}
              />
            </label>
          </>
        ) : null}

        <button
          className="w-full bg-[var(--accent)] px-4 py-3 font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Creating account..." : "Continue"}
        </button>
      </form>
      <p className="mt-6 text-sm text-[var(--muted)]">
        Already have an account?{" "}
        <Link className="font-semibold text-[var(--accent-strong)]" href="/login">
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}
