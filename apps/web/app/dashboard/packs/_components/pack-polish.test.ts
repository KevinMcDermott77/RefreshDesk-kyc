import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DEMO_COMPANY_NAME, DEMO_SUBJECT, demoFetcher } from '@/lib/demo/fjordvik'
import { snapshotFingerprint } from '@/lib/packs/canonical'
import { buildFixtureSnapshot } from '@/lib/packs/__tests__/fixtures'
import { buildSnapshot, type PackSnapshot } from '@/lib/packs/snapshot'
import { edgeLabel, formatRange, overallText, summarise, toFlow } from '@/lib/ownership/to-flow'
import type { ClientEvidenceItem } from '@/lib/ownership/types'
import { walk } from '@/lib/ownership/walk'
import { PackReport, type PackMeta } from './PackReport'

vi.mock('../actions', () => ({ approvePackAction: async () => ({}), rejectPackAction: async () => ({}), submitPackAction: async () => ({}) }))

// Invented data only.
const NOW = '2026-10-16T12:00:00.000Z'

const item = (over: Partial<ClientEvidenceItem> = {}): ClientEvidenceItem => ({
  id: 'ev-1',
  nodeIdentity: { country: 'NO', registrationNumber: '999 000 001' },
  evidenceKind: 'client_ownership_confirmation',
  asAt: '2026-06-30',
  documentDate: '2026-07-16',
  certified: 'not_applicable',
  certifierCapacity: null,
  certificationDate: null,
  confirmedByCapacity: 'director',
  confirmationDate: '2026-07-16',
  receivedAs: 'signed_letter',
  noOtherHolderAtOrAbove: 25,
  confirmedBy: 'admin-1',
  confirmedAt: '2026-10-15T09:00:00.000Z',
  edited: false,
  documentSha256: 'd'.repeat(64),
  ownersComplete: false,
  override: null,
  owners: [
    { kind: 'individual', label: 'Ø.Å.T.', holding: { type: 'percent', value: 45 }, registration: null, leiShown: null, pageRef: 'para 2' },
    { kind: 'individual', label: 'K.E.', holding: { type: 'percent', value: 55 }, registration: null, leiShown: null, pageRef: 'para 2' },
  ],
  ...over,
})

async function pack(items: ClientEvidenceItem[]): Promise<{ snapshot: PackSnapshot; meta: PackMeta }> {
  const walked = await walk(DEMO_SUBJECT, { ...demoFetcher(NOW), clientEvidence: async () => items }, { now: NOW })
  const snapshot = buildSnapshot({
    subject: { id: DEMO_SUBJECT, kind: 'company', name: DEMO_COMPANY_NAME },
    policy: { threshold: 25, maxDepth: 6, indirectMethod: 'either', acceptRegulatedAsTerminal: true },
    walked,
    profile: [],
    flow: toFlow(walked),
    summary: summarise(walked),
    sourceLog: [],
    sample: true,
    now: new Date(NOW),
  })
  const fingerprint = await snapshotFingerprint(snapshot)
  const meta: PackMeta = { id: 'p', status: 'draft', fingerprint, verified: true, recomputed: fingerprint, createdByName: 'x', createdAt: NOW, submittedAt: null, reviewedByName: null, reviewedAt: null, reviewNote: null }
  return { snapshot, meta }
}

const html = (p: { snapshot: PackSnapshot; meta: PackMeta }) => renderToStaticMarkup(createElement(PackReport, p))

describe('the summary line', () => {
  it('says "Complete — N branch resolved on client evidence" for a walk resolved on client evidence, never the status code', async () => {
    const out = html(await pack([item()]))
    expect(out).toContain('Complete — 1 branch resolved on client evidence')
    expect(out).toMatch(/Complete — 1 branch resolved on client evidence<\/strong> · 0 open branches/)
    expect(out).not.toContain('resolved_client_evidence')
    expect(out).not.toContain('walk status')
  })

  it('counts several branches, with the plural', () => {
    expect(overallText({ status: 'resolved_client_evidence', clientEvidence: [{ applied: true }, { applied: true }, { applied: false }] })).toBe(
      'Complete — 2 branches resolved on client evidence',
    )
  })

  it('keeps the plain words for the other statuses', async () => {
    const out = html(await pack([]))
    expect(out).toContain('Partial')
    expect(out).toContain('walk status unresolved')
    expect(out).not.toMatch(/walk status \w+_\w+/)
  })

  it('the fixture pack (a register-only walk) still reads as before', async () => {
    const snapshot = await buildFixtureSnapshot()
    const fingerprint = await snapshotFingerprint(snapshot)
    const meta: PackMeta = { id: 'p', status: 'draft', fingerprint, verified: true, recomputed: fingerprint, createdByName: 'x', createdAt: NOW, submittedAt: null, reviewedByName: null, reviewedAt: null, reviewNote: null }
    expect(html({ snapshot, meta })).toMatch(/walk status (resolved|partial|unresolved)/)
  })
})

describe('chart edge labels', () => {
  it('a range whose ends are equal is one number; a real band keeps its range', () => {
    expect(formatRange([45, 45])).toBe('45%')
    expect(formatRange([100, 100])).toBe('100%')
    expect(formatRange([23.7499, 23.7499])).toBe('23.7%')
    expect(formatRange([45, 46])).toBe('45-46%')
    expect(formatRange([25, 50])).toBe('25-50%')
    expect(formatRange([23.7499, 100])).toBe('23.7-100%')
    expect(formatRange(undefined)).toBeUndefined()
  })

  it('a Companies House band label is unchanged', () => {
    expect(edgeLabel([75, 100], ['ownership-of-shares-75-to-100-percent'])).toBe('75-100% shares')
  })

  it('the pack chart shows "45% (client evidence)" for a stated 45%, not "45-45%"', async () => {
    const out = html(await pack([item()]))
    expect(out).toContain('45% (client evidence)')
    expect(out).toContain('55% (client evidence)')
    expect(out).not.toMatch(/(\d+(?:\.\d)?)-\1%/)
  })
})

describe('the sign-off section and the submit wording', () => {
  it('the report and the panel together have one "Sign-off" heading, and the new submit sentence', async () => {
    const { SignOffPanel } = await import('./SignOffPanel')
    const p = await pack([item()])
    const gate = { showSubmit: true, canSubmit: true, showReview: false, canApprove: false, canReject: false }
    const panel = renderToStaticMarkup(createElement(SignOffPanel, { packId: 'p', gate } as never))
    const both = html(p) + panel
    expect((both.match(/>Sign-off</g) ?? []).length).toBe(1)
    expect(panel).not.toContain('Sign-off')
    expect(panel).toContain('Once submitted, a pack is locked and can never be edited.')
    expect(panel).not.toContain('it never can be')
    expect(panel).toContain('Submit for approval')
  })

  it('the reviewer panel has no heading of its own either', async () => {
    const { SignOffPanel } = await import('./SignOffPanel')
    const gate = { showSubmit: false, canSubmit: false, showReview: true, canApprove: true, canReject: true }
    const panel = renderToStaticMarkup(createElement(SignOffPanel, { packId: 'p', gate } as never))
    expect(panel).not.toContain('<h2')
    expect(panel).toContain('Approve')
  })
})
