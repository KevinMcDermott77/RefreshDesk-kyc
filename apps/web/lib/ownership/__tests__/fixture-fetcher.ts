import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Fetched, GleifParents, OwnershipFetcher } from '../types'

const FIXTURES = path.resolve(__dirname, '../../../../../__fixtures__')

export type CompanyFixture = {
  profile?: Fetched
  pscs?: Fetched
  psc_statements?: Fetched
  exemptions?: Fetched
  gleif?: GleifParents
}

const GLEIF_EXCEPTION_FILES = ['direct-parent-reporting-exception', 'ultimate-parent-reporting-exception']

function readGleif(companyNumber: string): GleifParents | null {
  const dir = path.join(FIXTURES, 'gleif', companyNumber)
  // record.json is the raw GLEIF record, not a { status, body } envelope.
  const record = path.join(dir, 'record.json')
  if (!existsSync(record)) return null
  const { id } = JSON.parse(readFileSync(record, 'utf8')) as { id?: string }
  if (!id) return null

  const reportingExceptions = GLEIF_EXCEPTION_FILES.flatMap((file) => {
    const fixture = path.join(dir, `${file}.json`)
    if (!existsSync(fixture)) return []
    const { status, body } = JSON.parse(readFileSync(fixture, 'utf8')) as {
      status: number
      body: { data?: { attributes?: { reason?: string } } }
    }
    const reason = status === 200 ? body.data?.attributes?.reason : undefined
    return reason ? [reason] : []
  })

  return { lei: id, reportingExceptions }
}

const NOT_FOUND: Fetched = { status: 404, body: null }

/**
 * Serves recorded Companies House / GLEIF responses from __fixtures__, or from
 * in-memory synthetic companies when given. Any lookup with no fixture is
 * recorded in `misses` so tests can assert the walk stayed inside the data.
 */
export function fixtureFetcher(synthetic?: Record<string, CompanyFixture>) {
  const misses: string[] = []
  const calls: string[] = []

  function ch(companyNumber: string, file: Exclude<keyof CompanyFixture, 'gleif'>): Fetched {
    calls.push(`${companyNumber}/${file}`)
    if (synthetic) {
      const company = synthetic[companyNumber]
      if (!company) misses.push(`${companyNumber}/${file}`)
      return company?.[file] ?? NOT_FOUND
    }
    const fixture = path.join(FIXTURES, 'ch', companyNumber, `${file}.json`)
    if (!existsSync(fixture)) {
      misses.push(`${companyNumber}/${file}`)
      return { status: 0, body: null }
    }
    return JSON.parse(readFileSync(fixture, 'utf8')) as Fetched
  }

  const fetcher: OwnershipFetcher = {
    getProfile: async (n) => ch(n, 'profile'),
    getPscs: async (n) => ch(n, 'pscs'),
    getPscStatements: async (n) => ch(n, 'psc_statements'),
    getExemptions: async (n) => ch(n, 'exemptions'),
    getGleifParents: async (n) => (synthetic ? (synthetic[n]?.gleif ?? null) : readGleif(n)),
  }

  return { fetcher, misses, calls }
}

/** Builds a minimal CH PSC list response. */
export function pscList(...items: Record<string, unknown>[]): Fetched {
  return { status: 200, body: { items } }
}

export function profile(companyNumber: string, name = `Company ${companyNumber}`): Fetched {
  return { status: 200, body: { company_number: companyNumber, company_name: name, jurisdiction: 'england-wales' } }
}

export function corporatePsc(registrationNumber: string, natures: string[], extra: Record<string, unknown> = {}) {
  return {
    kind: 'corporate-entity-person-with-significant-control',
    name: `Owner ${registrationNumber}`,
    identification: { registration_number: registrationNumber, country_registered: 'England', place_registered: 'Companies House' },
    natures_of_control: natures,
    ...extra,
  }
}

export function individualPsc(name: string, natures: string[]) {
  return { kind: 'individual-person-with-significant-control', name, natures_of_control: natures }
}
