import { describe, expect, it } from 'vitest'
import { buildStoragePath } from '@/lib/supabase/storage-path'
import { FORBIDDEN_PAYLOAD_FIELDS, matchesMimeType, parseFetchInput, uploadBelongsTo } from '../fetch-input'

const CLIENT = '3f2c1d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
const FIRM = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const DOC = '11111111-2222-4333-8444-555555555555'
const PATH = `${FIRM}/${CLIENT}/${DOC}/certificate.pdf`

function form(fields: Record<string, string | Blob>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

describe('parseFetchInput', () => {
  it('accepts a client and a company number: 00185647 (J Sainsbury plc)', () => {
    const parsed = parseFetchInput(form({ client_id: CLIENT, company_number: '00185647' }))
    expect(parsed).toEqual({ ok: true, input: { clientId: CLIENT, companyNumber: '00185647', upload: null } })
  })

  it('upper-cases and trims the company number', () => {
    expect(parseFetchInput(form({ client_id: CLIENT, company_number: ' sc123456 ' }))).toMatchObject({ ok: true, input: { companyNumber: 'SC123456' } })
  })

  it('what the browser posts for 00185647 is tiny, nowhere near the 1 MB Server Action limit', async () => {
    const body = form({ client_id: CLIENT, company_number: '00185647' })
    const bytes = (await new Response(body).arrayBuffer()).byteLength
    expect(bytes).toBeLessThan(2 * 1024)
    expect(bytes).toBeLessThan(1024 * 1024)
  })

  it('refuses fetched Companies House data posted from the browser, whatever the field', () => {
    for (const field of FORBIDDEN_PAYLOAD_FIELDS) {
      const parsed = parseFetchInput(form({ client_id: CLIENT, company_number: '00185647', [field]: '{"items": []}' }))
      expect(parsed, field).toMatchObject({ ok: false, error: expect.stringContaining('fetches Companies House data itself') })
    }
  })

  it('refuses a raw payload even when it is huge, before looking at anything else', () => {
    const huge = JSON.stringify({ items: Array.from({ length: 40_000 }, (_, i) => ({ name: `Officer ${i}`, role: 'director' })) })
    expect(huge.length).toBeGreaterThan(1024 * 1024)
    const parsed = parseFetchInput(form({ client_id: 'not-even-a-uuid', officers: huge }))
    expect(parsed).toMatchObject({ ok: false, error: expect.stringContaining('fetches Companies House data itself') })
  })

  it('ignores fields it does not know', () => {
    const parsed = parseFetchInput(form({ client_id: CLIENT, company_number: '00185647', whatever: 'x'.repeat(5000), fetched_at: 'now' }))
    expect(parsed).toEqual({ ok: true, input: { clientId: CLIENT, companyNumber: '00185647', upload: null } })
  })

  it('refuses a file body, which would hit the 1 MB limit; an empty file part is just ignored', () => {
    const big = new File([new Uint8Array(2 * 1024 * 1024)], 'certificate.pdf', { type: 'application/pdf' })
    expect(parseFetchInput(form({ client_id: CLIENT, file: big }))).toMatchObject({ ok: false, error: expect.stringContaining('Upload the document to storage first') })

    const empty = new File([], '', { type: 'application/octet-stream' })
    expect(parseFetchInput(form({ client_id: CLIENT, company_number: '00185647', file: empty }))).toMatchObject({ ok: true })
  })

  it('needs a valid client, and a number or an upload', () => {
    expect(parseFetchInput(form({ company_number: '00185647' }))).toMatchObject({ ok: false, error: 'Missing client ID' })
    expect(parseFetchInput(form({ client_id: 'x', company_number: '00185647' }))).toMatchObject({ ok: false, error: 'Missing client ID' })
    expect(parseFetchInput(form({ client_id: CLIENT }))).toMatchObject({ ok: false, error: expect.stringContaining('Enter a company number') })
    expect(parseFetchInput(form({ client_id: CLIENT, company_number: '1234' }))).toMatchObject({ ok: false, error: expect.stringContaining('Company number must be') })
  })

  describe('with an uploaded document', () => {
    const upload = { upload_path: PATH, upload_name: 'certificate.pdf', upload_type: 'application/pdf', upload_size: '734003' }

    it('accepts the path and details of a document already in storage', () => {
      expect(parseFetchInput(form({ client_id: CLIENT, ...upload }))).toEqual({
        ok: true,
        input: { clientId: CLIENT, companyNumber: '', upload: { path: PATH, name: 'certificate.pdf', size: 734003, type: 'application/pdf' } },
      })
    })

    it('lets a company number win over an upload', () => {
      expect(parseFetchInput(form({ client_id: CLIENT, company_number: '00185647', ...upload }))).toMatchObject({ ok: true, input: { upload: null, companyNumber: '00185647' } })
    })

    it('rejects a bad path, type or size', () => {
      expect(parseFetchInput(form({ client_id: CLIENT, ...upload, upload_path: '../../etc/passwd' }))).toMatchObject({ ok: false, error: expect.stringContaining('path') })
      expect(parseFetchInput(form({ client_id: CLIENT, ...upload, upload_path: `${FIRM}/${CLIENT}/${DOC}/a/b.pdf` }))).toMatchObject({ ok: false })
      expect(parseFetchInput(form({ client_id: CLIENT, ...upload, upload_type: 'text/html' }))).toMatchObject({ ok: false, error: 'File must be PDF, JPEG, or PNG' })
      expect(parseFetchInput(form({ client_id: CLIENT, ...upload, upload_size: '0' }))).toMatchObject({ ok: false })
      expect(parseFetchInput(form({ client_id: CLIENT, ...upload, upload_size: String(11 * 1024 * 1024) }))).toMatchObject({ ok: false, error: 'File exceeds 10 MB limit' })
      expect(parseFetchInput(form({ client_id: CLIENT, ...upload, upload_name: '' }))).toMatchObject({ ok: false })
    })
  })
})

describe('uploadBelongsTo', () => {
  it('accepts only this firm\'s and this client\'s folder', () => {
    expect(uploadBelongsTo(PATH, FIRM, CLIENT)).toBe(true)
    expect(uploadBelongsTo(PATH, FIRM.toUpperCase(), CLIENT)).toBe(true)
    expect(uploadBelongsTo(PATH, '00000000-0000-4000-8000-000000000000', CLIENT)).toBe(false)
    expect(uploadBelongsTo(PATH, FIRM, '00000000-0000-4000-8000-000000000000')).toBe(false)
    expect(uploadBelongsTo('nonsense', FIRM, CLIENT)).toBe(false)
  })

  it('accepts what buildStoragePath produces, however odd the file name', () => {
    expect(uploadBelongsTo(buildStoragePath(FIRM, CLIENT, DOC, 'Certificate of Incorporation (final).pdf'), FIRM, CLIENT)).toBe(true)
  })
})

describe('matchesMimeType', () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0])

  it('checks the file\'s own signature, not the browser\'s claim', () => {
    expect(matchesMimeType(bytes(0x25, 0x50, 0x44, 0x46), 'application/pdf')).toBe(true)
    expect(matchesMimeType(bytes(0x89, 0x50, 0x4e, 0x47), 'image/png')).toBe(true)
    expect(matchesMimeType(bytes(0xff, 0xd8, 0xff), 'image/jpeg')).toBe(true)
    expect(matchesMimeType(bytes(0x4d, 0x5a), 'application/pdf')).toBe(false)
    expect(matchesMimeType(bytes(0x25, 0x50, 0x44, 0x46), 'image/png')).toBe(false)
    expect(matchesMimeType(new Uint8Array(), 'application/pdf')).toBe(false)
    expect(matchesMimeType(bytes(0x25, 0x50, 0x44, 0x46), 'text/html')).toBe(false)
  })
})

describe('buildStoragePath', () => {
  it('replaces unsafe characters in the file name', () => {
    expect(buildStoragePath('f', 'c', 'd', 'a b/c?.pdf')).toBe('f/c/d/a_b_c_.pdf')
  })
})
