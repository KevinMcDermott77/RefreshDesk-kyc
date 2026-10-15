import { describe, expect, it } from 'vitest'
import { evaluateForeignProfile, evaluateProfile, LISTED_OWNERSHIP_NOTE, listingDecision, listingRow, NO_LISTING_NOTE, ownershipSummary } from '@/lib/kyc-profile/evaluate'
import { createTerminalChecks } from '../terminals'
import { walk } from '../walk'
import type { TerminalChecks } from '../types'
import { fixtureFetcher, replayGleif } from './fixture-fetcher'
import { LEIS, recordedLookups } from './terminal-fixtures'

const none: TerminalChecks = { listedEU: async () => null, regulatedEU: async () => null, usListing: async () => null }

function ukProfile(companyNumber: string, name: string, result: Awaited<ReturnType<typeof walk>>, listing = listingDecision(result)) {
  return evaluateProfile({
    profile: { company_number: companyNumber, company_name: name },
    officers: [],
    gleif: { status: 'none' },
    ownership: ownershipSummary(result, 25),
    listingDecision: listing,
    fetchedAt: {},
  })
}

describe('listing row follows the walk’s terminal decision', () => {
  it('00185647 (J Sainsbury plc): listed by Companies House exemption, so the row and the Ownership row agree', async () => {
    const result = await walk('00185647', fixtureFetcher().fetcher)
    expect(result.nodes.find((n) => n.id === result.rootId)).toMatchObject({ resolution: 'RESOLVED_LISTED' })

    // The ESMA checks on the plc's LEI came back empty: UK listings are not in the EU data.
    const decision = listingDecision(result, {
      checks: [
        { check: 'esma_firds', outcome: 'none' },
        { check: 'esma_upreg', outcome: 'none' },
      ],
    })
    const rows = ukProfile('00185647', 'J SAINSBURY PLC', result, decision)
    const listing = rows.find((r) => r.key === 'listing')!
    const ownership = rows.find((r) => r.key === 'ownership')!

    expect(ownership.lines).toContain(LISTED_OWNERSHIP_NOTE)
    expect(listing.mark).toBe('PASS')
    expect(listing.lines.join('\n')).not.toContain(NO_LISTING_NOTE)
    // Venue and MIC are not in the Companies House data: the row says so instead of guessing.
    expect(listing.lines[0]).toBe(
      'Listed on a UK regulated market: Companies House PSC exemption (psc-exempt-as-trading-on-uk-regulated-market). Companies House does not state the venue or MIC.',
    )
    expect(listing.source).toEqual({
      label: 'Companies House PSC register',
      url: 'https://find-and-update.company-information.service.gov.uk/company/00185647/persons-with-significant-control',
    })
    // Which checks ran, in the order they ran.
    expect(listing.lines.at(-1)).toBe(
      'Checks run: Companies House PSC exemption (UK regulated market) found; ESMA FIRDS (EU regulated-market listing) nothing found; ESMA register of authorised firms nothing found',
    )
  })

  it('a subsidiary (Sainsbury’s Supermarkets Ltd) is not listed itself, and the row names the listed parent', async () => {
    const result = await walk('03261722', fixtureFetcher().fetcher)
    const decision = listingDecision(result, { checks: [{ check: 'esma_firds', outcome: 'none' }, { check: 'esma_upreg', outcome: 'none' }] })
    expect(decision.terminal).toMatchObject({ isRoot: false, resolution: 'RESOLVED_LISTED' })

    const rows = ukProfile('03261722', "SAINSBURY'S SUPERMARKETS LTD", result, decision)
    const listing = rows.find((r) => r.key === 'listing')!
    expect(listing.mark).toBe('INFO')
    expect(listing.lines[0]).toContain('This entity is not listed itself. The ownership chain ends at a listed company:')
    expect(listing.lines[0]).toContain(decision.terminal!.name)
    expect(listing.lines.join('\n')).not.toContain(NO_LISTING_NOTE)
    expect(listing.lines.some((l) => l.startsWith(`Checks run on ${decision.terminal!.name}: Companies House PSC exemption (UK regulated market) found`))).toBe(true)
    expect(listing.lines.at(-1)).toContain('Checks run on this entity: Companies House PSC exemption (UK regulated market) nothing found; ESMA FIRDS')
    expect(listing.source?.url).toContain('/company/00185647/persons-with-significant-control')
    expect(rows.find((r) => r.key === 'ownership')!.lines).toContain(LISTED_OWNERSHIP_NOTE)
  })

  it('an EU listing shows the ISIN, MIC, venue, rule and the source, plus the checks that ran', async () => {
    const fetcher = { ...fixtureFetcher({}, replayGleif('nordea').source).fetcher, terminals: createTerminalChecks(recordedLookups()) }
    const result = await walk(LEIS.nordea, fetcher)
    const rows = evaluateForeignProfile({
      record: { lei: LEIS.nordea, legalName: 'Nordea Bank Abp', registrationStatus: 'ISSUED', entityStatus: 'ACTIVE' },
      listingDecision: listingDecision(result),
      ownership: ownershipSummary(result, 25),
    })
    const listing = rows.find((r) => r.key === 'listing')!
    expect(listing.mark).toBe('PASS')
    expect(listing.lines[0]).toContain('FI4000297767 on XHEL (')
    expect(listing.source?.label).toBe('ESMA FIRDS (instrument reference data)')
    expect(listing.lines.at(-1)).toBe(
      'Checks run: SEC US name match (needs SEC_USER_AGENT) nothing found; ESMA FIRDS (EU regulated-market listing) found; ESMA register of authorised firms found',
    )
  })

  it('nothing found: the row says no listing and which checks found nothing', async () => {
    const fetcher = { ...fixtureFetcher({}, replayGleif('nordea').source).fetcher, terminals: none }
    const result = await walk(LEIS.nordea, fetcher)
    const listing = evaluateForeignProfile({
      record: { lei: LEIS.nordea, legalName: 'Nordea Bank Abp', registrationStatus: 'ISSUED', entityStatus: 'ACTIVE' },
      listingDecision: listingDecision(result),
      ownership: ownershipSummary(result, 25),
    }).find((r) => r.key === 'listing')!
    expect(listing.mark).toBe('INFO')
    expect(listing.lines[0]).toBe(NO_LISTING_NOTE)
    expect(listing.lines.at(-1)).toBe(
      'Checks run: SEC US name match (needs SEC_USER_AGENT) nothing found; ESMA FIRDS (EU regulated-market listing) nothing found; ESMA register of authorised firms nothing found',
    )
  })

  it('a source that was down is reported as not checked, never as "nothing found"', async () => {
    const down: TerminalChecks = {
      ...none,
      listedEU: async () => {
        throw new Error('ESMA down')
      },
    }
    const result = await walk(LEIS.nordea, { ...fixtureFetcher({}, replayGleif('nordea').source).fetcher, terminals: down })
    const listing = evaluateForeignProfile({
      record: { lei: LEIS.nordea, legalName: 'Nordea Bank Abp', registrationStatus: 'ISSUED', entityStatus: 'ACTIVE' },
      listingDecision: listingDecision(result),
      ownership: ownershipSummary(result, 25),
    }).find((r) => r.key === 'listing')!
    expect(listing.lines.at(-1)).toContain('ESMA FIRDS (EU regulated-market listing) source unavailable, not checked')
  })

  it('without a decision the row reads only the evidence it is given, as before', () => {
    expect(listingRow([]).lines).toEqual([NO_LISTING_NOTE])
  })
})
