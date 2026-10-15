import { normaliseRegistration } from '@/lib/ownership/registration-number'
import type { NodeIdentity } from './types'

const LEI = /^[A-Z0-9]{20}$/

export type ParsedIdentity = { ok: true; identity: NodeIdentity; key: string } | { ok: false; error: string }

/**
 * What identifies the node the evidence is about, and the key stored with it. An LEI, or a
 * registration number with its two-letter country: never a name alone. The key is built from the
 * identity only, so the walk (slice 7c) can find evidence for a node from the same facts.
 */
export function parseNodeIdentity(input: { lei?: string; country?: string; registrationNumber?: string }): ParsedIdentity {
  const lei = (input.lei ?? '').trim().toUpperCase()
  const country = (input.country ?? '').trim().toUpperCase()
  const number = (input.registrationNumber ?? '').trim()

  if (lei && !LEI.test(lei)) return { ok: false, error: 'An LEI is 20 letters and digits' }
  if (country && !/^[A-Z]{2}$/.test(country)) return { ok: false, error: 'The country must be a two-letter code, such as NO' }

  const hasRegistration = !!country && !!normaliseRegistration(number)
  if (!lei && !hasRegistration) {
    return { ok: false, error: 'Give an LEI, or a registration number and its country. A name alone cannot identify the company.' }
  }

  const identity: NodeIdentity = {
    ...(lei ? { lei } : {}),
    ...(hasRegistration ? { country, registration_number: number } : {}),
  }
  const key = lei ? `LEI:${lei}` : `REG:${country}:${normaliseRegistration(number)}`
  return { ok: true, identity, key }
}
