# Slice 7: browser test, start to finish

This walks the whole client-evidence flow on the built-in **sample** company. Nothing in it is real: the UK
company `DEMO-FJORDVIK`, its register entries, its owner "Fjordvik Test Holding AS" and the shareholder register PDF
are all invented, and everything the sample produces says **Sample data**, including the refresh pack.

## Before you start

- Migration `20261016000000_slice7a_client_evidence.sql` is applied (it is).
- `apps/web/.env.local` has `ANTHROPIC_API_KEY` and `PACK_SIGNING_SECRET` (16+ characters). Restart `npm run dev` after changing it.
- Extraction is on for your firm (Settings → Client ownership evidence). It is, for `bubble-up`.
- The sample subject is offered only to firms whose slug is in `DEMO_SUBJECT_FIRM_SLUGS` (comma-separated), which defaults to `bubble-up`. Any other firm gets "The sample subject is not available to this firm."
- **The migration for the new evidence kind is applied** (see the report; until it is, uploading a written confirmation is refused with "invalid evidence kind"). Also `20261017000000_slice7e_evidence_followup.sql`.
- The files to upload: `__fixtures__/evidence/SAMPLE-ownership-confirmation.pdf` (the client's signed letter: use this one first) and `__fixtures__/evidence/SAMPLE-shareholder-register.pdf` (the register: the fallback). Regenerate both with `node scripts/make-sample-register.cjs`.

## Steps

1. **Sign in** as your admin and open your test client (`/dashboard/clients/<id>`). In the Documents panel you now have **Add ownership evidence** and **Ownership chain (with this client's evidence)**.
2. Click **Ownership chain (with this client's evidence)**. The page URL ends `?client=<id>`, and the form has a "Client evidence for …" box: the box "Let confirmed client evidence resolve branches the registers cannot" is ticked, and "Oldest evidence accepted" is 12 months.
3. In "Company number, LEI or name" type **`DEMO-FJORDVIK`** and click **Walk ownership**. No register is called, so it is instant. Expect:
   - a red **Sample data** banner above the results;
   - the chart: **SAMPLE DATA: Fjordvik Demo (UK) Limited** at the bottom, owned by **Fjordvik Test Holding AS**, red, `SHAREHOLDERS_NOT_FILED`, country NO;
   - "Overall: unresolved";
   - every profile row noting "Sample data: invented for testing…", with no links to Companies House.
4. Click the **Fjordvik Test Holding AS** node. The side panel shows the register stop for Norway and an **Add client evidence** button. Click it.
5. The form opens filled in: company name, **country NO**, **registration number 999 000 001**, walk subject `DEMO-FJORDVIK`, kind "Shareholder register". Leave the kind as **"Client's written confirmation of ownership"** (the default), choose `SAMPLE-ownership-confirmation.pdf`, leave **"Have Claude read the document"** ticked and click **Upload**. It takes 10 to 30 seconds.
6. **Claude's proposal** (the item page, status "Awaiting confirmation", a red "Sample data" tag, "Read by Claude · confidence …%"). Check it against the PDF. It should read:

   | Owner | Kind | Holding | Registration |
   |---|---|---|---|
   | Øystein Åsmund Testersen | Individual | 45% | |
   | Nordlys Invest Test AS | Company | 20% | 999 000 002, NO |
   | Kari Eksempel-Fjeld | Individual | 20% | |
   | Bjørn Prøve | Individual | 10% | |
   | Mia Sampleby | Individual | 5% | |

   with as-at **2026-06-30**, document date **2026-07-16**, and the confirmation block: **Confirmed by: Director**, **Date of the confirmation 2026-07-16**, **Received as: Signed letter**, and **"No other person holds 25 % or more"**. There is no "Certified?" field: a client's own confirmation is nobody's certification. "The document says it lists every holder" is **not** ticked (the letter does not say so), and the coverage box is still green because of the "no other person holds 25%" statement. The signatory's name is not in the proposal: only the capacity. Each owner's page/section should name the paragraph. A "Registration numbers in the proposal, looked up in GLEIF" panel says GLEIF has no record for 999 000 002: nothing is matched or linked. If Claude got anything wrong, correct it in the editor: you are confirming it, so you may edit.
7. **Four-eyes blocks you.** You uploaded it, so **Confirm evidence** is disabled and the page says "Four-eyes rule: the person who uploaded this evidence cannot confirm it. Ask another admin to confirm it." (With a second admin account you would stop here and sign in as them.)
8. **Turn four-eyes off for the test.** In the Supabase SQL editor, one statement:

   ```sql
   update public.firms set four_eyes = false where slug = 'bubble-up';
   ```

   This relaxes maker-checker for the whole firm (CDD records, filings, packs and evidence), so put it back at the end (step 14). Reload the item page: **Confirm evidence** is now enabled.
9. Click **Confirm evidence**. You land on `/dashboard/evidence`; the item is under "Recently decided" as Confirmed. (Before confirming you could also see it under "Awaiting confirmation".)
10. **Run the walk again**: client page → **Ownership chain (with this client's evidence)** → `DEMO-FJORDVIK` → **Walk ownership**. Expect:
    - banner **Overall: Complete — 1 branch resolved on client evidence** (green);
    - Fjordvik Test Holding AS is "Intermediate" with a **Client evidence** mark; above it **Ø.Å.T.**, **K.E.**, **B.P.**, **M.S.** as "Individual (client evidence)", and **Nordlys Invest Test AS** greyed as pruned (20% of 75-100% is below the 25% threshold);
    - edges labelled like "45-45% (client evidence)";
    - the Ownership profile row: "Walk status: resolved (client evidence)" and "1 branch resolved on client-provided, reviewer-verified evidence", marked PASS;
    - click the Fjordvik node: the **Client evidence** block shows the document kind, as-at date, "certified (company officer, 2026-07-15)", the confirmation time and a link to the evidence record.
11. **Save the pack**: click **Save as refresh pack** (the button above the profile). It opens `/dashboard/packs/<id>`.
12. On the pack page check: the red **Sample data** banner; the title "SAMPLE DATA: Fjordvik Demo (UK) Limited"; the policy line includes "client evidence may resolve a branch, up to 12 months old"; Summary "Complete … walk status resolved_client_evidence"; a **Client-provided evidence** section ("client ownership confirmation · as at 2026-06-30 · written confirmation from the client (signed letter), by a director, 2026-07-16; no certification applies", "client-provided, reviewer-verified", confirmed time, the document's sha-256, and no names); the **Source log** with a "SAMPLE DATA (built-in fixture…)" line and a "Client-provided evidence (reviewer-verified)" line.
13. **Fingerprint verified**: the green "✓ Fingerprint verified: the snapshot matches the stored fingerprint." line under the SHA-256. Try **Download PDF** (the browser print dialog): the banner and the fingerprint footer are on every page.
14. **Put four-eyes back:**

    ```sql
    update public.firms set four_eyes = true where slug = 'bubble-up';
    ```

## Things worth trying afterwards

- **Email policy**: in the client box on the ownership page, untick **Accept an emailed confirmation**. Re-upload the letter as "Received as: Email" (edit it in the confirm editor): the node goes back to red with `CLIENT_EVIDENCE_EMAIL_NOT_ACCEPTED` and "ask for a signed letter or a signed structure chart". Tick it again and walk: resolved.
- **No statement**: clear the "No other person holds…" box before confirming: the coverage box turns amber (the letter does not say it lists every holder), and `CLIENT_EVIDENCE_INCOMPLETE` cannot be overridden. Set it to 30: still amber (30 is above the 25% threshold).
- **The register instead**: upload `SAMPLE-shareholder-register.pdf` as kind "Shareholder register": it has certification fields (certified yes, company officer, 2026-07-15) and an "uncertified" override, which the letter does not.

- **Policy off**: untick "Let confirmed client evidence resolve branches" and walk again: the node stays red with "CLIENT_EVIDENCE_NOT_ACCEPTED" and the status goes back to unresolved.
- **Age limit**: set "Oldest evidence accepted" to 1 month and walk again: `CLIENT_EVIDENCE_STALE`, and the button offers "Add newer or fuller client evidence".
- **Open company branch**: edit the proposal so Nordlys holds 30% (and Kari 10%) before confirming: the walk then leaves Nordlys as an unresolved company (no register to read) and stays partial.
- **Incomplete**: remove the tick "lists every holder" before confirming: `CLIENT_EVIDENCE_INCOMPLETE`, which no override can waive.
- **Supersede**: upload and confirm a second item for the same node: the first becomes "Superseded" and is kept; a pack saved from the older run refuses with "Client evidence used by this run has been superseded…".
- **Extraction off**: switch it off in Settings and upload again: you enter the owners by hand.

## If something does not match

- "The sample subject is not available to this firm": your firm's slug is not in `DEMO_SUBJECT_FIRM_SLUGS` (default `bubble-up`).
- No **Add client evidence** button: the walk was not started from the client page (no `?client=`), or the node has no registration number/LEI, or it is not an evidence-eligible stop.
- Claude reads fewer rows than the table above: add or fix them in the editor; the page-reference and name rules stay the same.
- Saving the pack says the run is too old: it must be saved within an hour of the walk. Walk again.
