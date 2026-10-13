import { describe, expect, it } from 'vitest'
import { pickedFormData } from './picker'

const LEI = '529900ODI3047E2LIV03'

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

describe('pickedFormData', () => {
  it('works with an empty search box and keeps depth, threshold and method', () => {
    const data = pickedFormData(form({ entry: '', max_depth: '9', threshold: '10', indirect_method: 'multiply' }), LEI)
    expect(data.get('entry')).toBe(LEI)
    expect(data.get('picked_lei')).toBe(LEI)
    expect(data.get('max_depth')).toBe('9')
    expect(data.get('threshold')).toBe('10')
    expect(data.get('indirect_method')).toBe('multiply')
  })

  it('replaces whatever was typed in the search box', () => {
    const data = pickedFormData(form({ entry: 'Nordea Bank', max_depth: '6' }), LEI)
    expect(data.getAll('entry')).toEqual([LEI])
    expect(data.get('max_depth')).toBe('6')
  })

  it('drops a previous pick instead of keeping two', () => {
    const data = pickedFormData(form({ entry: 'x', picked_lei: 'OLD', threshold: '25' }), LEI)
    expect(data.getAll('picked_lei')).toEqual([LEI])
  })

  it('does not change the form it was given', () => {
    const current = form({ entry: 'abc', max_depth: '6' })
    pickedFormData(current, LEI)
    expect(current.get('entry')).toBe('abc')
    expect(current.has('picked_lei')).toBe(false)
  })
})
