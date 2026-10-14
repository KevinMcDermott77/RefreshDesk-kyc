import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * A pack's snapshot is built on the server, handed to the browser, and posted back to be saved.
 * Signing the fingerprint proves the snapshot being saved is the one the server built (not one
 * edited in the browser), for the firm and moment it was issued for. Server-only.
 */
export const SIGNING_MAX_AGE_MS = 60 * 60 * 1000

export function packSigningSecret(): string | null {
  const secret = process.env.PACK_SIGNING_SECRET
  return secret && secret.length >= 16 ? secret : null
}

function payload(firmId: string, issuedAt: string, sha256: string): string {
  return `refresh-pack.v1.${firmId}.${issuedAt}.${sha256}`
}

export function signPack(secret: string, firmId: string, issuedAt: string, sha256: string): string {
  return createHmac('sha256', secret).update(payload(firmId, issuedAt, sha256)).digest('hex')
}

export function verifyPackSignature(
  secret: string,
  firmId: string,
  issuedAt: string,
  sha256: string,
  signature: string,
  now: number = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  const issued = Date.parse(issuedAt)
  if (Number.isNaN(issued)) return { ok: false, reason: 'The run is not dated' }
  if (now - issued > SIGNING_MAX_AGE_MS || issued - now > 5 * 60 * 1000) {
    return { ok: false, reason: 'This run is too old to save: run the walk again' }
  }
  const expected = Buffer.from(signPack(secret, firmId, issuedAt, sha256), 'hex')
  const given = Buffer.from(signature, 'hex')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'The run was changed after it was made: run the walk again' }
  }
  return { ok: true }
}
