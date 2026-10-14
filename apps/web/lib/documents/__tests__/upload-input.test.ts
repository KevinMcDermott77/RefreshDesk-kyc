import { describe, expect, it } from 'vitest'
import { parseDocumentUploadInput } from '../upload-input'

const CLIENT = '3f2c1d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
const FIRM = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const DOC = '11111111-2222-4333-8444-555555555555'
const PATH = `${FIRM}/${CLIENT}/${DOC}/passport.pdf`

function form(fields: Record<string, string | Blob>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const valid = {
  client_id: CLIENT,
  document_type: 'passport',
  upload_path: PATH,
  upload_name: 'passport.pdf',
  upload_type: 'application/pdf',
  upload_size: '3145728',
}

describe('parseDocumentUploadInput', () => {
  it('accepts a client, a document type and the path of a file already in storage (a 3 MB file is fine)', () => {
    expect(parseDocumentUploadInput(form(valid))).toEqual({
      ok: true,
      input: {
        clientId: CLIENT,
        documentType: 'passport',
        upload: { path: PATH, name: 'passport.pdf', size: 3145728, type: 'application/pdf' },
      },
    })
  })

  it('what the browser posts for a 9 MB file is tiny: the file is not in it', async () => {
    const bytes = (await new Response(form({ ...valid, upload_size: String(9 * 1024 * 1024) })).arrayBuffer()).byteLength
    expect(bytes).toBeLessThan(2 * 1024)
  })

  it('refuses a file body: Server Actions cap the body at 1 MB', () => {
    const file = new File([new Uint8Array(2 * 1024 * 1024)], 'passport.pdf', { type: 'application/pdf' })
    expect(parseDocumentUploadInput(form({ client_id: CLIENT, document_type: 'passport', file }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('Upload the document to storage first'),
    })
  })

  it('ignores unknown fields', () => {
    expect(parseDocumentUploadInput(form({ ...valid, extra: 'x'.repeat(5000) }))).toMatchObject({ ok: true })
  })

  it('needs a valid client, a known document type and an uploaded file', () => {
    expect(parseDocumentUploadInput(form({ ...valid, client_id: 'x' }))).toMatchObject({ ok: false, error: 'Missing client ID' })
    expect(parseDocumentUploadInput(form({ ...valid, document_type: 'filing' }))).toMatchObject({ ok: false, error: 'Invalid document type' })
    expect(parseDocumentUploadInput(form({ ...valid, document_type: '' }))).toMatchObject({ ok: false, error: 'Invalid document type' })
    const { upload_path: _path, ...withoutPath } = valid
    expect(parseDocumentUploadInput(form(withoutPath))).toMatchObject({ ok: false, error: 'No file selected' })
  })

  it('accepts each document type the form offers', () => {
    for (const type of ['passport', 'proof_of_address', 'incorporation', 'source_of_funds']) {
      expect(parseDocumentUploadInput(form({ ...valid, document_type: type }))).toMatchObject({ ok: true })
    }
  })

  it('rejects a bad path, type or size', () => {
    expect(parseDocumentUploadInput(form({ ...valid, upload_path: '../x.pdf' }))).toMatchObject({ ok: false })
    expect(parseDocumentUploadInput(form({ ...valid, upload_type: 'text/html' }))).toMatchObject({ ok: false, error: 'File must be PDF, JPEG, or PNG' })
    expect(parseDocumentUploadInput(form({ ...valid, upload_size: '0' }))).toMatchObject({ ok: false })
    expect(parseDocumentUploadInput(form({ ...valid, upload_size: String(11 * 1024 * 1024) }))).toMatchObject({ ok: false, error: 'File exceeds 10 MB limit' })
  })
})
