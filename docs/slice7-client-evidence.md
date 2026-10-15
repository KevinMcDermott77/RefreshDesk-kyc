# Slice 7: client-provided ownership evidence (spec)

Status: draft for review. No code yet. Written 2026-10-15.

## Why

The walk stops at foreign nodes where the register is paywalled or restricted (`REGISTER_PAYWALLED`, `UBO_REGISTER_RESTRICTED`, `SHAREHOLDERS_NOT_FILED`, `FREE_MANUAL_RETRIEVAL`, `REGISTER_NOT_PROFILED`, `FOREIGN_ENTITY_UNMATCHED`, GLEIF exceptions). [docs/ownership-sources.md](ownership-sources.md) found no free, machine-readable source for most of these after the CJEU ruling, and recommends supporting a client-supplied extract with reviewer sign-off. This slice builds that.

## Rules that do not bend

1. **No match on name alone.** An owner proposed from a document becomes a node labelled with the name as shown. It is linked to a GLEIF record or a company only by an exact registration number plus country, or an exact LEI, printed in the document, through the lookups the walk already uses (`findByRegistration`, `sameRegistration`). Zero or several results mean no match. A name that looks similar is never a reason.
2. **Four-eyes.** The person who uploads is not the person who confirms. Only an `admin` can confirm, and when `firms.four_eyes` is on (default) not the uploader. Enforced in the database, as for filings and packs.
3. **Nothing resolves until confirmed.** An extraction is a proposal. Unconfirmed evidence changes no node, no summary and no pack.
4. **Evidence is labelled where it is used.** Evidence type is the fixed string `client-provided, reviewer-verified`, shown with the document link, reviewer and date on the node, in the profile, in the summary and in the pack.
5. **Individuals are initials in every output** (UI chain, summary, snapshot, audit payload, logs). Full names exist only in the evidence row and on the confirm page, so the reviewer can check them against the document. No personal data in fixtures or tests (the repo is public); use invented, obviously fake names.
6. **The original reason is kept.** Evidence never deletes the reason the register stop happened; it moves to a secondary reason, as terminal checks do.

## Flow

1. The walk shows an UNRESOLVED foreign node. The node panel offers "Add client evidence" to a `member` or `admin` when the node has a usable identity (see Node identity).
2. The member picks the evidence kind and uploads a file. The browser uploads straight to Storage under `<firm>/<client>/…` (as in `uploadIncorporationDocument`); only the path goes to the server action. The server checks the path is in the client's folder and the bytes match the claimed type (PDF, JPEG, PNG, 10 MB), then registers the document.
3. Extraction runs and stores a **proposal** (see Extraction). Status `proposed`.
4. The proposal appears in the admin queue. A different admin opens it: the document (signed URL) beside the proposed table. They confirm as proposed, edit rows, or reject with a note.
5. On confirm, the evidence becomes `confirmed`. The next walk for this client and node applies it. Earlier packs are untouched.

Evidence kinds: `register_extract`, `shareholder_register`, `signed_structure_chart`, `annual_report_page`. All need an "as at" date, entered or extracted, shown to the reviewer.

## Extraction

Reuses the extraction pattern in `lib/claude/extract-document.ts` with a new prompt version (`ownership-evidence-v1`) and a Zod schema. Output for each owner:

| Field | Notes |
|---|---|
| `kind` | `individual` or `entity` |
| `name_as_shown` | Verbatim. Never normalised, never completed. |
| `holding` | `{ type: 'percent', value }` or `{ type: 'band', low, high }`, as printed. Absent if not printed. Never a midpoint, never computed from share counts. |
| `shares` | Optional counts, only to help the reviewer. |
| `registration` | `{ number, country }` only if printed next to the owner; else null. |
| `lei_shown` | Only if printed. |
| `page_ref` | Page and section the row came from. Required; a row without one is dropped. |
| `uncertain` | Boolean the model sets when it is guessing a field. |

Document-level: `as_at`, `document_title`, `signed` (for a structure chart), `owners_complete` (does the document claim to list all holders?). The prompt says: do not infer, do not look anything up, return null when not shown. Raw response is stored, as for other extractions.

## Walk integration

- New optional `OwnershipFetcher.clientEvidence(identity)` returning the latest confirmed evidence for a node, or null. The walk stays pure and testable with a fake.
- Applied only when a foreign node would otherwise end UNRESOLVED for a register-stop or GLEIF-exception reason. It never overrides `RESOLVED_*`, `PSC_STATEMENT` (a Companies House statement is a finding about the company), `CIRCULAR_OWNERSHIP`, `DEPTH_LIMIT_REACHED` or `SOURCE_UNAVAILABLE`.
- For each confirmed owner the walk adds a child node and an edge with `source: 'client'`, `basis: 'client_evidence'`. A stated percentage becomes `[p, p]`, a band stays a band. Effective ranges flow through the existing multiply/majority maths.
  - `individual` owners: `RESOLVED_INDIVIDUAL`, with the evidence label.
  - `entity` owners with a unique registration/LEI match: queued and walked like any other node.
  - `entity` owners without a match: UNRESOLVED with `FOREIGN_ENTITY_UNMATCHED` and a point to check ("registration number not shown; request it"). The walk stays partial for that branch.
- The node itself becomes `PENDING` (its outcome lives on its owners) when the coverage rule passes, else it stays UNRESOLVED with the new secondary code below.

### Coverage rule

A document that lists some holders may hide a bigger one. After applying evidence to a node, take the sum of the lower bounds of the listed holders. If `100 - sum` is still at or above the policy threshold, an unlisted holder could be a beneficial owner, so the node stays UNRESOLVED with `CLIENT_EVIDENCE_INCOMPLETE`. The same code applies when the document sets `owners_complete` to false and the reviewer did not override it. Lower bounds missing (no holding printed) count as 0.

### New reason codes (secondary unless stated)

- `CLIENT_EVIDENCE_INCOMPLETE`: primary on a node whose evidence fails the coverage rule.
- `CLIENT_EVIDENCE_STALE`: the evidence is older than the firm's window (default 12 months from `as_at`). A stale item is not applied; the node returns to UNRESOLVED and the point to check says why.
- `CLIENT_EVIDENCE_APPLIED`: secondary on a node resolved this way, so filters and the pack can find it.

### Node identity

Evidence is keyed by `(firm, client, subject root, node key)` plus the identity the reviewer saw: `{ country, registrationNumber }` and/or `lei`. A rerun applies evidence only if the node's current identity equals the stored one. Nodes with neither a registration number nor an LEI cannot take evidence; the panel says why. If the walk's node id format changes, the identity match still holds.

## Effect on the summary (complete vs partial)

| Situation | Walk status | Display |
|---|---|---|
| Every open branch resolved by registers or by confirmed, complete, in-date evidence | `resolved` | "Resolved. N nodes rely on client-provided, reviewer-verified evidence" with links |
| Some branches resolved by evidence, others still open | `partial` | Evidence nodes listed separately from register-resolved ones |
| Evidence incomplete or stale on any open branch | `partial` | Point to check: `CLIENT_EVIDENCE_INCOMPLETE` or `…_STALE` |
| Unconfirmed proposal exists | unchanged | Point to check: "Evidence awaiting confirmation" (does not count as resolved) |

`WalkSummary` gains `clientEvidence: { nodeId, evidenceId, kind, asAt, confirmedAt }[]` and the `unresolved` list shows the new codes. **Recommendation: allow `resolved`** (a confirmed, four-eyes, dated document is real evidence), but never merge it silently into register-resolved wording. The alternative, capping at `partial` like a GLEIF consolidation edge, is listed as an open question.

## Refresh pack and source log

- The snapshot builder adds, per node resolved by evidence: `clientEvidence: { id, kind, asAt, confirmedAt, confirmedBy, documentSha256, label }`. No file name (it can hold a person's name), no full names, initials only.
- Source log entry per evidence item: register `client-provided evidence`, path `evidence/<id>`, fetched-at = confirmation time, status `confirmed`, cached `false`, plus the document SHA-256, so the pack shows which bytes the claim rests on.
- The SHA-256 of the file is computed server-side at registration and stored on the evidence row.
- `create_refresh_pack` checks that every evidence id in the snapshot exists, is `confirmed`, belongs to the firm and was not superseded at creation time. The pack fingerprint covers the references. Later superseding or expiry does not change an existing pack.
- Pack sign-off stays separate (Slice 6). Confirming evidence is not approving a pack.

## Audit events

All written in the RPC, in the same transaction, to `audit_events`; payloads hold ids, kinds, counts and hashes, never names.

- `ownership_evidence.created` (document id, kind, node key)
- `ownership_evidence.proposed` (model, prompt version, owner count, confidence)
- `ownership_evidence.confirmed` (confirmer, uploader, `edited` boolean, owner count, SHA-256 of the confirmed payload, four-eyes flag)
- `ownership_evidence.rejected` (note present)
- `ownership_evidence.superseded` (old and new id)
- `ownership_evidence.expired` is not an event: expiry is computed at read time from `as_at`.

## Data model and migration outline

Migration `20261016000000_slice7_client_evidence.sql`, dry-run first with `scripts/run-dryrun.cjs`.

1. `client_documents.document_type` check gains `ownership_evidence`.
2. Table `ownership_evidence`:
   - `id, firm_id, client_id, document_id (fk client_documents), subject_id, node_key, node_identity jsonb (country, registration_number, lei), evidence_kind, as_at date, document_sha256 text`
   - `status` in `proposed | confirmed | rejected | superseded`
   - `proposal jsonb` (as extracted), `confirmed jsonb` (as signed off; null until confirmed), `model_used, prompt_version, raw_response, confidence`
   - `created_by, created_at, confirmed_by, confirmed_at, review_note, superseded_by`
   - Constraints: `confirmed` is not null exactly when status is `confirmed`; `as_at` not in the future; `confirmed_by` not null when confirmed.
3. A guard trigger (as for `refresh_packs`): once `confirmed`, only `status → superseded` and `superseded_by` may change. `proposal`, `confirmed`, hashes, identity and people are immutable.
4. Partial unique index: one `confirmed` row per `(firm_id, client_id, subject_id, node_key)`; confirming a new one supersedes the old in the same transaction.
5. A check function that validates the JSON shape of `proposal`/`confirmed` (owner kinds, holding ranges 0 to 100, `low <= high`, required `page_ref`) so a bad client write is refused in the database.
6. RLS: firm members read; no direct writes (RPCs only), like packs. Decision needed on `read_only` seeing the table (it holds full names); the recommendation is no, and a view without names for them.
7. RPCs, all `security definer` with `require_role`:
   - `create_ownership_evidence(client, subject, node_key, identity, kind, document, sha256)`: admin or member.
   - `save_evidence_proposal(id, proposal, model, prompt_version, confidence, raw)`: admin or member; same caller as creator.
   - `confirm_ownership_evidence(id, confirmed jsonb, note)`: admin; four-eyes refusal with errcode `42501` and the same message style as packs; locks the row; refuses unless `proposed`; sets `edited` by comparing `confirmed` to `proposal`.
   - `reject_ownership_evidence(id, note)`: admin; note required; creator may also withdraw their own proposal.
   - `confirmed_evidence_for(client, subject)`: read function for the walk that returns confirmed, in-date rows (the app also checks staleness).
8. Storage: the existing `kyc-documents` bucket and policies; no new bucket.

## UI

- Node panel on an UNRESOLVED foreign node: reason, register profile (already there), and "Add client evidence". After upload, the state is "Awaiting confirmation" with the uploader and date.
- Admin queue (`/dashboard/evidence`): list of `proposed` items with client, node, kind, uploader, age. Disabled confirm with the reason shown when the viewer is the uploader (as on the CDD review page).
- Confirm page: document viewer beside an editable table (name, kind, holding, registration number and country, page reference), uncertain fields highlighted, a per-row "no registration number shown" state, the as-at date, the coverage rule result updating as rows change, and the lookup result for any printed registration number or LEI (matched record name shown next to the name in the document, so a mismatch is visible).
- Chain viewer: nodes resolved by evidence get the label and a link to the document and reviewer/date, and a distinct edge style.

## Tests

- **Schema and rules (vitest):** proposal and confirmed schemas; holding bounds; `page_ref` required; percent and band handling; no midpoint anywhere; coverage rule (boundaries around the threshold, missing holdings, `owners_complete` false).
- **No name matching:** a fake `findByRegistration` and fake GLEIF source; assert that a name-only entity owner is never linked and that two results mean no match; an exact registration number plus country links; a registration number without a country does not.
- **Walk with a fake `clientEvidence`:** applies only to the allowed reason codes; never overrides `RESOLVED_*` or `PSC_STATEMENT`; original reason kept as secondary; identity mismatch means not applied; stale means not applied and flagged; status transitions per the table above; effective ranges through multiply and majority.
- **Summary and profile rows:** counts, labels, points to check; unconfirmed proposal is not resolved; the Listing/Ownership rows still agree (see the listing-row fix).
- **Pack:** snapshot holds references, hash and label but no names, file name or personal-data keys (the existing leak check runs on it); the source-log entry; fingerprint covers references; superseded evidence does not change an existing pack.
- **Actions:** upload path must be in the client's folder; byte-sniffing refuses a mismatched type; file bodies posted through the action are refused (1 MB rule); role checks.
- **SQL (`supabase/tests/client_evidence.test.sql`, run by `run-dryrun.cjs`):** each RPC by role including `read_only`; four-eyes refusal for the uploader; confirm only from `proposed`; edited flag; immutability trigger; supersede on a second confirm; one confirmed row per node; RLS across two firms; audit rows with no names in payloads; JSON shape refusals.
- **Manual check before merge:** one real extract run against an invented document, with a screenshot of the confirm page.

## Build slices

- **7a** data model, RPCs, SQL tests, audit events.
- **7b** upload, extraction, proposal storage, admin queue and confirm page.
- **7c** walk integration, coverage rule, summary, profile rows, new reason texts.
- **7d** pack snapshot, source log, pack-creation check, chain viewer labels.

Each slice is its own branch and migration step where needed; nothing is pushed or applied to the live database without approval.

## Open questions

1. **Resolved or capped at partial?** Recommendation: `resolved`, clearly labelled. A cap would make evidence-backed runs never complete.
2. **Stale window.** Default 12 months from `as_at`; per firm setting or fixed?
3. **Several documents for one node** (a register extract plus a structure chart). Recommendation: one confirmed item per node; to combine, upload a new document and supersede. Merging is out of scope.
4. **Entity owners without a registration number.** Recommendation: leave unresolved with a prompt to request it, not a name search. Is that acceptable for the firm's process?
5. **Walks started without a client.** Evidence needs a client to hang on. Recommendation: the "Add client evidence" action only appears when the walk was started from a client page.
6. **`read_only` and full names.** Recommendation: no access to the table; a names-free view.
7. **Claude and personal data.** Documents with personal data are sent to the Anthropic API, as the existing passport and incorporation extractions are. Does the firm's DPA cover shareholder registers and structure charts the same way?
