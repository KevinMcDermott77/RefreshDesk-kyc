# Slice 9 — Automated Entity CDD (Companies House)

**Tag target:** `v0.9-slice-9-entity-cdd`  
**Stack:** Next.js 15 · TypeScript · Tailwind v4 · Supabase · Claude API · kyc-search (Railway) · React Flow  
**Depends on:** Slice 8 complete (`v0.8-slice-8-billing`)

---

## Goal

For entity clients, allow users to upload a certificate of incorporation or other company document. Claude extracts the company number. RefreshDesk automatically calls the kyc-search API to fetch Companies House data — registered details, officers, and PSC register. The user reviews and approves the populated CDD record. The approved data updates the client record and is written to the audit trail.

---

## Scope and known limitations

**In scope (Slice 9):**
- Claude extraction of company number from uploaded document
- Companies House API: company profile, officers, PSC register
- Flat list display of directors and PSCs with ownership percentages
- React Flow org chart (expandable view) with UBO chain and diluted ownership
- Human review + approve/reject gate (same pattern as Slice 3)
- Audit trail for all steps

**Known limitation:**
PSC data from the `/pscs` endpoint covers post-2016 filings reliably. For older companies or complex structures, ownership data may be in confirmation statements (CS01), annual returns (AR01), or accounts. When PSC data is thin or absent, the review screen will flag this and link to the Companies House filing history for manual review.

**Future (Slice 9b):**
Parse CS01/AR01 PDF filings via Claude for older or complex ownership structures.

---

## Architecture

```
User uploads incorporation doc
  └── Claude extracts company number
        └── kyc-search API called:
              ├── GET /company/{number}           -- profile
              ├── GET /company/{number}/officers  -- directors/secretaries
              └── GET /company/{number}/pscs      -- persons with significant control
                    └── Build ownership chain to UBO
                          └── Review screen (human approval gate)
                                └── Approve → update client record + audit trail
```

---

## kyc-search API endpoints used

Your existing kyc-search service on Railway exposes:

```
GET /company/{company_number}
GET /company/{company_number}/officers
GET /company/{company_number}/pscs
```

Base URL stored as `KYC_SEARCH_URL` env var. No auth required (internal service).

---

## Schema changes

### Migration: `20260607030000_slice9_entity_cdd.sql`

```sql
-- Store fetched Companies House data per entity client
create table public.entity_cdd_records (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  company_number text not null,
  source_document_id uuid references public.client_documents(id),

  -- Raw Companies House data
  company_profile jsonb not null default '{}',
  officers jsonb not null default '[]',
  pscs jsonb not null default '[]',

  -- Computed ownership chain
  ownership_chain jsonb not null default '[]',
  ubo_list jsonb not null default '[]',

  -- PSC data quality flag
  psc_data_quality text not null default 'full'
    check (psc_data_quality in ('full', 'partial', 'none')),
  psc_warning text,    -- shown on review screen if partial/none

  -- Review state (same pattern as document_extractions)
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  reviewer_notes text,

  -- Provenance
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.entity_cdd_records enable row level security;

create policy "firm members can read entity cdd records"
  on public.entity_cdd_records for select
  to authenticated
  using (
    firm_id in (
      select firm_id from public.firm_members
      where user_id = auth.uid() and status = 'active'
    )
  );

create index entity_cdd_records_client_id_idx
  on public.entity_cdd_records (client_id, created_at desc);
```

---

## RPCs

### `save_entity_cdd(p_client_id, p_company_number, p_source_document_id, p_company_profile, p_officers, p_pscs, p_ownership_chain, p_ubo_list, p_psc_data_quality, p_psc_warning)`

- Validates firm membership
- Inserts `entity_cdd_records` row with status `pending_review`
- Writes `audit_events`: `entity_cdd.fetched`
- Returns `record_id`

### `review_entity_cdd(p_record_id, p_decision, p_reviewer_notes)`

- Validates firm membership
- Updates status to approved/rejected
- If approved:
  - Updates `clients.details` JSONB with key CDD fields (company number, registered address, incorporation date)
  - Updates `clients.last_refreshed_at = now()`
  - Recalculates `clients.refresh_due_date`
  - Writes `audit_events`: `entity_cdd.approved` or `entity_cdd.rejected`
  - Writes `audit_events`: `client.refreshed`

---

## Claude extraction prompt for company number

**Prompt version:** `v1.0-entity`

```
You are a KYC document extraction assistant for a regulated UK compliance tool.
Extract the company registration number from the attached document.

The document may be a certificate of incorporation, confirmation statement, 
annual return, annual report, or other Companies House filing.

Return ONLY valid JSON:
{
  "company_number": "string or null",
  "confidence_score": 0.0 to 1.0,
  "document_type_detected": "certificate_of_incorporation | confirmation_statement | annual_return | annual_report | other",
  "extraction_warnings": ["list any issues"]
}

UK company numbers are 8 characters: either 8 digits (e.g. 12345678) 
or 2 letters followed by 6 digits (e.g. SC123456, NI123456).
Do not invent a company number. If not found, return null.
```

---

## Ownership chain computation

After fetching PSCs, compute the ownership chain server-side in TypeScript:

```typescript
// For each PSC:
// - If nature_of_control includes 'ownership-of-shares-...' extract percentage
// - If PSC is a corporate entity (kind = 'corporate-entity-person-with-significant-control')
//   flag for recursive lookup (future Slice 9b)
// - If PSC is an individual, mark as UBO candidate

type OwnershipNode = {
  name: string
  kind: 'individual' | 'corporate' | 'legal_person'
  ownership_percentage: number | null
  nature_of_control: string[]
  is_ubo: boolean
  company_number?: string  // if corporate PSC
  address?: string
}
```

PSC data quality assessment:
- `full` — PSCs found, at least one individual UBO identified
- `partial` — PSCs found but all are corporate (chain not resolved to individual)
- `none` — no PSCs on register; show warning + link to filing history

---

## UI spec

### Client detail page — Entity CDD section

Only shown for `client_type = 'entity'`. Add below Documents section:

```
Entity CDD
──────────────────────────────────────────────────
[Fetch from Companies House]

  or if record exists:

  12345678 — ACME LIMITED
  ✓ Approved  06/06/2026   [View details]
  
  ⚠ PSC data incomplete — review filing history
```

### Fetch flow

1. User clicks "Fetch from Companies House"
2. Modal/inline: "Enter company number or upload an incorporation document"
   - Option A: text input for company number (manual)
   - Option B: file upload → Claude extracts company number
3. On submit: loading state "Fetching from Companies House…"
4. Redirect to review screen

### Review screen (`/dashboard/clients/[id]/entity-cdd/[recordId]/review`)

```
Entity CDD Review
ACME LIMITED  ·  12345678

Company details
──────────────────────────────────────────────────
Registered name     ACME LIMITED
Company number      12345678
Status              Active
Incorporation date  01 Jan 2010
Registered address  123 High Street, London, EC1A 1BB
SIC codes           69201 — Accounting activities

Directors (2)
──────────────────────────────────────────────────
John Smith          Director    Appointed 01 Jan 2010
Jane Jones          Secretary   Appointed 15 Mar 2015

Persons with Significant Control (1)
──────────────────────────────────────────────────
John Smith          75%+ ownership    Individual  ← UBO

[View ownership structure ▾]   ← expands React Flow chart

⚠ PSC warning (if applicable)
──────────────────────────────────────────────────
PSC register shows corporate PSC only. Full ownership chain 
not resolved. Review confirmation statements:
[View filing history on Companies House →]

Reviewer notes  [_________________________________]

[Approve]   [Reject]
```

### React Flow org chart (expandable)

Reuse logic from `org-chart-builder`. Nodes: client entity at top, PSCs below, UBOs at bottom. Edge labels show ownership percentage. Corporate PSC nodes shown in amber with "chain unresolved" if not traced to individual.

---

## File structure (new/changed files only)

```
apps/web/
  app/
    dashboard/
      clients/
        [id]/
          entity-cdd/
            page.tsx                    -- fetch trigger UI (entity clients only)
            actions.ts                  -- fetch + Claude extract + save_entity_cdd RPC
            [recordId]/
              review/
                page.tsx                -- review screen
                actions.ts              -- review_entity_cdd RPC
                ownership-chart.tsx     -- React Flow org chart component
  lib/
    companies-house/
      fetch-entity-cdd.ts             -- calls kyc-search API, assembles data
      compute-ownership-chain.ts      -- PSC → ownership chain → UBO list
    claude/
      extract-company-number.ts       -- Claude extraction prompt v1.0-entity
supabase/
  migrations/
    20260607030000_slice9_entity_cdd.sql
```

---

## Environment variables

```
KYC_SEARCH_URL=https://your-kyc-search.railway.app
```

---

## Acceptance criteria (smoke test)

1. Migration runs clean — `entity_cdd_records` table exists
2. Entity client detail page shows "Entity CDD" section; individual clients do not
3. Manual path: enter company number → loading → review screen shows company details, directors, PSCs
4. Upload path: upload a certificate of incorporation → Claude extracts company number → review screen
5. PSC data quality: full ownership to individual → shows UBO, no warning
6. PSC data quality: corporate PSC only → shows warning + filing history link
7. Click "View ownership structure" → React Flow chart renders with ownership percentages
8. Approve → client `last_refreshed_at` updated, `refresh_due_date` recalculated
9. `audit_events` has `entity_cdd.fetched`, `entity_cdd.approved`, `client.refreshed`
10. Reject → status shows rejected, `last_refreshed_at` not updated

---

## What to tell Claude Code

> I am building Slice 9 of RefreshDesk. Slices 1–8 are complete. The full plan is at `docs/superpowers/plans/2026-06-07-slice-9-entity-cdd.md`.
>
> Build Slice 9 in this order:
> 1. Migration — `entity_cdd_records` table, RLS, `save_entity_cdd` RPC, `review_entity_cdd` RPC
> 2. `lib/companies-house/fetch-entity-cdd.ts` — calls kyc-search API for company profile, officers, PSCs; assembles into structured object
> 3. `lib/companies-house/compute-ownership-chain.ts` — processes PSC array into ownership nodes, identifies UBOs, sets psc_data_quality flag
> 4. `lib/claude/extract-company-number.ts` — Claude extraction prompt v1.0-entity for company number from uploaded document
> 5. Entity CDD section on client detail page — only shown for entity clients; "Fetch from Companies House" trigger with manual input + optional file upload
> 6. `entity-cdd/actions.ts` — server action: if file uploaded call Claude extraction, then call fetch-entity-cdd, call compute-ownership-chain, call save_entity_cdd RPC, redirect to review
> 7. Review screen — company details, directors table, PSC table with UBO flag, PSC warning if partial/none, React Flow org chart (expandable), approve/reject actions
> 8. `entity-cdd/[recordId]/review/actions.ts` — review_entity_cdd RPC call
>
> Key constraints:
> - Entity CDD section only renders for clients where client_type = 'entity'
> - All writes via security-definer RPCs
> - Human review gate — no CDD data updates client record without approval
> - KYC_SEARCH_URL from env var — do not hardcode
> - PSC data quality must be assessed and warning shown if partial or none
> - React Flow chart uses the same node/edge pattern as org-chart-builder
> - Prompt version stored as 'v1.0-entity' on any extraction row created

---

## Notes

- `kyc-search` is already deployed — confirm the Railway URL before Claude Code starts
- reactflow package may need installing: `npm install reactflow -w apps/web`
- The review screen is the most complex UI in the project — allow Claude Code extra turns if needed
- PSC corporate chain resolution (following corporate PSCs recursively) is deferred to Slice 9b