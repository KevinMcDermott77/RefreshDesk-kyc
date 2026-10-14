import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { filingApprovalGate } from '@/lib/entity-cdd/permissions'
import { ApproveFilingButton } from './ApproveFilingButton'

// The server action pulls in Supabase and Next internals; the button only needs it to exist.
vi.mock('../filings/actions', () => ({ approveFilingAction: async () => ({}) }))

function render(gate: ReturnType<typeof filingApprovalGate>) {
  return renderToStaticMarkup(
    createElement(ApproveFilingButton, { documentId: 'd', clientId: 'c', canApprove: gate.canApprove, reason: gate.reason }),
  )
}

const disabled = (html: string) => /<button[^>]*\sdisabled(=|\s|>)/.test(html)

describe('ApproveFilingButton', () => {
  it('is enabled for a different admin', () => {
    const html = render(filingApprovalGate({ role: 'admin', userId: 'b', savedBy: 'a', fourEyes: true }))
    expect(html).toContain('Approve')
    expect(disabled(html)).toBe(false)
  })

  it('is disabled with the four-eyes reason for the admin who saved the filing', () => {
    const html = render(filingApprovalGate({ role: 'admin', userId: 'a', savedBy: 'a', fourEyes: true }))
    expect(disabled(html)).toBe(true)
    expect(html).toContain('Four-eyes rule: the person who saved this filing cannot approve it')
  })

  it('is enabled for the admin who saved it when four-eyes is off', () => {
    expect(disabled(render(filingApprovalGate({ role: 'admin', userId: 'a', savedBy: 'a', fourEyes: false })))).toBe(false)
  })
})
