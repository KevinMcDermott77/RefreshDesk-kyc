import { formatRange, NODE_HEIGHT, NODE_WIDTH, type FlowEdge, type FlowNode, type Tone } from '@/lib/ownership/to-flow'

// Colours carry no meaning on their own: every node also says its status in words, so the chart
// reads the same in greyscale print.
const FILL: Record<Tone, string> = {
  resolved: '#ecfdf5',
  unresolved: '#fffbeb',
  pruned: '#f3f4f6',
  pending: '#ffffff',
}
const STROKE: Record<Tone, string> = {
  resolved: '#059669',
  unresolved: '#d97706',
  pruned: '#9ca3af',
  pending: '#6b7280',
}

/** Splits text over at most `lines` lines of about `width` characters, ending with an ellipsis if cut. */
export function wrapText(text: string, width: number, lines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let current = ''
  for (const word of words) {
    if (current && (current + ' ' + word).length > width) {
      out.push(current)
      current = word
    } else {
      current = current ? current + ' ' + word : word
    }
  }
  if (current) out.push(current)
  if (out.length <= lines) return out
  const kept = out.slice(0, lines)
  kept[lines - 1] = kept[lines - 1].replace(/\s*\S*$/, '') + '…'
  return kept
}

/**
 * The ownership chart as plain SVG, drawn from the positions saved in the snapshot: no scripts, no
 * live data, and it prints. Owners are above the entity they own.
 */
export function StaticChart({ nodes, edges }: { nodes: FlowNode[]; edges: FlowEdge[] }) {
  if (nodes.length === 0) return <p className="text-sm">No ownership chain was recorded.</p>

  const pad = 24
  const minX = Math.min(...nodes.map((n) => n.position.x)) - pad
  const minY = Math.min(...nodes.map((n) => n.position.y)) - pad
  const width = Math.max(...nodes.map((n) => n.position.x + NODE_WIDTH)) + pad - minX
  const height = Math.max(...nodes.map((n) => n.position.y + NODE_HEIGHT)) + pad - minY
  const byId = new Map(nodes.map((n) => [n.id, n]))

  return (
    <svg
      role="img"
      aria-label="Ownership chart"
      viewBox={`${minX} ${minY} ${width} ${height}`}
      className="h-auto w-full max-w-full"
      style={{ maxHeight: '240mm' }}
    >
      {edges.map((edge) => {
        // The edge runs from the owner (source) down to the entity it owns (target).
        const from = byId.get(edge.source)
        const to = byId.get(edge.target)
        if (!from || !to) return null
        const x1 = from.position.x + NODE_WIDTH / 2
        const y1 = from.position.y + NODE_HEIGHT
        const x2 = to.position.x + NODE_WIDTH / 2
        const y2 = to.position.y
        const midY = (y1 + y2) / 2
        return (
          <g key={edge.id}>
            <polyline
              points={`${x1},${y1} ${x1},${midY} ${x2},${midY} ${x2},${y2}`}
              fill="none"
              stroke="#374151"
              strokeWidth={1.5}
              strokeDasharray={edge.dashed ? '6 4' : undefined}
            />
            {edge.label ? (
              <g>
                <rect x={(x1 + x2) / 2 - 62} y={midY - 9} width={124} height={18} fill="#ffffff" stroke="#d1d5db" />
                <text x={(x1 + x2) / 2} y={midY + 4} textAnchor="middle" fontSize={11} fill="#111827">
                  {edge.label}
                </text>
              </g>
            ) : null}
          </g>
        )
      })}

      {nodes.map((node) => {
        const { x, y } = node.position
        const data = node.data
        const nameLines = wrapText(data.name, 30, 2)
        const status = data.reasonCode ? `${data.resolutionLabel} · ${data.reasonCode}` : data.resolutionLabel
        return (
          <g key={node.id}>
            <rect x={x} y={y} width={NODE_WIDTH} height={NODE_HEIGHT} fill={FILL[data.tone]} stroke={STROKE[data.tone]} strokeWidth={2} />
            {nameLines.map((line, i) => (
              <text key={i} x={x + 10} y={y + 20 + i * 16} fontSize={13} fontWeight={600} fill="#111827">
                {line}
              </text>
            ))}
            {data.subtitle || data.country ? (
              <text x={x + 10} y={y + 56} fontSize={11} fill="#374151">
                {[data.subtitle, data.country].filter(Boolean).join(' · ')}
              </text>
            ) : null}
            <text x={x + 10} y={y + 74} fontSize={11} fontWeight={600} fill="#111827">
              {wrapText(status, 38, 1)[0]}
            </text>
            {data.effectiveRange ? (
              <text x={x + 10} y={y + 90} fontSize={10} fill="#374151">
                {formatRange(data.effectiveRange)}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
