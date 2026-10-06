# Slice 5 — Refresh Campaigns (Email Notifications)

**Tag target:** `v0.5-slice-5-campaigns`  
**Stack:** Next.js 15 · TypeScript · Supabase · Resend · Railway Cron Job  
**Depends on:** Slice 4 complete (`v0.4-slice-4-audit-timeline`)

---

## Goal

Send a daily email to the MLR supervisor of each firm listing any clients whose KYC refresh is due within 30 days. A Railway Cron Job service hits a secure Next.js API route once per day. The route queries Supabase, builds the email, and sends via Resend.

---

## Architecture

```
Railway Cron Job (daily 08:00 UTC)
  └── POST /api/cron/refresh-reminders
        ├── Verify CRON_SECRET header
        ├── Query: firms with clients due ≤ 30 days
        ├── For each firm: build email digest
        └── Send via Resend to MLR supervisor email
```

No new DB tables required. All data comes from existing `firms`, `clients`, and `firm_members` tables.

---

## Schema changes

None required. One column addition to `firms` to store the MLR supervisor email (currently only stores the name):

```sql
alter table public.firms
  add column if not exists mlr_supervisor_email text;
```

Add this as a new migration: `20260607000000_slice5_firm_supervisor_email.sql`

Also update the firm onboarding form and settings page to capture this email field.

---

## API route: `/api/cron/refresh-reminders`

**File:** `apps/web/app/api/cron/refresh-reminders/route.ts`

### Security

Protected by a shared secret. Railway Cron Job sends the secret in the `Authorization` header. Route validates it before doing anything.

```typescript
const secret = request.headers.get('authorization')
if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}
```

### Query logic

```sql
-- For each firm, find clients due within 30 days
select
  f.id as firm_id,
  f.name as firm_name,
  f.mlr_supervisor as supervisor_name,
  f.mlr_supervisor_email as supervisor_email,
  c.id as client_id,
  c.display_name,
  c.client_type,
  c.risk_rating,
  c.refresh_due_date,
  c.last_refreshed_at
from firms f
join clients c on c.firm_id = f.id
where c.status = 'active'
  and c.refresh_due_date is not null
  and c.refresh_due_date <= current_date + interval '30 days'
  and f.mlr_supervisor_email is not null
order by f.id, c.refresh_due_date asc;
```

Use the Supabase **service role key** for this query (cron runs outside user auth context). Store as `SUPABASE_SERVICE_ROLE_KEY` in env.

### Email grouping

Group results by `firm_id`. For each firm with ≥ 1 due client, send one digest email to `mlr_supervisor_email`.

### Audit logging

Write one `audit_events` row per firm email sent:
- `event_type`: `campaign.reminder_sent`
- `payload`: `{ recipient_email, client_count, due_within_days: 30 }`

---

## Email template

Plain, professional. No HTML framework needed — Resend supports React Email but a simple HTML string is fine for Slice 5.

**Subject:** `[RefreshDesk] {n} client refresh{es} due within 30 days — {firm_name}`

**Body:**

```
Hi {supervisor_name},

The following clients at {firm_name} have KYC refreshes due within the next 30 days:

  Client            Type        Risk      Due date
  ─────────────────────────────────────────────────
  Jane Doe          Individual  Standard  06 Jul 2026
  Acme Ltd          Entity      High      12 Jul 2026

Log in to RefreshDesk to action these: https://your-domain.com/dashboard/clients?filter=due_soon

This is an automated reminder from RefreshDesk.
You are receiving this because you are the designated MLR supervisor for {firm_name}.
```

---

## Railway Cron Job service

### Setup

1. In Railway dashboard: New Service → Cron Job
2. Command: `curl -X POST https://your-app.railway.app/api/cron/refresh-reminders -H "Authorization: Bearer $CRON_SECRET"`
3. Schedule: `0 8 * * *` (08:00 UTC daily)
4. Add `CRON_SECRET` env var to the cron service (same value as in the Next.js app)

### Environment variables needed

In the Next.js app service on Railway:
```
CRON_SECRET=<generate with: openssl rand -hex 32>
RESEND_API_KEY=re_...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
APP_URL=https://your-app.railway.app
```

---

## Settings page update

Add `mlr_supervisor_email` field to the firm settings page so firms can set/update the notification email without needing a developer.

**File:** `apps/web/app/settings/page.tsx` (or wherever settings lives)

Add below the existing MLR supervisor name field:
- Label: "MLR supervisor email"
- Input: email type, required
- Save via existing settings update RPC (or new `update_firm_supervisor_email` RPC if writes are RPC-only)

---

## File structure (new/changed files only)

```
apps/web/
  app/
    api/
      cron/
        refresh-reminders/
          route.ts          -- cron handler, query, email dispatch
  lib/
    resend/
      send-refresh-reminder.ts  -- Resend call, email HTML builder
  settings/
    page.tsx                -- add mlr_supervisor_email field
supabase/
  migrations/
    20260607000000_slice5_firm_supervisor_email.sql
```

---

## Acceptance criteria (smoke test)

1. Migration runs clean — `mlr_supervisor_email` column exists on `firms`
2. Settings page has email field — save it with your email address
3. `GET /api/cron/refresh-reminders` without auth header returns 401
4. `POST /api/cron/refresh-reminders` with wrong secret returns 401
5. `POST /api/cron/refresh-reminders` with correct `CRON_SECRET` returns 200
6. Email arrives in inbox listing due clients (add a test client with due date within 30 days first)
7. Email subject includes firm name and client count
8. `audit_events` has a `campaign.reminder_sent` row after the successful call
9. Firms with no due clients get no email
10. Firms with no `mlr_supervisor_email` set are skipped silently

---

## What to tell Claude Code

> I am building Slice 5 of RefreshDesk. Slices 1–4 are complete. The full plan is at `docs/superpowers/plans/2026-06-07-slice-5-campaigns.md`.
>
> Build Slice 5 in this order:
> 1. Migration — add `mlr_supervisor_email text` column to `firms` table
> 2. Settings page — add mlr_supervisor_email input field, wire to existing save action
> 3. Install resend package: `npm install resend -w apps/web`
> 4. `lib/resend/send-refresh-reminder.ts` — Resend client, HTML email builder, send function
> 5. `app/api/cron/refresh-reminders/route.ts` — POST handler, CRON_SECRET auth, Supabase service role query, group by firm, call send function, write audit event
>
> Key constraints:
> - Route must verify `Authorization: Bearer {CRON_SECRET}` header before doing anything
> - Use SUPABASE_SERVICE_ROLE_KEY (not anon key) for the cron query — it runs outside user auth
> - Group clients by firm — one email per firm, not one per client
> - Skip firms with no mlr_supervisor_email silently (no error)
> - Skip firms with no due clients silently (no email sent)
> - Write a campaign.reminder_sent audit event per firm email sent
> - APP_URL env var for the dashboard link in the email body