import { createHash } from 'node:crypto'

/** SHA-256 of the stored file's bytes, in hex: the pack names exactly which bytes a claim rests on. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
