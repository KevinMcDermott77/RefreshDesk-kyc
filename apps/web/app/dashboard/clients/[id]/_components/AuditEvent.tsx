import { formatDistanceToNow } from 'date-fns'

export type AuditEventRow = {
  id: string
  event_type: string
  entity_type: string
  entity_id: string | null
  payload: Record<string, unknown>
  created_at: string
  actor_user_id: string | null
}

type Props = {
  event: AuditEventRow
  actorName: string | null
}

// ─── Labels ───────────────────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  'client.created': 'Client created',
  'client.updated': 'Client updated',
  'client.risk_rating_changed': 'Risk rating changed',
  'client.refresh_due_date_changed': 'Refresh date changed',
  'client.archived': 'Client archived',
  'client.refreshed': 'KYC refreshed',
  'client.bulk_imported': 'Bulk import',
  'document.uploaded': 'Document uploaded',
  'document.extraction_complete': 'AI extraction complete',
  'document.approved': 'Extraction approved',
  'document.rejected': 'Extraction rejected',
  'firm.created': 'Firm created',
  'firm_refresh_rules.updated': 'Refresh rules updated',
  'firm.join_code_created': 'Join code generated',
  'firm.join_code_deactivated': 'Join code deactivated',
  'firm.member_joined': 'Member joined',
  'firm.member_removed': 'Member removed',
  'firm.member_role_changed': 'Member role changed',
  'billing.subscription_created': 'Subscription started',
  'billing.subscription_cancelled': 'Subscription cancelled',
  'billing.payment_failed': 'Payment failed',
  'billing.payment_succeeded': 'Payment succeeded',
}

// ─── Icons ────────────────────────────────────────────────────────────────────

type IconStyle = { char: string; className: string }

const EVENT_ICONS: Record<string, IconStyle> = {
  'client.created':               { char: '+',  className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  'client.updated':               { char: '~',  className: 'bg-[var(--panel)] text-[var(--muted)] border-[var(--line)]' },
  'client.risk_rating_changed':   { char: '⚠',  className: 'bg-amber-50 text-amber-700 border-amber-200' },
  'client.refresh_due_date_changed': { char: '◷', className: 'bg-[var(--panel)] text-[var(--muted)] border-[var(--line)]' },
  'client.archived':              { char: '□',  className: 'bg-[var(--panel)] text-[var(--muted)] border-[var(--line)]' },
  'client.refreshed':             { char: '✓',  className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  'client.bulk_imported':         { char: '↑',  className: 'bg-[var(--panel)] text-[var(--muted)] border-[var(--line)]' },
  'document.uploaded':            { char: '↑',  className: 'bg-[var(--panel)] text-[var(--muted)] border-[var(--line)]' },
  'document.extraction_complete': { char: '◌',  className: 'bg-[var(--panel)] text-[var(--muted)] border-[var(--line)]' },
  'document.approved':            { char: '✓',  className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  'document.rejected':            { char: '✗',  className: 'bg-red-50 text-red-700 border-red-200' },
  'firm.join_code_created':       { char: '+',  className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  'firm.join_code_deactivated':   { char: '□',  className: 'bg-[var(--panel)] text-[var(--muted)] border-[var(--line)]' },
  'firm.member_joined':           { char: '+',  className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  'firm.member_removed':          { char: '✗',  className: 'bg-red-50 text-red-700 border-red-200' },
  'firm.member_role_changed':     { char: '~',  className: 'bg-[var(--panel)] text-[var(--muted)] border-[var(--line)]' },
  'billing.subscription_created':   { char: '✓', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  'billing.subscription_cancelled': { char: '□', className: 'bg-[var(--panel)] text-[var(--muted)] border-[var(--line)]' },
  'billing.payment_failed':         { char: '✗', className: 'bg-red-50 text-red-700 border-red-200' },
  'billing.payment_succeeded':      { char: '✓', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}

const DEFAULT_ICON: IconStyle = { char: '○', className: 'bg-[var(--panel)] text-[var(--muted)] border-[var(--line)]' }

// ─── Payload detail per event type ────────────────────────────────────────────

function PayloadDetail({ event_type, payload }: Pick<AuditEventRow, 'event_type' | 'payload'>) {
  const p = payload

  switch (event_type) {
    case 'client.created':
      return (
        <span>
          {String(p.display_name ?? '')} · {String(p.client_type ?? '')} · {String(p.risk_rating ?? '')} risk
        </span>
      )

    case 'client.updated': {
      const changes = p.changes as Record<string, { before: unknown; after: unknown }> | null
      if (!changes || Object.keys(changes).length === 0) return null
      return (
        <span>
          {Object.entries(changes)
            .map(([field, { before, after }]) =>
              `${field.replace(/_/g, ' ')}: ${before ?? '—'} → ${after ?? '—'}`
            )
            .join(' · ')}
        </span>
      )
    }

    case 'client.risk_rating_changed':
      return <span>{String(p.before ?? '—')} → {String(p.after ?? '—')}</span>

    case 'client.refresh_due_date_changed':
      return (
        <span>
          {p.before ? new Date(String(p.before)).toLocaleDateString('en-GB') : '—'}
          {' → '}
          {p.after ? new Date(String(p.after)).toLocaleDateString('en-GB') : '—'}
        </span>
      )

    case 'client.archived':
      return <span>Status: active → archived</span>

    case 'client.refreshed':
      return (
        <span>
          Next due:{' '}
          {p.new_refresh_due_date
            ? new Date(String(p.new_refresh_due_date)).toLocaleDateString('en-GB')
            : '—'}
        </span>
      )

    case 'client.bulk_imported':
      return <span>{Number(p.inserted_count ?? 0)} clients imported</span>

    case 'document.uploaded': {
      const docType = String(p.document_type ?? '').replace(/_/g, ' ')
      return <span>{docType} · {String(p.file_name ?? '')}</span>
    }

    case 'document.extraction_complete': {
      const score = typeof p.confidence_score === 'number'
        ? `${Math.round(p.confidence_score * 100)}%`
        : null
      return score ? <span>Confidence: {score}</span> : null
    }

    case 'document.approved':
    case 'document.rejected': {
      const notes = p.reviewer_notes
      return notes ? <span>&quot;{String(notes)}&quot;</span> : null
    }

    case 'firm.join_code_created':
      return <span>Code: {String(p.code ?? '')} · {String(p.role ?? '')}</span>

    case 'firm.join_code_deactivated':
      return <span>Code: {String(p.code ?? '')}</span>

    case 'firm.member_joined':
      return (
        <span>
          {String(p.full_name ?? '')} joined as {String(p.role ?? '')}
        </span>
      )

    case 'firm.member_removed':
      return <span>Previous role: {String(p.previous_role ?? '')}</span>

    case 'firm.member_role_changed':
      return <span>{String(p.before ?? '—')} → {String(p.after ?? '—')}</span>

    case 'billing.subscription_created':
    case 'billing.subscription_cancelled':
      return <span>Subscription: {String(p.subscription_id ?? '')}</span>

    case 'billing.payment_failed':
    case 'billing.payment_succeeded': {
      const amount = typeof p.amount_due === 'number' ? `£${(p.amount_due / 100).toFixed(2)}` : null
      return amount ? <span>{amount}</span> : null
    }

    case 'firm_refresh_rules.updated': {
      const cm = p.cadence_months as { before: number; after: number } | null
      if (!cm) return null
      return (
        <span>
          {String(p.risk_rating ?? '')} risk: {cm.before}m → {cm.after}m
        </span>
      )
    }

    default:
      return null
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AuditEvent({ event, actorName }: Props) {
  const icon = EVENT_ICONS[event.event_type] ?? DEFAULT_ICON
  const label = EVENT_LABELS[event.event_type] ?? event.event_type
  const relativeTime = formatDistanceToNow(new Date(event.created_at), { addSuffix: true })

  return (
    <div className="flex gap-3 py-3">
      <div className="shrink-0 pt-0.5">
        <span
          className={`inline-flex h-6 w-6 items-center justify-center border text-xs font-bold ${icon.className}`}
        >
          {icon.char}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold">{label}</span>
          {actorName && (
            <span className="text-xs text-[var(--muted)]">by {actorName}</span>
          )}
          <span className="text-xs text-[var(--muted)]">{relativeTime}</span>
        </div>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          <PayloadDetail event_type={event.event_type} payload={event.payload} />
        </p>
      </div>
    </div>
  )
}
