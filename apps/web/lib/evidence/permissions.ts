import { canReview, canWrite } from '@/lib/entity-cdd/permissions'
import type { EvidenceStatus } from './types'

/**
 * Who may do what with an evidence item. The database enforces the same rules (require_role and
 * the four-eyes check in confirm_ownership_evidence); this lets the page say so before the click.
 */

export const EVIDENCE_FOUR_EYES_MESSAGE = 'Four-eyes rule: the person who uploaded this evidence cannot confirm it'

export type EvidenceGateInput = {
  role: string | null | undefined
  userId: string
  uploadedBy: string
  status: EvidenceStatus
  /** 'extraction' or 'manual'; null until a proposal exists. */
  proposalSource: string | null
  fourEyes: boolean
}

export type EvidenceGate = {
  /** The uploader may type or edit the proposal (not an extraction's, whose edits belong to the confirmer). */
  canEditProposal: boolean
  canConfirm: boolean
  /** An admin rejects; the uploader withdraws. */
  canReject: boolean
  /** Why a button is disabled; shown beside it. */
  reason?: string
}

export function evidenceGate(input: EvidenceGateInput): EvidenceGate {
  const { role, userId, uploadedBy, status, proposalSource, fourEyes } = input
  const open = status === 'draft' || status === 'proposed'
  const none = (reason: string): EvidenceGate => ({ canEditProposal: false, canConfirm: false, canReject: false, reason })

  if (!role) return none('You are not an active member of this firm.')
  if (role === 'read_only') return none('Read-only users cannot change client evidence.')
  if (!open) return none(`This evidence is ${status}; it can no longer change.`)

  const isUploader = uploadedBy === userId
  const isAdmin = canReview(role)
  const canEditProposal = canWrite(role) && isUploader && (status === 'draft' || proposalSource === 'manual')
  const canReject = isAdmin || (canWrite(role) && isUploader)

  if (status === 'draft') {
    return {
      canEditProposal,
      canConfirm: false,
      canReject,
      reason: isUploader ? undefined : 'No owners have been entered yet. The person who uploaded it enters them first.',
    }
  }
  if (!isAdmin) {
    return { canEditProposal, canConfirm: false, canReject, reason: 'Only an admin (reviewer) can confirm evidence.' }
  }
  if (fourEyes && isUploader) {
    return { canEditProposal, canConfirm: false, canReject, reason: `${EVIDENCE_FOUR_EYES_MESSAGE}. Ask another admin to confirm it.` }
  }
  return { canEditProposal, canConfirm: true, canReject }
}
