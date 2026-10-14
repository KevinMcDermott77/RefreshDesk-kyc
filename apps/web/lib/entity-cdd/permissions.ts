/**
 * Who may do what with an entity CDD record. The database enforces the same rules
 * (require_role and the four-eyes check in review_entity_cdd); this module lets the
 * app say so before the user clicks.
 */

/** Roles that may write (fetch, create, upload). read_only never can. */
export const WRITE_ROLES = ['admin', 'member'] as const
/** Roles that may review (approve or reject records and documents). Admin is the reviewer. */
export const REVIEW_ROLES = ['admin'] as const

/** How a role is shown to people. Admins are the firm's reviewers. */
export const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin (reviewer)',
  member: 'Member',
  read_only: 'Read only',
}

export const FOUR_EYES_MESSAGE = 'Four-eyes rule: the person who fetched this record cannot approve it'

export function canWrite(role: string | null | undefined): boolean {
  return !!role && (WRITE_ROLES as readonly string[]).includes(role)
}

export function canReview(role: string | null | undefined): boolean {
  return !!role && (REVIEW_ROLES as readonly string[]).includes(role)
}

export type ReviewGate = {
  canApprove: boolean
  canReject: boolean
  /** Why a button is disabled; shown beside it. */
  reason?: string
}

export type ReviewGateInput = {
  role: string | null | undefined
  userId: string
  /** entity_cdd_records.fetched_by; null for records from before it existed. */
  fetchedBy: string | null | undefined
  fourEyes: boolean
}

export function reviewGate({ role, userId, fetchedBy, fourEyes }: ReviewGateInput): ReviewGate {
  if (!role) return { canApprove: false, canReject: false, reason: 'You are not an active member of this firm.' }
  if (role === 'read_only') {
    return { canApprove: false, canReject: false, reason: 'Read-only users cannot approve or reject records.' }
  }
  if (!canReview(role)) {
    return {
      canApprove: false,
      canReject: false,
      reason: 'Only an admin (reviewer) can approve or reject records.',
    }
  }
  // A missing fetched_by (old record) is allowed; the database logs that it could not be checked.
  if (fourEyes && fetchedBy && fetchedBy === userId) {
    return { canApprove: false, canReject: true, reason: FOUR_EYES_MESSAGE + '. Ask a colleague to approve it.' }
  }
  return { canApprove: true, canReject: true }
}
