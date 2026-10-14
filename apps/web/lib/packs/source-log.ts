/** One fetch from an upstream register, as recorded in a refresh pack's source log. */
export type SourceLogEntry = {
  /** Human name of the register, e.g. "GLEIF". */
  register: string
  /** Endpoint path (and query) with no host and no credentials. */
  path: string
  /** ISO timestamp the data was fetched from the register (the original fetch, when served from a cache). */
  fetchedAt: string
  /** HTTP status; 0 when the request failed before a response. */
  status: number
  /** True when this run was served from an in-memory cache rather than a new request. */
  cached?: boolean
}

export type SourceLog = {
  record(entry: SourceLogEntry): void
  entries(): SourceLogEntry[]
}

export function createSourceLog(): SourceLog {
  const entries: SourceLogEntry[] = []
  return {
    record: (entry) => {
      entries.push({ ...entry })
    },
    entries: () => entries.map((entry) => ({ ...entry })),
  }
}

const SECRET_PARAM = /(key|token|secret|password|passwd|auth|signature|sig|credential)/i

/**
 * The path and query of a URL (or of a path), without the host, user info or fragment, and with
 * the value of any credential-looking query parameter replaced by "***".
 */
export function scrubPath(urlOrPath: string): string {
  let pathname: string
  let params: URLSearchParams
  try {
    const url = new URL(urlOrPath, 'http://placeholder.invalid')
    pathname = url.pathname
    params = url.searchParams
  } catch {
    return urlOrPath.split('#')[0]
  }
  const clean = new URLSearchParams()
  for (const [key, value] of params) clean.append(key, SECRET_PARAM.test(key) ? '***' : value)
  const query = clean.toString()
  // URLSearchParams escapes "[" and "]"; the register APIs and humans read them literally.
  if (!query) return pathname
  const spaced = query.replace(/\+/g, '%20')
  try {
    return `${pathname}?${decodeURIComponent(spaced)}`
  } catch {
    return `${pathname}?${spaced}`
  }
}
