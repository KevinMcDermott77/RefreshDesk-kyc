import { describe, expect, it } from 'vitest'
import { parseEvidenceUploadInput } from '../input'
import { evidenceGate, EVIDENCE_FOUR_EYES_MESSAGE } from '../permissions'
import { sha256Hex } from '../hash'

const CLIENT = '3f2c1d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
const FIRM = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const DOC = '11111111-2222-4333-8444-555555555555'
const PATH = `${FIRM}/${CLIENT}/${DOC}/register.pdf`

function form(fields: Record<string, string | Blob>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const valid = {
  client_id: CLIENT,
  subject_id: '03261722',
  node_name: 'Example Holdings AS',
  country: 'no',
  registration_number: '999 999 999',
  evidence_kind: 'shareholder_register',
  upload_path: PATH,
  upload_name: 'register.pdf',
  upload_type: 'application/pdf',
  upload_size: '3145728',
}

describe('parseEvidenceUploadInput', () => {
  it('accepts a node, a kind and the path of a file already in storage (a 3 MB file is fine)', () => {
    expect(parseEvidenceUploadInput(form(valid))).toEqual({
      ok: true,
      input: {
        clientId: CLIENT,
        subjectId: '03261722',
        nodeKey: 'REG:NO:999999999',
        nodeName: 'Example Holdings AS',
        identity: { country: 'NO', registration_number: '999 999 999' },
        kind: 'shareholder_register',
        upload: { path: PATH, name: 'register.pdf', size: 3145728, type: 'application/pdf' },
        wantExtraction: false,
      },
    })
  })

  it('what the browser posts for a 9 MB file is tiny: the file is not in it', async () => {
    const bytes = (await new Response(form({ ...valid, upload_size: String(9 * 1024 * 1024) })).arrayBuffer()).byteLength
    expect(bytes).toBeLessThan(2 * 1024)
  })

  it('refuses a file body: Server Actions cap the body at 1 MB', () => {
    const { upload_path: _p, ...rest } = valid
    const file = new File([new Uint8Array(2 * 1024 * 1024)], 'register.pdf', { type: 'application/pdf' })
    expect(parseEvidenceUploadInput(form({ ...rest, file }))).toMatchObject({ ok: false, error: expect.stringContaining('Upload the document to storage first') })
  })

  it('never accepts owners from the upload step, and ignores unknown fields', () => {
    const result = parseEvidenceUploadInput(form({ ...valid, owners: '[{"name_as_shown":"x"}]', payload: '{}', extra: 'x'.repeat(5000) }))
    expect(result).toMatchObject({ ok: true })
    expect(JSON.stringify(result)).not.toContain('name_as_shown')
  })

  it('needs an LEI or a registration number with a country, never a name alone', () => {
    const { country: _c, registration_number: _r, ...nameOnly } = valid
    expect(parseEvidenceUploadInput(form(nameOnly))).toMatchObject({ ok: false, error: expect.stringContaining('A name alone cannot identify') })
    expect(parseEvidenceUploadInput(form({ ...valid, country: '' }))).toMatchObject({ ok: false })
    expect(parseEvidenceUploadInput(form({ ...nameOnly, lei: '529900ABCDEFGHIJKL12' }))).toMatchObject({ ok: true, input: { nodeKey: 'LEI:529900ABCDEFGHIJKL12' } })
  })

  it('needs a client, a subject, a name, a known kind and a file', () => {
    expect(parseEvidenceUploadInput(form({ ...valid, client_id: 'x' }))).toMatchObject({ ok: false, error: 'Missing client ID' })
    expect(parseEvidenceUploadInput(form({ ...valid, subject_id: '' }))).toMatchObject({ ok: false })
    expect(parseEvidenceUploadInput(form({ ...valid, node_name: '' }))).toMatchObject({ ok: false })
    expect(parseEvidenceUploadInput(form({ ...valid, evidence_kind: 'signed_client_declaration' }))).toMatchObject({ ok: false })
    const { upload_path: _p, ...noPath } = valid
    expect(parseEvidenceUploadInput(form(noPath))).toMatchObject({ ok: false, error: 'No file selected' })
  })

  it('rejects a bad path, type or size', () => {
    expect(parseEvidenceUploadInput(form({ ...valid, upload_path: '../x.pdf' }))).toMatchObject({ ok: false })
    expect(parseEvidenceUploadInput(form({ ...valid, upload_type: 'text/html' }))).toMatchObject({ ok: false, error: 'File must be PDF, JPEG, or PNG' })
    expect(parseEvidenceUploadInput(form({ ...valid, upload_size: String(11 * 1024 * 1024) }))).toMatchObject({ ok: false, error: 'File exceeds 10 MB limit' })
  })

  it('records whether extraction was asked for', () => {
    expect(parseEvidenceUploadInput(form({ ...valid, use_extraction: 'on' }))).toMatchObject({ ok: true, input: { wantExtraction: true } })
  })
})

describe('evidenceGate', () => {
  const base = { userId: 'u1', uploadedBy: 'u1', status: 'proposed' as const, proposalSource: 'manual', fourEyes: true }

  it('a different admin can confirm and reject', () => {
    expect(evidenceGate({ ...base, role: 'admin', userId: 'u2' })).toMatchObject({ canConfirm: true, canReject: true, canEditProposal: false })
  })

  it('the uploader-admin cannot confirm with four-eyes on, and is told why, but may still withdraw', () => {
    const gate = evidenceGate({ ...base, role: 'admin' })
    expect(gate).toMatchObject({ canConfirm: false, canReject: true })
    expect(gate.reason).toContain(EVIDENCE_FOUR_EYES_MESSAGE)
  })

  it('the uploader-admin can confirm when four-eyes is off', () => {
    expect(evidenceGate({ ...base, role: 'admin', fourEyes: false }).canConfirm).toBe(true)
  })

  it('a member can edit their own manual proposal and withdraw, but never confirm', () => {
    expect(evidenceGate({ ...base, role: 'member' })).toMatchObject({ canEditProposal: true, canConfirm: false, canReject: true })
  })

  it('an extraction proposal is not edited by its uploader: the confirmer edits it', () => {
    expect(evidenceGate({ ...base, role: 'member', proposalSource: 'extraction' })).toMatchObject({ canEditProposal: false })
  })

  it('another member can neither edit, confirm nor reject', () => {
    expect(evidenceGate({ ...base, role: 'member', userId: 'u2' })).toMatchObject({ canEditProposal: false, canConfirm: false, canReject: false })
  })

  it('a draft cannot be confirmed; its uploader enters the owners', () => {
    expect(evidenceGate({ ...base, role: 'member', status: 'draft', proposalSource: null })).toMatchObject({ canEditProposal: true, canConfirm: false })
    expect(evidenceGate({ ...base, role: 'admin', userId: 'u2', status: 'draft', proposalSource: null })).toMatchObject({ canConfirm: false, canReject: true })
  })

  it('read_only, no role and a closed item can do nothing', () => {
    const none = { canEditProposal: false, canConfirm: false, canReject: false }
    expect(evidenceGate({ ...base, role: 'read_only' })).toMatchObject(none)
    expect(evidenceGate({ ...base, role: null })).toMatchObject(none)
    for (const status of ['confirmed', 'rejected', 'superseded'] as const) {
      expect(evidenceGate({ ...base, role: 'admin', userId: 'u2', status })).toMatchObject(none)
    }
  })
})

describe('sha256Hex', () => {
  it('is the SHA-256 of the bytes in hex', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
