import { describe, expect, it, vi } from 'vitest'
import { createGleifSource } from '../gleif-source'
import { normaliseRegistration, registrationVariants, sameRegistration } from '../registration-number'

describe('registration numbers', () => {
  it('normalises case, whitespace, dots, hyphens and slashes', () => {
    expect(normaliseRegistration(' hrb 719.915 ')).toBe('HRB719915')
    expect(normaliseRegistration('123-456/789')).toBe('123456789')
    expect(normaliseRegistration(undefined)).toBe('')
  })

  it('compares on the normalised form', () => {
    expect(sameRegistration('923609016', '923 609 016')).toBe(true)
    expect(sameRegistration('Hrb719915', 'HRB 719915')).toBe(true)
    expect(sameRegistration('B144833', 'B 144.833')).toBe(true)
    expect(sameRegistration('923609016', '923609017')).toBe(false)
    expect(sameRegistration('', '')).toBe(false)
  })

  it('offers the spellings GLEIF may store', () => {
    expect(registrationVariants('923609016')).toEqual(['923609016', '923 609 016'])
    expect(registrationVariants('Hrb719915')).toEqual(['Hrb719915', 'HRB719915', 'HRB 719915'])
  })
})

describe('findByRegistration', () => {
  const item = (lei: string, registeredAs: string) => ({
    id: lei,
    attributes: {
      lei,
      entity: { legalName: { name: 'X' }, registeredAs, legalAddress: { country: 'NO' } },
      registration: { status: 'ISSUED' },
    },
  })

  function sourceHolding(stored: string) {
    const get = vi.fn(async (path: string) => ({
      status: 200,
      body: { data: path.includes(`registeredAs]=${encodeURIComponent(stored)}&`) ? [item('A'.repeat(20), stored)] : [] },
    }))
    return { get, source: createGleifSource({ get }) }
  }

  it('finds "923 609 016" from "923609016"', async () => {
    const { source } = sourceHolding('923 609 016')
    const found = await source.findByRegistration('923609016', 'NO')
    expect(found.map((r) => r.registeredAs)).toEqual(['923 609 016'])
  })

  it('finds "HRB 719915" from "Hrb719915"', async () => {
    const { source } = sourceHolding('HRB 719915')
    const found = await source.findByRegistration('Hrb719915', 'DE')
    expect(found.map((r) => r.registeredAs)).toEqual(['HRB 719915'])
  })

  it('drops records that merely share a query result but not the number', async () => {
    const get = vi.fn(async () => ({ status: 200, body: { data: [item('B'.repeat(20), '111 222 333')] } }))
    const found = await createGleifSource({ get }).findByRegistration('923609016', 'NO')
    expect(found).toEqual([])
  })

  it('returns every normalised match so the caller can refuse an ambiguous one', async () => {
    const get = vi.fn(async (path: string) => ({
      status: 200,
      body: {
        data: path.includes('registeredAs]=HRB%20719915&')
          ? [item('A'.repeat(20), 'HRB 719915')]
          : path.includes('registeredAs]=HRB719915&')
            ? [item('B'.repeat(20), 'HRB719915')]
            : [],
      },
    }))
    const found = await createGleifSource({ get }).findByRegistration('Hrb719915', 'DE')
    expect(found.map((r) => r.lei).sort()).toEqual(['A'.repeat(20), 'B'.repeat(20)])
  })
})
