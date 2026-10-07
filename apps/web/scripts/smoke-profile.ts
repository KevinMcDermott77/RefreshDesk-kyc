/**
 * Live check of the ownership page's server-side path: fetchEntityCdd, the
 * walk, GLEIF and the raw profile, then the six KYC profile rows.
 *
 *   cd apps/web && npx tsx scripts/smoke-profile.ts [companyNumber]
 *
 * Reads KYC_SEARCH_* from apps/web/.env.local. Individuals are initials only.
 */
import path from 'node:path'
import { fetchAuthToken } from '@/lib/companies-house/kyc-search-client'
import { fetchEntityCdd } from '@/lib/companies-house/fetch-entity-cdd'
import { evaluateProfile, ownershipSummary } from '@/lib/kyc-profile/evaluate'
import { fetchRawProfile } from '@/lib/kyc-profile/fetch-raw'
import { lookupLei } from '@/lib/kyc-profile/gleif'
import { createKycSearchFetcher } from '@/lib/ownership/kyc-search-fetcher'
import { walk } from '@/lib/ownership/walk'

process.loadEnvFile(path.resolve(__dirname, '..', '.env.local'))

const log = console.log
console.log = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('[kyc-search]')) return
  log(...args)
}

async function main() {
  const number = (process.argv[2] ?? '03261722').toUpperCase()
  const threshold = 25
  const token = await fetchAuthToken()
  const cdd = await fetchEntityCdd(number, token)
  const [walked, gleif, raw] = await Promise.all([
    walk(cdd.companyNumber, createKycSearchFetcher(token, cdd), { maxDepth: 6, threshold, indirectMethod: 'either' }),
    lookupLei(cdd.companyNumber),
    fetchRawProfile(cdd.companyNumber, token),
  ])
  const rows = evaluateProfile({
    profile: raw.profile,
    officers: raw.officers,
    gleif: gleif.lookup,
    gleifFetchedAt: gleif.fetchedAt,
    ownership: ownershipSummary(walked, threshold),
    fetchedAt: raw.fetchedAt,
  })

  for (const row of rows) {
    log(`\n[${row.mark}] ${row.label}${row.fetchedAt ? `  (fetched ${row.fetchedAt})` : ''}`)
    for (const line of row.lines) log(`   ${line}`)
    if (row.note) log(`   note: ${row.note}`)
    if (row.source) log(`   source: ${row.source.label} ${row.source.url}`)
  }
}

main().catch((error) => {
  log(`FATAL: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
