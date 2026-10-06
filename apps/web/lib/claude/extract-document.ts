import Anthropic from '@anthropic-ai/sdk'
import type { DocumentType, ExtractionResult } from '@/lib/types/documents'

const MODEL = 'claude-sonnet-4-20250514'
export const PROMPT_VERSION = 'v1.0'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are a KYC document extraction assistant for a regulated UK compliance tool.
Extract structured fields from the attached document and return ONLY valid JSON.
Do not include any text before or after the JSON object.`

function buildUserPrompt(documentType: DocumentType): string {
  return `Document type: ${documentType}

Return this exact structure:
{
  "document_type": "${documentType}",
  "fields": {
    ${getFieldsComment(documentType)}
  },
  "confidence_score": 0.0,
  "confidence_notes": "brief explanation of any uncertainty",
  "extraction_warnings": ["list any issues, missing fields, or quality concerns"]
}

If a field cannot be read clearly, set it to null and note it in extraction_warnings.
Do not invent or guess field values. Accuracy is more important than completeness.`
}

function getFieldsComment(documentType: DocumentType): string {
  switch (documentType) {
    case 'passport':
      return '"full_name": null, "date_of_birth": null, "nationality": null, "passport_number": null, "expiry_date": null, "issuing_country": null'
    case 'proof_of_address':
      return '"full_name": null, "address_line_1": null, "address_line_2": null, "city": null, "postcode": null, "document_date": null, "issuing_organisation": null'
    case 'incorporation':
      return '"company_name": null, "company_number": null, "incorporation_date": null, "registered_address": null, "directors": []'
    case 'source_of_funds':
      return '"description": null, "amount_or_range": null, "supporting_evidence": null'
    case 'filing':
      throw new Error('Filing documents are not extracted — they are saved as source documents')
  }
}

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

export type ExtractionOutput = {
  result: ExtractionResult
  rawResponse: string
}

export async function extractDocument(
  fileBuffer: Buffer,
  mimeType: string,
  documentType: DocumentType,
): Promise<ExtractionOutput> {
  const contentBlock = buildContentBlock(fileBuffer, mimeType)

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          contentBlock,
          { type: 'text', text: buildUserPrompt(documentType) },
        ],
      },
    ],
  })

  const rawResponse = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')

  const parsed = parseExtractionResponse(rawResponse, documentType)

  return { result: parsed, rawResponse }
}

function parseExtractionResponse(
  raw: string,
  documentType: DocumentType,
): ExtractionResult {
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
    document_type: documentType,
    fields: (obj.fields as Record<string, unknown>) ?? {},
    confidence_score:
      typeof obj.confidence_score === 'number'
        ? Math.min(1, Math.max(0, obj.confidence_score))
        : 0,
    confidence_notes:
      typeof obj.confidence_notes === 'string' ? obj.confidence_notes : '',
    extraction_warnings: Array.isArray(obj.extraction_warnings)
      ? (obj.extraction_warnings as string[])
      : [],
  }
}
