import type { WalkSummary } from '@/lib/ownership/to-flow'

type OverviewRow = { id: string; node_name: string; status: string }

/**
 * Points to check for evidence that has been uploaded but not confirmed. It is not used until an admin
 * confirms it, so the walk says so rather than leaving a reader to wonder whether it was counted.
 */
export function pendingEvidencePoints(rows: OverviewRow[]): WalkSummary['pointsToCheck'] {
  return rows
    .filter((row) => row.status === 'draft' || row.status === 'proposed')
    .map((row) => ({
      id: `evidence:${row.id}`,
      name: row.node_name,
      code: 'CLIENT_EVIDENCE_PENDING' as const,
      detail: row.status === 'draft' ? 'uploaded, owners not entered yet' : 'awaiting confirmation by an admin',
    }))
}
