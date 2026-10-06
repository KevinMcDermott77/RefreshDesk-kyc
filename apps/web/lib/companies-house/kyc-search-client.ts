function kycSearchUrl(): string {
  const base = process.env.KYC_SEARCH_URL
  if (!base) throw new Error('KYC_SEARCH_URL is not configured')
  return base.replace(/\/$/, '')
}

export async function fetchAuthToken(): Promise<string> {
  const email = process.env.KYC_SEARCH_ADMIN_EMAIL
  const password = process.env.KYC_SEARCH_ADMIN_PASSWORD
  if (!email || !password) {
    throw new Error('KYC_SEARCH_ADMIN_EMAIL / KYC_SEARCH_ADMIN_PASSWORD are not configured')
  }

  const url = `${kycSearchUrl()}/auth/login`
  console.log(`[kyc-search] POST ${url}`)

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok) {
    throw new Error(`kyc-search login failed (${response.status})`)
  }

  const body = (await response.json()) as { access_token?: string }
  if (!body.access_token) {
    throw new Error('kyc-search login response did not include an access_token')
  }

  return body.access_token
}

export async function kycSearchGetJson(path: string, token: string): Promise<unknown> {
  const url = `${kycSearchUrl()}${path}`
  console.log(`[kyc-search] GET ${url}`)

  const response = await fetch(url, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    throw new Error(`kyc-search request failed (${response.status}): ${path}`)
  }

  return response.json()
}

export type KycSearchResponse = {
  status: number
  body: unknown
  /** X-Fetched-At: when kyc-search fetched the data from Companies House. */
  fetchedAt?: string
  /** Retry-After sent with a 503 (Companies House rate limit), verbatim. */
  retryAfter?: string
}

/** Like kycSearchGetJson, but returns the status instead of throwing on non-2xx. */
export async function kycSearchGet(path: string, token: string): Promise<KycSearchResponse> {
  const url = `${kycSearchUrl()}${path}`
  console.log(`[kyc-search] GET ${url}`)

  const response = await fetch(url, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  })

  const body = response.ok ? await response.json() : null
  const fetchedAt = response.headers.get('x-fetched-at')
  const retryAfter = response.headers.get('retry-after')
  return {
    status: response.status,
    body,
    ...(fetchedAt ? { fetchedAt } : {}),
    ...(retryAfter ? { retryAfter } : {}),
  }
}

export async function kycSearchGetBinary(path: string, token: string): Promise<Buffer> {
  const url = `${kycSearchUrl()}${path}`
  console.log(`[kyc-search] GET ${url}`)

  const response = await fetch(url, {
    headers: { accept: 'application/pdf', authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    throw new Error(`kyc-search request failed (${response.status}): ${path}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

export function asArray(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value

  if (typeof value === 'object' && value !== null) {
    const items = (value as Record<string, unknown>)[key]
    if (Array.isArray(items)) return items
  }

  return []
}
