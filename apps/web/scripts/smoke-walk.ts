/**
 * Smoke test: walks known companies against the live kyc-search service.
 *
 *   cd apps/web && npx tsx scripts/smoke-walk.ts
 *
 * Reads KYC_SEARCH_URL / KYC_SEARCH_ADMIN_EMAIL / KYC_SEARCH_ADMIN_PASSWORD
 * from apps/web/.env.local. Never prints tokens or env values.
 */
import path from 'node:path'
import { fetchAuthToken } from '@/lib/companies-house/kyc-search-client'
import { fetchEntityCdd } from '@/lib/companies-house/fetch-entity-cdd'
import { createKycSearchFetcher } from '@/lib/ownership/kyc-search-fetcher'
import { walk } from '@/lib/ownership/walk'
import type { OwnershipNode, WalkPolicy } from '@/lib/ownership/types'

process.loadEnvFile(path.resolve(__dirname, '..', '.env.local'))

// kyc-search-client logs every request URL, which includes KYC_SEARCH_URL.
const log = console.log
console.log = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('[kyc-search]')) return
  log(...args)
}

const RUNS: { companyNumber: string; expect: string; policy: WalkPolicy }[] = [
  { companyNumber: '03261722', expect: 'J Sainsbury plc RESOLVED_LISTED at depth 2, overall resolved', policy: {} },
  { companyNumber: '01854213', expect: 'FOREIGN_ENTITY_UNMATCHED at depth 1', policy: {} },
  { companyNumber: '11391321', expect: 'PSC_STATEMENT at 13383560 with the "signficant" code', policy: {} },
  { companyNumber: 'OE005000', expect: 'DEPTH_LIMIT_REACHED at maxDepth 6', policy: {} },
  { companyNumber: 'OE005000', expect: 'RESOLVED_INDIVIDUAL at depth 8', policy: { maxDepth: 10 } },
]

function range(r: OwnershipNode['effectiveRange']): string {
  return r ? `[${r[0]},${r[1]}]` : '-'
}

function line(node: OwnershipNode): string {
  return [
    `d=${node.depth}`,
    node.companyNumber ?? '-',
    JSON.stringify(node.name),
    node.resolution,
    node.reasonCode ?? '-',
    node.statementCode ?? '-',
    range(node.effectiveRange),
    node.fetchedAt ?? '-',
  ].join('  ')
}

async function main() {
  const token = await fetchAuthToken()

  for (const run of RUNS) {
    const policy: WalkPolicy = { maxDepth: 6, threshold: 25, indirectMethod: 'either', ...run.policy }
    log(`\n=== ${run.companyNumber}  maxDepth=${policy.maxDepth}  expect: ${run.expect}`)
    try {
      const root = await fetchEntityCdd(run.companyNumber, token)
      const result = await walk(run.companyNumber, createKycSearchFetcher(token, root), policy)
      log(`status=${result.status}  nodes=${result.nodes.length}  edges=${result.edges.length}`)
      const nodes = [...result.nodes].sort((a, b) => a.depth - b.depth)
      for (const node of nodes) log(line(node))
    } catch (error) {
      log(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

main().catch((error) => {
  log(`FATAL: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
