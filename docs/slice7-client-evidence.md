# Slice 7: client-provided ownership evidence (spec)

Status: decisions approved 2026-10-15 (see "Decisions"). No code yet.

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

Evidence kinds: `register_extract`, `shareholder_register`, `signed_structure_chart`, `annual_report_page`. All need an "as at" date (the date the holdings are stated for), entered or extracted, shown to the reviewer. Age is measured from `as_at`, or from the document date when no `as_at` is printed.

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

Document-level: `as_at`, `document_date`, `document_title`, `signed` (for a structure chart), `owners_complete` (does the document claim to list all holders?), `certified` (`yes`, `no` or `unclear`, as the document shows it) and `certified_by` (who certified, verbatim, e.g. company secretary, notary, auditor; null if none shown). The model never assumes certification: a stamp, signature or statement of certification must be visible, and `unclear` goes to the reviewer. The prompt says: do not infer, do not look anything up, return null when not shown. Raw response is stored, as for other extractions.

## Walk integration

- New optional `OwnershipFetcher.clientEvidence(identity)` returning the latest confirmed evidence for a node, or null. The walk stays pure and testable with a fake.
- Applied only when a foreign node would otherwise end UNRESOLVED for a register-stop or GLEIF-exception reason. It never overrides `RESOLVED_*`, `PSC_STATEMENT` (a Companies House statement is a finding about the company), `CIRCULAR_OWNERSHIP`, `DEPTH_LIMIT_REACHED` or `SOURCE_UNAVAILABLE`.
- For each confirmed owner the walk adds a child node and an edge with `source: 'client'`, `basis: 'client_evidence'`. A stated percentage becomes `[p, p]`, a band stays a band. Effective ranges flow through the existing multiply/majority maths.
  - `individual` owners: `RESOLVED_INDIVIDUAL`, with the evidence label.
  - `entity` owners with a unique registration/LEI match: queued and walked like any other node.
  - `entity` owners without a match: UNRESOLVED with `FOREIGN_ENTITY_UNMATCHED` and a point to check ("registration number not shown; request it"). The walk stays partial for that branch.
- The node itself becomes `PENDING` (its outcome lives on its owners) when the item is applied (all conditions under Policy and overrides), else it stays UNRESOLVED with the matching code below.

### Coverage rule

A document that lists some holders may hide a bigger one. After applying evidence to a node, take the sum of the lower bounds of the listed holders. If `100 - sum` is still at or above the policy threshold, an unlisted holder could be a beneficial owner, so the node stays UNRESOLVED with `CLIENT_EVIDENCE_INCOMPLETE`. The same code applies when the document sets `owners_complete` to false and the reviewer did not override it. Lower bounds missing (no holding printed) count as 0.

### New reason codes (secondary unless stated)

- `CLIENT_EVIDENCE_INCOMPLETE`: primary on a node whose evidence fails the coverage rule.
- `CLIENT_EVIDENCE_STALE`: the evidence is older than `maxEvidenceAgeMonths`. It is not applied; the node returns to UNRESOLVED and the point to check says why.
- `CLIENT_EVIDENCE_UNCERTIFIED`: `certified` is not `yes`. Not applied, same handling.
- A reviewer override (see Policy and overrides) waives these two codes for that item.
- `CLIENT_EVIDENCE_APPLIED`: secondary on a node resolved this way, so filters and the pack can find it.

### Node identity

Evidence is keyed by `(firm, client, subject root, node key)` plus the identity the reviewer saw: `{ country, registrationNumber }` and/or `lei`. A rerun applies evidence only if the node's current identity equals the stored one. Nodes with neither a registration number nor an LEI cannot take evidence; the panel says why. If the walk's node id format changes, the identity match still holds.

## Policy and overrides

Two new `WalkPolicy` settings (also recorded in the pack policy):

| Setting | Default | Meaning |
|---|---|---|
| `acceptClientEvidenceAsResolved` | `true` | On: confirmed evidence can resolve a branch. Off: evidence is shown but the branch stays unresolved, so the walk is partial. |
| `maxEvidenceAgeMonths` | `12` | Evidence older than this, measured from `as_at` (else the document date) to the run date, is not applied. |

**Applied only if all hold:** status `confirmed`; certified `yes`; age within the window; coverage rule passes (above); `acceptClientEvidenceAsResolved` is on. Otherwise the branch stays partial, with the matching code (`CLIENT_EVIDENCE_STALE`, `CLIENT_EVIDENCE_UNCERTIFIED`, `CLIENT_EVIDENCE_INCOMPLETE`).

**Reviewer override.** When confirming, the admin may accept evidence that is older than the window or not certified. A written note is mandatory (the database refuses an override without one). Rules:
- The override is stored on the confirmed record as `override: { reasons: ['stale' | 'uncertified'], note }`, and is visible on the node, the profile and the pack.
- It waives only the reasons listed. Coverage cannot be overridden (decision 6).
- A stale override is time-limited: the document is accepted for `maxEvidenceAgeMonths` after the confirmation date, then it needs a fresh review. An uncertified override has no end date.
- The override is the confirmer's, so it follows the four-eyes rule: the uploader cannot confirm, and so cannot override.
- With `acceptClientEvidenceAsResolved` off, an override has no effect on resolution.

## Effect on the summary (complete vs partial)

`WalkStatus` gains `resolved_client_evidence`, shown as **"Resolved (client evidence)"**. It means every open branch is resolved and at least one relies on applied client evidence. Plain `resolved` is kept for walks that rely on registers only.

| Situation | Walk status | Summary wording |
|---|---|---|
| Every branch resolved by registers | `resolved` | "Complete" |
| Every branch resolved, N rely on applied client evidence | `resolved_client_evidence` | "Complete — N branches resolved on client evidence" (links to each item, with age, certification and any override) |
| Some branches still open | `partial` | Evidence-backed nodes listed apart from register-resolved ones |
| Evidence stale, uncertified or incomplete and not overridden | `partial` | Point to check with the code |
| `acceptClientEvidenceAsResolved` off | `partial` | "N branches have client evidence that policy does not accept as resolving" |
| Unconfirmed proposal exists | unchanged | Point to check: "Evidence awaiting confirmation" |

`WalkSummary` gains `clientEvidence: { nodeId, evidenceId, kind, asAt, certified, certifiedBy, confirmedAt, override }[]`. Code that tests `status === 'resolved'` (profile rows, summary, packs, the viewer) must treat `resolved_client_evidence` as a pass but never merge its wording with plain `resolved`. Finding all such checks is part of slice 7c.

## Refresh pack and source log

- The snapshot builder adds, per node resolved by evidence: `clientEvidence: { id, kind, asAt, documentDate, certified, certifiedBy, confirmedAt, confirmedBy, documentSha256, label, override }`. No file name (it can hold a person's name), no full names, initials only. An override's note is included and goes through the existing leak check, which refuses the pack if a known name is in it. The pack policy records both new settings.
- Source log entry per evidence item: register `client-provided evidence`, path `evidence/<id>`, fetched-at = confirmation time, status `confirmed`, cached `false`, plus the document SHA-256, so the pack shows which bytes the claim rests on.
- The SHA-256 of the file is computed server-side at registration and stored on the evidence row.
- `create_refresh_pack` checks that every evidence id in the snapshot exists, is `confirmed`, belongs to the firm and was not superseded at creation time. The pack fingerprint covers the references. Later superseding or expiry does not change an existing pack.
- Pack sign-off stays separate (Slice 6). Confirming evidence is not approving a pack.

## Audit events

All written in the RPC, in the same transaction, to `audit_events`; payloads hold ids, kinds, counts and hashes, never names.

- `ownership_evidence.created` (document id, kind, node key)
- `ownership_evidence.proposed` (model, prompt version, owner count, confidence)
- `ownership_evidence.confirmed` (confirmer, uploader, `edited` boolean, `override` reasons and whether a note was given, owner count, SHA-256 of the confirmed payload, four-eyes flag)
- `ownership_evidence.rejected` (note present)
- `ownership_evidence.superseded` (old and new id)
- `ownership_evidence.expired` is not an event: expiry is computed at read time from `as_at`.

## Data model and migration outline

Migration `20261016000000_slice7_client_evidence.sql`, dry-run first with `scripts/run-dryrun.cjs`.

1. `client_documents.document_type` check gains `ownership_evidence`.
2. Table `ownership_evidence`:
   - `id, firm_id, client_id, document_id (fk client_documents), subject_id, node_key, node_identity jsonb (country, registration_number, lei), evidence_kind, as_at date, document_date date, certified text (yes|no|unclear), certified_by text, document_sha256 text`
   - `status` in `proposed | confirmed | rejected | superseded`
   - `proposal jsonb` (as extracted), `confirmed jsonb` (as signed off, including any `override`; null until confirmed), `model_used, prompt_version, raw_response, confidence`
   - `created_by, created_at, confirmed_by, confirmed_at, review_note, superseded_by`
   - Constraints: `confirmed` is not null exactly when status is `confirmed`; `as_at` and `document_date` not in the future; `confirmed_by` not null when confirmed; an override needs a non-empty note and a listed reason.
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

- **Policy (vitest):** `acceptClientEvidenceAsResolved` on and off; `maxEvidenceAgeMonths` boundaries (exactly at the limit, a day over, `as_at` missing so the document date is used); uncertified and `unclear`; an override without a note is refused; a stale override expires after the window; an override cannot waive coverage; `resolved_client_evidence` only when at least one applied item exists, with the wording "Complete — N branches resolved on client evidence"; every `status === 'resolved'` check updated.
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

## Decisions

Approved on 2026-10-15:

1. Evidence-backed branches may resolve, controlled by `acceptClientEvidenceAsResolved` (default true), with the distinct status "Resolved (client evidence)". With the setting off they stay partial.
2. Document date and certification (yes/no, who certified) are extracted and confirmed. `maxEvidenceAgeMonths` defaults to 12. Older or uncertified evidence stays partial unless the reviewer overrides with a mandatory note.
3. Evidence applies only where the walk would otherwise leave a foreign node unresolved.

## Remaining questions, with a recommended answer for each

Approve all in one go, or say which to change. Numbering continues from the decisions above. The first draft had five open questions left after your two answers; question 6 is a sixth that the spec implied, added here so it is decided too.

| # | Question | Recommended answer | Why |
|---|---|---|---|
| 4 | **Several documents for one node** (a register extract plus a structure chart). | One confirmed item per node. To combine sources, upload a new document that covers the whole structure; confirming it supersedes the old item. No merging. | Merging two documents' holdings makes the coverage and certification rules ambiguous, and one item keeps the pack reference simple. Revisit if reviewers ask for it. |
| 5 | **Entity owners with no registration number printed.** | Leave the branch unresolved with a point to check ("registration number not shown; request it"). Never search by name. Once the client supplies a number, a new evidence item is confirmed. | This is the no-name-matching rule applied. A name search would put a guess into a signed pack. |
| 6 | **Can the reviewer override incomplete coverage?** | No. Only staleness and missing certification can be overridden. If the listed holders leave room for an unlisted one at or above the threshold, the reviewer asks for a fuller document. | An override of coverage is a claim about holders nobody has seen. The other two are claims about the quality of a document that has been seen. |
| 7 | **Walks started without a client.** | Show "Add client evidence" only when the walk was started from a client page; otherwise show the reason ("start from a client to attach evidence"). | Evidence needs a client, a firm folder and an owner for the record. A free-floating mode would need its own permissions. |
| 8 | **`read_only` and full names.** | `read_only` cannot read `ownership_evidence`; they get a view without names (kind, node, dates, status, reviewer). Admins and members see names on the evidence row and confirm page only; every other output uses initials. | Matches the initials-only rule and Slice 0b's least-privilege direction. |
| 9 | **Claude and personal data in documents.** | Treat as covered only if the firm's data-processing terms already cover the passport and incorporation extractions. Add a firm setting that disables evidence extraction (upload and manual entry still work), and record which model processed each document in the audit event. | Same processors as the existing extractions, but shareholder registers can list many third parties. This needs an answer from the firm, not a code default. |
