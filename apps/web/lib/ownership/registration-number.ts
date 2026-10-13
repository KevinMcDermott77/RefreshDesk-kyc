/** Uppercase with whitespace, dots, hyphens and slashes removed: the form registration numbers are compared in. */
export function normaliseRegistration(value: string | undefined): string {
  return (value ?? '').toUpperCase().replace(/[\s.\-/]/g, '')
}

export function sameRegistration(a: string | undefined, b: string | undefined): boolean {
  const left = normaliseRegistration(a)
  return left.length > 0 && left === normaliseRegistration(b)
}

/**
 * The spellings GLEIF might hold a registration number under. GLEIF can only
 * be filtered on the exact stored string, so each variant is queried and the
 * results are compared on the normalised form.
 *
 *   923609016 -> 923 609 016 (digits grouped from the right)
 *   HRB719915 -> HRB 719915  (letters, then digits)
 */
export function registrationVariants(value: string): string[] {
  const raw = value.trim()
  const normalised = normaliseRegistration(raw)
  if (!normalised) return []

  const variants = [raw, normalised]
  const letterThenDigits = normalised.match(/^([A-Z]+)([0-9]+)$/)
  if (letterThenDigits) variants.push(`${letterThenDigits[1]} ${letterThenDigits[2]}`)
  if (/^[0-9]{6,}$/.test(normalised)) variants.push(normalised.replace(/\B(?=([0-9]{3})+$)/g, ' '))

  return [...new Set(variants)]
}
