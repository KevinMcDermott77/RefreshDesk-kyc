/**
 * Live check for the GLEIF walk, and recorder for its test fixtures.
 *
 *   cd apps/web && npx tsx scripts/smoke-foreign.ts [--record]
 *
 * Walks (a) Nordic banks, (b) Luxembourg entities with a parent and (c) UK
 * companies with a foreign corporate PSC, and prints the chains. With
 * --record it saves every GLEIF response to __fixtures__/gleif/walks/<scenario>.json
 * and the root company's Companies House responses to __fixtures__/ch/<number>/.
 * Reads KYC_SEARCH_* from apps/web/.env.local.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fetchAuthToken, kycSearchGet } from '@/lib/companies-house/kyc-search-client'
import { gleifHttp, type GleifHttp, type GleifResponse } from '@/lib/kyc-profile/gleif'
import { createGleifSource, isHistoric, parseRecord } from '@/lib/ownership/gleif-source'
import { resolveEntry } from '@/lib/ownership/resolve-entry'
import { createKycSearchFetcher } from '@/lib/ownership/kyc-search-fetcher'
import { walk } from '@/lib/ownership/walk'
import type { OwnershipFetcher, WalkResult } from '@/lib/ownership/types'

process.loadEnvFile(path.resolve(__dirname, '..', '.env.local'))

const log = console.log
console.log = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('[kyc-search]')) return
  log(...args)
}

const RECORD = process.argv.includes('--record')
const ROOT = path.resolve(__dirname, '../../../__fixtures__')

function recorder() {
  const calls: Record<string, GleifResponse> = {}
  const http: GleifHttp = {
    async get(p) {
      const response = await gleifHttp.get(p)
      calls[p] = response
      return response
    },
  }
  return { http, calls }
}

function print(result: WalkResult) {
  log(`status=${result.status} nodes=${result.nodes.length} edges=${result.edges.length}`)
  const byId = new Map(result.nodes.map((n) => [n.id, n]))
  for (const n of [...result.nodes].sort((a, b) => a.depth - b.depth)) {
    const person = n.kind === 'individual' ? '(individual)' : JSON.stringify(n.name)
    log(`  d${n.depth} ${n.id} ${person} ${n.resolution}${n.reasonCode ? ' ' + n.reasonCode : ''}${n.registerProfile ? ' [' + n.registerProfile.country + ' ' + n.registerProfile.registerName + ']' : ''}${n.jurisdiction ? ' j=' + n.jurisdiction : ''}${n.secondaryReasons.length ? ' secondary=' + n.secondaryReasons.join(',') : ''}`)
    for (const e of n.evidence ?? []) log(`       evidence ${e.kind}: ${JSON.stringify(e.details)}`)
  }
  for (const e of result.edges) {
    log(`  edge ${byId.get(e.parentId)?.name ?? e.parentId} -> ${byId.get(e.childId)?.name ?? e.childId}  ${e.source}/${e.basis} band=${e.band ? e.band.join('-') : '-'}`)
  }
}

async function scenario(name: string, root: string, build: (http: GleifHttp) => OwnershipFetcher) {
  log(`\n=== ${name}: walk ${root}`)
  const { http, calls } = recorder()
  try {
    const result = await walk(root, build(http), { maxDepth: 6, threshold: 25, indirectMethod: 'either' })
    print(result)
  } catch (error) {
    log(`ERROR ${error instanceof Error ? error.message : String(error)}`)
  }
  if (RECORD) {
    const dir = path.join(ROOT, 'gleif', 'walks')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(calls, null, 2) + '\n')
    log(`  recorded ${Object.keys(calls).length} GLEIF responses`)
  }
}

async function recordCompany(number: string, token: string) {
  const files: [string, string][] = [
    ['profile', `/companies/${number}/raw`],
    ['pscs', `/companies/${number}/pscs/raw`],
    ['psc_statements', `/companies/${number}/pscs/statements`],
    ['exemptions', `/companies/${number}/exemptions`],
  ]
  const dir = path.join(ROOT, 'ch', number)
  mkdirSync(dir, { recursive: true })
  for (const [file, endpoint] of files) {
    const response = await kycSearchGet(endpoint, token)
    const body = response.body as { items?: { kind?: string }[] } | null
    if (file === 'pscs' && body?.items?.some((i) => String(i.kind).startsWith('individual'))) {
      throw new Error(`${number} has individual PSCs: not recorded (public repo)`)
    }
    writeFileSync(path.join(dir, `${file}.json`), JSON.stringify({ status: response.status, body: response.body }, null, 2) + '\n')
  }
  log(`  recorded CH responses for ${number}`)
}

async function main() {
  const token = await fetchAuthToken()
  const withGleif = (http: GleifHttp): OwnershipFetcher => ({ ...createKycSearchFetcher(token), gleif: createGleifSource(http) })

  // A name typed into the form: the picks GLEIF offers, then a walk of the first one.
  {
    const { http, calls } = recorder()
    const picks = await resolveEntry('Nordea Bank', createGleifSource(http))
    log('\n=== name entry "Nordea Bank"')
    if (picks.kind !== 'candidates') {
      log(`  not a candidate list: ${JSON.stringify(picks)}`)
    } else {
      for (const r of picks.candidates) {
        log(`  ${r.lei}  ${r.legalName}  ${r.country ?? '?'}  ${r.entityStatus}/${r.registrationStatus}${isHistoric(r) ? '  (historic entity)' : ''}`)
      }
      await scenario('name-nordea-bank', picks.candidates[0].lei, withGleif)
    }
    if (RECORD) {
      const dir = path.join(ROOT, 'gleif', 'search')
      mkdirSync(dir, { recursive: true })
      writeFileSync(path.join(dir, 'nordea-bank.json'), JSON.stringify(calls, null, 2) + '\n')
      log(`  recorded ${Object.keys(calls).length} GLEIF search responses`)
    }
  }

  // (a) Nordic banks, found by GLEIF search.
  for (const [name, query] of [['nordea', 'Nordea Bank Abp'], ['dnb', 'DNB Bank ASA']] as const) {
    const [match] = await createGleifSource(gleifHttp).searchByName(query, 5)
    if (!match) {
      log(`\n=== ${name}: no GLEIF match for "${query}"`)
      continue
    }
    await scenario(name, match.lei, withGleif)
  }

  // Allianz SE, by LEI (listed on German regulated markets).
  await scenario('allianz', '529900K9B0N5BT694847', withGleif)

  // (b) Luxembourg entities: children of Allianz SE in LU, then whatever GLEIF reports above them.
  const [allianz] = await createGleifSource(gleifHttp).searchByName('Allianz SE', 3)
  if (allianz) {
    const children = await gleifHttp.get(`/lei-records/${allianz.lei}/direct-children?page[size]=100`)
    const lu = ((children.body as { data?: unknown[] } | null)?.data ?? []).map(parseRecord).filter((r) => r?.country === 'LU').slice(0, 3)
    for (const [i, r] of lu.entries()) await scenario(`lu-${i + 1}`, r!.lei, withGleif)
    if (lu.length === 0) log('\n=== (b) Allianz SE has no LU children in GLEIF')
  }

  // A UK company whose only PSC is Allianz Strategic Investments S.a r.l (LU B144833), taken from
  // INNOVATION GROUP HOLDINGS LIMITED (11838883). That company also has individual PSCs, so its
  // Companies House data is not recorded: the PSC is synthetic and only the GLEIF half is live.
  const luMatch = (http: GleifHttp): OwnershipFetcher => {
    const ok = (body: unknown) => ({ status: 200, body })
    return {
      ...withGleif(http),
      getProfile: async () => ok({ company_name: 'ACME UK HOLDINGS LIMITED', jurisdiction: 'england-wales' }),
      getExemptions: async () => ({ status: 404, body: null }),
      getPscs: async () =>
        ok({
          items: [
            {
              kind: 'corporate-entity-person-with-significant-control',
              name: 'Allianz Strategic Investments Sarl',
              natures_of_control: ['ownership-of-shares-75-to-100-percent'],
              identification: { legal_authority: 'Luxembourg', country_registered: 'Luxembourg', place_registered: 'Luxembourg', registration_number: 'B144833' },
            },
          ],
        }),
    }
  }
  await scenario('lu-match', 'AA000001', luMatch)

  // (c) UK companies whose PSC is a foreign corporate with a registration number.
  for (const number of ['01285743', '02152073']) {
    if (RECORD) await recordCompany(number, token)
    await scenario(`uk-${number}`, number, withGleif)
  }
}

main().catch((error) => {
  log(`FATAL: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
