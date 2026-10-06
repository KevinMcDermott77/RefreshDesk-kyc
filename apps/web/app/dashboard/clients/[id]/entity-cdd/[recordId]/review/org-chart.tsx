'use client'

import { useMemo, useState, useCallback } from 'react'
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from 'reactflow'
import 'reactflow/dist/style.css'
import type { OwnershipNode } from '@/lib/types/entity-cdd'

const KIND_LABELS: Record<OwnershipNode['kind'], string> = {
  individual: 'Individual',
  corporate: 'Corporate entity',
  legal_person: 'Legal person',
}

type CompanyNodeData = {
  label: string
  companyNumber: string
}

type OwnerNodeData = {
  owner: OwnershipNode
  expanded: boolean
  onToggle: () => void
}

function CompanyNode({ data }: NodeProps<CompanyNodeData>) {
  return (
    <div className="min-w-[200px] border-2 border-[var(--accent-strong)] bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--accent-strong)]">
        Company
      </p>
      <p className="mt-1 text-sm font-semibold">{data.label}</p>
      <p className="mt-0.5 text-xs text-[var(--muted)]">{data.companyNumber}</p>
      <Handle type="target" position={Position.Top} />
    </div>
  )
}

function OwnerNode({ data }: NodeProps<OwnerNodeData>) {
  const { owner, expanded, onToggle } = data
  return (
    <div
      onClick={onToggle}
      className={`min-w-[200px] cursor-pointer border bg-white px-4 py-3 shadow-sm transition hover:border-[var(--accent)] ${
        owner.is_ubo ? 'border-emerald-300' : 'border-[var(--line)]'
      }`}
    >
      <Handle type="source" position={Position.Bottom} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{owner.name}</p>
        {owner.is_ubo && (
          <span className="shrink-0 border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-800">
            UBO
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-[var(--muted)]">
        {KIND_LABELS[owner.kind]}
        {owner.ownership_percentage !== null ? ` · ~${owner.ownership_percentage}%` : ''}
      </p>
      {expanded && (
        <div className="mt-2 space-y-1 border-t border-[var(--line)] pt-2 text-xs text-[var(--muted)]">
          {owner.company_number && <p>Company number: {owner.company_number}</p>}
          {owner.address && <p>Address: {owner.address}</p>}
          {owner.nature_of_control.length > 0 && (
            <ul className="list-inside list-disc">
              {owner.nature_of_control.map((n, i) => (
                <li key={i}>{n.replace(/-/g, ' ')}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="mt-2 text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">
        {expanded ? 'Click to collapse' : 'Click to expand'}
      </p>
    </div>
  )
}

const nodeTypes = { company: CompanyNode, owner: OwnerNode }

type Props = {
  companyName: string
  companyNumber: string
  ownershipChain: OwnershipNode[]
}

export function OwnershipOrgChart({ companyName, companyNumber, ownershipChain }: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const { nodes, edges } = useMemo(() => {
    const companyId = 'company'
    const nodeWidth = 240
    const startX = (Math.max(ownershipChain.length, 1) * nodeWidth) / 2 - nodeWidth / 2

    const ownerNodes: Node[] = ownershipChain.map((owner, i) => {
      const id = `owner-${i}`
      return {
        id,
        type: 'owner',
        position: { x: i * nodeWidth, y: 160 },
        data: { owner, expanded: expandedIds.has(id), onToggle: () => toggle(id) },
      }
    })

    const companyNode: Node = {
      id: companyId,
      type: 'company',
      position: { x: startX, y: 0 },
      data: { label: companyName, companyNumber },
    }

    const flowEdges: Edge[] = ownershipChain.map((owner, i) => ({
      id: `edge-${i}`,
      source: `owner-${i}`,
      target: companyId,
      label:
        owner.ownership_percentage !== null ? `~${owner.ownership_percentage}%` : undefined,
      type: 'smoothstep',
    }))

    return { nodes: [companyNode, ...ownerNodes], edges: flowEdges }
  }, [companyName, companyNumber, ownershipChain, expandedIds, toggle])

  if (ownershipChain.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        No ownership chain to display — no persons with significant control were returned.
      </p>
    )
  }

  return (
    <div className="h-[420px] w-full border border-[var(--line)] bg-white">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
