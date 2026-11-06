import type { PackSnapshot } from './snapshot'

export type StoredEvidence = { id: string; status: string; document_sha256: string }

/**
 * The evidence a snapshot refers to that is no longer confirmed, or whose document is not the one it was made
 * from. A run can be saved up to an hour after it was made; if an admin superseded or rejected the evidence
 * meanwhile, the pack would otherwise record a claim nobody stands behind any more.
 */
export function unconfirmedEvidence(snapshot: Pick<PackSnapshot, 'clientEvidence'>, stored: StoredEvidence[]): string[] {
  const byId = new Map(stored.map((row) => [row.id, row]))
  return (snapshot.clientEvidence ?? [])
    .filter((block) => {
      const row = byId.get(block.id)
      return !row || row.status !== 'confirmed' || row.document_sha256 !== block.documentSha256
    })
    .map((block) => block.id)
}
