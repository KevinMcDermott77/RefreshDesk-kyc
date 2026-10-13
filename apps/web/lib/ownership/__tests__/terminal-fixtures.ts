import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createTerminalLookups } from '../terminal-sources'
import type { TerminalLookups } from '../terminals'

const FILE = path.resolve(__dirname, '../../../../../__fixtures__/terminals/recorded.json')

export const LEIS = {
  nordea: '529900ODI3047E2LIV03',
  dnb: '549300GKFG0RYRRQ1414',
  allianz: '529900K9B0N5BT694847',
}

type Recorded = { status: number; text?: string; base64?: string }

/**
 * Serves the registers' responses recorded by scripts/record-terminals.ts.
 * A request that was not recorded answers 404, so the lookups behave as the
 * live service would for something it does not have (e.g. an unrecorded ECB month).
 */
export function replayFetch(): { fetchImpl: typeof fetch; requested: string[] } {
  const recorded = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, Recorded>
  const requested: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input)
    requested.push(url)
    const hit = recorded[url]
    if (!hit) return new Response('', { status: 404 })
    if (hit.base64) return new Response(Buffer.from(hit.base64, 'base64'), { status: hit.status })
    return new Response(hit.text ?? '', { status: hit.status })
  }) as typeof fetch
  return { fetchImpl, requested }
}

/** Lookups over the recording, with the clock fixed to when it was taken. */
export function recordedLookups(over: Partial<TerminalLookups> = {}, secUserAgent?: string): TerminalLookups & { requested: string[] } {
  const { fetchImpl, requested } = replayFetch()
  const now = () => Date.parse('2026-10-13T12:00:00Z')
  const lookups = createTerminalLookups({ fetchImpl, now, sleep: async () => undefined, secUserAgent, minGapMs: 0 })
  return { ...lookups, ...over, requested }
}
