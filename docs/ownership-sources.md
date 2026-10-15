# Non-UK ownership evidence: source survey

Research spike, no code. Researched 2026-10-14 and 2026-10-15.

## How far to trust this

Official pages were fetched live where noted **[fetched]**. Many official sites returned 404 or 403 to the fetch tool. Where that happened, the claim comes from a web-search summary of law-firm or press coverage and is marked **[secondary]**. Anything marked **[unverified]** is my background knowledge or a gap. Before building on any row, re-check it on the official page. Several rules changed in 2025-2026 and are still moving.

Evidence strength scale:
- **A**: filed by the holder or issuer to a regulator, identifies the holder and the percentage.
- **B**: register of legal (not beneficial) owners, or structured data with weak identifiers.
- **C**: names only, free text, or restricted so that we cannot fetch it ourselves.

## 1. SEC EDGAR

| | |
|---|---|
| Free | Yes. No key. |
| Rate limit | 10 requests per second per user **[fetched]** (sec.gov "Accessing EDGAR Data"). SEC "reserves the right to limit request rates". |
| Identification | "Please declare your user agent in request headers" (name and contact email) **[fetched]**. Our env var `SEC_USER_AGENT` is currently unset, so no SEC call may run. |
| Licence | US government work, public. No licence terms found on the pages fetched **[unverified]**. |
| Format | JSON (data.sec.gov), XML (13D/G), HTML (20-F, Ex.21). data.sec.gov has no CORS, so server-side only **[fetched]**. |

Endpoints **[fetched]**:
- `https://data.sec.gov/submissions/CIK##########.json`: filing history (latest 1,000 or one year), names, tickers, exchanges. Updates in under a second.
- `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`, `companyconcept`, `frames`: XBRL financial facts. Not ownership data.
- Bulk `submissions.zip` and `companyfacts.zip`, rebuilt nightly at about 03:00 ET.
- `company_tickers.json`, `company_tickers_exchange.json` (fields: `cik`, `name`, `ticker`, `exchange`, no LEI). The SEC says these are updated periodically and gives no guarantee of accuracy.
- Full-text search (`sec.gov/edgar/search/`) is linked, but I found no documented API. Coverage dates **[unverified]**.

### Documents

| Document | What it gives | Machine-readable | Key | Strength |
|---|---|---|---|---|
| Schedule 13D / 13G | Holder, percentage, shares, filed against the subject company. The XML mandate has applied since 18 Dec 2024; exhibits stay unstructured **[secondary]** (Olshan, Toppan Merrill). | Yes, for filings from that date. HTML or ASCII before. | CIK of the subject and of the filer | A for a listed holder of at least 5%. Only covers issuers with a US-registered equity class. Beneficial owner as declared, not necessarily ultimate. |
| 20-F Item 7.A | Table of holders above 5%, record holders in the US, control statements. | No. Free text in HTML. | CIK, name | A for content, C for extraction (needs LLM or manual). Foreign private issuers only. Item wording is from background knowledge **[unverified]**; the SEC PDF would not parse. |
| 10-K Exhibit 21 | List of subsidiaries and jurisdictions. | No. HTML, varied layouts. | Name only | B. Legal subsidiaries, no percentages. Filers may omit non-significant subsidiaries (Item 601(b)(21)(ii)) **[secondary]**. For 20-F filers the equivalent is an Item 19 exhibit **[unverified]**. |

### CIK to LEI

- I found **no official CIK to LEI crosswalk**. The GLEIF mapping page lists BIC, ISIN, MIC, S&P CIQ, OpenCorporates, Open Ownership, QCC and GEM files, with no CIK **[fetched]**. GLEIF told the SEC in 2020 it would help map CIKs "if only for internal purposes" **[secondary]**. That is an offer, not a dataset.
- Whether a GLEIF LEI record can carry a CIK in its registration fields **[unverified]**. Test on a known filer (Apple) before assuming.
- The SEC ticker files carry no LEI **[fetched]**. Our current lookup is name-only and flagged as secondary, which is right.
- Workable route: candidate match by normalised name and country between the GLEIF record and `company_tickers_exchange.json`, then confirm by ticker or ISIN. GLEIF publishes a daily ISIN to LEI file **[fetched]**, but an ISIN does not contain the CIK, and EDGAR submissions give tickers rather than ISINs **[unverified]**. So the match stays "candidate, needs confirmation" until a reviewer confirms it. Never auto-accept.

## 2. Transparency Directive major-holding notifications

Common facts: thresholds differ by country. The notification goes to the issuer and the regulator. The issuer publishes through the officially appointed mechanism (OAM). None of the five has a documented free bulk API that I could find.

| Country | Official source | Free? | API / bulk | Format | Key | Strength | Checked |
|---|---|---|---|---|---|---|---|
| NO | Oslo Børs NewsWeb (`newsweb.oslobors.no`). Category "Major shareholding notifications" **[secondary]**. Finanstilsynet says notices are e-mailed to Oslo Børs for publication; no register or API on its page **[fetched]**. Thresholds 5, 10, 15, 20, 25, 1/3, 50, 2/3, 90%. | Viewing yes | None documented. Using an unofficial JSON endpoint would need a terms check. | PDF or HTML notice, free text | Issuer name or ticker, no LEI | A, C to extract | 2026-10-14 |
| SE | Finansinspektionen takes notifications through its Rapporteringsportalen **[secondary]**. Its "Our registers" page lists company register, net short positions, prospectus, PDMR, fund holdings and no flagging register **[fetched]**. Published by the issuer as a press release. | Per-issuer yes | None found. A commercial dataset exists (tic.io) **[secondary]**. | Press release | Issuer name | A, C to extract | 2026-10-14 |
| DE | Notification to BaFin (portal MVP) and issuer. Issuer publishes within 3 trading days and files with the Unternehmensregister **[secondary]**. Thresholds 3, 5, 10, 15, 20, 25, 30, 50, 75%. | Viewing likely free **[unverified]** | None found | Issuer-published PDF or text | Issuer name | A, C to extract | 2026-10-15 |
| FR | AMF publishes declarations in BDIF (`bdif.amf-france.org`) within 3 trading days **[secondary]**. The `info-financiere` regulated-information dataset is on data.gouv.fr: XML metadata plus attachments, XSD schema, Licence Ouverte (Etalab), updated 14 Oct 2026 **[fetched]**. | Yes | HTTPS and FTPS bulk at `echanges.dila.gouv.fr/OPENDATA/` **[fetched]**. The AMF open-data page lists no threshold datasets **[fetched]**. | XML + PDF | Page names no ISIN, LEI or SIREN **[fetched]** | A. Whether it includes threshold declarations is **[unverified]**. | 2026-10-14 |
| NL | AFM register of substantial holdings (`afm.nl/en/sector/registers/meldingenregisters/substantiele-deelnemingen`). **CSV and XML export links on the page** **[fetched]**. Thresholds 3, 5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 95% **[secondary]**. | Yes | Export, no API | CSV, XML | Names only in the listing (issuer, notifier, date) **[fetched]** | A, but name matching is weak | 2026-10-14 |

Page copyright reads "all rights reserved" (AFM), with no reuse licence stated **[fetched]**. Ask the AFM before redistributing.

### ESAP (EU single access point)

ESMA started collecting data from OAMs and national authorities on 10 July 2026. Public access is due by 10 July 2027 **[secondary]**, with the Transparency Directive in scope. Whether major-holding notices are included, and the API shape, are **[unverified]**. If it delivers, it replaces all five national scrapers with one feed.

## 3. National registers after the CJEU ruling (C-37/20, C-601/20, 22 Nov 2022)

The ruling ended unconditional public access to beneficial ownership registers. The common pattern in 2026 is access for authorities and obliged entities, plus a "legitimate interest" route (journalists, NGOs, prospective counterparties), usually with login, a declaration and a certificate. None is a free open bulk source. Our tool is used by firms that may count as obliged entities, but that is a legal question for the user, not an assumption.

| Country | Official page / source | Beneficial owner data | Legal shareholder data | Machine-readable | Key | Checked |
|---|---|---|---|---|---|---|
| NO | Brønnøysund Enhetsregisteret API docs **[fetched]**. | Register opened 1 Oct 2024. Access for authorities and reporting entities; rules for others set by regulation **[secondary]**. Final access categories **[unverified]**. | No shareholder list in the API docs **[fetched]** | Yes. JSON/HAL, bulk CSV, xlsx, gzipped JSON. NLOD 2.0 licence. No rate limit documented. Search capped at 10,000 results. | `organisasjonsnummer` (9 digits) | 2026-10-14 |
| SE | Bolagsverket. SFS 2026:316 (hosted on a third-party site) **[secondary]**. | Legitimate interest, certificate, up to 5 years back. Other electronic delivery may be granted. | No free shareholder register found | Not stated | Org no. | 2026-10-15 |
| FI | PRH **[secondary]**. | Name, birth date and holding visible, via Virre for contract customers or on request with a stated purpose. Sources are older than 2022-2026 changes. | Not found | Virre is a paid service **[unverified]** | Business ID (Y-tunnus) | 2026-10-15 |
| DK | Erhvervsstyrelsen guide **[fetched]**. CVR. | From 1 Sep 2025: authorities, obliged entities and legitimate interest only. MitID login and declaration, access lasts 3 years. **System-to-system API available on request** (email `cvrselvbetjening@erst.dk`, up to 12 working days). Cost not stated. | "Legal owners" and capital remain open in CVR per Danske Erhverv **[secondary]**. `datacvr.virk.dk` returned 403 to the fetch tool, so not checked directly. | Yes (API) | CVR number | 2026-10-14 |
| NL | KvK UBO register **[secondary]**. The KvK page returned 404. | Public access suspended since Nov 2022. A bill limits access to journalists, academics, NGOs, gatekeepers. Three-year certificate. Whether it is in force is **[unverified]**. | No | No | KvK number | 2026-10-15 |
| DE | Transparenzregister. The page returned 404. | Legitimate interest, reasoned application, fee of EUR 1.65 per document under TrGebV **[secondary]**. A 2026 draft law (AMLD6) is pending. | Handelsregister, paid after-2022 terms **[unverified]** | No | HRB number | 2026-10-15 |
| FR | INPI, RBE **[secondary]**. | Decree 2026-310 of 24 Apr 2026: legitimate interest assessed from role and link to the entity; request via INPI form (June 2026 notice). A claim that free consultation ended on 1 Oct 2026 and new deadlines start 10 Nov 2026 is from one firm, **[unverified]**. | Not found | No | SIREN | 2026-10-15 |
| LU | LBR **[secondary]**. | Public access suspended Dec 2022; professionals and press (via the Conseil de presse) have access. Law of Jan 2025 in force 1 Feb 2025. Fees **[unverified]**. | Not found | No | RCS number | 2026-10-15 |
| IE | CRO RBO **[secondary]**. | Legitimate-interest access. Revised rules said to apply from 10 Nov 2026 (single source). Fee **[unverified]**. | Annual return shareholder lists are paid CRO documents **[unverified]** | No | CRO number | 2026-10-15 |
| ES | Registro Central de Titularidades Reales, RD 609/2023 **[secondary]**. | Legitimate-interest access; media and AML NGOs presumed. Public view is limited: name, month and year of birth, nationality, nature of the holding, and no percentage for non-presumed applicants. | Registro Mercantil, paid **[unverified]** | No | NIF | 2026-10-15 |
| CH | LETA/LETO register, in force 1 Oct 2026, not public **[secondary]**. | Authorities and certain intermediaries only. | GmbH member lists are public in the cantonal register. AG shareholders are not disclosed. Zefix has a free REST API, but account and terms need checking **[secondary]**. | Zefix JSON | UID | 2026-10-15 |
| JE / GG | Consultations in early 2026 propose legitimate-interest-only access **[secondary]**. Outcome **[unverified]**. | Not public | Jersey and Guernsey public registers hold limited data **[unverified]** | No | Registry no. | 2026-10-15 |

For reference, the UK PSC register stays open and is already used.

## Recommended build order

1. **SEC 13D/G (structured XML), then 20-F Item 7.A.** The only source that is free, documented, rate-limited in a known way and machine-readable. Evidence grade A. Needs `SEC_USER_AGENT` set first. Output is a "candidate holder above 5%" with the filing URL, and the CIK to LEI match is confirmed by a person. Exhibit 21 as a hint only (grade B, no percentages).
2. **NL AFM export (CSV/XML).** Cheapest European source with a download. The weakness is names only, so matching to our entities would be by normalised name, flagged "name match, confirm". Get the AFM's position on reuse first.
3. **FR `info-financiere` bulk.** Open licence and a schema, but first check whether it includes threshold declarations. If not, drop it and do not scrape BDIF.
4. **ESAP, when it is public (target July 2027).** Do not build per-country scrapers for NO, SE and DE. Record issuer-published notices as manual evidence (uploaded document plus reviewer note) until then. Re-check ESAP's scope, API and identifiers in early 2027.
5. **DK CVR API**, only if a firm qualifies for an access category. Needs a request to the Danish Business Authority and a three-year declaration.
6. **Do not build** automated fetches for national UBO registers (NL, DE, FR, LU, IE, ES, CH, SE, FI, NO, JE, GG). Access is restricted by law and gives no bulk route. Support them as a client-supplied extract: upload the document, record the register, date and requester, and let a reviewer sign off. The refresh pack source log already fits that.

## Open checks before building

- Test whether a GLEIF LEI record carries a CIK.
- Confirm in the AMF open-data catalogue whether threshold declarations are in `info-financiere`.
- Ask the AFM about reuse of the export.
- Confirm Oslo Børs terms for NewsWeb before touching any endpoint.
- Re-fetch the 404 and 403 pages (KvK, Transparenzregister, CVR, Brønnøysund beneficial owner page) from a browser.
- Confirm in-force dates for NL, FR, IE and SE rules against official texts.
