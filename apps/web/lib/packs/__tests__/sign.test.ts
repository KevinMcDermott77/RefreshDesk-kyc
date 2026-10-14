import { afterEach, describe, expect, it } from 'vitest'
import { snapshotFingerprint } from '../canonical'
import { createPackOffer } from '../offer'
import { packSignOffGate, PACK_FOUR_EYES_MESSAGE } from '../sign-off'
import { packSigningSecret, signPack, SIGNING_MAX_AGE_MS, verifyPackSignature } from '../sign'
import { buildFixtureInput } from './fixtures'

const SECRET = 'a-test-secret-of-sufficient-length'
const FIRM = '11111111-1111-1111-1111-111111111111'
const SHA = 'a'.repeat(64)
const ISSUED = '2026-10-14T10:00:00.000Z'
const NOW = Date.parse(ISSUED) + 60_000

describe('pack signatures', () => {
  it('verify for the same firm, time and fingerprint', () => {
    const signature = signPack(SECRET, FIRM, ISSUED, SHA)
    expect(verifyPackSignature(SECRET, FIRM, ISSUED, SHA, signature, NOW)).toEqual({ ok: true })
  })

  it('fail if the fingerprint, firm, time or secret differ', () => {
    const signature = signPack(SECRET, FIRM, ISSUED, SHA)
    expect(verifyPackSignature(SECRET, FIRM, ISSUED, 'b'.repeat(64), signature, NOW).ok).toBe(false)
    expect(verifyPackSignature(SECRET, '22222222-2222-2222-2222-222222222222', ISSUED, SHA, signature, NOW).ok).toBe(false)
    expect(verifyPackSignature(SECRET, FIRM, '2026-10-14T10:00:01.000Z', SHA, signature, NOW).ok).toBe(false)
    expect(verifyPackSignature('another-secret-of-sufficient-length', FIRM, ISSUED, SHA, signature, NOW).ok).toBe(false)
  })

  it('fail for malformed or truncated signatures instead of throwing', () => {
    expect(verifyPackSignature(SECRET, FIRM, ISSUED, SHA, 'zz', NOW).ok).toBe(false)
    expect(verifyPackSignature(SECRET, FIRM, ISSUED, SHA, '', NOW).ok).toBe(false)
    expect(verifyPackSignature(SECRET, FIRM, ISSUED, SHA, signPack(SECRET, FIRM, ISSUED, SHA).slice(2), NOW).ok).toBe(false)
  })

  it('expire after an hour, and refuse a time in the future', () => {
    const signature = signPack(SECRET, FIRM, ISSUED, SHA)
    const late = verifyPackSignature(SECRET, FIRM, ISSUED, SHA, signature, Date.parse(ISSUED) + SIGNING_MAX_AGE_MS + 1)
    expect(late).toMatchObject({ ok: false, reason: expect.stringContaining('too old') })
    expect(verifyPackSignature(SECRET, FIRM, ISSUED, SHA, signature, Date.parse(ISSUED) - 10 * 60_000).ok).toBe(false)
    expect(verifyPackSignature(SECRET, FIRM, 'not a date', SHA, signature, NOW).ok).toBe(false)
  })
})

describe('packSigningSecret', () => {
  const original = process.env.PACK_SIGNING_SECRET
  afterEach(() => {
    if (original === undefined) delete process.env.PACK_SIGNING_SECRET
    else process.env.PACK_SIGNING_SECRET = original
  })

  it('needs 16 or more characters', () => {
    delete process.env.PACK_SIGNING_SECRET
    expect(packSigningSecret()).toBeNull()
    process.env.PACK_SIGNING_SECRET = 'short'
    expect(packSigningSecret()).toBeNull()
    process.env.PACK_SIGNING_SECRET = SECRET
    expect(packSigningSecret()).toBe(SECRET)
  })
})

describe('createPackOffer', () => {
  it('seals the snapshot and signs the fingerprint for the firm', async () => {
    const input = await buildFixtureInput()
    const now = new Date('2026-10-14T10:00:00Z')
    const offer = await createPackOffer(input, { firmId: FIRM, secret: SECRET, now })

    expect(offer.sha256).toBe(await snapshotFingerprint(offer.snapshot))
    expect(offer.issuedAt).toBe('2026-10-14T10:00:00.000Z')
    expect(verifyPackSignature(SECRET, FIRM, offer.issuedAt, offer.sha256, offer.signature, now.getTime() + 1000)).toEqual({ ok: true })
  })

  it('does not verify for another firm, or once the snapshot is edited', async () => {
    const input = await buildFixtureInput()
    const now = new Date('2026-10-14T10:00:00Z')
    const offer = await createPackOffer(input, { firmId: FIRM, secret: SECRET, now })

    expect(verifyPackSignature(SECRET, 'other-firm', offer.issuedAt, offer.sha256, offer.signature, now.getTime()).ok).toBe(false)
    const edited = { ...offer.snapshot, subject: { ...offer.snapshot.subject, name: 'Edited' } }
    const editedSha = await snapshotFingerprint(edited)
    expect(editedSha).not.toBe(offer.sha256)
    expect(verifyPackSignature(SECRET, FIRM, offer.issuedAt, editedSha, offer.signature, now.getTime()).ok).toBe(false)
  })

  it('refuses to build when a name has leaked, so no offer exists to sign', async () => {
    const input = await buildFixtureInput({ individualNames: ['Anna Example'] })
    const leaky = { ...input, profile: [...input.profile, { key: 'officers' as const, label: 'Officers', mark: 'INFO' as const, lines: ['Anna Example — director'] }] }
    await expect(createPackOffer(leaky, { firmId: FIRM, secret: SECRET })).rejects.toThrow(/must not contain individuals/)
  })
})

describe('packSignOffGate', () => {
  const base = { userId: 'u-admin-b', createdBy: 'u-member', fourEyes: true }

  it('lets only the creator submit a draft, and only if they can write', () => {
    expect(packSignOffGate({ ...base, role: 'member', userId: 'u-member', status: 'draft' })).toMatchObject({ showSubmit: true, canSubmit: true, showReview: false })
    expect(packSignOffGate({ ...base, role: 'member', userId: 'u-other', status: 'draft' }).showSubmit).toBe(false)
    expect(packSignOffGate({ ...base, role: 'admin', userId: 'u-admin-b', status: 'draft' }).showSubmit).toBe(false)
    expect(packSignOffGate({ ...base, role: 'read_only', userId: 'u-member', status: 'draft' }).showSubmit).toBe(false)
    expect(packSignOffGate({ ...base, role: 'member', userId: 'u-member', status: 'submitted' }).showSubmit).toBe(false)
  })

  it('shows approve and reject to admins only, and only while submitted', () => {
    expect(packSignOffGate({ ...base, role: 'admin', status: 'submitted' })).toEqual({
      showSubmit: false,
      canSubmit: false,
      showReview: true,
      canApprove: true,
      canReject: true,
    })
    for (const role of ['member', 'read_only', undefined, null]) {
      expect(packSignOffGate({ ...base, role, status: 'submitted' }).showReview).toBe(false)
    }
    for (const status of ['draft', 'approved', 'rejected'] as const) {
      expect(packSignOffGate({ ...base, role: 'admin', status }).showReview).toBe(false)
    }
  })

  it('shows but disables Approve for the creator-admin under four-eyes, leaving Reject enabled', () => {
    const gate = packSignOffGate({ ...base, role: 'admin', userId: 'u-member', status: 'submitted' })
    expect(gate).toMatchObject({ showReview: true, canApprove: false, canReject: true })
    expect(gate.reason).toContain(PACK_FOUR_EYES_MESSAGE)
  })

  it('lets the creator-admin approve when four-eyes is off', () => {
    expect(packSignOffGate({ ...base, role: 'admin', userId: 'u-member', status: 'submitted', fourEyes: false })).toMatchObject({ canApprove: true })
  })

  it('uses the wording the database raises', () => {
    expect(PACK_FOUR_EYES_MESSAGE).toBe('Four-eyes rule: the person who created this pack cannot approve it')
  })
})
