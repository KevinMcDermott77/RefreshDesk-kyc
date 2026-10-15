import { EVIDENCE_ELIGIBLE_REASONS } from './apply'
import type { FlowNodeData } from '@/lib/ownership/to-flow'

const NEEDS_NEWER = ['CLIENT_EVIDENCE_INCOMPLETE', 'CLIENT_EVIDENCE_STALE', 'CLIENT_EVIDENCE_UNCERTIFIED']

export type EvidenceLink = { href: string; label: string }

/**
 * The "Add client evidence" link for a node in the chain, or null when none belongs there. Only an
 * unresolved foreign node with something to identify it by (an LEI, or a registration number with its
 * country) gets one, and only on a walk started from a client page. The facts go in the URL so the form
 * opens filled in; the person still checks them.
 */
export function evidenceLink(clientId: string | undefined, subjectId: string | undefined, data: FlowNodeData): EvidenceLink | null {
  if (!clientId || !subjectId || data.tone !== 'unresolved' || !data.reasonCode) return null
  const identity = data.identity
  if (!identity || !(identity.lei || (identity.country && identity.registrationNumber))) return null
  const wantsNewer = NEEDS_NEWER.includes(data.reasonCode)
  if (!wantsNewer && !EVIDENCE_ELIGIBLE_REASONS.includes(data.reasonCode)) return null

  const params = new URLSearchParams({ subject: subjectId, name: data.name })
  if (identity.lei) params.set('lei', identity.lei)
  if (identity.country) params.set('country', identity.country)
  if (identity.registrationNumber) params.set('registration', identity.registrationNumber)
  return {
    href: `/dashboard/clients/${clientId}/evidence/new?${params.toString()}`,
    label: wantsNewer ? 'Add newer or fuller client evidence' : 'Add client evidence',
  }
}
