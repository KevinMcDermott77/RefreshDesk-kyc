import type { ProfileRow } from '@/lib/kyc-profile/evaluate'
import type { SourceLogEntry } from '@/lib/packs/source-log'
import type { Fetched, GleifSource, OwnershipFetcher } from '@/lib/ownership/types'

/**
 * A built-in SAMPLE subject for trying the client-evidence flow end to end. Everything here is invented: the
 * UK company, its register entries, its officers and the shareholder register in
 * __fixtures__/evidence/SAMPLE-shareholder-register.pdf. No real company is used, so no real company can be
 * matched with a made-up document. It is offered only to firms on the allow-list below, and everything it
 * produces says "Sample data", including a refresh pack built from it.
 */

export const DEMO_SUBJECT = 'DEMO-FJORDVIK'
export const DEMO_COMPANY_NAME = 'SAMPLE DATA: Fjordvik Demo (UK) Limited'
export const SAMPLE_NOTE = 'Sample data: invented for testing, not a real register entry.'
export const SAMPLE_REGISTER = 'SAMPLE DATA (built-in fixture, not a register)'

/** The organisation number printed in the SAMPLE shareholder register PDF. */
export const DEMO_OWNER_NAME = 'Fjordvik Test Holding AS'
export const DEMO_OWNER_REGISTRATION = '999 000 001'

/** Firms that may use the sample subject until it has a proper flag: comma-separated slugs in DEMO_SUBJECT_FIRM_SLUGS. */
export const DEFAULT_DEMO_FIRM_SLUGS = ['bubble-up']

export function demoFirmSlugs(env: string | undefined = process.env.DEMO_SUBJECT_FIRM_SLUGS): string[] {
  const listed = (env ?? '')
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean)
  return listed.length > 0 ? listed : DEFAULT_DEMO_FIRM_SLUGS
}

export function demoAllowed(firmSlug: string | undefined, env?: string): boolean {
  return !!firmSlug && demoFirmSlugs(env).includes(firmSlug)
}

export function isDemoSubject(entry: string): boolean {
  return entry.trim().toUpperCase() === DEMO_SUBJECT
}

/** A fictional UK private company, in the shape of the Companies House profile the profile panel reads. */
export const demoRawProfile: Record<string, unknown> = {
  company_number: DEMO_SUBJECT,
  company_name: DEMO_COMPANY_NAME,
  company_status: 'active',
  type: 'ltd',
  jurisdiction: 'england-wales',
  date_of_creation: '2020-01-15',
  registered_office_address: { address_line_1: 'SAMPLE DATA, 1 Test Street', locality: 'Testville', postal_code: 'TE1 1ST', country: 'England' },
  sic_codes: ['64209'],
  accounts: { next_due: '2027-06-30', overdue: false },
  confirmation_statement: { next_due: '2027-01-29', overdue: false },
  has_charges: false,
  has_insolvency_history: false,
}

/** Invented officers: the profile shows them as initials, and a pack's leak check is run against these names. */
export const demoOfficers: Record<string, unknown>[] = [
  { name: 'DEMO, Sam', officer_role: 'director' },
  { name: 'EXAMPLE, Alex', officer_role: 'secretary' },
]

const sampleGleif: GleifSource = {
  getRecord: async () => null,
  // The sample company is on no register: nothing is found by number, so the walk stops at it.
  findByRegistration: async () => [],
  getDirectParent: async () => ({}),
}

/** The walk's inputs for the sample subject. No network: every response is built here. */
export function demoFetcher(fetchedAt: string = new Date().toISOString()): OwnershipFetcher {
  const ok = (body: unknown): Fetched => ({ status: 200, body, fetchedAt })
  const none: Fetched = { status: 404, body: null }
  return {
    getProfile: async () => ok(demoRawProfile),
    getPscs: async () =>
      ok({
        items: [
          {
            kind: 'corporate-entity-person-with-significant-control',
            name: DEMO_OWNER_NAME,
            natures_of_control: ['ownership-of-shares-75-to-100-percent', 'voting-rights-75-to-100-percent'],
            identification: {
              legal_authority: 'Norwegian Private Limited Companies Act',
              place_registered: 'Brønnøysund Register Centre',
              country_registered: 'Norway',
              registration_number: DEMO_OWNER_REGISTRATION,
            },
          },
        ],
      }),
    getPscStatements: async () => none,
    getExemptions: async () => none,
    getGleifParents: async () => null,
    gleif: sampleGleif,
  }
}

/** Marks every profile row as sample data and removes the links to registers (there is no real entry to link to). */
export function labelAsSample(rows: ProfileRow[], fetchedAt: string): ProfileRow[] {
  return rows.map((row) => {
    const { source: _source, links: _links, ...rest } = row
    return { ...rest, fetchedAt, note: [row.note, SAMPLE_NOTE].filter(Boolean).join(' ') }
  })
}

export function demoSourceLog(fetchedAt: string): SourceLogEntry[] {
  return [{ register: SAMPLE_REGISTER, path: 'demo/fjordvik', fetchedAt, status: 200, cached: false }]
}
