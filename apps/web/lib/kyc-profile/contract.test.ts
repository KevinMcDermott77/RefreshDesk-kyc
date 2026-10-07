import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluateProfile, type ProfileRow } from './evaluate'

const DIR = path.resolve(__dirname, '../../../../__fixtures__/kyc-search')

function fixture(file: string) {
  return JSON.parse(readFileSync(path.join(DIR, file), 'utf8')) as { fetchedAt?: string; body: Record<string, unknown> }
}

const profile = fixture('03261722-profile-raw.json')
const officers = fixture('03261722-officers-raw.json')

const rows = evaluateProfile({
  profile: profile.body,
  officers: officers.body.items as unknown[],
  gleif: { status: 'none' },
  ownership: { status: 'resolved', threshold: 25, owners: [], possibleOwners: [] },
  fetchedAt: { profile: profile.fetchedAt, officers: officers.fetchedAt },
})
const row = (key: ProfileRow['key']) => rows.find((r) => r.key === key)!

describe('KYC profile from recorded kyc-search /raw responses (03261722)', () => {
  it('shows real filing due dates', () => {
    const filings = row('filings')
    expect(filings.mark).toBe('PASS')
    expect(filings.lines).toEqual(['Accounts: next due 6 Dec 2026', 'Confirmation statement: next due 15 Aug 2027'])
  })

  it('shows identity from the raw profile', () => {
    const identity = row('identity')
    expect(identity.mark).toBe('PASS')
    expect(identity.lines).toContain('SIC codes: 47110')
    expect(identity.lines).toContain('Legal form: Private limited company')
  })

  it('counts active directors and lists officers by initials only', () => {
    const officersRow = row('officers')
    expect(officersRow.lines[0]).toBe('7 active directors, 1 active secretary')
    expect(officersRow.lines).toContain('N.S.G. — secretary')
    expect(officersRow.lines.every((line, i) => i === 0 || /^[A-Z]\.([A-Z]\.)* — /.test(line))).toBe(true)
  })

  it('keeps no personal data on individual officers in the fixture', () => {
    const raw = readFileSync(path.join(DIR, '03261722-officers-raw.json'), 'utf8')
    for (const field of ['date_of_birth', 'nationality', 'country_of_residence', 'occupation']) {
      expect(raw).not.toContain(field)
    }
    const items = officers.body.items as { name: string; officer_role: string; address?: unknown }[]
    for (const item of items.filter((i) => !i.officer_role.startsWith('corporate-'))) {
      expect(item.address).toBeUndefined()
      expect(item.name).toMatch(/^([A-Z]\.)+$/)
    }
  })
})
