# RefreshDesk — Development Log

A working record of what was built, what was learned, and where the failure modes were. Updated after every meaningful working session.

This log doubles as portfolio evidence for the AICC PGCert Recognition of Prior Learning application and as a future reference when patterns reappear.

---

## 2026-05-09 — Project kickoff

**Built:** Project scope, README, repo planning. RefreshDesk defined as an auditable KYC refresh and remediation tool for UK accountants, TCSPs, and small wealth managers. ICP narrowed to UK firms in the 5-50 user band. Commercial wedge identified: workflow tool with auditable RAG engine inside, not an "AI tool" with workflow bolted on. Commercial model drafted (£149/£349/£749 tiered subscription). Path to first 5 paying customers documented.

**Learned:** A specialism statement is only useful when it constrains decisions. "Auditable RAG and AI evaluation for AML/KYC and regulated document workflows" is sharper than "applied AI engineer" because it rejects most paths and recommends a few specific ones. The same product can be framed as an engineering project or a commercial product; framing it as both simultaneously is the win — the AI engine is the moat, the workflow is the wedge.

---

## 2026-05-09 — Slice 1 foundation

**Built:** Slice 1 foundation. Multi-tenant Next.js 15 + TypeScript + Tailwind v4 app under `apps/web`. Supabase SSR auth setup. Signup, login, logout. Firm onboarding flow. Dashboard and settings shells. Supabase migrations for `firms`, `firm_members`, `audit_events`. `audit_events` is append-only via Postgres trigger. No `public.users` table — uses `auth.users` directly. Security-definer bootstrap function `firm_has_no_members(uuid)` for first-admin-of-empty-firm policy. RLS enabled and policied on all three tables.

Tag: `v0.1-slice-1-foundation`.

**Learned:** Postgres trigger-based immutability is the only way to guarantee audit integrity — application-layer rules can be bypassed by service-role keys. `SECURITY DEFINER` with pinned `search_path` is the correct hardening pattern for RLS policy helpers; without the pinned search_path, a malicious user could create a shadow table in another schema and trick the function. The bootstrap-first-admin pattern is a known chicken-and-egg case in multi-tenant SaaS — needs a dedicated policy with constraints tighter than the normal admin-creates-members policy.

---

## 2026-05-09 — Onboarding fix (silent failure)

**Built:** Atomic firm creation via security-definer RPC `create_firm_with_admin`. Replaced three application-layer inserts (firms, firm_members, audit_events) with one Postgres function called via `supabase.rpc()`. Error surfacing wired into the onboarding form — any RPC failure now renders visibly above the submit button. Server-side logging added at every RPC boundary so failures appear in the Next.js terminal.

Tag: `v0.1.1-onboarding-fix`.

**Diagnosis:** Onboarding form was returning HTTP 200 with no database side effects. Two consecutive 200s in the terminal with no rows in `firms`, `firm_members`, or `audit_events`. Root cause: the server action used a non-authenticated Supabase client, so RLS rejected all inserts silently because `auth.uid()` returned null. The Supabase client returns `{ data, error }` rather than throwing — and the action ignored the error.

**Learned:** Application-layer multi-table writes against RLS are fragile — partial failures leave inconsistent state. RPC with security definer is the right pattern for compliance-grade atomicity. Server actions must inspect Supabase `{ data, error }` returns or failures are silent. "Silent success" is a worse failure mode than a loud error because it convinces the user the work was done.

---

## 2026-05-09 — Middleware redirect loop fix

**Built:** Rewrote `apps/web/lib/supabase/middleware.ts` to refresh-only pattern — middleware does cookie refresh via `getUser()` and returns the response with refreshed cookies. No redirect logic in middleware. Moved auth gating into pages and layouts: created `apps/web/app/dashboard/layout.tsx` to gate dashboard routes by `getUser()` and active `firm_members`. Split client forms from server pages so `/login` and `/signup` redirect authenticated users at the page level. Matcher updated to skip static assets and `_next/*` paths.

Tag: `v0.1.2-middleware-fix`.

**Diagnosis:** Logging into the dashboard with a stale `sb-` auth cookie caused an infinite 307 redirect loop. Captured log showed `/dashboard → /login → /dashboard → /login` because middleware was using `hasAuthCookie` (cookie presence) as the auth signal instead of the verified `getUser()` result. The cookie existed but the session was invalid; middleware passed it through, the page redirected to `/login`, middleware saw the same cookie on `/login`, and redirected back.

**Learned:** Middleware-level auth redirects with cookie presence as the signal is a known failure mode. The Supabase official pattern is middleware refreshes session, pages call `getUser()` and gate. Cookie propagation on response objects is the subtle bit — `NextResponse.redirect()` creates a fresh response, so any cookies the SSR client wrote during `getUser()` get dropped unless explicitly forwarded. Removing middleware redirects entirely eliminates the bug class.

---

## 2026-05-10 — DataCamp validation signal

**Built:** Nothing. Logged an external curriculum signal that validates the RefreshDesk thesis.

**Logged:** DataCamp's "AI for Compliance" module teaches the exact workflow RefreshDesk productises: ingest documents, extract structured fields, output a reviewable spreadsheet, validate against originals. The framing — "appropriate per your organization's policies", "review the output against the originals" — describes the human-in-the-loop step already in the RefreshDesk design.

**Learned:** When an external curriculum teaches the workflow you're building, that's market validation, but also a competitive signal. The DataCamp version is the generic ChatGPT-upload version; the differentiation has to be the parts that generic AI use *can't* offer — UK data residency, citation grounding inline with extracted facts, prompt versioning, audit trail. The DataCamp paragraph essentially writes the "before RefreshDesk" half of the future landing page.

---

## 2026-05-10 — FIS + Anthropic announcement (external validation)

**Built:** Nothing. Logged the FIS/Anthropic Financial Crimes AI Agent announcement (May 4, 2026) as an external validation anchor.

**Logged:** Anthropic and FIS announced an agentic AML system for tier-1 banks: BMO and Amalgamated Bank as design partners, general availability H2 2026. Architecture is auditable, evidence-grounded, human-in-the-loop — the same architecture RefreshDesk is building for the SME segment FIS will not sell to.

**Learned:** External validation from major vendors is a credibility transfer that can be used in sales, RPL application materials, and content writing. The risk is that downmarket vendors (Onfido, SmartSearch, ComplyAdvantage) react by adding "agent" stories to their existing UK SME stacks. The defensive moat is not "agents" — that word will saturate by Christmas — it is "auditable" and "evidence-grounded", which are harder to claim convincingly and easier to defend against a regulator.

---

## 2026-05-10 — Slice 2 planning: Codex hallucination

**Built:** Nothing usable. Wrote the full Slice 2 prompt covering clients schema (single table with `client_type` and `details` JSONB), risk_rating (low/standard/high), firm-level refresh cadence rules with per-client overrides, CSV import wizard, four RPCs, RLS policies, audit event taxonomy, and ten verification checkpoints. Decision made to use a single `clients` table with JSONB rather than separate `individual_clients` and `entity_clients` tables — shared fields dominate, polymorphism tax avoided.

**Diagnosis:** Codex was sent the prompt with five explicit response requirements (confirm read, full SQL, file list, npm packages, stop). Codex responded twice with only npm package names, then on the third response described having "produced" the SQL/RPC proposal — but file system verification (`dir supabase\migrations`, `Get-ChildItem -Recurse -Filter "*clients*"`) confirmed no Slice 2 migration file existed anywhere on disk. The model hallucinated work completion.

**Learned:** Long-running AI coding sessions can degrade into summary-mode where the model describes work plausibly without producing it. Verifying disk state against claimed output is a cheap and necessary check at every "I've done X" claim. Pushing harder in a degraded session does not recover it — the fix is starting a fresh session or switching tools. This is a real applied AI engineering lesson, not just a productivity inconvenience: any system that delegates work to an LLM agent needs verification primitives independent of the LLM's own reporting.

Also a direct reinforcement of the auditability thesis behind RefreshDesk itself. An AI system that *says* it produced an answer is not the same as an AI system that *can prove* it produced an answer. The audit trail is the product.

---

## 2026-06-05 — Slice 2 application layer

**Built:** Full client management layer on top of the already-written Slice 2 DB migration. TypeScript types (`Client`, `FirmRefreshRule`, `ClientFilter`). Zod v4 CSV row schema (`validateCsvRow`) with 8 Vitest tests (TDD — tests written first). Four server actions: `addClientAction`, `editClientAction`, `archiveClientAction`, `importClientsAction` — all delegating to security-definer RPCs. Client list page at `/dashboard/clients` with overdue/due_soon/complete/all filter tabs. Shared `ClientForm` client component reused for add and edit. Add client page (`/dashboard/clients/new`). Edit client page (`/dashboard/clients/[id]/edit`). Client detail placeholder page with Documents and Audit timeline stubs for Slices 3 and 4. CSV import page: PapaParse browser-side parse → Zod row validation → preview table (valid/invalid) → JSON submit to server action. Dashboard updated with active clients count card linking to `/dashboard/clients`. 12 commits, 8/8 tests passing, 0 TypeScript errors. Migration push pending (`supabase db push` requires `SUPABASE_DB_PASSWORD`).

**Learned:** The filter logic for dates had a subtle timezone bug: `new Date()` (local) vs `parseISO()` (which treats date-only ISO strings as UTC midnight) creates off-by-one day mismatches at timezone boundaries. Fix: work with YYYY-MM-DD strings throughout and use lexicographic string comparison — it's correct, timezone-safe, and simpler than any Date-object approach. Code review caught this before it shipped. Subagent-driven development with two-stage review (spec compliance then code quality) per task catches bugs that the implementer's self-review misses. The timezone bug was caught by the code quality review, not the spec review, which is the correct split — spec compliance verifies what was built, code quality verifies whether it's correct.

---

## Tags

| Tag | Description |
|---|---|
| `v0.1-slice-1-foundation` | Multi-tenant auth, firms, members, audit_events with RLS and immutability triggers |
| `v0.1.1-onboarding-fix` | Atomic firm creation via security-definer RPC, error surfacing, audit trail wired |
| `v0.1.2-middleware-fix` | Refresh-only middleware, page-level auth gating, no redirect loops |
| 2026-05-10 | Slice 2 planning friction: confused myself about Codex state by alternating between "give me status" and "give me the artefact" without realising those were different requests. Mistook status summaries for failed artefact production. | Agentic coding tools answer the literal question asked, not the intent behind it. When delegating, distinguish status queries ("what is the state") from artefact queries ("show me the SQL") explicitly, and keep them in separate turns. Mixing them up looks like model failure when it's actually user-side ambiguity. |