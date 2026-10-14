import { canReview, canWrite } from '@/lib/entity-cdd/permissions'

export type PackStatus = 'draft' | 'submitted' | 'approved' | 'rejected'

export const PACK_STATUS_LABELS: Record<PackStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted for approval',
  approved: 'Approved',
  rejected: 'Rejected',
}

export const PACK_FOUR_EYES_MESSAGE = 'Four-eyes rule: the person who created this pack cannot approve it'

export type SignOffGate = {
  /** Show the submit button: the creator, while the pack is a draft. */
  showSubmit: boolean
  canSubmit: boolean
  /** Show approve and reject: admins only, while the pack is submitted. */
  showReview: boolean
  canApprove: boolean
  canReject: boolean
  reason?: string
}

/** What this user can do with a pack, with the same visibility rules as filing approval. */
export function packSignOffGate(input: {
  role: string | null | undefined
  userId: string
  createdBy: string
  status: PackStatus
  fourEyes: boolean
}): SignOffGate {
  const isCreator = input.userId === input.createdBy
  const showSubmit = input.status === 'draft' && isCreator && canWrite(input.role)
  const showReview = input.status === 'submitted' && canReview(input.role)
  const selfApproval = input.fourEyes && isCreator

  return {
    showSubmit,
    canSubmit: showSubmit,
    showReview,
    canApprove: showReview && !selfApproval,
    canReject: showReview,
    ...(showReview && selfApproval ? { reason: PACK_FOUR_EYES_MESSAGE + '. Ask another admin to approve it.' } : {}),
  }
}
