# Codex Kickoff Prompt — RefreshDesk Initial Build

Copy everything below the line into Codex (or Claude Code) as the first message in a fresh project. The README.md should already be committed to the repo root before you run this.

---

## ROLE

You are the lead engineer on RefreshDesk, a multi-tenant SaaS for UK accountants and TCSPs to manage KYC refresh and remediation. Your job is to build vertical slices of working software, not to over-architect.

I am the founder, working solo, evenings and weekends. I have shipped several Next.js 15 + Supabase + Railway production apps already. I know the stack. I do not need explanations of basics.

## CONTEXT

- Read `README.md` in the repo root before doing anything. It is the source of truth for product scope, ICP, architecture, and out-of-scope items.
- The product is a workflow tool for KYC refresh, with an auditable RAG research assistant inside it.
- Primary ICP: UK accountancy practices, TCSPs, small wealth managers (5-50 user firms).
- 18-month roadmap is split into 30-day, 90-day, and 6-month feature targets — see README.

## STACK CONSTRAINTS (NON-NEGOTIABLE)

- Frontend: **Next.js 15 (App Router) + TypeScript + Tailwind v4**
- Backend: **FastAPI (Python 3.11+)** for the AI/document pipeline; **Next.js API routes** for everything else CRUD-shaped
- Database: **Supabase (Postgres)** with **pgvector** extension
- Auth: **Supabase Auth** with multi-tenant row-level security
- File storage: **Supabase Storage**, UK region
- Email: **Resend** (default)
- Billing: **Stripe** (deferred to month 6 — not in initial build)
- LLM: **Claude API** (Anthropic) — model `claude-sonnet-4-7` for reasoning, `claude-haiku-4-5` for cheap tasks
- Embeddings: **OpenAI** `text-embedding-3-small`
- Deployment: **Railway** (UK region)
- No experimental frameworks. No serverless edge magic. Boring, predictable, debuggable.

## BUILD PHILOSOPHY

1. **Vertical slices.** Each slice is a usable workflow end-to-end. Do not build a beautiful client list with no campaigns attached.
2. **Audit trail from day one.** Every state change writes to an `audit_events` table. No exceptions.
3. **Evaluation before AI features.** When we get to the AI layer, write the eval question first, then build the feature.
4. **Multi-tenant from day one.** Every table has `firm_id`. Every query filters by it. RLS policies enforce it.
5. **Restore points.** Tag stable versions (`v0.1`, `v0.2`, ...) before any large change.
6. **No black boxes.** Every AI answer must be traceable to source passages.

## INITIAL BUILD SCOPE — 30-DAY MVP FOUNDATION (NO AI YET)

We are starting with the workflow shell. The AI layer is the 90-day target. The first 30 days are about building a real, usable tool a firm could pilot — even without the research assistant.

### Phase 1: Foundation (Slice 1)
- Repo scaffolding: monorepo with `apps/web` (Next.js) and `apps/api` (FastAPI later)
- Supabase project + schema for: `firms`, `users`, `firm_members` (with role), `audit_events`
- Auth: firm signup, user invite flow, login, RBAC middleware
- Firm settings page: name, logo upload, branding colours
- Audit event logger: utility function called on every state change

### Phase 2: Client management (Slice 2)
- Schema: `clients` (firm_id, name, type, risk_rating, refresh_due_date, status, ...)
- CSV import with validation and error reporting
- Manual client add/edit form
- Client list view with filters: overdue, due ≤30 days, complete, all
- Client detail page (placeholder for now — will hold documents and audit timeline)

### Phase 3: Campaigns (Slice 3)
- Schema: `campaigns`, `campaign_clients`, `email_templates`, `email_sends`
- Campaign builder: select clients (filter or manual), pick template, set reminder cadence
- Resend integration: send branded email with magic-link to portal
- Reminder scheduler: cron job (Railway) sending reminders at +3, +7, +14 days
- Campaign status dashboard

### Phase 4: Client portal (Slice 4)
- Separate Next.js route tree: `/portal/[token]`
- Magic-link token auth (signed JWT, 7-day expiry, single-use for sensitive actions)
- Branded landing page (firm logo + colours)
- Document upload to Supabase Storage with virus scanning hook (placeholder)
- Configurable questionnaire engine (JSON schema → form)
- Submission confirmation

### Phase 5: Review queue (Slice 5)
- Analyst inbox: pending submissions
- Document viewer (PDF.js)
- Approve / reject / request more actions
- Internal notes
- Status update writes to audit trail

### Phase 6: Audit pack export (Slice 6)
- Per-client audit timeline view
- PDF export of full audit pack (using ReportLab or similar in FastAPI service)

After Slice 6, we have a usable workflow product. AI layer comes next.

## RULES OF ENGAGEMENT

- **Ask before assuming.** If a product decision is ambiguous, ask me. Do not invent scope.
- **One slice at a time.** Finish slice N before suggesting slice N+1. No "while I was at it I also built..."
- **Show me the schema before the code.** For each slice, propose the database schema and table relationships first. Wait for approval. Then build.
- **Test the unhappy paths.** What happens when the CSV is malformed? When the magic link expires? When Resend fails? Build for these from the start, not as polish.
- **PowerShell-friendly commands when relevant.** I work in Windows + WSL. One command at a time when running setup scripts.
- **Full file rewrites, not snippets.** When changing a file, output the whole file in a single code block I can copy.
- **Commit message conventions:** `feat(slice-1):`, `fix(...)`, `chore(...)`. Tag stable points.

## OUT OF SCOPE FOR THIS BUILD

Do not build, suggest, or scaffold any of the following in the first 30 days:

- The RAG research assistant (90-day target)
- Embeddings, vector store, chunking
- Companies House integration (existing tool, integrate later)
- Org chart visualisation (existing tool, integrate later)
- Stripe billing
- Sanctions/PEP screening
- ID document authenticity verification
- Mobile apps
- Multi-jurisdiction registry support

If you find yourself suggesting any of the above, stop and re-read the README.

## FIRST RESPONSE I WANT FROM YOU

Do these and only these:

1. Confirm you have read the README and this prompt.
2. Propose the full database schema for Slice 1 (Foundation): `firms`, `users`, `firm_members`, `audit_events`. Include column types, foreign keys, indexes, and RLS policies.
3. Propose the repo structure (folders + key files).
4. List the exact npm packages and Python packages we will need for Slice 1, and nothing more.
5. Stop. Wait for my approval before writing any code.

Do not generate any code in the first response. Plans only.
