import { describe, expect, it } from 'vitest'
import { walk } from '../walk'
import { createTerminalChecks } from '../terminals'
import { summarise, toFlow } from '../to-flow'
import { evaluateForeignProfile, listingRow, NO_LISTING_NOTE } from '@/lib/kyc-profile/evaluate'
import type { Evidence, TerminalChecks, WalkResult } from '../types'
import { fixtureFetcher, replayGleif } from './fixture-fetcher'
import { LEIS, recordedLookups } from './terminal-fixtures'

const NORDEA = `LEI:${LEIS.nordea}`
const ALLIANZ = `LEI:${LEIS.allianz}`

function node(result: WalkResult, id: string) {
  const found = result.nodes.find((n) => n.id === id)
  if (!found) throw new Error(`no node ${id}`)
  return found
}

const regulatedEvidence: Evidence = {
  kind: 'regulated_eu',
  source: 'ESMA register of authorised entities (MiFID investment firms)',
  url: 'https://registers.esma.europa.eu/example',
  details: { register: 'ESMA upreg', authority: 'FSA', status: 'Active' },
}

function checks(over: Partial<TerminalChecks> = {}): TerminalChecks {
  return { listedEU: async () => null, regulatedEU: async () => null, usListing: async () => null, ...over }
}

describe('walk with terminal checks — recorded responses', () => {
  const recordedChecks = () => createTerminalChecks(recordedLookups())

  function fetcherFor(scenario: string, terminals: TerminalChecks) {
    return { ...fixtureFetcher({}, replayGleif(scenario).source).fetcher, terminals }
  }

  it('Nordea Bank Abp resolves as listed; its GLEIF exception moves to secondaryReasons', async () => {
    const result = await walk(LEIS.nordea, fetcherFor('nordea', recordedChecks()))
    const nordea = node(result, NORDEA)

    expect(nordea.resolution).toBe('RESOLVED_LISTED')
    expect(nordea.reasonCode).toBeUndefined()
    expect(nordea.secondaryReasons).toContain('GLEIF_EXCEPTION_NATURAL_PERSONS')
    expect(nordea.evidence?.[0]).toMatchObject({ kind: 'listed_eu', details: { isin: 'FI4000297767', mic: 'XHEL', rule: 'mir' } })
    expect(result.status).toBe('resolved')
    // A terminal node is not given a "register stop" profile.
    expect(nordea.registerProfile).toBeUndefined()
  })

  it('DNB Bank ASA resolves as listed', async () => {
    const result = await walk(LEIS.dnb, fetcherFor('dnb', recordedChecks()))
    expect(node(result, `LEI:${LEIS.dnb}`)).toMatchObject({ resolution: 'RESOLVED_LISTED', secondaryReasons: ['GLEIF_EXCEPTION_NON_CONSOLIDATING'] })
  })

  it('Allianz SE, reached as a parent over a GLEIF edge, resolves as listed', async () => {
    const result = await walk('529900H9Q8LI6GGZB203', fetcherFor('lu-1', recordedChecks()))
    const allianz = node(result, ALLIANZ)

    expect(allianz).toMatchObject({ resolution: 'RESOLVED_LISTED', secondaryReasons: ['GLEIF_NO_KNOWN_PERSON'] })
    expect(allianz.reasonCode).toBeUndefined()
    // The consolidation link itself resolves nothing: the target stays an intermediate and the walk is only partial.
    expect(node(result, 'LEI:529900H9Q8LI6GGZB203').resolution).toBe('PENDING')
    expect(result.status).toBe('partial')
  })

  it('shows the evidence in the flow data and the profile row', async () => {
    const result = await walk(LEIS.nordea, fetcherFor('nordea', recordedChecks()))
    const data = toFlow(result).nodes.find((n) => n.id === NORDEA)!.data
    expect(data).toMatchObject({ resolutionLabel: 'Listed company', evidence: [{ kind: 'listed_eu' }] })

    const row = listingRow(data.evidence)
    expect(row).toMatchObject({ key: 'listing', mark: 'PASS', source: { label: 'ESMA FIRDS (instrument reference data)' } })
    expect(row.lines[0]).toContain('FI4000297767 on XHEL')
  })
})

describe('walk with terminal checks — policy and flags', () => {
  const fetcherFor = (terminals: TerminalChecks) => ({ ...fixtureFetcher({}, replayGleif('nordea').source).fetcher, terminals })

  it('a regulated entity terminates by default', async () => {
    const result = await walk(LEIS.nordea, fetcherFor(checks({ regulatedEU: async () => regulatedEvidence })))
    expect(node(result, NORDEA)).toMatchObject({ resolution: 'RESOLVED_REGULATED', secondaryReasons: ['GLEIF_EXCEPTION_NATURAL_PERSONS'] })
  })

  it('does not terminate on a regulated entity when acceptRegulatedAsTerminal is false', async () => {
    const result = await walk(LEIS.nordea, fetcherFor(checks({ regulatedEU: async () => regulatedEvidence })), { acceptRegulatedAsTerminal: false })
    const nordea = node(result, NORDEA)
    expect(nordea).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'GLEIF_EXCEPTION_NATURAL_PERSONS' })
    // The finding is still shown.
    expect(nordea.evidence).toEqual([regulatedEvidence])
  })

  it('a listing terminates even when regulated terminals are switched off', async () => {
    const listed: Evidence = { kind: 'listed_eu', source: 's', url: 'u', details: { isin: 'X', mic: 'XHEL', operatingMic: 'XHEL', venueName: 'v', rule: 'mir' } }
    const result = await walk(LEIS.nordea, fetcherFor(checks({ listedEU: async () => listed })), { acceptRegulatedAsTerminal: false })
    expect(node(result, NORDEA).resolution).toBe('RESOLVED_LISTED')
  })

  it('a US name match is only a secondary flag with ticker and exchange', async () => {
    const us: Evidence = { kind: 'us_listing', source: 'SEC', url: 'u', details: { ticker: 'NDEA', exchange: 'Nasdaq' } }
    const result = await walk(LEIS.nordea, fetcherFor(checks({ usListing: async () => us })))
    const nordea = node(result, NORDEA)

    expect(nordea).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'GLEIF_EXCEPTION_NATURAL_PERSONS' })
    expect(nordea.secondaryReasons).toContain('LISTING_US_UNCONFIRMED')
    expect(result.status).not.toBe('resolved')
    expect(summarise(result).pointsToCheck).toEqual([
      { id: NORDEA, name: nordea.name, code: 'LISTING_US_UNCONFIRMED', detail: 'NDEA on Nasdaq' },
    ])
  })

  it('a US name match alone leaves the node unresolved', async () => {
    const us: Evidence = { kind: 'us_listing', source: 'SEC', url: 'u', details: { ticker: 'T', exchange: 'NYSE' } }
    const none = await walk(LEIS.nordea, fetcherFor(checks({ usListing: async () => us })))
    expect(node(none, NORDEA).resolution).toBe('UNRESOLVED')
  })

  it('a failing source is noted and the walk carries on to the GLEIF stop', async () => {
    const down = checks({
      listedEU: async () => {
        throw new Error('ESMA down')
      },
    })
    const nordea = node(await walk(LEIS.nordea, fetcherFor(down)), NORDEA)
    expect(nordea).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'GLEIF_EXCEPTION_NATURAL_PERSONS' })
    expect(nordea.secondaryReasons).toContain('SOURCE_UNAVAILABLE')
  })

  it('without terminal checks the walk is as before', async () => {
    const nordea = node(await walk(LEIS.nordea, fixtureFetcher({}, replayGleif('nordea').source).fetcher), NORDEA)
    expect(nordea).toMatchObject({ resolution: 'UNRESOLVED', reasonCode: 'GLEIF_EXCEPTION_NATURAL_PERSONS' })
    expect(nordea.evidence).toBeUndefined()
  })
})

describe('profile "Listing / regulation" row', () => {
  it('is INFO when nothing is found', () => {
    expect(listingRow([])).toMatchObject({ key: 'listing', label: 'Listing / regulation', mark: 'INFO', lines: [NO_LISTING_NOTE] })
    expect(listingRow(undefined).mark).toBe('INFO')
  })

  it('is PASS with the evidence for an authorised entity, with the ECB file month', () => {
    const row = listingRow([{ ...regulatedEvidence, details: { ...regulatedEvidence.details, fileMonth: '202608' } }])
    expect(row.mark).toBe('PASS')
    expect(row.lines[0]).toContain('Authorised: ESMA upreg, FSA, Active, file 202608')
  })

  it('appears in the foreign profile between LEI and ownership', () => {
    const rows = evaluateForeignProfile({
      record: { lei: LEIS.nordea, legalName: 'Nordea Bank Abp', registrationStatus: 'ISSUED', entityStatus: 'ACTIVE' },
      listing: [regulatedEvidence],
      ownership: { status: 'resolved', threshold: 25, owners: [], possibleOwners: [] },
    })
    expect(rows.map((r) => r.key)).toEqual(['identity', 'filings', 'officers', 'lei', 'listing', 'ownership', 'not-covered'])
    expect(rows.find((r) => r.key === 'listing')!.mark).toBe('PASS')
  })

  it('mentions an unconfirmed US name match without passing on it', () => {
    const us: Evidence = { kind: 'us_listing', source: 'SEC', url: 'u', details: { ticker: 'ACME', exchange: 'Nasdaq' } }
    const row = listingRow([us])
    expect(row.mark).toBe('INFO')
    expect(row.lines).toContain('US name match, unconfirmed: ACME on Nasdaq')
  })
})
