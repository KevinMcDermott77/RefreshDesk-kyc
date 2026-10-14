import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { chargesRow, evaluateProfile, type ProfileInput } from './evaluate'

const CH = 'https://find-and-update.company-information.service.gov.uk/company/'

function input(profile: Record<string, unknown>): ProfileInput {
  return {
    profile: { company_number: '03261722', company_name: 'ACME LTD', company_status: 'active', ...profile },
    officers: [],
    gleif: { status: 'none' },
    ownership: { status: 'resolved', threshold: 25, owners: [], possibleOwners: [] },
    fetchedAt: { profile: '2026-10-07T19:04:00Z' },
  }
}

describe('Charges & insolvency row', () => {
  it('is PASS with neither charges nor insolvency history', () => {
    const row = chargesRow(input({ has_charges: false, has_insolvency_history: false }))
    expect(row).toMatchObject({ key: 'charges', label: 'Charges & insolvency', mark: 'PASS' })
    expect(row.lines).toEqual(['Insolvency history: none', 'Charges: none'])
  })

  it('is INFO when charges exist, with a link to the charges page', () => {
    const row = chargesRow(input({ has_charges: true, has_insolvency_history: false }))
    expect(row.mark).toBe('INFO')
    expect(row.source).toEqual({ label: 'Companies House charges', url: `${CH}03261722/charges` })
    expect(row.lines[1]).toContain('Charges: yes')
  })

  it('is GAP when there is insolvency history, with or without charges, and links to the insolvency page', () => {
    for (const has_charges of [false, true]) {
      const row = chargesRow(input({ has_charges, has_insolvency_history: true }))
      expect(row.mark).toBe('GAP')
      expect(row.lines[0]).toBe('Insolvency history: yes')
      expect(row.links).toEqual([{ label: 'Insolvency', url: `${CH}03261722/insolvency` }])
      expect(row.note).toMatch(/insolvency history/)
    }
  })

  it('is INFO, not PASS, when Companies House gives neither flag', () => {
    const row = chargesRow(input({}))
    expect(row.mark).toBe('INFO')
    expect(row.lines).toEqual(['Not provided by Companies House for this entity'])
  })

  it('does not call a missing flag a clean result', () => {
    const row = chargesRow(input({ has_insolvency_history: false }))
    expect(row.mark).toBe('PASS')
    expect(row.lines).toContain('Charges: not provided')
  })

  it('sits after Filings in the profile', () => {
    const keys = evaluateProfile(input({ has_charges: false, has_insolvency_history: false })).map((r) => r.key)
    expect(keys.slice(0, 4)).toEqual(['identity', 'filings', 'charges', 'officers'])
  })

  it('reads the recorded 03261722 profile as clean', () => {
    const raw = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../../../__fixtures__/kyc-search/03261722-profile-raw.json'), 'utf8'),
    ) as { body: Record<string, unknown> }
    expect(chargesRow(input(raw.body)).mark).toBe('PASS')
  })
})

describe('Identity row links', () => {
  it('links to the filing history and to incorporation documents', () => {
    const identity = evaluateProfile(input({})).find((r) => r.key === 'identity')!
    expect(identity.links).toEqual([
      { label: 'Filing history', url: `${CH}03261722/filing-history` },
      { label: 'Incorporation documents', url: `${CH}03261722/filing-history?category=incorporation` },
    ])
  })
})
