# RefreshDesk — Product Roadmap

## Slices

| Slice | Name | Status |
|---|---|---|
| 1 | Foundation (auth, firms, RLS, audit triggers) | ✅ Done — v0.1.2 |
| 2 | Client management (add, edit, archive, CSV import) | ✅ Done — v0.2-slice-2-client-management |
| 3 | Document ingestion + Claude AI extraction + human review | ✅ Done — v0.3-slice-3-document-ingestion |
| 4 | Audit timeline UI (per-client, full payload detail) | ✅ Done — v0.4-slice-4-audit-timeline |
| 5 | Refresh campaigns (daily email reminders via Resend) | ✅ Done — v0.5-slice-5-campaigns |
| 6 | Multi-user firms (join codes, roles, team management) | 🔄 In progress |
| 7 | Deploy to Railway (live URL, cron job, custom domain) | ⏳ Planned |
| 8 | Billing (Stripe checkout, subscription gating, per-firm plans) | ⏳ Planned |
| 9 | Automated entity CDD (Companies House API, PSC/UBO chain, org chart) | ⏳ Planned |
| 10 | pgvector semantic search (embed extracted fields, natural language queries) | ⏳ Planned |
| 11 | Polish + public launch (landing page, onboarding, empty states, error handling) | ⏳ Planned |

---

## Slice 9 detail — Automated Entity CDD

The highest-value feature in the roadmap. For entity clients, the user uploads a certificate of incorporation. Claude extracts the company number. The system then automatically calls:

- **Companies House API** — registered address, SIC codes, incorporation date, filing history
- **Officers endpoint** — directors, secretaries, persons with significant control (PSCs)
- **PSC ownership chain** — follows chain to UBO (ultimate beneficial owner)

User reviews and approves the populated data — same human-in-the-loop pattern as Slice 3.

**Existing assets to reuse:**
- `kyc-search` — Companies House lookup API already deployed on Railway
- `org-chart-builder` — React Flow UBO dilution calculator already built

This slice is mostly integration work, not greenfield.

---

| 9b | Filing history (save CH PDFs to client record via document API) | ⏳ Planned |

## Slice 10 detail — pgvector Semantic Search

Embed extracted document fields and client details using Claude embeddings. Store in `pgvector` column on `document_extractions`. Enable natural language queries across the client base:

- "Show me all high-risk clients with passports expiring in the next 6 months"
- "Find all entity clients with South African directors"
- "Which clients haven't been refreshed in over 2 years"

Core AI engineering learning objective — the RAG implementation that anchors the QUB AI PGCert RPL application.

---

## Tech stack

- **Frontend:** Next.js 15, TypeScript, Tailwind CSS v4
- **Backend:** Supabase (Postgres + RLS + pgvector), security-definer RPCs
- **AI:** Claude API (claude-sonnet-4-20250514), vision extraction, embeddings
- **Email:** Resend
- **Infrastructure:** Railway (app + cron job)
- **Payments:** Stripe (Slice 8)

## Target market

UK accountants, TCSPs, and small wealth managers subject to MLR 2017. Firms with 1–20 staff doing manual KYC refresh workflows.

## Pricing model (planned)

Per-firm subscription. Tiered by client count or seat count. Free trial on signup.