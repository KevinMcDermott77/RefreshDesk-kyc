import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createGleifHttp, createLimiter, type GleifHttp } from '@/lib/kyc-profile/gleif'
import {
  evaluateForeignProfile,
  evaluateProfile,
  LISTED_OWNERSHIP_NOTE,
  listingRow,
  ownershipSummary,
} from '@/lib/kyc-profile/evaluate'
import { createReferenceNames, describeAuthority, describeLegalForm, REFERENCE_TTL_MS } from '../gleif-source'
import { ruleText } from '../terminals'
import { createTerminalChecks } from '../terminals'
import { walk } from '../walk'
import type { TerminalChecks } from '../types'
import { fixtureFetcher, replayGleif } from './fixture-fetcher'
import { LEIS, recordedLookups } from './terminal-fixtures'

const NAMES = path.resolve(__dirname, '../../../../../__fixtures__/gleif/reference/names.json')
const recorded = JSON.parse(readFileSync(NAMES, 'utf8')) as Record<string, { status: number; body: unknown }>

function replayNames() {
  const get = vi.fn(async (p: string, _options?: { ttlMs?: number }) => {
    const hit = recorded[p]
    if (!hit) throw new Error(`not recorded: ${p}`)
    return hit
  })
  return { get, names: createReferenceNames({ get } as GleifHttp) }
}

describe('legal form names (ELF codes)', () => {
  it('shows the local name and the code', async () => {
    expect(await replayNames().names.legalForm('K6VE')).toBe('Julkinen osakeyhtiö (K6VE)')
  })

  it('adds the transliteration when GLEIF gives one that differs', () => {
    const body = { data: { attributes: { names: [{ localName: 'Акционерное общество', transliteratedName: 'Aktsionernoe obshchestvo' }] } } }
    expect(describeLegalForm('R2YF', body)).toBe('Акционерное общество / Aktsionernoe obshchestvo (R2YF)')
  })

  it('falls back to the bare code for an unnamed, unknown or unreachable code', async () => {
    const { names } = replayNames()
    expect(await names.legalForm('8888')).toBe('8888')
    expect(await names.legalForm('ZZZZ')).toBe('ZZZZ')
    const down = createReferenceNames({ get: async () => Promise.reject(new Error('down')) })
    expect(await down.legalForm('K6VE')).toBe('K6VE')
  })
})

describe('registration authority names (RA codes)', () => {
  it("shows the register's international name, its organisation and the RA code", async () => {
    expect(await replayNames().names.registrationAuthority('RA000188')).toBe(
      'The Business Information System (BIS), Finnish Patent and Registration Office (RA000188)',
    )
    expect(await replayNames().names.registrationAuthority('RA000585')).toBe('Companies Register, Companies House (RA000585)')
  })

  it('shows the wording GLEIF gives its placeholder code, and the bare code when there is no name', async () => {
    expect(await replayNames().names.registrationAuthority('RA999999')).toBe('No Registration Authority available (RA999999)')
    expect(describeAuthority('RAX', {})).toBe('RAX')
  })
})

describe('reference-name caching', () => {
  it('asks the shared client for a 30 day cache', async () => {
    const { get, names } = replayNames()
    await names.legalForm('K6VE')
    await names.registrationAuthority('RA000188')
    expect(get.mock.calls.map((c) => c[1])).toEqual([{ ttlMs: REFERENCE_TTL_MS }, { ttlMs: REFERENCE_TTL_MS }])
    expect(REFERENCE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('the client keeps such a response for 30 days but ordinary ones for 24 hours', async () => {
    let t = 0
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200 }))
    const http = createGleifHttp({ fetchImpl: fetchImpl as unknown as typeof fetch, now: () => t, limiter: createLimiter(50), cache: new Map() })

    await http.get('/entity-legal-forms/K6VE', { ttlMs: REFERENCE_TTL_MS })
    await http.get('/lei-records/X')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    t = 29 * 24 * 3600 * 1000
    await http.get('/entity-legal-forms/K6VE', { ttlMs: REFERENCE_TTL_MS })
    expect(fetchImpl).toHaveBeenCalledTimes(2) // still cached after 29 days
    await http.get('/lei-records/X')
    expect(fetchImpl).toHaveBeenCalledTimes(3) // the 24 hour entry has expired
    t = 31 * 24 * 3600 * 1000
    await http.get('/entity-legal-forms/K6VE', { ttlMs: REFERENCE_TTL_MS })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })
})

describe('foreign identity lines', () => {
  const record = { lei: LEIS.nordea, legalName: 'Nordea Bank Abp', legalForm: 'K6VE', registeredAt: 'RA000188', registeredAs: '2858394-9', registrationStatus: 'ISSUED', entityStatus: 'ACTIVE' }
  const ownership = { status: 'resolved' as const, threshold: 25, owners: [], possibleOwners: [] }

  it('uses the resolved names, keeping the codes', async () => {
    const { names } = replayNames()
    const rows = evaluateForeignProfile({
      record,
      ownership,
      labels: { legalForm: await names.legalForm('K6VE'), registrationAuthority: await names.registrationAuthority('RA000188') },
    })
    const lines = rows.find((r) => r.key === 'identity')!.lines
    expect(lines).toContain('Legal form: Julkinen osakeyhtiö (K6VE)')
    expect(lines).toContain('Registration authority: The Business Information System (BIS), Finnish Patent and Registration Office (RA000188), number 2858394-9')
  })

  it('falls back to the raw codes without labels', () => {
    const lines = evaluateForeignProfile({ record, ownership }).find((r) => r.key === 'identity')!.lines
    expect(lines).toContain('Legal form: K6VE')
    expect(lines).toContain('Registration authority: RA000188, number 2858394-9')
  })
})

describe('venue rule wording', () => {
  it('uses friendly text for each rule', () => {
    expect(ruleText('mir')).toBe('ESMA regulated-market list')
    expect(ruleText('operating-mic')).toContain('exchange on the ESMA regulated-market list')
    expect(ruleText('iso-rmkt')).toContain('ISO 10383')
    expect(ruleText('other')).toBe('other')
  })

  it('appears in the listing row instead of the raw rule', () => {
    const row = listingRow([
      { kind: 'listed_eu', source: 's', url: 'u', details: { isin: 'FI4000297767', mic: 'XHEL', operatingMic: 'XHEL', venueName: 'Nasdaq Helsinki Oy', rule: 'mir' } },
    ])
    expect(row.lines[0]).toBe('Listed on a regulated market: FI4000297767 on XHEL (Nasdaq Helsinki Oy), ESMA regulated-market list')
    expect(row.lines[0]).not.toContain('mir')
  })
})

describe('listed-company rule in the ownership row', () => {
  const fetcherFor = (scenario: string, terminals: TerminalChecks) => ({ ...fixtureFetcher({}, replayGleif(scenario).source).fetcher, terminals })

  it('Nordea (listed, also authorised): the rule, then the authorisation as a secondary line', async () => {
    const result = await walk(LEIS.nordea, fetcherFor('nordea', createTerminalChecks(recordedLookups())))
    const summary = ownershipSummary(result, 25)
    expect(summary.listed).toEqual({ alsoAuthorised: { register: 'ESMA upreg', authority: 'Finanssivalvonta (FSA)' } })

    const record = { lei: LEIS.nordea, legalName: 'Nordea Bank Abp', registrationStatus: 'ISSUED', entityStatus: 'ACTIVE' }
    const row = evaluateForeignProfile({ record, ownership: summary }).find((r) => r.key === 'ownership')!
    expect(row.mark).toBe('PASS')
    expect(row.lines).toEqual([
      'Walk status: resolved',
      LISTED_OWNERSHIP_NOTE,
      'Also authorised: ESMA upreg, Finanssivalvonta (FSA)',
    ])
    expect(LISTED_OWNERSHIP_NOTE).toBe(
      "Listed on an EEA/UK regulated market. Beneficial owners need not be identified (MLR 2017 reg. 28(5)); confirm against your firm's policy.",
    )
  })

  it('a listed parent reached over GLEIF (Allianz, not authorised): the rule, no "Also authorised" line', async () => {
    const result = await walk('529900H9Q8LI6GGZB203', fetcherFor('lu-1', createTerminalChecks(recordedLookups())))
    expect(ownershipSummary(result, 25).listed).toEqual({})
  })

  it('a UK target whose chain ends at a listed plc gets the same rule', async () => {
    const result = await walk('03261722', fixtureFetcher().fetcher)
    const summary = ownershipSummary(result, 25)
    expect(summary.listed).toEqual({})

    const rows = evaluateProfile({
      profile: { company_number: '03261722', company_name: "SAINSBURY'S SUPERMARKETS LTD" },
      officers: [],
      gleif: { status: 'none' },
      ownership: summary,
      fetchedAt: {},
    })
    const lines = rows.find((r) => r.key === 'ownership')!.lines
    expect(lines).toContain(LISTED_OWNERSHIP_NOTE)
    expect(lines.some((l) => l.startsWith('No beneficial owners identified'))).toBe(false)
  })

  it('an entity that is not listed keeps the plain wording', async () => {
    const result = await walk(LEIS.nordea, fetcherFor('nordea', { listedEU: async () => null, regulatedEU: async () => null, usListing: async () => null }))
    const summary = ownershipSummary(result, 25)
    expect(summary.listed).toBeUndefined()
    const record = { lei: LEIS.nordea, legalName: 'Nordea Bank Abp', registrationStatus: 'ISSUED', entityStatus: 'ACTIVE' }
    const lines = evaluateForeignProfile({ record, ownership: summary }).find((r) => r.key === 'ownership')!.lines
    expect(lines).not.toContain(LISTED_OWNERSHIP_NOTE)
  })
})
