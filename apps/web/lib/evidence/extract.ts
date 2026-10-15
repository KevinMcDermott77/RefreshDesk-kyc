import Anthropic from '@anthropic-ai/sdk'
import { EVIDENCE_KIND_LABELS, type EvidenceKind } from './types'
import { parseEvidenceResponse, type ParsedExtraction } from './parse-response'

export const EVIDENCE_MODEL = 'claude-sonnet-4-20250514'
export const EVIDENCE_PROMPT_VERSION = 'ownership-evidence-v1'

const SYSTEM_PROMPT = `You read ownership documents for a regulated UK compliance tool. You extract only what is printed on the document and return ONLY valid JSON, with no text before or after it.
You are a reader, not a researcher: never look anything up, never infer a missing value, never complete a name, never convert share counts into percentages, and never guess.`

function buildUserPrompt(kind: EvidenceKind): string {
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
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

  return { ...parseEvidenceResponse(rawResponse), rawResponse }
}
