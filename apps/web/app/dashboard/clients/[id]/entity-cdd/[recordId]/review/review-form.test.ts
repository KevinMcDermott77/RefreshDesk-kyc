import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { reviewGate } from '@/lib/entity-cdd/permissions'
import { ReviewEntityCddForm } from './review-form'

// The server action pulls in Supabase and Next internals; the form only needs it to exist.
vi.mock('./actions', () => ({ reviewEntityCddAction: async () => ({}) }))

function render(gate: ReturnType<typeof reviewGate>) {
  return renderToStaticMarkup(createElement(ReviewEntityCddForm, { recordId: 'r', clientId: 'c', gate }))
}

/** The opening tag of the button with this decision value. */
function button(html: string, decision: 'approved' | 'rejected'): string {
  const match = html.match(new RegExp(`<button[^>]*value="${decision}"[^>]*>`))
  if (!match) throw new Error(`no ${decision} button`)
  return match[0]
}

const disabled = (tag: string) => /\sdisabled(=|\s|>)/.test(tag)

describe('review form buttons', () => {
  it('enables both for a second reviewer and shows no warning', () => {
    const html = render(reviewGate({ role: 'admin', userId: 'b', fetchedBy: 'a', fourEyes: true }))
    expect(disabled(button(html, 'approved'))).toBe(false)
    expect(disabled(button(html, 'rejected'))).toBe(false)
    expect(html).not.toContain('role="note"')
  })

  it('disables both for read_only and says why', () => {
    const html = render(reviewGate({ role: 'read_only', userId: 'b', fetchedBy: 'a', fourEyes: true }))
    expect(disabled(button(html, 'approved'))).toBe(true)
    expect(disabled(button(html, 'rejected'))).toBe(true)
    expect(html).toContain('Read-only users cannot approve or reject records.')
  })

  it('disables both for a member', () => {
    const html = render(reviewGate({ role: 'member', userId: 'b', fetchedBy: 'a', fourEyes: true }))
    expect(disabled(button(html, 'approved'))).toBe(true)
    expect(disabled(button(html, 'rejected'))).toBe(true)
    expect(html).toContain('Only an admin or reviewer')
  })

  it('disables only Approve for the fetcher under four-eyes, with the rule shown', () => {
    const html = render(reviewGate({ role: 'admin', userId: 'a', fetchedBy: 'a', fourEyes: true }))
    expect(disabled(button(html, 'approved'))).toBe(true)
    expect(disabled(button(html, 'rejected'))).toBe(false)
    expect(html).toContain('Four-eyes rule: the person who fetched this record cannot approve it')
  })

  it('enables Approve for the fetcher when four-eyes is off', () => {
    const html = render(reviewGate({ role: 'admin', userId: 'a', fetchedBy: 'a', fourEyes: false }))
    expect(disabled(button(html, 'approved'))).toBe(false)
  })
})
