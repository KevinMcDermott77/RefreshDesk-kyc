import { z } from 'zod'
import type { ClientEvidenceItem } from '@/lib/ownership/types'

/**
 * Turns what confirmed_evidence_for returns into the items the walk uses. No individual's name goes
 * into an item: individuals become their initials (set by the app when the proposal was saved). The
 * certifier's text is left behind, and an override's note is never copied onto a node or into a summary.
 * Names of individuals are exposed only by individualNamesIn, for the pack's leak check.
 */

const holding = z.union([
  z.object({ type: z.literal('percent'), value: z.number() }),
  z.object({ type: z.literal('band'), low: z.number(), high: z.number() }),
])

const owner = z.object({
  kind: z.enum(['individual', 'entity']),
  name_as_shown: z.string().nullish(),
  initials: z.string().nullish(),
  holding: holding.nullish(),
  registration: z.object({ number: z.string(), country: z.string() }).nullish(),
  lei_shown: z.string().nullish(),
  page_ref: z.string(),
})

const itemSchema = z.object({
  id: z.string(),
  node_identity: z.object({ lei: z.string().optional(), country: z.string().optional(), registration_number: z.string().optional() }),
  evidence_kind: z.string(),
  as_at: z.string().nullish(),
  document_date: z.string().nullish(),
  certified: z.enum(['yes', 'no', 'unclear']),
  edited: z.boolean().nullish(),
  confirmed_at: z.string(),
  document_sha256: z.string(),
  payload: z.object({
    owners: z.array(owner),
    owners_complete: z.boolean(),
    override: z.object({ reasons: z.array(z.enum(['stale', 'uncertified'])), note: z.string() }).nullish(),
  }),
})

export function toClientEvidenceItems(json: unknown): ClientEvidenceItem[] {
  if (!Array.isArray(json)) return []
  const items: ClientEvidenceItem[] = []
  for (const raw of json) {
    const parsed = itemSchema.safeParse(raw)
    // An item that does not parse is left out: the walk then simply does not use it.
    if (!parsed.success) continue
    const item = parsed.data
    items.push({
      id: item.id,
      nodeIdentity: {
        ...(item.node_identity.lei ? { lei: item.node_identity.lei } : {}),
        ...(item.node_identity.country ? { country: item.node_identity.country } : {}),
        ...(item.node_identity.registration_number ? { registrationNumber: item.node_identity.registration_number } : {}),
      },
      evidenceKind: item.evidence_kind,
      asAt: item.as_at ?? null,
      documentDate: item.document_date ?? null,
      certified: item.certified,
      confirmedAt: item.confirmed_at,
      edited: item.edited ?? false,
      documentSha256: item.document_sha256,
      ownersComplete: item.payload.owners_complete,
      override: item.payload.override ? { reasons: item.payload.override.reasons, note: item.payload.override.note } : null,
      owners: item.payload.owners.map((o) => ({
        kind: o.kind,
        // Individuals: initials only. An entity is a company, so its name is not personal data.
        label: o.kind === 'individual' ? (o.initials?.trim() || '?') : (o.name_as_shown?.trim() || 'Unnamed owner'),
        holding: o.holding ?? null,
        registration: o.registration ?? null,
        leiShown: o.lei_shown ?? null,
        pageRef: o.page_ref,
      })),
    })
  }
  return items
}

/** Full names of individuals in the raw result (admins and members receive them), only to check they never reach a pack. */
export function individualNamesIn(json: unknown): string[] {
  if (!Array.isArray(json)) return []
  const names: string[] = []
  for (const raw of json) {
    const owners = (raw as { payload?: { owners?: unknown } } | null)?.payload?.owners
    if (!Array.isArray(owners)) continue
    for (const o of owners as { kind?: unknown; name_as_shown?: unknown }[]) {
      if (o?.kind === 'individual' && typeof o.name_as_shown === 'string' && o.name_as_shown.trim()) names.push(o.name_as_shown.trim())
    }
  }
  return names
}

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
}

/**
 * The confirmed evidence for one client's walk, as a loader for the walk and a way to read, afterwards, the
 * names it carried (for the pack's leak check). The loader throws if the database refuses, which the walk
 * treats as "no evidence".
 */
export function createEvidenceLoader(supabase: RpcClient, clientId: string, subjectId: string) {
  let names: string[] = []
  return {
    load: async (): Promise<ClientEvidenceItem[]> => {
      const { data, error } = await supabase.rpc('confirmed_evidence_for', { p_client_id: clientId, p_subject_id: subjectId.trim().toUpperCase() })
      if (error) throw new Error(error.message)
      names = individualNamesIn(data)
      return toClientEvidenceItems(data)
    },
    individualNames: () => names,
  }
}
