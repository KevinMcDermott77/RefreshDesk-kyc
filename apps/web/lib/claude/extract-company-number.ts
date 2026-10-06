import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-4-20250514'
export const PROMPT_VERSION = 'v1.0-entity'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are a KYC document extraction assistant for a regulated UK compliance tool.
Extract the company registration number from the attached document.
Return ONLY valid JSON. Do not include any text before or after the JSON object.`

const USER_PROMPT = `The document may be a certificate of incorporation, confirmation statement,
annual return, annual report, or other Companies House filing.

Return ONLY valid JSON:
{
  "company_number": "string or null",
  "confidence_score": 0.0,
  "document_type_detected": "certificate_of_incorporation | confirmation_statement | annual_return | annual_report | other",
  "extraction_warnings": ["list any issues"]
}

UK company numbers are 8 characters: either 8 digits (e.g. 12345678)
or 2 letters followed by 6 digits (e.g. SC123456, NI123456).
Do not invent a company number. If not found, return null.`

type ImageMediaType = 'image/jpeg' | 'image/png'

function buildContentBlock(
  fileBuffer: Buffer,
  mimeType: string,
): Anthropic.DocumentBlockParam | Anthropic.ImageBlockParam {
  const base64 = fileBuffer.toString('base64')

  if (mimeType === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64 },
    }
  }

  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mimeType as ImageMediaType,
      data: base64,
    },
  }
}

export type CompanyNumberExtraction = {
  company_number: string | null
  confidence_score: number
  document_type_detected: string
  extraction_warnings: string[]
}

export type CompanyNumberExtractionOutput = {
  result: CompanyNumberExtraction
  rawResponse: string
}

export async function extractCompanyNumber(
  fileBuffer: Buffer,
  mimeType: string,
): Promise<CompanyNumberExtractionOutput> {
  const contentBlock = buildContentBlock(fileBuffer, mimeType)

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [contentBlock, { type: 'text', text: USER_PROMPT }],
      },
    ],
  })

  const rawResponse = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')

  return { result: parseResponse(rawResponse), rawResponse }
}

function parseResponse(raw: string): CompanyNumberExtraction {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('Claude did not return valid JSON')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    throw new Error('Failed to parse Claude JSON response')
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Unexpected response shape from Claude')
  }

  const obj = parsed as Record<string, unknown>

  return {
    company_number: typeof obj.company_number === 'string' ? obj.company_number : null,
    confidence_score:
      typeof obj.confidence_score === 'number'
        ? Math.min(1, Math.max(0, obj.confidence_score))
        : 0,
    document_type_detected:
      typeof obj.document_type_detected === 'string' ? obj.document_type_detected : 'other',
    extraction_warnings: Array.isArray(obj.extraction_warnings)
      ? (obj.extraction_warnings as string[])
      : [],
  }
}
