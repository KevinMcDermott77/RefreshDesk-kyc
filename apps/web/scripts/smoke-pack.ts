/**
 * Live check of the refresh pack snapshot: runs the same steps as the ownership page for one
 * company, builds the snapshot, and proves that no officer or owner name from the live data is in it.
 *
 *   cd apps/web && npx tsx scripts/smoke-pack.ts [companyNumber]
 *
 * Reads KYC_SEARCH_* from apps/web/.env.local. Prints no names, only counts and the source log.
 */
import path from 'node:path'
import { fetchAuthToken } from '@/lib/companies-house/kyc-search-client'
import { fetchEntityCdd } from '@/lib/companies-house/fetch-entity-cdd'
import { evaluateProfile, ownershipSummary } from '@/lib/kyc-profile/evaluate'
import { fetchRawProfile } from '@/lib/kyc-profile/fetch-raw'
import { lookupLei } from '@/lib/kyc-profile/gleif'
import { createKycSearchFetcher, terminalChecksFor } from '@/lib/ownership/kyc-search-fetcher'
import { summarise, toFlow } from '@/lib/ownership/to-flow'
import { walk } from '@/lib/ownership/walk'
import { snapshotFingerprint } from '@/lib/packs/canonical'
import { buildSnapshot } from '@/lib/packs/snapshot'
import { createSourceLog } from '@/lib/packs/source-log'

process.loadEnvFile(path.resolve(__dirname, '..', '.env.local'))

const log = console.log
console.log = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('[kyc-search]')) return
  log(...args)
}

async function main() {
  const number = (process.argv[2] ?? '03261722').toUpperCase()
  const sourceLog = createSourceLog()
  const token = await fetchAuthToken()
  const cdd = await fetchEntityCdd(number, token, sourceLog)
  const policy = { maxDepth: 6, threshold: 25, indirectMethod: 'either' as const }
  const [walked, gleif, raw] = await Promise.all([
    walk(cdd.companyNumber, createKycSearchFetcher(token, cdd, sourceLog), policy),
    lookupLei(cdd.companyNumber, fetch, Date.now, sourceLog),
    fetchRawProfile(cdd.companyNumber, token, sourceLog),
  ])
  const terminals = terminalChecksFor(sourceLog)
  const listing = []
  if (gleif.lookup.status === 'found') {
    for (const check of [() => terminals.listedEU(gleif.lookup.status === 'found' ? gleif.lookup.lei : ''), () => terminals.regulatedEU(gleif.lookup.status === 'found' ? gleif.lookup.lei : '')]) {
      const evidence = await check().catch(() => null)
      if (evidence) listing.push(evidence)
    }
  }
  const profile = evaluateProfile({
    listing,
    profile: raw.profile,
    officers: raw.officers,
    gleif: gleif.lookup,
    gleifFetchedAt: gleif.fetchedAt,
    ownership: ownershipSummary(walked, policy.threshold),
    fetchedAt: raw.fetchedAt,
  })

  const officerNames = raw.officers.map((o) => (o as { name?: string }).name).filter((n): n is string => !!n)
  const individualNames = [...officerNames, ...walked.nodes.filter((n) => n.kind === 'individual').map((n) => n.name)]

  const snapshot = buildSnapshot({
    subject: { id: cdd.companyNumber, kind: 'company', name: String(raw.profile.company_name ?? cdd.companyNumber) },
    policy: { ...policy, acceptRegulatedAsTerminal: true },
    walked,
    profile,
    flow: toFlow(walked),
    summary: summarise(walked),
    sourceLog: sourceLog.entries(),
    individualNames,
  })

  const text = JSON.stringify(snapshot).toLowerCase()
  const leaked = individualNames.filter((n) => n.length >= 4 && text.includes(n.toLowerCase()))
  log(`snapshot built: ${snapshot.chart.nodes.length} nodes, ${snapshot.chart.edges.length} edges, ${snapshot.profile.length} profile rows, ${snapshot.sourceLog.length} source log entries`)
  log(`summary: ${snapshot.summary.status}, ${snapshot.summary.openBranches} open branches; ${individualNames.length} individual names checked, ${leaked.length} found in the snapshot`)
  log(`fingerprint: ${await snapshotFingerprint(snapshot)}`)
  for (const e of snapshot.sourceLog) log(`  ${e.status} ${e.cached ? '(cached) ' : ''}${e.register}: ${e.path.slice(0, 100)}  @ ${e.fetchedAt}`)
  if (leaked.length > 0) process.exit(1)
}

main().catch((error) => {
  log(`FATAL: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
