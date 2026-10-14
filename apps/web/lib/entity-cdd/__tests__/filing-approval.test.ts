import { describe, expect, it } from 'vitest'
import { DOCUMENT_STATUS_LABELS } from '@/lib/types/documents'
import { FILING_FOUR_EYES_MESSAGE, filingApprovalGate } from '../permissions'

const base = { userId: 'admin-b', savedBy: 'member-1', fourEyes: true }

describe('filingApprovalGate', () => {
  it('shows no Approve button to members or read_only users', () => {
    for (const role of ['member', 'read_only', undefined, null]) {
      expect(filingApprovalGate({ ...base, role })).toEqual({ show: false, canApprove: false })
    }
  })

  it('lets an admin approve a filing a member saved', () => {
    expect(filingApprovalGate({ ...base, role: 'admin' })).toEqual({ show: true, canApprove: true })
  })

  it('lets a different admin approve an admin\'s filing', () => {
    expect(filingApprovalGate({ ...base, role: 'admin', savedBy: 'admin-a' })).toEqual({ show: true, canApprove: true })
  })

  it('shows but disables Approve for the admin who saved the filing under four-eyes, with the reason', () => {
    const gate = filingApprovalGate({ ...base, role: 'admin', savedBy: 'admin-b' })
    expect(gate).toMatchObject({ show: true, canApprove: false })
    expect(gate.reason).toContain(FILING_FOUR_EYES_MESSAGE)
  })

  it('lets an admin approve their own filing when four-eyes is off', () => {
    expect(filingApprovalGate({ ...base, role: 'admin', savedBy: 'admin-b', fourEyes: false })).toEqual({
      show: true,
      canApprove: true,
    })
  })

  it('uses the wording the database raises', () => {
    expect(FILING_FOUR_EYES_MESSAGE).toBe('Four-eyes rule: the person who saved this filing cannot approve it')
  })
})

describe('filing status label', () => {
  it('calls a saved, unapproved filing "Pending approval"', () => {
    expect(DOCUMENT_STATUS_LABELS.pending).toBe('Pending approval')
  })
})
