# Slice 9b — Filing History (CH Documents to Client Record)

**Tag target:** `v0.9b-slice-9b-filing-history`  
**Stack:** Next.js 15 · TypeScript · Tailwind v4 · Supabase · Supabase Storage · kyc-search  
**Depends on:** Slice 9 complete (`v0.9-slice-9-entity-cdd`)

---

## Goal

For entity clients with an approved CDD record, show the Companies House filing history. Users can bulk-select relevant filings and save them to the client record. Saved filings are downloaded via the CH document API (proxied through kyc-search), stored in Supabase Storage, and appear in the client's Documents section alongside uploaded docs.

---

## Architecture

```
Client detail page
  └── Filing History section (entity clients with approved CDD only)
        ├── Summary: last 5 relevant filings with "View all" link
        └── Full filing list page
              ├── Filterable by filing type
              ├── Bulk select checkboxes
              └── "Save selected to client record" button
                    └── Server action:
                          ├── For each selected filing:
                          │     ├── Fetch PDF via kyc-search /companies/{number}/filings/{id}/document
                          │     ├── Upload to Supabase Storage (kyc-documents bucket)
                          │     └── Call register_document RPC
                          └── Write audit_events: filing.saved
```

---

## kyc-search changes needed

The existing `/companies/{number}/filings` endpoint returns the filing list. We need to add a document download endpoint to kyc-search:

```
GET /companies/{number}/filings/{transaction_id}/document
```

This proxies the Companies House document API:
```
https://document-api.company-information.service.gov.uk/document/{transaction_id}/content
```

Returns the PDF as a binary stream. Add to kyc-search backend `routers/companies.py`.

---

## Relevant filing types to highlight

| Code | Label | Priority |
|---|---|---|
| CS01 | Confirmation statement | High |
| PSC01 | PSC notification | High |
| PSC07 | PSC cessation | High |
| AP01 | Director appointment | Medium |
| TM01 | Director termination | Medium |
| AP02 | Corporate director appointment | Medium |
| AA | Annual accounts | Low |
| NEWINC | Certificate of incorporation | High |

All other types shown but not highlighted.

---

## Schema changes

None required. Saved filings use the existing `client_documents` table with:
- `document_type`: `'incorporation'` for NEWINC, `'source_of_funds'` for AA, `'proof_of_address'` for address-related, otherwise a new check constraint value `'filing'`

Actually — add `'filing'` to the `document_type` check constraint:

```sql
-- Migration: 20260607040000_slice9b_filing_document_type.sql
alter table public.client_documents
  drop constraint client_documents_document_type_check;

alter table public.client_documents
  add constraint client_documents_document_type_check
  check (document_type in (
    'passport', 'proof_of_address', 'incorporation', 'source_of_funds', 'filing'
  ));
```

---

## UI spec

### Client detail page — Filing History section

Only shown for entity clients where an approved `entity_cdd_record` exists.

```
Filing History
──────────────────────────────────────────────────
CS01   Confirmation statement    07/03/2026
PSC01  PSC notification          15/08/2018
AP01   Director appointment      15/08/2018
NEWINC Certificate of incorp.    15/08/2018

[View all filings →]
```

Shows last 5 relevant filings (priority types first). Links to full filing list page.

### Full filing list page (`/dashboard/clients/[id]/filings`)

```
Filing History — Acme Ltd (11519884)

Filter: [All ▾]   [Save selected →]  (disabled until selection)

☐  CS01   Confirmation statement         07/03/2026   [View on CH →]
☑  PSC01  PSC notification               15/08/2018   [View on CH →]
☑  NEWINC Certificate of incorporation   15/08/2018   [View on CH →]
☐  AP01   Director appointment           15/08/2018   [View on CH →]

[Save selected to client record]  (2 selected)
```

- Checkboxes for bulk select
- "View on CH →" links to `https://find-and-update.company-information.service.gov.uk/company/{number}/filing-history/{transaction_id}`
- "Save selected" triggers server action
- After save: selected rows show ✓ Saved, disabled

### After save

Saved filings appear in the Documents section on the client detail page:

```
Documents
──────────────────────────────────────────────────
PSC01 - PSC notification.pdf    Filing    ✓ Approved   07/06/2026
NEWINC - Certificate.pdf        Filing    ✓ Approved   07/06/2026
pp.png                          Passport  ✓ Approved   06/06/2026
```

Saved filings are auto-approved (no AI extraction review needed — they're source documents, not extracted data).

---

## Server action: `saveFilings`

```typescript
// For each selected filing transaction_id:
// 1. Fetch PDF from kyc-search: GET /companies/{number}/filings/{id}/document
// 2. Convert to buffer
// 3. Upload to Supabase Storage: kyc-documents/{firm_id}/{client_id}/{doc_id}/{filename}
// 4. Call register_document RPC → returns document_id
// 5. Immediately call a new approve_document RPC (or update status directly via service role)
//    since filing PDFs don't need AI extraction review
// 6. Write audit_events: filing.saved per filing
```

### New RPC: `approve_filing_document(p_document_id uuid)`

Since filing PDFs are source documents (not AI-extracted), they can be auto-approved without going through the extraction review flow. This RPC:
- Validates firm membership
- Updates `client_documents.status` to `approved`
- Writes `audit_events`: `filing.saved`

---

## kyc-search backend changes

Add to `backend/app/routers/companies.py`:

```python
@router.get("/{company_number}/filings/{transaction_id}/document")
async def get_filing_document(
    company_number: str,
    transaction_id: str,
    current_user = Depends(get_current_user),
    ch_client = Depends(get_ch_client),
):
    """Proxy CH document API to download a filing PDF."""
    pdf_bytes = await ch_client.get_filing_document(transaction_id)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={transaction_id}.pdf"}
    )
```

Add `get_filing_document` to `backend/app/services/companies_house.py`:

```python
async def get_filing_document(self, transaction_id: str) -> bytes:
    url = f"https://document-api.company-information.service.gov.uk/document/{transaction_id}/content"
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            url,
            headers={"Authorization": f"Basic {self._encode_api_key()}"},
            follow_redirects=True
        )
        resp.raise_for_status()
        return resp.content
```

Note: CH document API uses HTTP Basic auth with the API key as username and empty password.

---

## File structure (new/changed files only)

```
apps/web/
  app/
    dashboard/
      clients/
        [id]/
          filings/
            page.tsx              -- full filing list with bulk select
            actions.ts            -- saveFilings server action
          page.tsx                -- add Filing History summary section
  lib/
    companies-house/
      fetch-filings.ts            -- calls kyc-search /companies/{number}/filings
supabase/
  migrations/
    20260607040000_slice9b_filing_document_type.sql

kyc-search backend (push to GitHub, redeploy on Railway):
  backend/app/routers/companies.py    -- add filing document endpoint
  backend/app/services/companies_house.py  -- add get_filing_document method
```

---

## Acceptance criteria (smoke test)

1. Migration runs clean — `filing` added to document_type check constraint
2. Entity client detail page with approved CDD shows Filing History section with last 5 relevant filings
3. Individual client detail page does NOT show Filing History section
4. Click "View all filings →" — full filing list page renders with all filings
5. "View on CH →" links open correct Companies House filing URL
6. Select 2 filings → "Save selected (2)" button becomes active
7. Click save → loading state → success → selected rows show ✓ Saved
8. Back on client detail page — saved filings appear in Documents section with status Approved
9. `audit_events` has `filing.saved` entries for each saved filing
10. Filings page filter by type works — selecting CS01 shows only confirmation statements

---

## What to tell Claude Code

> I am building Slice 9b of RefreshDesk. Slices 1–9 are complete. The full plan is at `docs/superpowers/plans/2026-06-07-slice-9b-filing-history.md`.
>
> This slice has two parts: kyc-search backend changes and RefreshDesk frontend/action changes.
>
> **Part 1 — kyc-search backend (push to GitHub separately):**
> Add a filing document download endpoint to the kyc-search backend. The kyc-search repo is at `C:\Users\travi\OneDrive\Pictures\TradeBot\Agentic Workflows\kyc-search`. Add:
> - `GET /companies/{number}/filings/{transaction_id}/document` endpoint in `backend/app/routers/companies.py`
> - `get_filing_document(transaction_id)` method in `backend/app/services/companies_house.py` that proxies `https://document-api.company-information.service.gov.uk/document/{transaction_id}/content` using HTTP Basic auth with CH_API_KEY as username and empty password
>
> **Part 2 — RefreshDesk:**
> 1. Migration — add `filing` to `client_documents.document_type` check constraint
> 2. New RPC `approve_filing_document(p_document_id uuid)` — validates membership, sets status to approved, writes `filing.saved` audit event
> 3. `lib/companies-house/fetch-filings.ts` — calls kyc-search `/companies/{number}/filings`, returns typed filing list
> 4. Filing History summary on client detail page — entity clients with approved CDD only, shows last 5 priority filings, "View all →" link
> 5. `/dashboard/clients/[id]/filings/page.tsx` — full filing list, filterable by type, bulk select checkboxes, "Save selected" button
> 6. `filings/actions.ts` — for each selected filing: fetch PDF from kyc-search document endpoint, upload to Supabase Storage, call register_document RPC, call approve_filing_document RPC
>
> Key constraints:
> - Filing History section only renders for entity clients with at least one approved entity_cdd_record
> - Saved filings are auto-approved (no extraction review needed — they are source documents)
> - Each saved filing writes a filing.saved audit event
> - "View on CH →" link format: `https://find-and-update.company-information.service.gov.uk/company/{number}/filing-history/{transaction_id}`
> - Priority filing types (CS01, PSC01, PSC07, AP01, TM01, NEWINC) shown first and highlighted in the list