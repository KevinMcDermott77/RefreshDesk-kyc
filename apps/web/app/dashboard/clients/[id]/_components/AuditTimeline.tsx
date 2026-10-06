import { AuditEvent } from './AuditEvent'
import type { AuditEventRow } from './AuditEvent'

type Props = {
  events: AuditEventRow[]
  actorMap: Map<string, string>
}

export function AuditTimeline({ events, actorMap }: Props) {
  if (events.length === 0) {
    return (
      <p className="mt-3 text-sm text-[var(--muted)]">No audit events recorded yet.</p>
    )
  }

  return (
    <div className="mt-3 divide-y divide-[var(--line)]">
      {events.map((event) => (
        <AuditEvent
          key={event.id}
          event={event}
          actorName={event.actor_user_id ? (actorMap.get(event.actor_user_id) ?? null) : null}
        />
      ))}
    </div>
  )
}
