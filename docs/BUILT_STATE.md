# RefreshDesk — Built State (audited from code, 2026-10-05, commit 8910004; §1, §3, §6 and §7 updated 2026-10-14 for Slice 0b, the upload fix and Slice 6)

## 1. Entity CDD flow
- **Entry:** `/dashboard/clients/[id]/entity-cdd` → `fetchEntityCddAction` (`app/dashboard/clients/[id]/entity-cdd/actions.ts`). Entity clients only. Roles: `read_only` cannot fetch; the app checks the role for the client's own firm (`getMembership`), and `save_entity_cdd` enforces it in the database (`require_role`, Slice 0b).
- **Input:** the browser posts only the client id and a company number, or the storage path of a PDF/JPEG/PNG (≤10 MB) that it has already uploaded straight to Storage under the user's own session (a Server Action body over 1 MB is refused, so files never go through the action; `parseFetchInput` rejects file bodies and fetched-data fields). The action checks the path is in this client's folder and that the bytes match the claimed type, registers a `client_documents` row (`document_type='incorporation'`), and sends it to Claude (`claude-sonnet-4-20250514`, prompt `v1.0-entity`) to extract the number. The number is then checked against `^([0-9]{8}|[A-Z]{2}[0-9]{6})$`.
- **kyc-search calls** (`lib/companies-house/kyc-search-client.ts`): `POST /auth/login` (admin email/password → `access_token`; a new login for every operation, nothing cached), then these run in parallel: `GET /companies/{n}`, `/companies/{n}/officers?fresh=true`, `/companies/{n}/pscs?fresh=true` (via `kycSearchGet`, which also reads `X-Fetched-At`). Filings use `GET /companies/{n}/filings` and `/companies/{n}/filings/{txId}/document` (PDF).
- **Stored:** RPC `save_entity_cdd` writes one `entity_cdd_records` row (`pending_review`) holding the raw profile, officers and PSCs, plus the computed chain and UBOs. It sets `fetched_by` from `auth.uid()` (Slice 0b).
- **Review gate:** `/entity-cdd/[recordId]/review` shows the profile, active officers, the PSC table, a ReactFlow org chart and Approve/Reject buttons. RPC `review_entity_cdd` locks the row, rejects records that are already reviewed, needs the `admin` role (admin is the reviewer; there is no reviewer role), and with `firms.four_eyes` on (the default) refuses an approval by the person who fetched the record (a null `fetched_by`, on old rows, is allowed and logged with a note; the fetcher may still reject). The review page disables the buttons with the reason shown. On approve it merges `company_number`, `registered_name`, `registered_address` and `incorporation_date` into `clients.details`, sets `last_refreshed_at`, recomputes `refresh_due_date` from `firm_refresh_rules`, and then embeds the client and the CDD record (Voyage). An embedding failure no longer surfaces as an error: it is logged and recorded as an `embedding.failed` audit event.
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
- **Production wiring (`lib/ownership/kyc-search-fetcher.ts`):** the walker reads live data from kyc-search.
  - The root's profile and PSCs come from `fetchEntityCdd`, which calls `/officers?fresh=true` and `/pscs?fresh=true`, so the root is not fetched twice.
  - Each company above the root uses `GET /companies/{n}` and `/companies/{n}/pscs?fresh=true`. kyc-search paginates officers and PSCs fully.
  - Every company, root included, also calls `GET /companies/{n}/exemptions`, which is always live. An open `psc-exempt-as-trading-on-uk-regulated-market` exemption ends the company as `RESOLVED_LISTED` before its PSCs are read; J Sainsbury plc (00185647) resolves this way.
  - A company with no active PSCs calls `GET /companies/{n}/pscs/statements` (always live). An active statement gives `PSC_STATEMENT`.
  - kyc-search maps a CH 404 to 404, and the walker reads a 404 on PSCs, statements or exemptions as "none on file". So a company with nothing on file ends `PSC_NONE_FILED`, not `SOURCE_UNAVAILABLE`.
  - kyc-search maps a CH 429 to 503 with `Retry-After`. A 503 or other 5xx (or a network error) on the profile, the PSCs, or, for a company with no PSCs, the statements or exemptions, ends the company as `SOURCE_UNAVAILABLE`. The node keeps `Retry-After` verbatim as `retryAfter`.
  - There is still no GLEIF in production: `getGleifParents` returns null.
- **Freshness:** each company node records `fetchedAt`, the oldest `X-Fetched-At` among the kyc-search responses read for it. It is not yet carried into the stored `ownership_chain`.
- **Stored shape:** `toEntityCddOwnership` maps the walk onto the existing `ownership_chain` (direct owners, `ownership_percentage` always null), `ubo_list`, `psc_data_quality` and `psc_warning` fields.

## 3. Data model (relevant)
- `clients`: `id, firm_id, client_type(individual|entity), display_name, risk_rating(low|standard|high), refresh_due_date, last_refreshed_at, status, details jsonb, external_ref`.
- `entity_cdd_records`: `id, firm_id, client_id, company_number, source_document_id→client_documents, company_profile/officers/pscs jsonb (raw), ownership_chain/ubo_list jsonb (OwnershipNode[]), psc_data_quality(full|partial|none), psc_warning, status(pending_review|approved|rejected), reviewed_by, reviewed_at, reviewer_notes, fetched_at, fetched_by (Slice 0b; null on older rows), created_at`. RLS allows SELECT for active firm members. All writes go through SECURITY DEFINER RPCs.
- **Ownership nodes:** there is no table. They are JSON `{name, kind, ownership_percentage, nature_of_control[], is_ubo, company_number?, address?}` stored inside the record. The extraction model and prompt version are kept only in `audit_events.payload`.
- `firms.four_eyes boolean default true` (Slice 0b): the maker cannot be the checker for entity CDD records, saved filings and refresh packs. `firm_members.role` is `admin | member | read_only`.
- `client_documents.status` also allows `pending` (Slice 0b): a saved Companies House filing waits there until an admin approves it; `uploaded_by` is who saved it.
- `refresh_packs` (Slice 6): `id, firm_id, subject, subject_name, policy jsonb, snapshot jsonb, snapshot_sha256, status(draft|submitted|approved|rejected), created_by, created_at, submitted_at, reviewed_by, reviewed_at, review_note`. A trigger refuses any change to the subject, policy, snapshot, fingerprint, firm, creator or creation time; rows are written only by RPCs (read for firm members, read_only included). Snapshots hold individuals as initials only and a check constraint rejects personal-data keys.
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
- **Tests (at 2026-10-14):** 354 vitest tests on the Slice 6 branch (ownership walker and viewer, GLEIF and register lookups, KYC profile, permissions, uploads, refresh packs), 6 `node --test` tests for the SQL splitter, and SQL tests for the RPCs (`supabase/tests/permissions.test.sql`: 61 checks, `refresh_packs.test.sql`: 64 checks) run by `scripts/run-dryrun.cjs` inside a transaction that is rolled back.
- **TODO/FIXME comments:** none found.
- **Bugs / gaps found in code:**
  1. ~~The `read_only` role is not checked in any RPC.~~ **Fixed in Slice 0b**: `require_role` is called at the top of every write RPC that only checked membership; review needs admin.
  2. ~~No four-eyes check.~~ **Fixed in Slice 0b**: `entity_cdd_records.fetched_by` and `firms.four_eyes`, enforced in `review_entity_cdd` (and for filings and packs).
  3. ~~`fetchEntityCddAction` looks up membership without filtering on `firm_id`.~~ **Fixed**: it uses the client's firm (`getMembership`), as does the document upload action. Other pages still use an unfiltered `.single()` on `firm_members`, which fails for a user in more than one firm.
  4. ~~Embedding after approval is not wrapped in try/catch.~~ **Fixed**: failures are audited as `embedding.failed`.
  5. The uploaded source document stays in `status='uploaded'` and is never approved or extracted (UNVERIFIED how the UI treats it).
  6. Production ownership walks cannot see PSC statements, exemptions or GLEIF data, because kyc-search does not expose them (see §2).
  7. Only the first page of officers and PSCs is used, if kyc-search paginates (UNVERIFIED).

## 7. Changes since the audit (2026-10-14)

### Slice 0b: permissions in the database
- Migration `20261014000000_slice0b_permissions.sql`, **applied to the live database**.
- `public.require_role(firm_id, roles[])` is called at the top of every write RPC that previously checked only active membership: create_client, import_clients, register_document, save_extraction, save_entity_cdd, the three `upsert_*_embedding` RPCs (admin or member), and review_entity_cdd, review_extraction, approve_filing_document (admin only). `read_only` can no longer write. Admin is the reviewer; there is no reviewer role.
- `is_admin_or_analyst_of_firm` was repaired (it still looked for the `analyst` role that the multi-user migration (20260607010000) had removed), so admins and members can update and archive clients again.
- **Filings are maker-checker.** Saving a filing (member or admin) registers it with status `pending`; an admin approves it, and with `firms.four_eyes` on, not the person who saved it. Pending filings show "Pending approval" and admins get an Approve button. Filings saved before this that were never approved were moved to `pending`.
- Dry-run tooling: `scripts/run-dryrun.cjs` runs migrations and SQL tests over one connection inside a transaction that is always rolled back (see `supabase/README.md`).

### Uploads no longer pass through Server Actions
- A file over 1 MB posted through a Server Action fails with "Body exceeded 1 MB limit", although the forms promised 10 MB. The entity CDD fetch form and the Documents upload form now upload to Storage from the browser and send only the path. `bodySizeLimit` is unchanged. The server checks the path is in the client's folder and the bytes match the claimed type.

### Slice 6: refresh packs
- Migration `20261015000000_slice6_refresh_packs.sql`, **applied to the live database** (dry run: 64 checks passed).
- A refresh pack is a saved, unchangeable record of an ownership run: the snapshot is exactly what the pack page renders (KYC profile rows, ownership nodes and edges with resolutions, reason codes and ranges, points to check, summary with open-branch count, and a **source log** of every register fetch: register, endpoint path, fetched-at, status, cached or not), with a SHA-256 fingerprint over canonical JSON (sorted keys, no whitespace). Individuals are initials only; the builder refuses to build if a known name leaks.
- RPCs: `create_refresh_pack` (member or admin), `submit_refresh_pack` (creator), `approve_refresh_pack` / `reject_refresh_pack` (admin; with four-eyes the creator cannot approve; reviewed once; rejecting needs a note). Audit events `refresh_pack.created|submitted|approved|rejected`.
- UI: "Save as refresh pack" on `/dashboard/ownership`; `/dashboard/packs` (list); `/dashboard/packs/[id]` renders only from the snapshot (static SVG chart, source log, sign-off) and recomputes the fingerprint ("Fingerprint verified" or a red mismatch warning); "Download PDF" is the browser print dialog with a print stylesheet (fingerprint repeated in every page footer).
- The server signs each snapshot (HMAC, `PACK_SIGNING_SECRET`, 16+ characters, bound to the firm and valid for an hour) so only a snapshot it built can be saved. **Without that environment variable the Save button is disabled.** A user in several firms gets their earliest firm (the app has no "current firm" yet).
- Not enforced in the database: that the stored fingerprint equals the hash of the snapshot (canonical JSON is computed in TypeScript; the pack page verifies it). Deleting a firm cascades to its packs.
