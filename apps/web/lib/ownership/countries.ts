const UK = /\b(united kingdom|uk|great britain|england|wales|scotland|northern ireland)\b/i

// Longest / most specific names first. Matching is on whole words, case-insensitive.
const NAMES: [RegExp, string][] = [
  [/\b(united states|usa|u\.s\.a?\.?|delaware|nevada|new york|california|texas|florida|wyoming|new jersey|massachusetts)\b/i, 'US'],
  [/\b(republic of ireland|ireland|eire)\b/i, 'IE'],
  [/\bluxembourg\b/i, 'LU'],
  [/\bnetherlands\b/i, 'NL'],
  [/\bgermany\b|\bdeutschland\b/i, 'DE'],
  [/\bfrance\b/i, 'FR'],
  [/\bspain\b|\bespana\b/i, 'ES'],
  [/\bdenmark\b/i, 'DK'],
  [/\bnorway\b/i, 'NO'],
  [/\bsweden\b/i, 'SE'],
  [/\bfinland\b/i, 'FI'],
  [/\bcayman\b/i, 'KY'],
  [/\bbritish virgin islands\b|\bbvi\b/i, 'VG'],
  [/\bjersey\b/i, 'JE'],
  [/\bguernsey\b/i, 'GG'],
  [/\bswitzerland\b|\bswiss\b/i, 'CH'],
]

/**
 * ISO country code from the free text Companies House holds for an overseas
 * PSC's register ("The Netherlands", "Delaware"). undefined when the text is
 * empty or names a country we do not recognise; the caller tells those apart
 * by whether there was text at all.
 */
export function countryCode(text: string | undefined): string | undefined {
  const value = text?.trim()
  if (!value) return undefined
  if (/^[A-Za-z]{2}$/.test(value)) return value.toUpperCase()
  if (/new south wales/i.test(value)) return "AU"
  if (UK.test(value)) return 'GB'
  return NAMES.find(([pattern]) => pattern.test(value))?.[1]
}
