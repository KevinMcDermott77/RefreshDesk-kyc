import { unzipSync } from 'fflate'
import { scrubPath, type SourceLog, type SourceLogEntry } from '@/lib/packs/source-log'
import Papa from 'papaparse'
import {
  FIRDS_URL,
  ISO_MIC_URL,
  UPREG_URL,
  type FirdsRow,
  type IsoMic,
  type SecTicker,
  type TerminalLookups,
  type UpregFirm,
} from './terminals'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
const LEI = /^[A-Z0-9]{20}$/
const SEC_URL = 'https://www.sec.gov/files/company_tickers_exchange.json'
const ECB_URL = 'https://www.bankingsupervision.europa.eu/ecb/pub/pdf/'

function rec(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function docs(body: unknown): Record<string, unknown>[] {
  const list = rec(rec(body).response).docs
  return Array.isArray(list) ? list.map(rec) : []
}

// --- Parsers (pure) ---

export function parseFirds(body: unknown): FirdsRow[] {
  return docs(body).flatMap((doc) => {
    const isin = str(doc.isin)
    const mic = str(doc.mic)
    const cfi = str(doc.gnr_cfi_code)
    if (!isin || !mic || !cfi) return []
    return [
      {
        isin,
        mic,
        cfi,
        ...(str(doc.gnr_full_name) ? { name: str(doc.gnr_full_name) } : {}),
        ...(str(doc.status) ? { status: str(doc.status) } : {}),
        latestReceived: String(doc.latest_received_flag) === '1',
        // ESMA's own spelling of the field.
        ...(str(doc.mrkt_trdng_start_date) ? { startDate: str(doc.mrkt_trdng_start_date) } : {}),
        ...(str(doc.mrkt_trdng_trmination_date) ? { terminationDate: str(doc.mrkt_trdng_trmination_date) } : {}),
      },
    ]
  })
}

export function parseMir(body: unknown): Map<string, string> {
  const map = new Map<string, string>()
  for (const doc of docs(body)) {
    const mic = str(doc.ae_micLeiEsmaId)
    if (mic && String(doc.ae_status ?? 'Active').toLowerCase() === 'active') map.set(mic.toUpperCase(), str(doc.ae_entityName) ?? mic)
  }
  return map
}

export function parseUpreg(body: unknown): UpregFirm[] {
  return docs(body).map((doc) => ({
    name: str(doc.ae_entityName) ?? '',
    typeCode: str(doc.ae_entityTypeCode) ?? '',
    typeLabel: str(doc.ae_entityTypeLabel) ?? '',
    status: str(doc.ae_status) ?? '',
    authority: str(doc.ae_competentAuthority) ?? '',
    officeType: str(doc.ae_officeType) ?? '',
  }))
}

export function parseIsoMics(csv: string): Map<string, IsoMic> {
  const rows = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data
  const map = new Map<string, IsoMic>()
  for (const row of rows) {
    const mic = row['MIC']?.trim().toUpperCase()
    if (!mic) continue
    map.set(mic, {
      mic,
      operatingMic: (row['OPERATING MIC'] || mic).trim().toUpperCase(),
      category: (row['MARKET CATEGORY CODE'] ?? '').trim().toUpperCase(),
      country: (row['ISO COUNTRY CODE (ISO 3166)'] ?? '').trim().toUpperCase(),
      name: (row['MARKET NAME-INSTITUTION DESCRIPTION'] ?? '').trim(),
      status: (row['STATUS'] ?? '').trim().toUpperCase(),
    })
  }
  return map
}

/** Every LEI in the workbook's shared strings (the ECB list holds its LEI column there). */
export function parseEcbLeis(xlsx: Uint8Array): Set<string> {
  const files = unzipSync(xlsx, { filter: (file) => file.name === 'xl/sharedStrings.xml' })
  const xml = files['xl/sharedStrings.xml']
  if (!xml) return new Set()
  const text = new TextDecoder().decode(xml)
  const leis = new Set<string>()
  for (const match of text.matchAll(/<t[^>]*>([^<]*)<\/t>/g)) {
    const value = match[1].trim()
    if (LEI.test(value) && /[0-9]{2}$/.test(value)) leis.add(value)
  }
  return leis
}

export function parseSecTickers(body: unknown): SecTicker[] {
  const { fields, data } = rec(body)
  if (!Array.isArray(fields) || !Array.isArray(data)) return []
  const at = (name: string) => fields.indexOf(name)
  const [cik, name, ticker, exchange] = [at('cik'), at('name'), at('ticker'), at('exchange')]
  if ([cik, name, ticker, exchange].some((i) => i < 0)) return []
  return data
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => ({ cik: String(row[cik]), name: String(row[name]), ticker: String(row[ticker]), exchange: String(row[exchange]) }))
}

// --- Caching and politeness ---

type Options = {
  fetchImpl?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** SEC asks for a User-Agent with contact details; the SEC lookup is skipped without one. */
  secUserAgent?: string
  /** Minimum gap between requests to the same host. */
  minGapMs?: number
}

export type TerminalLookupsWithLog = TerminalLookups & {
  /** The same lookups and caches, recording each register fetch (or cache hit) in a refresh pack's source log. */
  withLog(log: SourceLog | undefined): TerminalLookups
}

type Note = (entry: Omit<SourceLogEntry, 'cached'>) => void

/** Cached lookups against the public registers. In-memory; one instance per process. */
export function createTerminalLookups(options: Options = {}): TerminalLookupsWithLog {
  const { fetchImpl = fetch, now = Date.now, secUserAgent = process.env.SEC_USER_AGENT, minGapMs = 250 } = options
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  // Each cached value keeps the source-log entries of the fetches behind it, so a run served from
  // the cache still lists the registers it relied on (marked cached, with the original fetch time).
  const cache = new Map<string, { value: Promise<unknown>; entries: SourceLogEntry[]; expires: number }>()
  function memo<T>(key: string, ttl: number, log: SourceLog | undefined, load: (note: Note) => Promise<T>): Promise<T> {
    const hit = cache.get(key)
    if (hit && hit.expires > now()) {
      return (hit.value as Promise<T>).then((value) => {
        for (const entry of hit.entries) log?.record({ ...entry, cached: true })
        return value
      })
    }
    const entries: SourceLogEntry[] = []
    const note: Note = (entry) => {
      entries.push(entry)
      log?.record(entry)
    }
    const value = load(note)
    cache.set(key, { value, entries, expires: now() + ttl })
    // A failed or empty load is not remembered.
    value.then(
      (v) => v === null && cache.delete(key),
      () => cache.delete(key),
    )
    return value
  }

  // One request at a time per host, with a minimum gap.
  const lastStart = new Map<string, number>()
  const queues = new Map<string, Promise<unknown>>()
  function polite<T>(url: string, run: () => Promise<T>): Promise<T> {
    const host = new URL(url).host
    const previous = queues.get(host) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(async () => {
      const wait = (lastStart.get(host) ?? 0) + minGapMs - now()
      if (wait > 0) await sleep(wait)
      lastStart.set(host, now())
      return run()
    })
    queues.set(host, next)
    return next
  }

  const userAgent = 'RefreshDesk ownership checks'

  /** fetch with the request noted in the source log, whatever the outcome. */
  async function fetched(url: string, register: string, note: Note, init: RequestInit): Promise<Response> {
    const fetchedAt = new Date(now()).toISOString()
    try {
      const response = await fetchImpl(url, init)
      note({ register, path: scrubPath(url), fetchedAt, status: response.status })
      return response
    } catch (error) {
      note({ register, path: scrubPath(url), fetchedAt, status: 0 })
      throw error
    }
  }

  async function getJson(url: string, register: string, note: Note, headers: Record<string, string> = {}): Promise<unknown> {
    return polite(url, async () => {
      const response = await fetched(url, register, note, {
        headers: { accept: 'application/json', 'user-agent': userAgent, ...headers },
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(`request failed (${response.status}): ${url.split('?')[0]}`)
      return response.json()
    })
  }

  function solr(base: string, params: Record<string, string>): string {
    const url = new URL(base)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    return url.toString()
  }

  function leiOrThrow(lei: string): string {
    const value = lei.trim().toUpperCase()
    if (!LEI.test(value)) throw new Error(`not an LEI: ${lei}`)
    return value
  }

  function build(log: SourceLog | undefined): TerminalLookups {
    return {
      now: () => new Date(now()),

      firdsEquities: async (raw) => {
        const lei = leiOrThrow(raw)
        return memo(`firds:${lei}`, DAY_MS, log, async (note) =>
          parseFirds(
            await getJson(
              solr(FIRDS_URL, {
                q: `lei:${lei} AND gnr_cfi_code:ES* AND latest_received_flag:1 AND -status:TERM`,
                rows: '200',
                fl: 'isin,mic,gnr_cfi_code,gnr_full_name,status,latest_received_flag,mrkt_trdng_start_date,mrkt_trdng_trmination_date',
                wt: 'json',
              }),
              'ESMA FIRDS',
              note,
            ),
          ),
        )
      },

      regulatedMarkets: () =>
        memo('mir', DAY_MS, log, async (note) =>
          parseMir(
            await getJson(
              solr(UPREG_URL, {
                q: 'ae_entityTypeCode:MIR AND ae_status:Active',
                rows: '500',
                fl: 'ae_micLeiEsmaId,ae_entityName,ae_status',
                wt: 'json',
              }),
              'ESMA regulated markets',
              note,
            ),
          ),
        ),

      isoMics: () =>
        memo('iso-mic', WEEK_MS, log, async (note) =>
          polite(ISO_MIC_URL, async () => {
            const response = await fetched(ISO_MIC_URL, 'ISO 10383 MIC list', note, {
              headers: { 'user-agent': userAgent },
              signal: AbortSignal.timeout(30_000),
            })
            if (!response.ok) throw new Error(`request failed (${response.status}): ISO 10383 MIC list`)
            return parseIsoMics(await response.text())
          }),
        ),

      upregFirms: async (raw) => {
        const lei = leiOrThrow(raw)
        return memo(`upreg:${lei}`, DAY_MS, log, async (note) =>
          parseUpreg(
            await getJson(
              solr(UPREG_URL, {
                q: `ae_lei:${lei}`,
                rows: '50',
                fl: 'ae_entityName,ae_entityTypeCode,ae_entityTypeLabel,ae_status,ae_competentAuthority,ae_officeType',
                wt: 'json',
              }),
              'ESMA authorised entities',
              note,
            ),
          ),
        )
      },

      // The ECB publishes the list monthly under a dated name: try this month and the two before.
      ecbSupervised: () =>
        memo('ecb', WEEK_MS, log, async (note) => {
          const base = new Date(now())
          for (let back = 0; back < 3; back++) {
            const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - back, 1))
            const month = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`
            const url = `${ECB_URL}ssm.listofsupervisedentities${month}.en.xlsx`
            const bytes = await polite(url, async () => {
              const response = await fetched(url, 'ECB list of supervised entities', note, {
                headers: { 'user-agent': userAgent },
                signal: AbortSignal.timeout(30_000),
              })
              return response.ok ? new Uint8Array(await response.arrayBuffer()) : null
            })
            // A missing month comes back as an HTML page or 404; a real file is a zip.
            if (bytes && bytes[0] === 0x50 && bytes[1] === 0x4b) return { month, url, leis: parseEcbLeis(bytes) }
          }
          return null
        }),

      secTickers: async () => {
        if (!secUserAgent) return null
        return memo('sec', DAY_MS, log, async (note) =>
          parseSecTickers(await getJson(SEC_URL, 'SEC company tickers', note, { 'user-agent': secUserAgent })),
        )
      },
    }
  }

  return { ...build(undefined), withLog: build }
}
