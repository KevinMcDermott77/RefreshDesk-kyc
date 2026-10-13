/**
 * Records the registers' responses for the terminal-check tests.
 *
 *   cd apps/web && npx tsx scripts/record-terminals.ts
 *
 * Runs the real lookups for Nordea Bank Abp, DNB Bank ASA and Allianz SE with
 * a recording fetch, then trims the large files (ISO MIC list, ECB workbook)
 * to what the tests use. Writes __fixtures__/terminals/recorded.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import Papa from 'papaparse'
import { createTerminalLookups, parseEcbLeis, parseIsoMics } from '@/lib/ownership/terminal-sources'
import { createTerminalChecks } from '@/lib/ownership/terminals'

const LEIS = {
  nordea: '529900ODI3047E2LIV03',
  dnb: '549300GKFG0RYRRQ1414',
  allianz: '529900K9B0N5BT694847',
  sap: '529900D6BF99LW9R2E68',
}
const OUT = path.resolve(__dirname, '../../../__fixtures__/terminals')

type Recorded = { status: number; text?: string; base64?: string }
const recorded: Record<string, Recorded> = {}

const recordingFetch: typeof fetch = async (input, init) => {
  const url = String(input)
  const response = await fetch(input, init)
  const copy = response.clone()
  const isBinary = url.endsWith('.xlsx')
  if (response.ok && isBinary) recorded[url] = { status: response.status, base64: Buffer.from(await copy.arrayBuffer()).toString('base64') }
  else recorded[url] = { status: response.status, text: response.ok ? await copy.text() : '' }
  return response
}

async function main() {
  const lookups = createTerminalLookups({ fetchImpl: recordingFetch, secUserAgent: undefined })
  const checks = createTerminalChecks(lookups)
  const log = console.log

  for (const [name, lei] of Object.entries(LEIS)) {
    const listed = await checks.listedEU(lei)
    const regulated = await checks.regulatedEU(lei)
    log(`${name}: listed=${listed ? JSON.stringify(listed.details) : '-'}  regulated=${regulated ? JSON.stringify(regulated.details) : '-'}`)
  }

  await lookups.ecbSupervised()

  // Trim the ISO list to the MICs the recorded FIRDS rows use, their operating MICs, and the Frankfurt family.
  const firdsMics = new Set<string>(['XETR', 'XFRA', 'FRAA', 'XHEL', 'XOSL', 'XNGM', 'NSME'])
  for (const lei of Object.values(LEIS)) {
    const rows = await lookups.firdsEquities(lei)
    for (const row of rows) firdsMics.add(row.mic.toUpperCase())
  }
  const isoUrl = Object.keys(recorded).find((u) => u.endsWith('ISO10383_MIC.csv'))!
  const isoAll = parseIsoMics(recorded[isoUrl].text!)
  const keep = new Set<string>()
  for (const mic of firdsMics) {
    const row = isoAll.get(mic)
    keep.add(mic)
    if (row) keep.add(row.operatingMic)
  }
  const parsed = Papa.parse<Record<string, string>>(recorded[isoUrl].text!, { header: true, skipEmptyLines: true })
  const trimmed = parsed.data.filter((row) => keep.has((row['MIC'] ?? '').toUpperCase()))
  recorded[isoUrl].text = Papa.unparse(trimmed, { columns: parsed.meta.fields })

  // Reduce the ECB workbook to the LEIs the tests care about, keeping the workbook shape.
  const ecbUrl = Object.keys(recorded).find((u) => u.endsWith('.xlsx') && recorded[u].base64)!
  const realLeis = parseEcbLeis(new Uint8Array(Buffer.from(recorded[ecbUrl].base64!, 'base64')))
  const kept = [LEIS.nordea, ...[...realLeis].filter((l) => l !== LEIS.nordea).slice(0, 4)]
  const strings = ['LEI\r\nMFI code for branches', 'Name', ...kept, 'Nordea Bank Abp']
  const sharedStrings = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings
    .map((s) => `<si><t>${s}</t></si>`)
    .join('')}</sst>`
  recorded[ecbUrl].base64 = Buffer.from(zipSync({ 'xl/sharedStrings.xml': strToU8(sharedStrings) })).toString('base64')

  // Missing ECB months answer 404 (recorded as such by the lookups when tried).
  mkdirSync(OUT, { recursive: true })
  writeFileSync(path.join(OUT, 'recorded.json'), JSON.stringify(recorded, null, 1) + '\n')
  log(`recorded ${Object.keys(recorded).length} responses`)
  for (const url of Object.keys(recorded)) log(`  ${recorded[url].status} ${url.slice(0, 140)}`)
}

main().catch((error) => {
  console.log(`FATAL: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
