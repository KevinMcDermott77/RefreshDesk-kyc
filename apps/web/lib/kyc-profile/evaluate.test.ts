import { describe, expect, it } from 'vitest'
import { evaluateProfile, namesMatch, SCREENING_GAP, type ProfileInput, type ProfileRow } from './evaluate'

const HEALTHY_PROFILE: Record<string, unknown> = {
  company_name: "SAINSBURY'S SUPERMARKETS LTD",
  company_number: '03261722',
  company_status: 'active',
  type: 'ltd',
  date_of_creation: '1996-10-10',
  registered_office_address: { address_line_1: '33 Charterhouse Street', locality: 'London', postal_code: 'EC1M 6HA' },
  sic_codes: ['47110'],
  accounts: { next_due: '2026-12-06', overdue: false },
  confirmation_statement: { next_due: '2027-08-15', overdue: false },
}

const ISSUED = {
  status: 'found' as const,
  lei: '213800KMLDLT2PROXX14',
  legalName: "Sainsbury's Supermarkets Limited",
  registrationStatus: 'ISSUED',
  nextRenewalDate: '2027-02-10T00:00:00Z',
}

function input(
  profile: Record<string, unknown> = {},
  overrides: Partial<Omit<ProfileInput, 'profile'>> = {},
): ProfileInput {
  return {
    profile: { ...HEALTHY_PROFILE, ...profile },
    officers: [
      { name: 'GRANT, Nicolas Stuart', officer_role: 'secretary' },
      { name: 'SMITH, John Paul', officer_role: 'director' },
      { name: 'JONES, Ann', officer_role: 'director', resigned_on: '2020-01-01' },
      { name: 'ACME NOMINEES LIMITED', officer_role: 'corporate-nominee-director' },
    ],
    gleif: ISSUED,
    ownership: { status: 'resolved', threshold: 25, owners: ['S.A.S.'], possibleOwners: [] },
    fetchedAt: { profile: '2026-10-07T19:04:00Z' },
    ...overrides,
  }
}

function row(rows: ProfileRow[], key: ProfileRow['key']) {
  return rows.find((r) => r.key === key)!
}

describe('evaluateProfile', () => {
  it('passes a healthy active company', () => {
    const rows = evaluateProfile(input())
    expect(row(rows, 'identity').mark).toBe('PASS')
    expect(row(rows, 'filings').mark).toBe('PASS')
    expect(row(rows, 'lei').mark).toBe('PASS')
    expect(row(rows, 'ownership').mark).toBe('PASS')
  })

  it('marks a dissolved company as a GAP', () => {
    const identity = row(evaluateProfile(input({ company_status: 'dissolved' })), 'identity')
    expect(identity.mark).toBe('GAP')
    expect(identity.note).toMatch(/dissolved/)
  })

  it('marks overdue accounts or confirmation statement as a GAP', () => {
    const accounts = row(evaluateProfile(input({ accounts: { next_due: '2025-01-01', overdue: true } })), 'filings')
    expect(accounts.mark).toBe('GAP')
    expect(accounts.lines[0]).toMatch(/OVERDUE/)
    const confirmation = row(
      evaluateProfile(input({ confirmation_statement: { next_due: '2025-01-01', overdue: true } })),
      'filings',
    )
    expect(confirmation.mark).toBe('GAP')
  })

  it('does not guess filings that Companies House does not provide', () => {
    const filings = row(evaluateProfile(input({ accounts: undefined, confirmation_statement: undefined })), 'filings')
    expect(filings.mark).toBe('INFO')
  })

  it('lists current officers by initials and role only', () => {
    const lines = row(evaluateProfile(input()), 'officers').lines
    expect(lines[0]).toBe('2 active directors, 1 active secretary')
    expect(lines).toContain('N.S.G. — secretary')
    expect(lines).toContain('J.P.S. — director')
    expect(lines.join(' ')).not.toMatch(/Nicolas|JONES|Ann/)
  })

  it('marks a lapsed LEI as a GAP', () => {
    const lei = row(evaluateProfile(input({}, { gleif: { ...ISSUED, registrationStatus: 'LAPSED' } })), 'lei')
    expect(lei.mark).toBe('GAP')
    expect(lei.note).toMatch(/does not endorse/)
  })

  it('marks a name mismatch as a GAP', () => {
    const lei = row(evaluateProfile(input({}, { gleif: { ...ISSUED, legalName: 'SOMEONE ELSE LIMITED' } })), 'lei')
    expect(lei.mark).toBe('GAP')
    expect(lei.lines.join(' ')).toMatch(/differs/)
  })

  it('shows INFO "No LEI" when GLEIF has none', () => {
    const lei = row(evaluateProfile(input({}, { gleif: { status: 'none' } })), 'lei')
    expect(lei.mark).toBe('INFO')
    expect(lei.lines).toEqual(['No LEI'])
  })

  it('marks partial or unresolved ownership as a GAP', () => {
    for (const status of ['partial', 'unresolved'] as const) {
      const rows = evaluateProfile(input({}, { ownership: { status, threshold: 25, owners: [], possibleOwners: [] } }))
      expect(row(rows, 'ownership').mark).toBe('GAP')
    }
  })

  it('always ends with the screening gap', () => {
    const last = evaluateProfile(input()).at(-1)!
    expect(last).toMatchObject({ key: 'not-covered', mark: 'GAP', lines: [SCREENING_GAP] })
  })
})

describe('namesMatch', () => {
  it('ignores case, punctuation and LTD/LIMITED', () => {
    expect(namesMatch("SAINSBURY'S SUPERMARKETS LTD", 'Sainsburys Supermarkets Limited')).toBe(true)
    expect(namesMatch('ACME & SONS LTD', 'Acme and Sons Limited')).toBe(true)
    expect(namesMatch('ACME LTD', 'ACME PLC')).toBe(false)
  })
})
