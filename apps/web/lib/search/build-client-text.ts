import type { Client } from '@/lib/types/clients'

export function buildClientText(client: Client): string {
  const lines = [
    client.display_name,
    `${client.client_type} client`,
    `Risk rating: ${client.risk_rating}`,
    `Status: ${client.status}`,
  ]

  if (client.external_ref) lines.push(`External reference: ${client.external_ref}`)

  for (const [key, value] of Object.entries(client.details)) {
    if (value === null || value === undefined || value === '') continue
    lines.push(`${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
  }

  return lines.join('\n')
}
