# Slice 4 — Audit Timeline UI

**Tag target:** `v0.4-slice-4-audit-timeline`  
**Stack:** Next.js 15 · TypeScript · Tailwind v4 · Supabase  
**Depends on:** Slice 3 complete (`v0.3-slice-3-document-ingestion`)

---

## Goal

Replace the "Full audit trail for this client will appear here in Slice 4" placeholder on the client detail page with a live, readable timeline showing every event for that client — with full payload detail rendered in a human-friendly way.

No new schema. No new RPCs. All the data is already being written to `audit_events`. This slice is purely UI.

---

## Data available in `audit_events`

Each row has:
- `event_type` — e.g. `client.created`, `document.uploaded`, `document.extraction_complete`, `document.approved`, `document.rejected`, `client.refreshed`, `client.archived`
- `created_at` — timestamp
- `actor_user_id` — who triggered it
- `payload` — JSONB with event-specific detail

---

## Query

Fetch audit events for this client from the existing `audit_events` table. Filter by `entity_id = client_id` OR by `payload->>'client_id' = client_id` to catch all related events (document events reference the client in payload).

```sql
select
  ae.id,
  ae.event_type,
  ae.created_at,
  ae.payload,
  fm.full_name as actor_name
from audit_events ae
left join firm_members fm
  on fm.user_id = ae.actor_user_id
  and fm.firm_id = ae.firm_id
where ae.firm_id = $1
  and (
    ae.entity_id = $2
    or ae.payload->>'client_id' = $2::text
  )
order by ae.created_at desc
limit 50;
```

Run this as a direct Supabase query from the server component — no new RPC needed since it's read-only and already scoped by `firm_id` via RLS.

---

## UI Spec

### Timeline layout

Vertical timeline, newest event at top. Each event is a row with:

```
● document.approved          Kevin MCD · 2 minutes ago
  ├ Document    pp.png (Passport)
  ├ Decision    Approved
  ├ Confidence  95%
  └ Notes       —

● document.extraction_complete   System · 2 minutes ago
  ├ Model       claude-sonnet-4-20250514
  ├ Prompt      v1.0
  └ Confidence  95%

● document.uploaded          Kevin MCD · 3 minutes ago
  ├ File        pp.png
  ├ Type        Passport
  └ Size        142 KB

● client.created             Kevin MCD · 1 hour ago
  └ (no additional detail)
```

### Event type rendering

Each event type gets a specific icon and payload renderer:

| event_type | Icon | Payload fields to show |
|---|---|---|
| `client.created` | 👤 | — |
| `client.updated` | ✏️ | changed fields |
| `client.archived` | 📦 | — |
| `client.refreshed` | ✅ | new_refresh_due_date |
| `document.uploaded` | 📄 | file_name, document_type, file_size_bytes |
| `document.extraction_complete` | 🤖 | model_used, prompt_version, confidence_score |
| `document.approved` | ✓ | file_name, confidence_score, reviewer_notes |
| `document.rejected` | ✗ | file_name, reviewer_notes |

### Formatting helpers

- `file_size_bytes` → human readable (e.g. "142 KB")
- `confidence_score` → percentage (e.g. "95%")
- `document_type` → capitalised label (e.g. "proof_of_address" → "Proof of address")
- `new_refresh_due_date` → formatted date (e.g. "06 Jun 2029")
- `created_at` → relative time + absolute on hover tooltip

---

## File structure (new/changed files only)

```
apps/web/
  app/
    dashboard/
      clients/
        [id]/
          page.tsx                  -- replace placeholder with <AuditTimeline>
          _components/
            AuditTimeline.tsx       -- timeline component (server component)
            AuditEvent.tsx          -- single event row with payload renderer
```

Keep `AuditTimeline` as a server component — it fetches directly from Supabase, no client state needed.

---

## Acceptance criteria (smoke test)

1. Client detail page — Audit timeline section shows real events (not placeholder text)
2. `client.created` event shows at the bottom of the timeline
3. `document.uploaded` event shows file name, type, size
4. `document.extraction_complete` event shows model, prompt version, confidence
5. `document.approved` event shows confidence score and reviewer notes field (even if blank)
6. `client.refreshed` event shows new due date
7. Actor name shows (e.g. "Kevin MCD") not a UUID
8. Timestamps show relative time ("2 minutes ago") with no console errors
9. Timeline is scoped to this client only — no other clients' events visible

---

## What to tell Claude Code

> I am building Slice 4 of RefreshDesk. Slices 1–3 are complete. The full plan is at `docs/superpowers/plans/2026-06-06-slice-4-audit-timeline.md`.
>
> Replace the audit timeline placeholder on the client detail page (`app/dashboard/clients/[id]/page.tsx`) with a live timeline component.
>
> Build in this order:
> 1. Add the Supabase query to the client detail page server component — fetch audit events for this client joined with actor name from firm_members
> 2. Create `_components/AuditEvent.tsx` — single event row with icon, event type label, actor name, relative timestamp, and payload detail renderer per event type
> 3. Create `_components/AuditTimeline.tsx` — renders the list of AuditEvent rows
> 4. Wire AuditTimeline into the client detail page, replacing the placeholder
>
> Key constraints:
> - Server components only — no client state or useEffect
> - Query must filter by firm_id AND (entity_id = client_id OR payload->>'client_id' = client_id::text) to catch all related events
> - Actor name must come from firm_members join, not raw UUID
> - Payload rendering is event-type-specific — see the plan for the field mapping per event type
> - Relative timestamps using date-fns formatDistanceToNow (already installed)