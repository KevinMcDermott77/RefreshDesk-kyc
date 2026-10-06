# RefreshDesk — Built State (audited from code, 2026-10-05, commit 8910004)

## 1. Entity CDD flow
- **Entry:** `/dashboard/clients/[id]/entity-cdd` → `fetchEntityCddAction` (`app/dashboard/clients/[id]/entity-cdd/actions.ts`). Entity clients only; `read_only` role blocked (app layer only).
- **Input:** a company number, or a PDF/JPEG/PNG (≤10 MB). An upload goes to Storage, is registered as a `client_documents` row (`document_type='incorporation'`), and is sent to Claude (`claude-sonnet-4-20250514`, prompt `v1.0-entity`) to extract the number. The number is then checked against `^([0-9]{8}|[A-Z]{2}[0-9]{6})$`.
- **kyc-search calls** (`lib/companies-house/kyc-search-client.ts`): `POST /auth/login` (admin email/password → `access_token`; a new login for every operation, nothing cached), then these run in parallel: `GET /companies/{n}`, `/companies/{n}/officers`, `/companies/{n}/pscs`. Filings use `GET /companies/{n}/filings` and `/companies/{n}/filings/{txId}/document` (PDF).
- **Stored:** RPC `save_entity_cdd` writes one `entity_cdd_records` row (`pending_review`) holding the raw profile, officers and PSCs, plus the computed chain and UBOs.
- **Review gate:** `/entity-cdd/[recordId]/review` shows the profile, active officers, the PSC table, a ReactFlow org chart and Approve/Reject buttons. RPC `review_entity_cdd` locks the row and rejects records that are already reviewed. On approve it merges `company_number`, `registered_name`, `registered_address` and `incorporation_date` into `clients.details`, sets `last_refreshed_at`, recomputes `refresh_due_date` from `firm_refresh_rules`, and then embeds the client and the CDD record (Voyage).
- **Audit events:** `entity_cdd.fetched` (payload includes the extraction model and prompt version), `entity_cdd.approved` / `entity_cdd.rejected` (with notes), `client.refreshed`, `document.uploaded`, `filing.saved`. The timeline UI has no labels for `entity_cdd.*` or `filing.saved`, so it shows the raw event type.

## 2. Ownership walker (`lib/ownership/walk.ts`)
- **Recursion:** a breadth-first walk up the PSC register, starting from `walk(companyNumber, fetcher, {maxDepth = 6, threshold = 25})`. The fetcher is injected.
- **Visited set:** keyed on `GB:<number>` or `LEI:<lei>`. Ceased PSCs are ignored.
- **Bands, not percentages:** natures are parsed into `[lo, hi]` bands and multiplied down the chain into `effectiveRange`.
- **Terminal outcomes:**
  - An individual PSC is `RESOLVED_INDIVIDUAL`. It also gets `BAND_STRADDLES_THRESHOLD` if its effective range straddles the threshold.
  - A UK regulated-market exemption is `RESOLVED_LISTED`.
  - A UK corporate PSC is walked. A non-UK corporate PSC, or one with no registration number, is `FOREIGN_ENTITY_UNMATCHED`. Names are never matched.
  - An active statement with no PSCs is `PSC_STATEMENT`, with the statement code kept verbatim.
  - Other outcomes are `PSC_NONE_FILED`, `PSC_SUPER_SECURE`, `CIRCULAR_OWNERSHIP` (ancestor revisit), `DEPTH_LIMIT_REACHED` and `SOURCE_UNAVAILABLE`.
  - A non-individual branch that sits wholly below the threshold is `PRUNED` and not fetched.
- **Overall status:** `resolved` if no material UNRESOLVED leaf remains, otherwise `partial` or `unresolved`.
- **Production wiring:** the walker uses kyc-search, which exposes no statements, exemptions or GLEIF data. In production, a company with no PSCs therefore ends as `SOURCE_UNAVAILABLE`, and listed companies are not detected.
- **Stored shape:** `toEntityCddOwnership` maps the walk onto the existing `ownership_chain` (direct owners, `ownership_percentage` always null), `ubo_list`, `psc_data_quality` and `psc_warning` fields.

## 3. Data model (relevant)
- `clients`: `id, firm_id, client_type(individual|entity), display_name, risk_rating(low|standard|high), refresh_due_date, last_refreshed_at, status, details jsonb, external_ref`.
- `entity_cdd_records`: `id, firm_id, client_id, company_number, source_document_id→client_documents, company_profile/officers/pscs jsonb (raw), ownership_chain/ubo_list jsonb (OwnershipNode[]), psc_data_quality(full|partial|none), psc_warning, status(pending_review|approved|rejected), reviewed_by, reviewed_at, reviewer_notes, fetched_at, created_at`. RLS allows SELECT for active firm members. All writes go through SECURITY DEFINER RPCs.
- **Ownership nodes:** there is no table. They are JSON `{name, kind, ownership_percentage, nature_of_control[], is_ubo, company_number?, address?}` stored inside the record. The extraction model and prompt version are kept only in `audit_events.payload`.
- `extraction_embeddings.entity_cdd_id` (unique, vector(512)); `audit_events(firm_id, actor_user_id, event_type, entity_type, entity_id, payload)`.

## 4. UK / Companies House hardcoding
- The company-number regex appears in both the action and the Claude prompt ("UK company numbers are 8 characters…"). The form uses `maxLength=8`, and `fetchEntityCdd` upper-cases the number.
- CH field names: `natures_of_control` band strings, PSC `kind` strings, `name_elements`, `identification.registration_number`, `registered_office_address`, `date_of_creation`, `company_status`, `officer_role`, `resigned_on`, `notified_on`, `transaction_id`.
- Fixed values: `en-GB` date formatting, "Companies House" UI copy, `firms.country_code` default `'GB'` (unused by the CDD flow).

## 5. External dependencies, rate limits, costs
- **kyc-search** (separate service; `KYC_SEARCH_URL`, `KYC_SEARCH_ADMIN_EMAIL/PASSWORD`, of which only the URL is in `.env.example`). Calls have no timeout, retry, pagination or rate limiting.
- **Call counts:**
  - A fetch makes 4 calls.
  - **Every view of a client detail page with an approved CDD** makes 2 calls (login + filings).
  - Saving N filings makes 2 + 2N calls.
- **Rate limits and cost:** CH rate limits and kyc-search hosting cost are UNVERIFIED (not in this repo).
- **Anthropic Claude Sonnet 4:** one call per upload-based fetch, `max_tokens` 1024. Cost is not tracked.
- **Voyage `voyage-3-lite`:** one or two embeds per approval, skipped when the content hash is unchanged. `VOYAGE_API_KEY` is not in `.env.example`.
- Supabase (Postgres, Storage, pgvector).

## 6. Tests, bugs, TODOs
- **Tests:** only `lib/schemas/__tests__/client-csv.test.ts` (8 tests, passing). There are **no tests** for CDD, the ownership chain, kyc-search or the RPCs.
- **TODO/FIXME comments:** none found.
- **Bugs / gaps found in code:**
  1. The `read_only` role is not checked in the review page, `reviewEntityCddAction` or any RPC. Every RPC checks only active membership, so a read-only user can approve.
  2. There is no four-eyes check: the person who fetched a record can approve it.
  3. `fetchEntityCddAction` looks up membership without filtering on `firm_id`, so `.single()` fails for a user in more than one firm. It also builds the storage path from that membership's firm.
  4. Embedding runs after the approval has committed and is not wrapped in try/catch. A Voyage failure therefore shows an error even though the approval was saved.
  5. The uploaded source document stays in `status='uploaded'` and is never approved or extracted (UNVERIFIED how the UI treats it).
  6. Production ownership walks cannot see PSC statements, exemptions or GLEIF data, because kyc-search does not expose them (see §2).
  7. Only the first page of officers and PSCs is used, if kyc-search paginates (UNVERIFIED).
