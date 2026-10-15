import { describe, expect, it } from 'vitest'
import { walk } from '../walk'
import { overallText, summarise, toFlow } from '../to-flow'
import { evaluateForeignProfile, evaluateProfile, ownershipSummary } from '@/lib/kyc-profile/evaluate'
import { buildSnapshot, parseSnapshot } from '@/lib/packs/snapshot'
import { createEvidenceLoader, individualNamesIn, toClientEvidenceItems } from '@/lib/evidence/load'
import { pendingEvidencePoints } from '@/lib/evidence/pending'
import { parseEvidenceUploadInput } from '@/lib/evidence/input'
import type { ClientEvidenceItem, GleifSource } from '../types'
import { fixtureFetcher, profile, pscList } from './fixture-fetcher'

// Invented names only.
const NOW = '2026-10-16T12:00:00.000Z'

const evidence: ClientEvidenceItem = {
  id: 'ev-1',
  nodeIdentity: { country: 'NO', registrationNumber: '923609016' },
  evidenceKind: 'shareholder_register',
  asAt: '2026-06-30',
  documentDate: '2026-07-15',
  certified: 'yes',
  confirmedAt: '2026-08-01T09:00:00.000Z',
  edited: true,
  documentSha256: 'b'.repeat(64),
  ownersComplete: true,
  override: { reasons: ['stale'], note: 'a note that must stay off the walk' },
  owners: [
    { kind: 'individual', label: 'T.A.', holding: { type: 'percent', value: 85 }, registration: null, leiShown: null, pageRef: 'p.2' },
    { kind: 'individual', label: 'K.E.', holding: { type: 'percent', value: 15 }, registration: null, leiShown: null, pageRef: 'p.2' },
  ],
}

const gleif: GleifSource = { getRecord: async () => null, findByRegistration: async () => [], getDirectParent: async () => ({}) }

async function walkWith(items: ClientEvidenceItem[], policy = {}) {
  const { fetcher } = fixtureFetcher(
    {
      AA000001: {
        profile: profile('AA000001', 'ACME UK LIMITED'),
        pscs: pscList({
          kind: 'corporate-entity-person-with-significant-control',
          name: 'Fjordholding AS',
          natures_of_control: ['ownership-of-shares-75-to-100-percent'],
          identification: { country_registered: 'Norway', registration_number: '923609016' },
        }),
      },
    },
    gleif,
  )
  return walk('AA000001', { ...fetcher, clientEvidence: async () => items }, { now: NOW, ...policy })
}

describe('chart and summary', () => {
  it('labels evidence owners and edges, and carries the evidence on the node', async () => {
    const flow = toFlow(await walkWith([evidence]))
    const owner = flow.nodes.find((n) => n.data.name === 'T.A.')!
    expect(owner.data).toMatchObject({ resolutionLabel: 'Individual (client evidence)', viaClientEvidence: 'ev-1' })
    const stop = flow.nodes.find((n) => n.data.clientEvidence)!
    expect(stop.data).toMatchObject({ resolutionLabel: 'Intermediate', clientEvidence: { id: 'ev-1', applied: true } })
    const edge = flow.edges.find((e) => e.source === owner.id)!
    expect(edge).toMatchObject({ client: true, label: '85-85% (client evidence)' })
    expect(edge.dashed).toBeUndefined()
  })

  it('the summary lists the evidence used, without the certifier’s text or any override note', async () => {
    const result = await walkWith([evidence])
    const summary = summarise(result)
    expect(summary.status).toBe('resolved_client_evidence')
    expect(summary.clientEvidence).toEqual([
      {
        nodeId: 'GB:AA000001/psc/0',
        nodeName: 'Fjordholding AS',
        evidenceId: 'ev-1',
        kind: 'shareholder_register',
        asAt: '2026-06-30',
        documentDate: '2026-07-15',
        certified: 'yes',
        confirmedAt: '2026-08-01T09:00:00.000Z',
        edited: true,
        override: ['stale'],
        applied: true,
      },
    ])
    expect(JSON.stringify([summary, toFlow(result)])).not.toContain('a note that must stay off')
  })

  it('says "Complete — N branches resolved on client evidence" for that status, and the plain status otherwise', async () => {
    expect(overallText(summarise(await walkWith([evidence])))).toBe('Complete — 1 branch resolved on client evidence')
    expect(overallText(summarise(await walkWith([])))).toBe('unresolved')
    expect(overallText({ status: 'resolved', clientEvidence: [] })).toBe('resolved')
    expect(overallText({ status: 'resolved_client_evidence', clientEvidence: [{ applied: true }, { applied: true }, { applied: false }] as never })).toBe(
      'Complete — 2 branches resolved on client evidence',
    )
  })

  it('with the policy off, the summary notes the evidence is not accepted', async () => {
    const summary = summarise(await walkWith([evidence], { acceptClientEvidenceAsResolved: false }))
    expect(summary.status).toBe('unresolved')
    expect(summary.clientEvidence[0]).toMatchObject({ applied: false, notApplied: ['policy'] })
    expect(summary.pointsToCheck).toEqual([{ id: 'GB:AA000001/psc/0', name: 'Fjordholding AS', code: 'CLIENT_EVIDENCE_NOT_ACCEPTED' }])
  })

  it('evidence that could not be used appears in the gap list under its own code', async () => {
    const summary = summarise(await walkWith([{ ...evidence, certified: 'no', override: null }]))
    expect(summary.unresolved).toEqual([expect.objectContaining({ id: 'GB:AA000001/psc/0', reasonCode: 'CLIENT_EVIDENCE_UNCERTIFIED' })])
    expect(summary.clientEvidence[0]).toMatchObject({ applied: false, notApplied: ['uncertified'] })
  })
})

describe('profile rows', () => {
  const profileInput = (ownership: ReturnType<typeof ownershipSummary>) =>
    evaluateProfile({
      profile: { company_number: 'AA000001', company_name: 'ACME UK LIMITED' },
      officers: [],
      gleif: { status: 'none' },
      ownership,
      fetchedAt: {},
    })

  it('shows a walk resolved on evidence as a pass, in its own words, never as a plain "resolved"', async () => {
    const result = await walkWith([evidence])
    const row = profileInput(ownershipSummary(result, 25)).find((r) => r.key === 'ownership')!
    expect(row.mark).toBe('PASS')
    expect(row.lines[0]).toBe('Walk status: resolved (client evidence)')
    expect(row.lines).toContain('1 branch resolved on client-provided, reviewer-verified evidence')
  })

  it('says when evidence could not be used, or the policy does not accept it', async () => {
    const stale = ownershipSummary(await walkWith([{ ...evidence, asAt: '2024-01-01', documentDate: null, override: null }]), 25)
    expect(stale.clientEvidence).toEqual({ applied: 0, notUsed: 1, notAcceptedByPolicy: 0 })
    const row = profileInput(stale).find((r) => r.key === 'ownership')!
    expect(row.mark).toBe('GAP')
    expect(row.lines.some((l) => /could not be used \(stale, uncertified or incomplete\)/.test(l))).toBe(true)

    const off = ownershipSummary(await walkWith([evidence], { acceptClientEvidenceAsResolved: false }), 25)
    expect(off.clientEvidence).toEqual({ applied: 0, notUsed: 0, notAcceptedByPolicy: 1 })
    expect(profileInput(off).find((r) => r.key === 'ownership')!.lines.some((l) => /not accepted as resolving by the policy/.test(l))).toBe(true)
  })

  it('has no evidence lines when the walk met none, and the foreign profile behaves the same way', async () => {
    const none = ownershipSummary(await walkWith([]), 25)
    expect(none.clientEvidence).toBeUndefined()
    expect(profileInput(none).find((r) => r.key === 'ownership')!.lines).toEqual(['Walk status: unresolved', 'No beneficial owners identified at or above 25%'])

    const used = ownershipSummary(await walkWith([evidence]), 25)
    const foreign = evaluateForeignProfile({
      record: { lei: '529900ABCDEFGHIJKL12', legalName: 'Test AS', registrationStatus: 'ISSUED', entityStatus: 'ACTIVE' },
      ownership: used,
    }).find((r) => r.key === 'ownership')!
    expect(foreign.mark).toBe('PASS')
    expect(foreign.lines.slice(0, 2)).toEqual(['Walk status: resolved (client evidence)', '1 branch resolved on client-provided, reviewer-verified evidence'])
  })
})

describe('refresh pack snapshot', () => {
  it('is complete when resolved on evidence, keeps the new walk status, and holds no name', async () => {
    const result = await walkWith([evidence])
    const summary = summarise(result)
    const snapshot = buildSnapshot({
      subject: { id: 'AA000001', kind: 'company', name: 'ACME UK LIMITED' },
      policy: { threshold: 25, maxDepth: 6, indirectMethod: 'either', acceptRegulatedAsTerminal: true, acceptClientEvidenceAsResolved: true, maxEvidenceAgeMonths: 12 },
      walked: result,
      profile: [],
      flow: toFlow(result),
      summary,
      sourceLog: [],
      // The names that must not appear (what admins receive from the database).
      individualNames: ['Testperson Alpha', 'Kari Eksempel'],
      now: new Date(NOW),
    })
    expect(snapshot.summary).toMatchObject({ status: 'complete', walkStatus: 'resolved_client_evidence', openBranches: 0 })
    expect(snapshot.policy).toMatchObject({ acceptClientEvidenceAsResolved: true, maxEvidenceAgeMonths: 12 })
    expect(() => parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).not.toThrow()
    expect(JSON.stringify(snapshot)).not.toMatch(/Testperson|Eksempel|must stay off/)
  })

  it('still masks a full name if one ever reaches the walk, and the leak check passes on the masked chart', async () => {
    const result = await walkWith([{ ...evidence, owners: [{ ...evidence.owners[0], label: 'Testperson Alpha' }, evidence.owners[1]] }])
    const snapshot = buildSnapshot({
      subject: { id: 'AA000001', kind: 'company', name: 'ACME' },
      policy: { threshold: 25, maxDepth: 6, indirectMethod: 'either', acceptRegulatedAsTerminal: true },
      walked: result,
      profile: [],
      flow: toFlow(result),
      summary: summarise(result),
      sourceLog: [],
      individualNames: ['Testperson Alpha'],
    })
    expect(JSON.stringify(snapshot)).not.toContain('Testperson')
    expect(JSON.stringify(snapshot)).toContain('T.A.')
  })
})

describe('loading evidence from the database', () => {
  const rpcItem = (over: Record<string, unknown> = {}) => ({
    id: 'ev-1',
    node_key: 'REG:NO:923609016',
    node_identity: { country: 'NO', registration_number: '923 609 016' },
    evidence_kind: 'shareholder_register',
    as_at: '2026-06-30',
    document_date: null,
    certified: 'yes',
    certified_by: 'Company secretary',
    edited: false,
    confirmed_at: '2026-08-01T09:00:00+00:00',
    document_sha256: 'b'.repeat(64),
    payload: {
      owners_complete: true,
      override: { reasons: ['uncertified'], note: 'n' },
      owners: [
        { kind: 'individual', name_as_shown: 'Testperson Alpha', initials: 'T.A.', holding: { type: 'percent', value: 60 }, page_ref: 'p.3' },
        { kind: 'entity', name_as_shown: 'Example Holdings AS', holding: { type: 'band', low: 10, high: 30 }, registration: { number: '999000002', country: 'NO' }, page_ref: 'p.3' },
      ],
    },
    ...over,
  })

  it('turns individuals into initials, keeps an entity’s name, and drops the certifier’s text', () => {
    const [item] = toClientEvidenceItems([rpcItem()])
    expect(item.owners.map((o) => o.label)).toEqual(['T.A.', 'Example Holdings AS'])
    expect(item.nodeIdentity).toEqual({ country: 'NO', registrationNumber: '923 609 016' })
    expect(JSON.stringify(item)).not.toMatch(/Testperson|Company secretary/)
  })

  it('what read_only receives (no names, only initials) loads the same way', () => {
    const stripped = rpcItem({ payload: { owners_complete: true, owners: [{ kind: 'individual', initials: 'T.A.', holding: { type: 'percent', value: 100 }, page_ref: 'p.1' }] } })
    expect(toClientEvidenceItems([stripped])[0].owners[0].label).toBe('T.A.')
  })

  it('leaves out an item that does not parse, and anything that is not a list', () => {
    expect(toClientEvidenceItems([rpcItem({ certified: 'maybe' }), rpcItem({ id: 'ok' })]).map((i) => i.id)).toEqual(['ok'])
    expect(toClientEvidenceItems(null)).toEqual([])
    expect(toClientEvidenceItems({ error: 'x' })).toEqual([])
  })

  it('exposes individuals’ names only through individualNamesIn, for the pack check', () => {
    expect(individualNamesIn([rpcItem()])).toEqual(['Testperson Alpha'])
    expect(individualNamesIn('nope')).toEqual([])
  })

  it('the loader asks for the client and the upper-cased subject, remembers the names and throws when refused', async () => {
    const calls: [string, Record<string, unknown>][] = []
    const ok = createEvidenceLoader({ rpc: async (fn, args) => (calls.push([fn, args]), { data: [rpcItem()], error: null }) }, 'client-1', ' 529900abcdefghijkl12 ')
    expect((await ok.load()).length).toBe(1)
    expect(calls).toEqual([['confirmed_evidence_for', { p_client_id: 'client-1', p_subject_id: '529900ABCDEFGHIJKL12' }]])
    expect(ok.individualNames()).toEqual(['Testperson Alpha'])
    const refused = createEvidenceLoader({ rpc: async () => ({ data: null, error: { message: 'not an active member' } }) }, 'c', 's')
    await expect(refused.load()).rejects.toThrow('not an active member')
  })
})

describe('pending evidence and subject ids', () => {
  it('notes draft and proposed items as points to check, and ignores decided ones', () => {
    expect(
      pendingEvidencePoints([
        { id: 'a', node_name: 'Fjordholding AS', status: 'proposed' },
        { id: 'b', node_name: 'Other AS', status: 'draft' },
        { id: 'c', node_name: 'Done AS', status: 'confirmed' },
        { id: 'd', node_name: 'No AS', status: 'rejected' },
      ]),
    ).toEqual([
      { id: 'evidence:a', name: 'Fjordholding AS', code: 'CLIENT_EVIDENCE_PENDING', detail: 'awaiting confirmation by an admin' },
      { id: 'evidence:b', name: 'Other AS', code: 'CLIENT_EVIDENCE_PENDING', detail: 'uploaded, owners not entered yet' },
    ])
  })

  it('stores the walk subject upper-cased, as the walk looks it up', () => {
    const form = new FormData()
    const fields: Record<string, string> = {
      client_id: '3f2c1d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
      subject_id: ' sc123456 ',
      node_name: 'Fjordholding AS',
      country: 'NO',
      registration_number: '923609016',
      evidence_kind: 'shareholder_register',
      upload_path: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d/3f2c1d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f/11111111-2222-4333-8444-555555555555/r.pdf',
      upload_name: 'r.pdf',
      upload_type: 'application/pdf',
      upload_size: '1000',
    }
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    expect(parseEvidenceUploadInput(form)).toMatchObject({ ok: true, input: { subjectId: 'SC123456' } })
  })
})
