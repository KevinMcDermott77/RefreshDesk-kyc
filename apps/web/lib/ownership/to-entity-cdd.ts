import type { OwnershipNode as StoredOwnershipNode, PscDataQuality } from '@/lib/types/entity-cdd'
import { classify } from './bands'
import type { OwnershipNode, WalkResult } from './types'
import { DEFAULT_THRESHOLD } from './walk'

export type EntityCddOwnership = {
  ownershipChain: StoredOwnershipNode[]
  uboList: StoredOwnershipNode[]
  pscDataQuality: PscDataQuality
  pscWarning: string | null
}

const QUALITY: Record<WalkResult['status'], PscDataQuality> = {
  resolved: 'full',
  partial: 'partial',
  unresolved: 'none',
}

function isMaterial(node: OwnershipNode, threshold: number): boolean {
  return !node.effectiveRange || classify(node.effectiveRange, threshold) !== 'below'
}

/**
 * Maps a walk onto the columns entity_cdd_records already stores, so the
 * review screen and save_entity_cdd RPC keep working unchanged.
 * ownership_chain holds the root's direct owners only (the org chart draws a
 * single level); ubo_list holds material individuals at any depth.
 */
export function toEntityCddOwnership(result: WalkResult, threshold = DEFAULT_THRESHOLD): EntityCddOwnership {
  const byId = new Map(result.nodes.map((node) => [node.id, node]))

  const toStored = (node: OwnershipNode, natures: string[]): StoredOwnershipNode => ({
    name: node.name,
    kind: node.kind === 'super_secure' ? 'legal_person' : node.kind,
    ownership_percentage: null,
    nature_of_control: natures,
    is_ubo: node.resolution === 'RESOLVED_INDIVIDUAL' && isMaterial(node, threshold),
    ...(node.companyNumber ? { company_number: node.companyNumber } : {}),
  })

  const ownershipChain = result.edges
    .filter((edge) => edge.childId === result.rootId)
    .map((edge) => toStored(byId.get(edge.parentId)!, edge.natures))

  const uboList = result.edges
    .map((edge) => ({ edge, node: byId.get(edge.parentId)! }))
    .filter(({ node }) => node.resolution === 'RESOLVED_INDIVIDUAL' && isMaterial(node, threshold))
    .map(({ edge, node }) => toStored(node, edge.natures))

  const open = result.nodes.filter((node) => node.resolution === 'UNRESOLVED' && isMaterial(node, threshold))
  const pscWarning =
    open.length === 0
      ? null
      : `Ownership not fully resolved: ${open
          .map((node) => {
            const id = node.companyNumber ? ` (${node.companyNumber})` : ''
            const statement = node.statementCode ? `: ${node.statementCode}` : ''
            return `${node.name}${id} — ${node.reasonCode ?? 'UNRESOLVED'}${statement}`
          })
          .join('; ')}. Review the filing history to identify the ultimate beneficial owner.`

  return { ownershipChain, uboList, pscDataQuality: QUALITY[result.status], pscWarning }
}
