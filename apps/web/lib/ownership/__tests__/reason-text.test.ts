import { describe, expect, it } from 'vitest'
import { REASON_TEXT, reasonText } from '../reason-text'
import { REASON_CODES } from '../types'

describe('reason-text', () => {
  it('covers every ReasonCode with non-empty text and no extras', () => {
    expect(Object.keys(REASON_TEXT).sort()).toEqual([...REASON_CODES].sort())
    for (const code of REASON_CODES) expect(reasonText(code).length).toBeGreaterThan(10)
  })
})
