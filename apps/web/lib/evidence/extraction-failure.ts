/**
 * Why a document extraction failed, in a form the page can show and the server can log. Nothing here holds
 * the document or the model's reply: only a code, an HTTP status and Anthropic's request id.
 */

export const EXTRACTION_FAILURE_CODES = [
  'no_api_key',
  'model_not_found',
  'auth',
  'rate_limited',
  'overloaded',
  'bad_request',
  'network',
  'api_error',
  'unreadable_reply',
  'no_owners',
  'save_failed',
] as const
export type ExtractionFailureCode = (typeof EXTRACTION_FAILURE_CODES)[number]

export const EXTRACTION_FAILURE_TEXT: Record<ExtractionFailureCode, string> = {
  no_api_key: 'the server has no ANTHROPIC_API_KEY set',
  model_not_found: 'the AI model this app is set to use is no longer available (a configuration problem, not your document)',
  auth: 'the Anthropic API key was refused',
  rate_limited: 'Anthropic is rate-limiting requests: try again in a minute',
  overloaded: 'Anthropic is overloaded: try again shortly',
  bad_request: 'Anthropic could not accept this file (it may be too large or an unsupported PDF)',
  network: 'the server could not reach Anthropic',
  api_error: 'Anthropic returned an error',
  unreadable_reply: "Claude's reply could not be turned into a list of owners",
  no_owners: 'Claude found no shareholders in the document',
  save_failed: 'the proposal could not be saved',
}

export class ExtractionFailure extends Error {
  constructor(
    readonly code: ExtractionFailureCode,
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(EXTRACTION_FAILURE_TEXT[code])
    this.name = 'ExtractionFailure'
  }
}

export type ClassifiedFailure = { code: ExtractionFailureCode; status?: number; requestId?: string }

function requestIdOf(err: { requestID?: unknown; request_id?: unknown; message?: unknown }): string | undefined {
  for (const value of [err.requestID, err.request_id]) if (typeof value === 'string' && value) return value
  const match = /"request_id"\s*:\s*"(req_[A-Za-z0-9]+)"/.exec(String(err.message ?? ''))
  return match?.[1]
}

/** Maps whatever was thrown (our own failure, an Anthropic SDK error, a parser error) to a code. */
export function classifyExtractionError(err: unknown): ClassifiedFailure {
  if (err instanceof ExtractionFailure) return { code: err.code, status: err.status, requestId: err.requestId }
  const e = (err ?? {}) as { status?: unknown; message?: unknown; name?: unknown; error?: { error?: { type?: unknown } } }
  const status = typeof e.status === 'number' ? e.status : undefined
  const message = String(e.message ?? '')
  const requestId = requestIdOf(e)
  const apiType = typeof e.error?.error?.type === 'string' ? e.error.error.type : /"type"\s*:\s*"([a-z_]+_error)"/.exec(message)?.[1]

  if (/api ?key/i.test(message) && !status) return { code: 'no_api_key' }
  if (status === 404 || apiType === 'not_found_error') return { code: 'model_not_found', status, requestId }
  if (status === 401 || status === 403) return { code: 'auth', status, requestId }
  if (status === 429) return { code: 'rate_limited', status, requestId }
  if (status === 529 || apiType === 'overloaded_error') return { code: 'overloaded', status, requestId }
  if (status === 400 || status === 413 || apiType === 'invalid_request_error') return { code: 'bad_request', status, requestId }
  if (typeof status === 'number') return { code: 'api_error', status, requestId }
  if (/valid JSON|parse Claude|response shape|could not be used/i.test(message)) return { code: 'unreadable_reply' }
  if (/connection|fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|timed? ?out|network/i.test(`${message} ${String(e.name ?? '')}`)) return { code: 'network' }
  return { code: 'api_error' }
}

/** The sentence the item page shows. */
export function extractionFailureNotice(code: string | undefined): string {
  const why = EXTRACTION_FAILURE_CODES.includes(code as ExtractionFailureCode) ? EXTRACTION_FAILURE_TEXT[code as ExtractionFailureCode] : undefined
  const reason = why ? ` Reason: ${why}.` : ''
  return `The document was uploaded but Claude did not read it.${reason} Enter the owners by hand, or reject this item and try again.`
}
