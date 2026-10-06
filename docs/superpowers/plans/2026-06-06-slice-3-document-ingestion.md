# Slice 3 — Document Ingestion & AI Extraction

**Tag target:** `v0.3-slice-3-document-ingestion`  
**Stack:** Next.js 15 · TypeScript · Tailwind v4 · Supabase · Supabase Storage · Claude API (claude-sonnet-4-20250514)  
**Depends on:** Slice 2 complete (`v0.2-slice-2-client-management`)

---

## Goal

Allow firm users to upload CDD documents against a client, have Claude extract structured fields with confidence scores, and require a human reviewer to approve or reject the extraction before it is written to the audit trail. No AI output touches the audit trail without a human approval step.

---

## Schema

### New table: `client_documents`

```sql
create table client_documents (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  document_type text not null check (
    document_type in ('passport', 'proof_of_address', 'incorporation', 'source_of_funds')
  ),
  storage_path text not null,          -- Supabase Storage object path
  file_name text not null,
  file_size_bytes integer not null,
  mime_type text not null,
  status text not null default 'uploaded' check (
    status in ('uploaded', 'extracting', 'pending_review', 'approved', 'rejected')
  ),
  created_at timestamptz not null default now()
);

alter table client_documents enable row level security;
```

### New table: `document_extractions`

```sql
create table document_extractions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references client_documents(id) on delete cascade,
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  extracted_fields jsonb not null default '{}',
  confidence_score numeric(4,3) check (confidence_score between 0 and 1),
  model_used text not null,
  prompt_version text not null,
  raw_response text,                   -- full Claude response for audit
  status text not null default 'pending_review' check (
    status in ('pending_review', 'approved', 'rejected')
  ),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  reviewer_notes text,
  created_at timestamptz not null default now()
);

alter table document_extractions enable row level security;
```

### RLS policies (security-definer RPCs handle writes — no direct INSERT/UPDATE)

```sql
-- client_documents: firm members can read their firm's docs
create policy "firm members read documents"
  on client_documents for select
  using (firm_id = get_user_firm_id(auth.uid()));

-- document_extractions: firm members can read their firm's extractions
create policy "firm members read extractions"
  on document_extractions for select
  using (firm_id = get_user_firm_id(auth.uid()));
```

### Audit trigger

Add `client_documents` and `document_extractions` to the existing immutable audit trigger so every status change is logged to `audit_events`.

---

## RPCs (security-definer)

### `register_document(p_client_id, p_document_type, p_storage_path, p_file_name, p_file_size_bytes, p_mime_type)`

- Looks up `firm_id` from `clients` table
- Inserts row into `client_documents` with status `uploaded`
- Writes `audit_events` row: `document.uploaded`
- Returns `document_id`

### `save_extraction(p_document_id, p_extracted_fields, p_confidence_score, p_model_used, p_prompt_version, p_raw_response)`

- Verifies caller is a member of the document's firm
- Updates `client_documents.status` to `pending_review`
- Inserts row into `document_extractions` with status `pending_review`
- Writes `audit_events` row: `document.extraction_complete`
- Returns `extraction_id`

### `review_extraction(p_extraction_id, p_decision, p_reviewer_notes)`

- `p_decision`: `'approved'` or `'rejected'`
- Updates `document_extractions` status, sets `reviewed_by`, `reviewed_at`, `reviewer_notes`
- Updates parent `client_documents.status` to match decision
- Writes `audit_events` row: `document.approved` or `document.rejected`
- If approved: updates `clients.last_refreshed_at = now()` and recalculates `refresh_due_date` based on firm cadence

---

## Supabase Storage

- Bucket name: `kyc-documents`
- Private bucket (no public access)
- Path pattern: `{firm_id}/{client_id}/{document_id}/{file_name}`
- Max file size: 10MB
- Allowed MIME types: `image/jpeg`, `image/png`, `application/pdf`
- Access via signed URLs (1-hour expiry) generated server-side

---

## Claude API Integration

### Extraction flow

1. User uploads file → stored in Supabase Storage → `register_document` RPC called
2. Server action triggers extraction: fetches signed URL, downloads file, sends to Claude
3. Claude returns structured JSON → `save_extraction` RPC called
4. UI redirects to review screen

### Prompt (version: `v1.0`)

```
You are a KYC document extraction assistant for a regulated UK compliance tool.
Extract structured fields from the attached document and return ONLY valid JSON.

Document type: {document_type}

Return this exact structure:
{
  "document_type": "{document_type}",
  "fields": {
    // For passport: full_name, date_of_birth, nationality, passport_number, expiry_date, issuing_country
    // For proof_of_address: full_name, address_line_1, address_line_2, city, postcode, document_date, issuing_organisation
    // For incorporation: company_name, company_number, incorporation_date, registered_address, directors
    // For source_of_funds: description, amount_or_range, supporting_evidence
  },
  "confidence_score": 0.0 to 1.0,
  "confidence_notes": "brief explanation of any uncertainty",
  "extraction_warnings": ["list any issues, missing fields, or quality concerns"]
}

If a field cannot be read clearly, set it to null and note it in extraction_warnings.
Do not invent or guess field values. Accuracy is more important than completeness.
```

### Model

`claude-sonnet-4-20250514` — vision-capable, cost-appropriate for document extraction.

---

## UI Spec

### Client detail page — Documents section (replaces placeholder)

```
Documents
─────────────────────────────────────────────
[Upload document ▾]   (dropdown: Passport / Proof of address / Incorporation / Source of funds)

  [filename.pdf]  Passport  ● Pending review   [Review →]
  [id-scan.jpg]   Passport  ✓ Approved          06/06/2026
  [bill.pdf]      Proof of address  ✗ Rejected  05/06/2026
```

### Upload flow (`/dashboard/clients/[id]/documents/upload`)

- Document type selector (pre-filled from dropdown choice)
- File input (PDF, JPG, PNG, max 10MB)
- "Upload and extract" button
- Loading state: "Uploading… Extracting with AI…"
- On completion: redirect to review page

### Review page (`/dashboard/clients/[id]/documents/[docId]/review`)

```
Review extraction — Passport

Extracted fields                    Confidence: 87%
────────────────────────────────────────────────────
Full name          JOHN SMITH
Date of birth      01/01/1980
Nationality        British
Passport number    123456789
Expiry date        01/01/2030
Issuing country    GBR

Warnings
────────────────────────────────────────────────────
  ⚠ Expiry date partially obscured — verify manually

Reviewer notes  [_______________________________]

[Approve]   [Reject]
```

- Approve → calls `review_extraction` with `approved`, updates `last_refreshed_at`, back to client detail
- Reject → calls `review_extraction` with `rejected`, back to client detail, document marked rejected

---

## File structure (new files only)

```
apps/web/
  app/
    dashboard/
      clients/
        [id]/
          documents/
            upload/
              page.tsx          -- upload form
              actions.ts        -- upload to storage + trigger extraction
            [docId]/
              review/
                page.tsx        -- review screen
                actions.ts      -- approve/reject RPCs
  lib/
    claude/
      extract-document.ts       -- Claude API call, prompt construction
    supabase/
      storage.ts                -- signed URL helpers
  types/
    documents.ts                -- Document, Extraction types
supabase/
  migrations/
    YYYYMMDDHHMMSS_slice3_documents.sql
```

---

## Acceptance criteria (smoke test)

1. Navigate to a client detail page — Documents section shows "Upload document" dropdown
2. Select Passport, upload a JPG of any ID (can be a test image) — loading state shows
3. Redirect to review page — extracted fields render with confidence score
4. Warnings section shows if any fields are null or uncertain
5. Click Approve — back to client detail, document shows ✓ Approved with date
6. `last_refreshed_at` on the client is updated — detail page shows today's date not "Never"
7. `audit_events` table has: `document.uploaded`, `document.extraction_complete`, `document.approved`
8. Click Reject on a second document — shows ✗ Rejected, `last_refreshed_at` not updated
9. Signed URL for stored file expires — direct URL access denied after 1 hour

---

## What to tell Codex

> I am building Slice 3 of RefreshDesk, an auditable KYC refresh tool. Slice 1 (auth/firms) and Slice 2 (client management) are complete. The full plan is at `docs/superpowers/plans/2026-06-06-slice-3-document-ingestion.md`.
>
> Build Slice 3 in chunks:
> 1. Migration — `client_documents` and `document_extractions` tables, RLS, audit trigger extension, three RPCs
> 2. Storage helpers — Supabase Storage bucket setup, signed URL utility in `lib/supabase/storage.ts`
> 3. Claude extraction — `lib/claude/extract-document.ts` with prompt v1.0, structured JSON response handling
> 4. Upload UI — `/dashboard/clients/[id]/documents/upload/` page and server action
> 5. Review UI — `/dashboard/clients/[id]/documents/[docId]/review/` page and approve/reject actions
> 6. Client detail page — replace Documents placeholder with live document list
>
> Key constraints:
> - All writes go through security-definer RPCs (no direct INSERT/UPDATE from the app layer)
> - No AI extraction output touches the audit trail without the human review step (approve/reject)
> - Supabase Storage bucket is private — files accessed via signed URLs only
> - Prompt version must be stored on each extraction row (`prompt_version: 'v1.0'`)
> - Use `claude-sonnet-4-20250514` for extraction

---

## Notes

- `last_refreshed_at` column needs adding to `clients` table if not already present — check migration before running
- The review approval updating `refresh_due_date` is the first time a KYC action closes the loop end-to-end — this is the core product value
- pgvector embeddings on `document_extractions.extracted_fields` are deferred to Slice 4
- Email notifications (refresh due reminders) are deferred to Slice 5 (Campaigns)
