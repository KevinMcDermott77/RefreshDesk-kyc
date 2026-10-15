# Slice 8: verify digital signatures on evidence PDFs (spec)

Status: draft for review. **No code yet.** Written 2026-10-16. Builds on [slice7-client-evidence.md](slice7-client-evidence.md).
Do this after the Slice 7 browser test passes and 7e and 7f are applied.

## Why

A client's written confirmation of ownership is often not a scan but an e-signed PDF (DocuSign, Adobe Sign and similar). Those carry a
cryptographic signature that can tell us three things a human reading the page cannot: the document is the one that was signed, it has not
been edited since, and who vouches for the certificate. Today the reviewer sees none of that. This slice reads the signature, shows the
result, and carries it through to the node and the refresh pack.

It does **not** decide who the signatory is, check their authority, or replace the reviewer: the written confirmation is still confirmed by
a different admin, as now.

## What we report, per signature

| Field | Meaning | Notes |
|---|---|---|
| `integrity` | The signed bytes still hash to what the signature covers, and the signature is a valid signature of that hash. | `intact` or `broken`. |
| `modifiedAfterSigning` | Yes/no: the file was changed after this signature in a way the signature does not allow. | From the library's revision analysis. Allowed later updates (another signature, a timestamp, validation data for long-term validity) are **not** "modified". Detail kept: `none`, `permitted_updates`, `other_changes`, `not_covered` (bytes appended that the signature does not cover). |
| `signingTime` and `signingTimeSource` | When it was signed. | `timestamp` (a trusted timestamp token inside the signature) or `claimed` (the signer's own clock: shown as "claimed"). |
| `issuer` | The organisation that issued the signing certificate. | The certificate's **issuer**, never its subject. See privacy below. |
| `chain` | `trusted`, `untrusted_root`, `self_signed`, `incomplete`, `expired`, `revoked` or `revocation_unknown`. | Against our trust roots only. |
| `coversWholeDocument` | The signature covers every byte up to the end of the file. | Together with `modifiedAfterSigning`, this is what "altered" rests on. |
| `isTestCertificate` | The issuer is our SAMPLE test CA. | Lets the demo say "test certificate". Never true for a real signature. |

The file-level result is one `status`:

| Status | Shown as |
|---|---|
| `not_signed` | No digital signature. |
| `valid_trusted` | Signed: valid, not changed since signing, certificate issued by *issuer*, trusted. |
| `valid_untrusted` | Signed, not changed since signing, but the certificate is not trusted (issuer shown, or "test certificate" for ours). |
| `altered` | Signed, but the document was changed after signing (or the signed bytes no longer match). **Do not rely on it.** |
| `invalid` | The signature does not verify at all (wrong key, corrupt, unsupported algorithm). |
| `unreadable` | The PDF could not be read for signatures (encrypted, malformed, too large). Says so; never "not signed". |

`verified` (the flag that travels with the evidence) is true only for `valid_trusted`: valid, unmodified, trusted chain, certificate in date at
the signing time. Everything else is `verified = false` with the status saying why.

### Privacy

- **The signer's name, e-mail and any contact details are never read into our data, stored, logged or shown.** The verifier extracts only the
  fields above. It does not return the certificate subject, the signature dictionary's `/Name`, `/ContactInfo`, `/Reason` or `/Location`, or the
  signer's attributes. What we display is "signed by a certificate issued by *<issuer>*".
- **Self-signed certificates.** Their issuer *is* their subject, which can be a person's name. For `self_signed` we show "self-signed
  certificate" and store no issuer text.
- Issuer text is cut to the organisation (`O`, else `CN`) and length-limited.

### What a signature does and does not prove

Cloud signing services (DocuSign, Adobe Sign) typically seal the finished PDF with **one** signature by the service, and record who signed in
a separate audit trail ("certificate of completion"). So "valid, trusted, issued by <service>" shows the document has not changed since the
service sealed it; **it does not by itself show who signed or that they had authority.** The page says so, and the reviewer checks the audit
trail. *(From general knowledge of how those services work: to be confirmed with a real, scrubbed sample from the user before the wording is final.)*

## Library recommendation

**Recommendation: pyHanko, in a stateless endpoint of the kyc-search Python backend.**

| Option | For | Against |
|---|---|---|
| **pyHanko** (Python, MIT) | The only mature open-source library that covers everything asked: signature integrity, **revision/modification analysis**, certificate chain against trust roots we supply, timestamps, long-term validation data, PAdES and Adobe-style signatures. Actively released (0.37.0 on 2026-08-31; needs Python 3.10+, kyc-search runs 3.12). Same language as the service we already have. | Another Python dependency set (`asn1crypto`, `pyhanko-certvalidator`, `cryptography`, `aiohttp`, `lxml`, `fonttools`, `uharfbuzz`, `Pillow`, `qrcode`, `python-pkcs11`: the signing and stamping parts come along). Its own docs warn that the modification judgements are "risky and ill-defined", so "altered" is a strong warning, not a legal finding. |
| **Node: do it ourselves** (`pkijs` or `node-forge` plus our own PDF byte-range and revision parser) | No new service. | We would be writing the hard part ourselves: incremental-update analysis, chain building, timestamps. A bug here fails open (a forged-looking document shown as fine). Not recommended for a control that people rely on. |
| **Node: `@jonz94/verify-pdf`** | Drop-in. | Last published 2022-09, `node-forge ^0.10`; reports integrity only. Its sibling `node-pdf-verifier` says outright that the certificate is not verified. No trust chain, no revision analysis. Not fit for this. |
| **Poppler `pdfsig`** (command-line, via a child process) | Real validation, battle-tested C++. | A system binary to ship and keep patched; text output to parse; trust roots are an NSS database; weaker modification detail. A reasonable fallback, not the first choice. |
| **EU DSS** (Java) | The reference implementation for EU qualified signatures, with the EU Trusted List built in. | A Java service just for this; heavy to run and operate. Worth revisiting only if EU qualified-signature validation becomes a requirement. |
| **Commercial APIs** (Aspose, Adobe, a DocuSign verification service) | Maintained for us. | Client documents (with shareholders' names) go to a third party; cost; we would still need our own trust policy. |

**Where to host it**
- **kyc-search (recommended to start).** It already has authentication (`fetchAuthToken`), a deployment, Python 3.12 and `cryptography`. The endpoint is stateless: bytes in, JSON out.
  Trade-off: kyc-search is a company-data service with its own database; we are asking it to parse client documents. Mitigated by the rules below.
- **A separate tiny FastAPI service.** Cleaner separation (client documents never reach the company-data service) at the cost of another deployment and its own auth. Same code; we can move it later because the contract is plain HTTP.

**Rules for the endpoint** (they matter because the input is an untrusted PDF):
- Stateless: nothing written to disk or the database, no document content or names in logs (only size, status, duration, request id).
- Limits: 10 MB, a wall-clock timeout (about 20 s), a memory limit, one document per call.
- **No outbound network from the verifier.** Revocation checking normally fetches OCSP/CRL URLs *named inside the certificate*: an attacker-chosen URL is a server-side request forgery. Default: offline only, using revocation data embedded in the PDF if any; otherwise `revocation_unknown`. (`allow_fetching` is the ValidationContext switch as I understand it: **to be confirmed in the spike**.)
- Encrypted or malformed PDFs return `unreadable`, never an error that looks like "not signed".

## Trust

- **Roots we trust** are a configured bundle, not the operating system's web CA list (document-signing roots are different from TLS roots):
  1. the **EU Trusted List** qualified CA certificates (public, free; built from the EU list of trusted lists);
  2. **Adobe's approved trust list (AATL)**, which is what Acrobat itself trusts by default and which covers DocuSign and Adobe Sign. **Its licence terms for use by other software must be checked before we ship it**: unverified;
  3. roots a firm adds itself (a settings list, off by default).
- Our SAMPLE **test root is never in the bundle**, so the demo documents show "signed — test certificate, not trusted". A development-only environment variable can add it to show the trusted state; it is never set in production and the endpoint refuses it unless `ENV` is not production.
- A signature by a trusted CA but outside the certificate's validity period at the signing time is `expired`, not `trusted`.
- Signing time: a signature timestamp token is trusted; the signer's own claimed time is shown as "claimed" and is never used to decide whether the certificate was in date.

## Contract

`POST /evidence/signatures` on kyc-search (multipart: `file`). Returns:

```json
{
  "status": "valid_untrusted",
  "verified": false,
  "signatures": [
    {
      "integrity": "intact",
      "modifiedAfterSigning": false,
      "modification": "none",
      "coversWholeDocument": true,
      "signingTime": "2026-07-16T09:12:44Z",
      "signingTimeSource": "claimed",
      "issuer": "RefreshDesk SAMPLE Test CA",
      "chain": "untrusted_root",
      "isTestCertificate": true
    }
  ],
  "checkedAt": "2026-10-16T12:00:00Z",
  "library": "pyhanko 0.37.0"
}
```

No subject, no names. If there are several signatures, `status` is the worst of them (`altered`/`invalid` > `valid_untrusted` > `valid_trusted`) and `verified` needs all of them to be trusted and intact.

## What changes in the app

**received_as.** `e_signed` joins `signed_letter`, `email`, `signed_chart` and `other`. The upload step runs the check; if the file has a signature, the editor opens with "Received as: E-signed" selected (the reviewer can change it) and the result beside it. App-level only: the database check does not validate `received_as`.

**Where the check runs and where it is kept.**
1. On upload (the server action already downloads and sniffs the bytes): call the endpoint, keep the result.
2. **Again when an admin confirms**, on the stored file, so the confirmed record carries a fresh result and the reviewer sees what the server sees now, not what a browser sent.
3. Stored on the item as `signature_check jsonb` (new column, written by a new RPC `record_signature_check(evidence_id, result)` for the uploader; the confirm RPC takes the re-run result and puts `signature_verified` and the summary into the confirmed payload, so it is frozen with the confirmation and hashed in the audit event).
   *Limit, as for the rest of the evidence:* a user who calls the RPC directly could write any result. The controls are the re-run at confirmation and the audit hash; closing it fully would need a signed result like the pack offers (an HMAC the database cannot check). Noted, not solved.
4. **Migration (new, after 7f):** the `signature_check` column, the RPC, the confirm RPC extended, SQL tests, one dry-run command, as before. Nothing is written until you approve this spec.

**Using it in the walk.** An e-signed confirmation is still a written confirmation (no certification, same age rule). New:
- `altered` or `invalid` blocks resolution (`CLIENT_EVIDENCE_SIGNATURE_ALTERED`): the text the reviewer and Claude read is not what was signed. An admin may confirm anyway with a note: a new override reason `signature`, same rules as `stale`.
- `valid_untrusted` does **not** block: an untrusted signature adds no assurance but is not a warning. It is shown.
- Policy `requireVerifiedESignature` (default **false**): when true, an `e_signed` confirmation that is not `verified` stays partial (`CLIENT_EVIDENCE_SIGNATURE_NOT_VERIFIED`). For firms that want to accept only a signature they can trust.

**Where it is shown** (all say "signed by a certificate issued by <issuer>", never a name):
- **Confirm page**, a "Digital signature" box above the editor with the status chip, signing time (and whether it is claimed), issuer, trusted or not, "changed after signing: yes/no", and the line about what a signature does not prove. `altered` is a red block and the Confirm button asks for the override note.
- **Node panel** and chart badge: "e-signed: valid, unchanged, signed 2026-07-16, issuer … (trusted / not trusted)".
- **Pack evidence block**: `signatureStatus`, `signatureVerified`, `signingTime`, `issuer`, `modifiedAfterSigning`. No subject, no names, covered by the fingerprint.
- Evidence queue and `read_only` overview: the status only.

## SAMPLE documents

A generator, `scripts/make-signed-samples.py` (needs `pip install pyhanko`, run by hand; the PDFs are committed, the generator is not part of the app):
1. **`SAMPLE-ownership-confirmation-signed.pdf`**: the existing SAMPLE letter, signed with a **self-signed TEST certificate** created for the run (a fresh throwaway key each time; only the certificate is embedded, the private key is discarded, nothing secret is committed). Issuer "RefreshDesk SAMPLE Test CA", subject "SAMPLE Test Signer (not a real person)". The demo shows: **"Signed — test certificate, not trusted."**
2. **`SAMPLE-ownership-confirmation-signed-altered.pdf`**: the same signed file with a later **incremental edit** (a changed holding), so the signature bytes are intact but the content differs. The demo shows the **"changed after signing"** warning and the blocked resolution.
3. Optionally a third with bytes changed inside the signed range, to show `invalid`.
4. The existing unsigned letter stays, for "No digital signature".

Fixtures are fictional and stamped SAMPLE, as before.

## Tests

- **Service (pytest, with the generated fixtures):** unsigned; valid with an untrusted test root; the same with the test root trusted (dev flag, in the test only); altered by incremental edit; bytes changed in the signed range; two signatures with a later permitted update; expired certificate; self-signed (no issuer text returned); encrypted PDF; truncated PDF; over the size limit; and a certificate whose OCSP URL points at a local server (asserting **no request is made**).
- **No names:** every fixture has a person-looking subject, `/Name`, `/ContactInfo` and `/Reason`; assert none of those strings appears anywhere in the response.
- **App (vitest):** status mapping and wording; the editor preselects `e_signed`; `altered` blocks and needs the override note; `requireVerifiedESignature` on and off; the summary, node data and pack block carry the fields and no subject; the pack fingerprint changes if the result changes.
- **SQL:** the new column and RPC by role (member uploads, read_only cannot), the confirm RPC freezing the result, the audit hash, the names-free overview.
- **Manual:** the demo with the three SAMPLE files, then one real DocuSign and one real Adobe Sign document from you (scrubbed), to settle the trust bundle and the "what it proves" wording.

## Build order

1. **8a** the service endpoint, fixtures generator and pytest (no app change).
2. **8b** the migration, RPC and SQL tests (needs your approval of this spec first; one dry-run command).
3. **8c** app wiring: upload and confirm-time checks, `e_signed`, the walk rules and policy.
4. **8d** UI (confirm page, node, pack) and the SAMPLE walkthrough.

## Decisions for you

1. **Hosting:** kyc-search (recommended), or a separate small service so client documents never reach it?
2. **Trust roots:** EU Trusted List plus AATL, with the AATL licence checked first? Or EU list only to start, and add AATL once cleared?
3. **Revocation:** offline only (recommended: no SSRF, but many signatures will say `revocation_unknown`), or online fetching behind an allow-list proxy?
4. **`altered` / `invalid`:** block resolution unless an admin overrides with a note (recommended), or warn only?
5. **`requireVerifiedESignature`:** default off (recommended), so an untrusted but unchanged signature does not stop a branch.
6. **Real samples:** can you provide one scrubbed DocuSign and one Adobe Sign PDF, so the trust bundle and the wording are tested on real signatures before 8d?
