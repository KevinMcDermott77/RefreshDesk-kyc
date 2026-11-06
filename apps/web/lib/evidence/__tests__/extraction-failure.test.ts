import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLAUDE_MODEL, DEFAULT_CLAUDE_MODEL } from '@/lib/claude/model'
import {
  classifyExtractionError,
  EXTRACTION_FAILURE_CODES,
  EXTRACTION_FAILURE_TEXT,
  ExtractionFailure,
  extractionFailureNotice,
} from '../extraction-failure'

const create = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create }
  },
}))

describe('classifyExtractionError', () => {
  const sdkError = (status: number, type: string, message = 'x') =>
    Object.assign(new Error(`${status} ${JSON.stringify({ type: 'error', error: { type, message }, request_id: 'req_011ABC' })}`), { status })

  it('a retired model is its own reason, with Anthropic’s request id for the log', () => {
    expect(classifyExtractionError(sdkError(404, 'not_found_error', 'model: claude-sonnet-4-20250514'))).toEqual({
      code: 'model_not_found',
      status: 404,
      requestId: 'req_011ABC',
    })
  })

  it('tells a refused key, a rate limit, an overload, a bad file and any other API error apart', () => {
    expect(classifyExtractionError(sdkError(401, 'authentication_error')).code).toBe('auth')
    expect(classifyExtractionError(sdkError(403, 'permission_error')).code).toBe('auth')
    expect(classifyExtractionError(sdkError(429, 'rate_limit_error')).code).toBe('rate_limited')
    expect(classifyExtractionError(sdkError(529, 'overloaded_error')).code).toBe('overloaded')
    expect(classifyExtractionError(sdkError(400, 'invalid_request_error')).code).toBe('bad_request')
    expect(classifyExtractionError(sdkError(413, 'request_too_large')).code).toBe('bad_request')
    expect(classifyExtractionError(sdkError(500, 'api_error'))).toMatchObject({ code: 'api_error', status: 500 })
  })

  it('uses the SDK’s own request id field when it has one', () => {
    expect(classifyExtractionError(Object.assign(new Error('boom'), { status: 500, requestID: 'req_sdk' })).requestId).toBe('req_sdk')
  })

  it('recognises our own failures, a reply that could not be read, a missing key and a network failure', () => {
    expect(classifyExtractionError(new ExtractionFailure('no_owners'))).toEqual({ code: 'no_owners', status: undefined, requestId: undefined })
    expect(classifyExtractionError(new Error('Claude did not return valid JSON')).code).toBe('unreadable_reply')
    expect(classifyExtractionError(new Error('Failed to parse Claude JSON response')).code).toBe('unreadable_reply')
    expect(classifyExtractionError(new Error('The extraction could not be used: nope')).code).toBe('unreadable_reply')
    expect(classifyExtractionError(new Error('Could not resolve authentication method. Expected the apiKey to be set')).code).toBe('no_api_key')
    expect(classifyExtractionError(new TypeError('fetch failed')).code).toBe('network')
    expect(classifyExtractionError(undefined).code).toBe('api_error')
    expect(classifyExtractionError('weird').code).toBe('api_error')
  })

  it('has a plain sentence for every code, and the notice says the reason', () => {
    for (const code of EXTRACTION_FAILURE_CODES) expect(EXTRACTION_FAILURE_TEXT[code].length).toBeGreaterThan(10)
    expect(extractionFailureNotice('model_not_found')).toContain('no longer available')
    expect(extractionFailureNotice('no_api_key')).toContain('ANTHROPIC_API_KEY')
    expect(extractionFailureNotice('no_owners')).toContain('Enter the owners by hand')
    // An unknown or missing reason still says the document was not read, without inventing a cause.
    expect(extractionFailureNotice('made-up')).toBe('The document was uploaded but Claude did not read it. Enter the owners by hand, or reject this item and try again.')
    expect(extractionFailureNotice(undefined)).not.toContain('Reason:')
  })
})

describe('extractOwnershipEvidence', () => {
  afterEach(() => {
    create.mockReset()
    vi.unstubAllEnvs()
  })

  const reply = (body: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(body) }] })
  const owner = { kind: 'individual', name_as_shown: 'Testperson Alpha', holding: { type: 'percent', value: 100 }, page_ref: 'p.2' }
  const pdf = Buffer.from('%PDF-1.4 test')

  it('says so when the server has no API key, before calling anything', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const { extractOwnershipEvidence } = await import('../extract')
    await expect(extractOwnershipEvidence(pdf, 'application/pdf', 'shareholder_register')).rejects.toMatchObject({ code: 'no_api_key' })
    expect(create).not.toHaveBeenCalled()
  })

  it('asks the configured model, and treats a reply with no usable owner as a failed read, not an empty proposal', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    const { extractOwnershipEvidence, EVIDENCE_MODEL } = await import('../extract')
    create.mockResolvedValueOnce(reply({ owners: [], owners_complete: false, certified: 'unclear' }))
    await expect(extractOwnershipEvidence(pdf, 'application/pdf', 'shareholder_register')).rejects.toMatchObject({ code: 'no_owners' })
    expect(create.mock.calls[0][0].model).toBe(EVIDENCE_MODEL)

    create.mockResolvedValueOnce(reply({ owners: [{ ...owner, page_ref: '' }], owners_complete: true, certified: 'yes' }))
    await expect(extractOwnershipEvidence(pdf, 'application/pdf', 'shareholder_register')).rejects.toMatchObject({ code: 'no_owners' })
  })

  it('returns the proposal, the confidence and the raw reply for a good read', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    const { extractOwnershipEvidence } = await import('../extract')
    create.mockResolvedValueOnce(reply({ owners: [owner], owners_complete: true, as_at: '2026-06-30', certified: 'yes', confidence_score: 0.9 }))
    const result = await extractOwnershipEvidence(pdf, 'application/pdf', 'shareholder_register')
    expect(result.payload.owners[0]).toMatchObject({ name_as_shown: 'Testperson Alpha', initials: 'T.A.' })
    expect(result.confidence).toBeCloseTo(0.9)
    expect(result.rawResponse).toContain('Testperson Alpha')
  })

  it('lets an API error through for the action to classify', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    const { extractOwnershipEvidence } = await import('../extract')
    create.mockRejectedValueOnce(Object.assign(new Error('404 not_found'), { status: 404 }))
    const err = await extractOwnershipEvidence(pdf, 'application/pdf', 'shareholder_register').catch((e: unknown) => e)
    expect(classifyExtractionError(err).code).toBe('model_not_found')
  })
})

describe('the model', () => {
  it('is one shared constant, and not the retired Sonnet 4 id', () => {
    expect(DEFAULT_CLAUDE_MODEL).toBe('claude-sonnet-5-5')
    expect(CLAUDE_MODEL).not.toMatch(/sonnet-4-2025/)
  })

  it('no source file names the retired model id again', () => {
    const roots = ['lib', 'app', 'scripts'].map((d) => path.resolve(__dirname, '../../..', d))
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) {
          if (name !== 'node_modules' && name !== '.next' && name !== '__tests__') walk(full)
        } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') && readFileSync(full, 'utf8').includes('claude-sonnet-4-20250514')) {
          hits.push(path.relative(path.resolve(__dirname, '../../..'), full))
        }
      }
    }
    for (const root of roots) walk(root)
    expect(hits).toEqual([])
  })
})
