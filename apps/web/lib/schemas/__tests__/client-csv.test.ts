import { describe, it, expect } from 'vitest'
import { validateCsvRow } from '../client-csv'

describe('validateCsvRow', () => {
  it('accepts a valid individual row', () => {
    const result = validateCsvRow({
      client_type: 'individual',
      display_name: 'John Smith',
      risk_rating: 'standard',
      external_ref: 'JS001',
      refresh_due_date: '2027-06-01',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.display_name).toBe('John Smith')
    }
  })

  it('accepts a valid entity row with no optional fields', () => {
    const result = validateCsvRow({
      client_type: 'entity',
      display_name: 'Acme Ltd',
      risk_rating: 'high',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing display_name', () => {
    const result = validateCsvRow({
      client_type: 'individual',
      display_name: '',
      risk_rating: 'low',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors[0].field).toBe('display_name')
    }
  })

  it('rejects invalid client_type', () => {
    const result = validateCsvRow({
      client_type: 'company',
      display_name: 'Acme Ltd',
      risk_rating: 'standard',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors[0].field).toBe('client_type')
    }
  })

  it('rejects invalid risk_rating', () => {
    const result = validateCsvRow({
      client_type: 'entity',
      display_name: 'Acme Ltd',
      risk_rating: 'medium',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid date format', () => {
    const result = validateCsvRow({
      client_type: 'individual',
      display_name: 'Jane Doe',
      risk_rating: 'low',
      refresh_due_date: '01/06/2027',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors[0].field).toBe('refresh_due_date')
    }
  })

  it('accepts empty refresh_due_date as omitted', () => {
    const result = validateCsvRow({
      client_type: 'individual',
      display_name: 'Jane Doe',
      risk_rating: 'low',
      refresh_due_date: '',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.refresh_due_date).toBeUndefined()
    }
  })

  it('trims whitespace from string fields', () => {
    const result = validateCsvRow({
      client_type: '  individual  ',
      display_name: '  John Smith  ',
      risk_rating: '  standard  ',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.display_name).toBe('John Smith')
      expect(result.data.client_type).toBe('individual')
    }
  })
})
