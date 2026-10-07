/**
 * Records the kyc-search raw profile and officers responses for 03261722 as
 * contract fixtures, with individual officers reduced to initials, role and
 * dates (the repo is public).
 *
 *   cd apps/web && npx tsx scripts/capture-profile-fixtures.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fetchAuthToken, kycSearchGet } from '@/lib/companies-house/kyc-search-client'
import { initials } from '@/lib/ownership/to-flow'

process.loadEnvFile(path.resolve(__dirname, '..', '.env.local'))

const OUT = path.resolve(__dirname, '../../../__fixtures__/kyc-search')
const NUMBER = '03261722'

const log = console.log
console.log = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('[kyc-search]')) return
  log(...args)
}

type Item = Record<string, unknown>

/** Individuals keep only role, dates and initials; corporate officers are companies and stay as filed. */
function sanitiseOfficer(item: Item): Item {
  const role = typeof item.officer_role === 'string' ? item.officer_role : ''
  if (role.startsWith('corporate-')) return item
  const keep = ['officer_role', 'appointed_on', 'resigned_on', 'is_pre_1992_appointment']
  return {
    name: initials(String(item.name ?? '')),
    ...Object.fromEntries(keep.filter((key) => key in item).map((key) => [key, item[key]])),
  }
}

async function main() {
  const token = await fetchAuthToken()
  const profile = await kycSearchGet(`/companies/${NUMBER}/raw`, token)
  const officers = await kycSearchGet(`/companies/${NUMBER}/officers/raw`, token)
  if (profile.status !== 200 || officers.status !== 200) {
    throw new Error(`unexpected status profile=${profile.status} officers=${officers.status}`)
  }

  const officerBody = officers.body as { items?: Item[] } & Item
  const cleanOfficers = {
    ...officerBody,
    items: (officerBody.items ?? []).map(sanitiseOfficer),
  }

  mkdirSync(OUT, { recursive: true })
  const write = (file: string, status: number, body: unknown, fetchedAt?: string) =>
    writeFileSync(
      path.join(OUT, file),
      JSON.stringify({ status, ...(fetchedAt ? { fetchedAt } : {}), body }, null, 2) + '\n',
    )
  write(`${NUMBER}-profile-raw.json`, profile.status, profile.body, profile.fetchedAt)
  write(`${NUMBER}-officers-raw.json`, officers.status, cleanOfficers, officers.fetchedAt)
  log(`saved ${OUT}: profile keys=${Object.keys(profile.body as object).length}, officers=${cleanOfficers.items.length}`)
}

main().catch((error) => {
  log(`FATAL: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
