import { describe, expect, it } from 'vitest'
import { canReview, canWrite, FOUR_EYES_MESSAGE, REVIEW_ROLES, ROLE_LABELS, WRITE_ROLES, reviewGate } from '../permissions'

const FETCHER = 'user-fetcher'
const OTHER = 'user-other'

describe('canWrite / canReview', () => {
  it('read_only can never write or review', () => {
    expect(canWrite('read_only')).toBe(false)
    expect(canReview('read_only')).toBe(false)
  })

  it('members write but do not review; admins do both', () => {
    expect(canWrite('member')).toBe(true)
    expect(canReview('member')).toBe(false)
    expect(canWrite('admin')).toBe(true)
    expect(canReview('admin')).toBe(true)
  })

  it('names only roles that can exist: admin, member, read_only', () => {
    expect([...WRITE_ROLES, ...REVIEW_ROLES].every((r) => ['admin', 'member', 'read_only'].includes(r))).toBe(true)
    expect(canWrite('reviewer')).toBe(false)
    expect(canReview('reviewer')).toBe(false)
  })

  it('labels admins as the reviewers', () => {
    expect(ROLE_LABELS.admin).toBe('Admin (reviewer)')
    expect(ROLE_LABELS.member).toBe('Member')
    expect(ROLE_LABELS.read_only).toBe('Read only')
  })

  it('no role means no access', () => {
    expect(canWrite(null)).toBe(false)
    expect(canReview(undefined)).toBe(false)
    expect(canWrite('analyst')).toBe(false)
  })
})

describe('reviewGate', () => {
  const base = { userId: OTHER, fetchedBy: FETCHER, fourEyes: true }

  it('disables both buttons for read_only, with the reason', () => {
    const gate = reviewGate({ ...base, role: 'read_only' })
    expect(gate).toMatchObject({ canApprove: false, canReject: false })
    expect(gate.reason).toMatch(/read-only/i)
  })

  it('disables both buttons for a member', () => {
    const gate = reviewGate({ ...base, role: 'member' })
    expect(gate).toMatchObject({ canApprove: false, canReject: false })
    expect(gate.reason).toMatch(/admin \(reviewer\)/)
  })

  it('disables both buttons when the user is not in the firm', () => {
    expect(reviewGate({ ...base, role: undefined })).toMatchObject({ canApprove: false, canReject: false })
  })

  it('stops the fetcher approving under four-eyes, but lets them reject', () => {
    const gate = reviewGate({ ...base, role: 'admin', userId: FETCHER })
    expect(gate.canApprove).toBe(false)
    expect(gate.canReject).toBe(true)
    expect(gate.reason).toContain(FOUR_EYES_MESSAGE)
  })

  it('lets the fetcher approve when four-eyes is off', () => {
    expect(reviewGate({ ...base, role: 'admin', userId: FETCHER, fourEyes: false })).toEqual({ canApprove: true, canReject: true })
  })

  it('lets a second admin approve under four-eyes', () => {
    expect(reviewGate({ ...base, role: 'admin' })).toEqual({ canApprove: true, canReject: true })
  })

  it('allows approval of an old record with no fetched_by', () => {
    expect(reviewGate({ ...base, role: 'admin', userId: FETCHER, fetchedBy: null })).toEqual({ canApprove: true, canReject: true })
  })

  it('uses the exact wording the database raises', () => {
    expect(FOUR_EYES_MESSAGE).toBe('Four-eyes rule: the person who fetched this record cannot approve it')
  })
})
