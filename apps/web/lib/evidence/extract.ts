import Anthropic from '@anthropic-ai/sdk'
import { EVIDENCE_KIND_LABELS, isConfirmationKind, type EvidenceKind } from './types'
import { CLAUDE_MODEL } from '@/lib/claude/model'
import { ExtractionFailure } from './extraction-failure'
import { parseEvidenceResponse, type ParsedExtraction } from './parse-response'

export const EVIDENCE_MODEL = CLAUDE_MODEL
export const EVIDENCE_PROMPT_VERSION = 'ownership-evidence-v1'

const SYSTEM_PROMPT = `You read ownership documents for a regulated UK compliance tool. You extract only what is printed on the document and return ONLY valid JSON, with no text before or after it.
You are a reader, not a researcher: never look anything up, never infer a missing value, never complete a name, never convert share counts into percentages, and never guess.`

/** For a client's own written confirmation of its ownership: a signed letter, an email or a signed structure chart. */
function buildConfirmationPrompt(kind: EvidenceKind): string {
  return `Document kind: ${EVIDENCE_KIND_LABELS[kind]}

This is the client's own written statement of who owns it. List the owners it states, and describe the document. Return this exact structure:
{
  "owners": [
    {
      "kind": "individual" or "entity",
      "name_as_shown": "verbatim, exactly as written",
      "holding": {"type": "percent", "value": 0} or {"type": "band", "low": 0, "high": 0} or null,
      "registration": {"number": "as written", "country": "two-letter ISO code"} or null,
      "lei_shown": "20-character LEI if written beside the owner" or null,
      "shares": "share count as written" or null,
      "page_ref": "where in the document: page, paragraph or table",
      "uncertain": true or false
    }
  ],
  "owners_complete": true or false,
  "no_other_holder_at_or_above": a number or null,
  "as_at": "yyyy-mm-dd or null",
  "document_date": "yyyy-mm-dd or null",
  "confirmation_date": "yyyy-mm-dd or null",
  "confirmed_by_capacity": "director" or "company_secretary" or "authorised_signatory" or "compliance_officer" or "other" or "unclear",
  "received_as": "signed_letter" or "email" or "signed_chart" or "other",
  "signed": true or false or null,
  "document_title": "title or subject line as written, or null",
  "confidence_score": 0.0,
  "extraction_warnings": ["anything unreadable, ambiguous or missing"]
}

Rules:
- Every owner needs a page_ref. If you cannot say where a row is, leave the row out and add a warning.
- "holding" is only a percentage or band that is WRITTEN. If only share counts are written, set holding to null and put the count in "shares". Never convert counts to percentages.
- "registration" only if a registration number is written next to that owner. "lei_shown" only if an LEI is written beside the owner.
- "owners_complete" is true only if the document states that it lists all shareholders or all holders; otherwise false.
- "no_other_holder_at_or_above": if the document states that no other person holds a percentage "or more" (for example "no other person holds 25% or more of the shares or voting rights"), give that percentage as a number (25). If it says "more than X%", or names no percentage, use null and add a warning.
- "as_at" is the date the holdings are stated for; "document_date" is the date of the document; "confirmation_date" is the date the confirmation was signed or sent (for a letter normally the same as the document date). Use null if not written or not readable.
- "confirmed_by_capacity" is the capacity the signatory writes under their signature, or in the email signature (Director, Company Secretary, Authorised Signatory, Head of Compliance or Compliance Officer); otherwise "unclear". NEVER output the signatory's name, or anyone's contact details.
- "received_as" is "signed_letter" for a letter on letterhead with a signature, "email" for an email (or a print of one), "signed_chart" for a structure chart that is signed, otherwise "other". "signed" is true only if a signature is visible; a "[signature]" placeholder or an empty signature line is false.
- A client's confirmation is nobody's certification: do not output any certification fields.
- Do not output dates of birth, nationality, residence, occupation or addresses of individuals.
- Set "uncertain" to true on any row where you were reading poor print or guessing a field.`
}

function buildUserPrompt(kind: EvidenceKind): string {
  if (isConfirmationKind(kind)) return buildConfirmationPrompt(kind)
  return `Document kind: ${EVIDENCE_KIND_LABELS[kind]}

List the shareholders / owners shown, and describe the document. Return this exact structure:
{
  "owners": [
    {
      "kind": "individual" or "entity",
      "name_as_shown": "verbatim, exactly as printed",
      "holding": {"type": "percent", "value": 0} or {"type": "band", "low": 0, "high": 0} or null,
      "registration": {"number": "as printed", "country": "two-letter ISO code"} or null,
      "lei_shown": "20-character LEI if printed beside the owner" or null,
      "shares": "share count as printed" or null,
      "page_ref": "page number and table or section the row is on",
      "uncertain": true or false
    }
  ],
  "owners_complete": true or false,
  "as_at": "yyyy-mm-dd or null",
  "document_date": "yyyy-mm-dd or null",
  "certified": "yes" or "no" or "unclear",
  "certified_by": "who certified it, as printed, or null",
  "certifier_capacity": "notary" or "lawyer" or "accountant" or "company_officer" or "other" or "unclear",
  "certification_date": "yyyy-mm-dd or null",
  "document_title": "title as printed or null",
  "signed": true or false or null,
  "confidence_score": 0.0,
  "extraction_warnings": ["anything unreadable, ambiguous or missing"]
}

Rules:
- Every owner needs a page_ref. If you cannot say where a row is, leave the row out and add a warning.
- "holding" is only a percentage or band that is PRINTED. If only share counts are printed, set holding to null and put the count in "shares".
- "registration" only if a registration number is printed next to that owner; "country" is where that register is, if the document says; otherwise set registration to null. Do not copy the company's own number onto its owners.
- "lei_shown" only if an LEI is printed beside the owner.
- "owners_complete" is true only if the document itself states that it lists all shareholders or all holders; otherwise false.
- "as_at" is the date the holdings are stated for; "document_date" is the date of the document itself. Use null if not printed or not readable.
- "certified" is "yes" only if a certification statement, stamp or signature is visible (for example a company secretary, notary, auditor or registrar certifying the copy or the contents); "no" if the document shows none; "unclear" if you cannot tell.
- "certifier_capacity" is the capacity the certifier signs in, only if it is printed (for example "Notary Public", "Solicitor", "Chartered Accountant", "Company Secretary", "Director"); "company_officer" covers a secretary or director of the company; otherwise "unclear". "certification_date" is the date written on the certification itself, not the date of the document; null if none.
- Do not output dates of birth, nationality, residence, occupation or addresses of individuals.
- Set "uncertain" to true on any row where you were reading poor print or guessing a field.`
}

type ImageMediaType = 'image/jpeg' | 'image/png'

function contentBlock(bytes: Buffer, mimeType: string): Anthropic.DocumentBlockParam | Anthropic.ImageBlockParam {
  const data = bytes.toString('base64')
  if (mimeType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
  }
  return { type: 'image', source: { type: 'base64', media_type: mimeType as ImageMediaType, data } }
}

export type EvidenceExtraction = ParsedExtraction & { rawResponse: string }

/** Sends the document to Claude and returns a proposal. The caller must have checked the firm allows extraction. */
export async function extractOwnershipEvidence(bytes: Buffer, mimeType: string, kind: EvidenceKind): Promise<EvidenceExtraction> {
  // Created here, not at import, so reading the parser in tests needs no API key.
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) throw new ExtractionFailure('no_api_key')
  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model: EVIDENCE_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [contentBlock(bytes, mimeType), { type: 'text', text: buildUserPrompt(kind) }] }],
  })

  const rawResponse = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')

  const parsed = parseEvidenceResponse(rawResponse, undefined, kind)
  // A reply with no usable owner is a failed read, not an empty proposal for someone to confirm.
  if (parsed.payload.owners.length === 0) throw new ExtractionFailure('no_owners')
  return { ...parsed, rawResponse }
}
