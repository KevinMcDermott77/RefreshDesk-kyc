import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildFixtureSnapshot } from '@/lib/packs/__tests__/fixtures'
import { snapshotFingerprint } from '@/lib/packs/canonical'
import type { PackSnapshot } from '@/lib/packs/snapshot'
import { PackReport, type PackMeta } from './PackReport'
import { StaticChart, wrapText } from './StaticChart'

async function meta(snapshot: PackSnapshot, over: Partial<PackMeta> = {}): Promise<PackMeta> {
  const fingerprint = await snapshotFingerprint(snapshot)
  return {
    id: 'pack-1',
    status: 'submitted',
    fingerprint,
    verified: true,
    recomputed: fingerprint,
    createdByName: 'Plain Member',
    createdAt: '2026-10-14T10:05:00Z',
    submittedAt: '2026-10-14T10:10:00Z',
    reviewedByName: null,
    reviewedAt: null,
    reviewNote: null,
    ...over,
  }
}

const html = (snapshot: PackSnapshot, m: PackMeta) => renderToStaticMarkup(createElement(PackReport, { snapshot, meta: m }))

describe('PackReport', () => {
  it('shows the header, policy, status and the verified fingerprint', async () => {
    const snapshot = await buildFixtureSnapshot()
    const m = await meta(snapshot)
    const out = html(snapshot, m)

    expect(out).toContain('Test Overseas Entity')
    expect(out).toContain('OE005000')
    expect(out).toContain('Threshold 25%')
    expect(out).toContain('max depth 10')
    expect(out).toContain('Submitted for approval')
    expect(out).toContain(m.fingerprint)
    expect(out).toContain('Fingerprint verified')
    expect(out).not.toContain('FINGERPRINT MISMATCH')
  })

  it('shows a red mismatch warning, with the recomputed value, when the fingerprint does not verify', async () => {
    const snapshot = await buildFixtureSnapshot()
    const m = await meta(snapshot, { verified: false, recomputed: 'f'.repeat(64) })
    const out = html(snapshot, m)

    expect(out).toContain('FINGERPRINT MISMATCH')
    expect(out).toContain('role="alert"')
    expect(out).toContain('f'.repeat(64))
    expect(out).not.toContain('Fingerprint verified')
    // The printed footer says so on every page too.
    expect(out).toMatch(/print-footer[^>]*>[^<]*FINGERPRINT MISMATCH/)
  })

  it('renders the profile, summary, points to check, chart and every row of the source log', async () => {
    const snapshot = await buildFixtureSnapshot()
    const out = html(snapshot, await meta(snapshot))

    expect(out).toContain('Entity KYC profile')
    expect(out).toContain('Summary')
    expect(out).toContain('Points to check')
    expect(out).toContain('Ownership chart')
    expect(out).toContain('<svg')
    expect(out).toContain('Source log')
    for (const entry of snapshot.sourceLog) {
      expect(out).toContain(entry.register)
      expect(out.replace(/&amp;/g, '&')).toContain(entry.path.replace(/&/g, '&'))
    }
    expect(out).toContain('/companies/OE005000/pscs/raw')
  })

  it('shows individuals as initials only', async () => {
    const snapshot = await buildFixtureSnapshot()
    const out = html(snapshot, await meta(snapshot))
    expect(out).toContain('S.A.S.')
    expect(out).not.toMatch(/Schwarzman|Stephen/i)
  })

  it('has a sign-off block with who prepared, submitted and decided, plus signature lines to print', async () => {
    const snapshot = await buildFixtureSnapshot()
    const approved = html(
      snapshot,
      await meta(snapshot, { status: 'approved', reviewedByName: 'Second Admin', reviewedAt: '2026-10-14T11:00:00Z', reviewNote: 'Checked against the register' }),
    )
    expect(approved).toContain('Sign-off')
    expect(approved).toContain('Prepared by')
    expect(approved).toContain('Plain Member')
    expect(approved).toContain('Second Admin')
    expect(approved).toContain('Checked against the register')
    expect(approved).toContain('Approved by (signature, date)')

    const pending = html(snapshot, await meta(snapshot))
    expect(pending).toContain('Awaiting decision')
  })

  it('has print rules that keep tables and cards together and repeat the fingerprint on every page', async () => {
    const snapshot = await buildFixtureSnapshot()
    const m = await meta(snapshot)
    const out = html(snapshot, m)

    expect(out).toContain('@media print')
    expect(out).toContain('thead { display: table-header-group; }')
    expect(out).toMatch(/tr, \.keep-together \{ break-inside: avoid; page-break-inside: avoid; \}/)
    expect(out).toContain('.no-print')
    expect(out).toMatch(/\.print-footer \{ position: fixed; bottom: 0;/)
    expect(out).toContain(`${m.fingerprint.slice(0, 16)}…${m.fingerprint.slice(-8)}`)
    // The source log and sign-off are real tables, so their rows are protected by the rule above.
    expect(out.match(/<table/g)?.length).toBeGreaterThanOrEqual(2)
    expect(out).toContain('<thead>')
  })

  it('renders only from the snapshot and meta: the same inputs give the same page', async () => {
    const snapshot = await buildFixtureSnapshot()
    const m = await meta(snapshot)
    expect(html(snapshot, m)).toBe(html(structuredClone(snapshot), { ...m }))
  })

  it('hides controls from print', async () => {
    const snapshot = await buildFixtureSnapshot()
    const out = renderToStaticMarkup(createElement(PackReport, { snapshot, meta: await meta(snapshot), controls: createElement('button', null, 'Download PDF') }))
    expect(out).toMatch(/class="no-print[^"]*"[^>]*><button>Download PDF/)
  })
})

describe('StaticChart', () => {
  it('draws every node and edge from the saved positions, dashing GLEIF links', async () => {
    const snapshot = await buildFixtureSnapshot()
    const out = renderToStaticMarkup(createElement(StaticChart, snapshot.chart))
    expect(out.match(/<rect/g)!.length).toBeGreaterThanOrEqual(snapshot.chart.nodes.length)
    expect(out.match(/<polyline/g)!.length).toBe(snapshot.chart.edges.length)
    expect(out).toContain('Individual')

    const dashed = renderToStaticMarkup(
      createElement(StaticChart, {
        nodes: snapshot.chart.nodes.slice(0, 2),
        edges: [{ id: 'e', source: snapshot.chart.nodes[0].id, target: snapshot.chart.nodes[1].id, label: 'consolidates (GLEIF)', dashed: true }],
      }),
    )
    expect(dashed).toContain('stroke-dasharray="6 4"')
    expect(dashed).toContain('consolidates (GLEIF)')
  })

  it('says so when there is no chain', () => {
    expect(renderToStaticMarkup(createElement(StaticChart, { nodes: [], edges: [] }))).toContain('No ownership chain')
  })
})

describe('wrapText', () => {
  it('wraps on words, and ends with an ellipsis when it has to cut', () => {
    expect(wrapText('Alpha Beta Gamma', 11, 3)).toEqual(['Alpha Beta', 'Gamma'])
    expect(wrapText('Alpha Beta Gamma Delta Epsilon', 11, 2)).toEqual(['Alpha Beta', 'Gamma…'])
    expect(wrapText('', 10, 2)).toEqual([])
  })
})
