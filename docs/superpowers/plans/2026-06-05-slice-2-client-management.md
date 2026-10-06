# Slice 2: Client Management — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full application layer for client management — types, server actions, list view with filters, manual add/edit, CSV import, and client detail placeholder — on top of the already-written Slice 2 DB migration.

**Architecture:** Server components fetch data via Supabase RLS queries; all mutations route through security-definer RPCs via Next.js server actions using the established `useActionState` pattern. CSV rows are parsed and Zod-validated in the browser, previewed before submit, then POSTed to a server action as JSON in a hidden form field.

**Tech Stack:** Next.js 15 App Router, TypeScript, Zod v4, Tailwind v4 CSS variables, Supabase JS v2, date-fns, papaparse (new)

---

## Status: DB layer is complete — do not touch it

`supabase/migrations/20260510000000_slice_2_clients.sql` is already written. It provides:
- `clients` table + `firm_refresh_rules` table
- RLS: members can SELECT; all writes via security-definer RPCs only
- RPCs: `create_client`, `update_client`, `archive_client`, `import_clients`, `update_refresh_rule`
- `create_firm_with_admin` updated to seed defaults: low=60m, standard=36m, high=12m

This plan covers the **application layer only**. The migration needs to be pushed to Supabase (`supabase db push`) in the final task.

---

## Design decisions locked in

- **Filter semantics** (applied in TypeScript after fetching active clients):
  - `overdue`: `refresh_due_date < today`
  - `due_soon`: `today ≤ refresh_due_date ≤ today + 30`
  - `complete`: `refresh_due_date > today + 30` (or null, treated as not due)
  - `all`: no date filter — all active clients regardless of due date

- **CSV columns**: `client_type, display_name, risk_rating, external_ref, refresh_due_date`
  - Required: client_type, display_name, risk_rating
  - Optional: external_ref, refresh_due_date (YYYY-MM-DD)

- **Shared form component**: one `ClientForm` client component used by both add and edit pages; receives the server action as a prop and optional initial values.

- **Archive**: direct form action (no `useActionState` needed — one click, no error state required in the UI, server redirects on success).

---

## File Map

**Create:**
- `apps/web/lib/types/clients.ts` — Row types for `clients` and `firm_refresh_rules`
- `apps/web/lib/schemas/client-csv.ts` — Zod v4 schema + `validateCsvRow` export
- `apps/web/lib/schemas/__tests__/client-csv.test.ts` — Vitest unit tests for CSV row validation
- `apps/web/vitest.config.ts` — Minimal Vitest config (node environment)
- `apps/web/app/dashboard/clients/actions.ts` — Server actions: addClientAction, editClientAction, archiveClientAction, importClientsAction
- `apps/web/app/dashboard/clients/page.tsx` — Client list server component with 4 filter tabs
- `apps/web/app/dashboard/clients/client-form.tsx` — Shared add/edit form (client component)
- `apps/web/app/dashboard/clients/new/page.tsx` — Add client page (server shell)
- `apps/web/app/dashboard/clients/[id]/page.tsx` — Client detail placeholder
- `apps/web/app/dashboard/clients/[id]/edit/page.tsx` — Edit client page (server shell, pre-loads client)
- `apps/web/app/dashboard/clients/import/page.tsx` — CSV import page (server shell)
- `apps/web/app/dashboard/clients/import/import-form.tsx` — CSV import client component

**Modify:**
- `apps/web/app/dashboard/page.tsx` — Replace "Foundation status" card with active clients count + link
- `apps/web/package.json` — Add papaparse, @types/papaparse, vitest

---

## Chunk 1: Foundation — types, CSV schema, Vitest

### Task 1: Install Vitest and papaparse

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/vitest.config.ts`

- [ ] **Step 1: Install dependencies**

Run from `apps/web/`:
```bash
npm install papaparse
npm install -D vitest @types/papaparse
```

- [ ] **Step 2: Create vitest.config.ts**

Create `apps/web/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 3: Add test scripts to package.json**

In `apps/web/package.json` scripts section, add alongside existing scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify Vitest runs without error**

Run from `apps/web/`: `npm test`
Expected: exits 0 (no test files found yet — that is fine).

- [ ] **Step 5: Commit**
```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/vitest.config.ts
git commit -m "chore: add vitest and papaparse for slice 2"
```

---

### Task 2: TypeScript types

**Files:**
- Create: `apps/web/lib/types/clients.ts`

- [ ] **Step 1: Write the types**

Create `apps/web/lib/types/clients.ts`:
```typescript
export type RiskRating = 'low' | 'standard' | 'high'
export type ClientType = 'individual' | 'entity'
export type ClientStatus = 'active' | 'archived'
export type ClientFilter = 'overdue' | 'due_soon' | 'complete' | 'all'

export type Client = {
  id: string
  firm_id: string
  client_type: ClientType
  display_name: string
  risk_rating: RiskRating
  refresh_due_date: string | null
  last_refreshed_at: string | null
  status: ClientStatus
  details: Record<string, unknown>
  external_ref: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type FirmRefreshRule = {
  id: string
  firm_id: string
  risk_rating: RiskRating
  cadence_months: number
  created_at: string
  updated_at: string
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `apps/web/`: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**
```bash
git add apps/web/lib/types/clients.ts
git commit -m "feat: add Client and FirmRefreshRule TypeScript types"
```

---

### Task 3: CSV row schema (TDD)

**Files:**
- Create: `apps/web/lib/schemas/__tests__/client-csv.test.ts` (write first)
- Create: `apps/web/lib/schemas/client-csv.ts` (write to make tests pass)

- [ ] **Step 1: Write the failing tests first**

Create `apps/web/lib/schemas/__tests__/client-csv.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { validateCsvRow } from '../client-csv'

describe('validateCsvRow', () => {
  it('accepts a valid individual row', () => {
    const result = validateCsvRow({
      client_type: 'individual',
      display_name: 'John Smith',
      risk_rating: 'standard',
      external_ref: 'JS001',
      refresh_due_date: '2027-06-01',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.display_name).toBe('John Smith')
    }
  })

  it('accepts a valid entity row with no optional fields', () => {
    const result = validateCsvRow({
      client_type: 'entity',
      display_name: 'Acme Ltd',
      risk_rating: 'high',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing display_name', () => {
    const result = validateCsvRow({
      client_type: 'individual',
      display_name: '',
      risk_rating: 'low',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors[0].field).toBe('display_name')
    }
  })

  it('rejects invalid client_type', () => {
    const result = validateCsvRow({
      client_type: 'company',
      display_name: 'Acme Ltd',
      risk_rating: 'standard',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors[0].field).toBe('client_type')
    }
  })

  it('rejects invalid risk_rating', () => {
    const result = validateCsvRow({
      client_type: 'entity',
      display_name: 'Acme Ltd',
      risk_rating: 'medium',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid date format', () => {
    const result = validateCsvRow({
      client_type: 'individual',
      display_name: 'Jane Doe',
      risk_rating: 'low',
      refresh_due_date: '01/06/2027',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors[0].field).toBe('refresh_due_date')
    }
  })

  it('accepts empty refresh_due_date as omitted', () => {
    const result = validateCsvRow({
      client_type: 'individual',
      display_name: 'Jane Doe',
      risk_rating: 'low',
      refresh_due_date: '',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.refresh_due_date).toBeUndefined()
    }
  })

  it('trims whitespace from string fields', () => {
    const result = validateCsvRow({
      client_type: '  individual  ',
      display_name: '  John Smith  ',
      risk_rating: '  standard  ',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.display_name).toBe('John Smith')
      expect(result.data.client_type).toBe('individual')
    }
  })
})
```

- [ ] **Step 2: Run tests and confirm they fail**

Run from `apps/web/`: `npm test`
Expected: FAIL — `Cannot find module '../client-csv'`

- [ ] **Step 3: Implement the CSV schema**

Create `apps/web/lib/schemas/client-csv.ts`:
```typescript
import { z } from 'zod'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const csvRowSchema = z.object({
  client_type: z
    .string()
    .trim()
    .refine((v) => v === 'individual' || v === 'entity', {
      message: 'Must be "individual" or "entity"',
    }),
  display_name: z
    .string()
    .trim()
    .min(1, { message: 'display_name is required' }),
  risk_rating: z
    .string()
    .trim()
    .refine((v) => v === 'low' || v === 'standard' || v === 'high', {
      message: 'Must be "low", "standard", or "high"',
    }),
  external_ref: z.string().trim().optional(),
  refresh_due_date: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined
      const t = v.trim()
      return t === '' ? undefined : t
    })
    .refine((v) => v === undefined || ISO_DATE_RE.test(v), {
      message: 'Date must be YYYY-MM-DD format',
    }),
})

export type CsvRow = z.infer<typeof csvRowSchema>

export type CsvRowError = { field: string; message: string }

export type CsvRowResult =
  | { success: true; data: CsvRow }
  | { success: false; errors: CsvRowError[] }

export function validateCsvRow(
  raw: Record<string, string | undefined>
): CsvRowResult {
  const result = csvRowSchema.safeParse(raw)
  if (result.success) {
    return { success: true, data: result.data }
  }
  const errors: CsvRowError[] = result.error.issues.map((issue) => ({
    field: String(issue.path[0] ?? 'unknown'),
    message: issue.message,
  }))
  return { success: false, errors }
}
```

- [ ] **Step 4: Run tests and confirm all pass**

Run from `apps/web/`: `npm test`
Expected: 8 tests pass, 0 failures.

- [ ] **Step 5: Commit**
```bash
git add apps/web/lib/schemas/client-csv.ts apps/web/lib/schemas/__tests__/client-csv.test.ts
git commit -m "feat: add CSV row validation schema with Vitest tests"
```

---

## Chunk 2: Server actions and client list

### Task 4: Server actions

**Files:**
- Create: `apps/web/app/dashboard/clients/actions.ts`

- [ ] **Step 1: Write the server actions file**

Create `apps/web/app/dashboard/clients/actions.ts`:
```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

type ActionState = { error?: string; success?: string }

async function getActiveMembership() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { supabase: null, user: null, membership: null }

  const { data: membership } = await supabase
    .from('firm_members')
    .select('firm_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()

  return { supabase, user, membership }
}

export async function addClientAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase, membership } = await getActiveMembership()
  if (!supabase || !membership) return { error: 'Not authenticated' }

  const dueDateRaw = String(formData.get('refresh_due_date') ?? '').trim()

  const { error } = await supabase.rpc('create_client', {
    p_firm_id: membership.firm_id,
    p_client_type: String(formData.get('client_type') ?? ''),
    p_display_name: String(formData.get('display_name') ?? ''),
    p_risk_rating: String(formData.get('risk_rating') ?? ''),
    p_details: {},
    p_external_ref: String(formData.get('external_ref') ?? '').trim() || null,
    p_refresh_due_date: dueDateRaw || null,
  })

  if (error) return { error: error.message }

  revalidatePath('/dashboard/clients')
  redirect('/dashboard/clients')
}

export async function editClientAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase } = await getActiveMembership()
  if (!supabase) return { error: 'Not authenticated' }

  const clientId = String(formData.get('client_id') ?? '').trim()
  if (!clientId) return { error: 'Missing client ID' }

  const patch: Record<string, unknown> = {}
  for (const key of [
    'client_type',
    'display_name',
    'risk_rating',
    'external_ref',
    'refresh_due_date',
  ]) {
    const val = formData.get(key)
    if (val !== null) {
      const str = String(val).trim()
      patch[key] = str === '' ? null : str
    }
  }

  const { error } = await supabase.rpc('update_client', {
    p_client_id: clientId,
    p_patch: patch,
  })

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/clients/${clientId}`)
  revalidatePath('/dashboard/clients')
  redirect(`/dashboard/clients/${clientId}`)
}

export async function archiveClientAction(formData: FormData): Promise<void> {
  const { supabase } = await getActiveMembership()
  if (!supabase) return

  const clientId = String(formData.get('client_id') ?? '').trim()
  if (!clientId) return

  await supabase.rpc('archive_client', { p_client_id: clientId })

  revalidatePath('/dashboard/clients')
  redirect('/dashboard/clients')
}

export type ImportResult = {
  error?: string
  inserted_count?: number
  row_errors?: { row_index: number; error_message: string }[]
}

export async function importClientsAction(
  _prev: ImportResult,
  formData: FormData
): Promise<ImportResult> {
  const { supabase, membership } = await getActiveMembership()
  if (!supabase || !membership) return { error: 'Not authenticated' }

  const rowsRaw = String(formData.get('rows') ?? '[]')
  let rows: unknown[]
  try {
    rows = JSON.parse(rowsRaw)
    if (!Array.isArray(rows)) throw new Error()
  } catch {
    return { error: 'Invalid rows payload' }
  }

  const { data, error } = await supabase.rpc('import_clients', {
    p_firm_id: membership.firm_id,
    p_rows: rows,
  })

  if (error) return { error: error.message }

  return {
    inserted_count: (data as { inserted_count: number }).inserted_count,
    row_errors: (data as { errors: { row_index: number; error_message: string }[] }).errors ?? [],
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `apps/web/`: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**
```bash
git add apps/web/app/dashboard/clients/actions.ts
git commit -m "feat: add client CRUD and import server actions"
```

---

### Task 5: Client list page

**Files:**
- Create: `apps/web/app/dashboard/clients/page.tsx`

- [ ] **Step 1: Write the client list server component**

Create `apps/web/app/dashboard/clients/page.tsx`:
```typescript
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { addDays, isBefore, isAfter, parseISO } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import type { Client, ClientFilter } from '@/lib/types/clients'
import { archiveClientAction } from './actions'

const FILTER_LABELS: Record<ClientFilter, string> = {
  overdue: 'Overdue',
  due_soon: 'Due ≤ 30 days',
  complete: 'Up to date',
  all: 'All',
}

const RISK_BADGE: Record<string, string> = {
  low: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  standard: 'bg-amber-50 text-amber-800 border-amber-200',
  high: 'bg-red-50 text-red-800 border-red-200',
}

function applyFilter(clients: Client[], filter: ClientFilter): Client[] {
  if (filter === 'all') return clients
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const in30 = addDays(today, 30)
  return clients.filter((c) => {
    if (!c.refresh_due_date) return filter === 'complete'
    const due = parseISO(c.refresh_due_date)
    if (filter === 'overdue') return isBefore(due, today)
    if (filter === 'due_soon') return !isBefore(due, today) && !isAfter(due, in30)
    if (filter === 'complete') return isAfter(due, in30)
    return true
  })
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  const { filter: rawFilter } = await searchParams
  const filter: ClientFilter =
    rawFilter === 'overdue' || rawFilter === 'due_soon' || rawFilter === 'complete'
      ? rawFilter
      : 'all'

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('firm_members')
    .select('firm_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()

  if (!membership) redirect('/onboarding')

  const { data: clients = [] } = await supabase
    .from('clients')
    .select('*')
    .eq('firm_id', membership.firm_id)
    .eq('status', 'active')
    .order('refresh_due_date', { ascending: true, nullsFirst: false })

  const displayed = applyFilter((clients ?? []) as Client[], filter)

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-6xl">
        <header className="flex flex-col justify-between gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
              RefreshDesk
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Clients</h1>
          </div>
          <div className="flex gap-3">
            <Link
              href="/dashboard/clients/import"
              className="inline-flex items-center gap-2 border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold"
            >
              Import CSV
            </Link>
            <Link
              href="/dashboard/clients/new"
              className="inline-flex items-center gap-2 bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            >
              Add client
            </Link>
          </div>
        </header>

        <nav className="mt-6 flex gap-1 border-b border-[var(--line)]">
          {(Object.keys(FILTER_LABELS) as ClientFilter[]).map((f) => (
            <Link
              key={f}
              href={
                f === 'all'
                  ? '/dashboard/clients'
                  : `/dashboard/clients?filter=${f}`
              }
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                filter === f
                  ? 'border-[var(--accent)] text-[var(--accent-strong)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              {FILTER_LABELS[f]}
            </Link>
          ))}
        </nav>

        <div className="mt-6">
          {displayed.length === 0 ? (
            <p className="py-12 text-center text-sm text-[var(--muted)]">
              No clients in this view.
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-[var(--muted)]">
                  <th className="pb-3 pr-4 font-medium">Name</th>
                  <th className="pb-3 pr-4 font-medium">Type</th>
                  <th className="pb-3 pr-4 font-medium">Risk</th>
                  <th className="pb-3 pr-4 font-medium">Due date</th>
                  <th className="pb-3 pr-4 font-medium">Ref</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {displayed.map((client) => (
                  <tr key={client.id} className="group">
                    <td className="py-3 pr-4 font-medium">
                      <Link
                        href={`/dashboard/clients/${client.id}`}
                        className="hover:text-[var(--accent)]"
                      >
                        {client.display_name}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 capitalize text-[var(--muted)]">
                      {client.client_type}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`inline-block border px-2 py-0.5 text-xs font-medium capitalize ${RISK_BADGE[client.risk_rating] ?? ''}`}
                      >
                        {client.risk_rating}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-[var(--muted)]">
                      {client.refresh_due_date ?? '—'}
                    </td>
                    <td className="py-3 pr-4 text-[var(--muted)]">
                      {client.external_ref ?? '—'}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-3 opacity-0 transition-opacity group-hover:opacity-100">
                        <Link
                          href={`/dashboard/clients/${client.id}/edit`}
                          className="text-xs text-[var(--accent)] hover:underline"
                        >
                          Edit
                        </Link>
                        <form action={archiveClientAction}>
                          <input
                            type="hidden"
                            name="client_id"
                            value={client.id}
                          />
                          <button
                            type="submit"
                            className="text-xs text-[var(--muted)] hover:text-red-700"
                          >
                            Archive
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="mt-8 text-right">
          <Link
            href="/dashboard"
            className="text-sm text-[var(--muted)] hover:underline"
          >
            ← Back to dashboard
          </Link>
        </footer>
      </section>
    </main>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `apps/web/`: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Start dev server and verify page renders at `/dashboard/clients`**

Run from repo root: `npm run dev`
Navigate to `/dashboard/clients`.
Expected: empty state message, "Add client" and "Import CSV" buttons, 4 filter tabs (Overdue / Due ≤ 30 days / Up to date / All).

- [ ] **Step 4: Commit**
```bash
git add apps/web/app/dashboard/clients/page.tsx
git commit -m "feat: add client list page with filter tabs"
```

---

## Chunk 3: Add and edit client forms

### Task 6: Shared client form component

**Files:**
- Create: `apps/web/app/dashboard/clients/client-form.tsx`

- [ ] **Step 1: Write the shared form**

Create `apps/web/app/dashboard/clients/client-form.tsx`:
```typescript
'use client'

import { useActionState } from 'react'
import { FormError } from '@/components/form-error'
import type { Client } from '@/lib/types/clients'

type ActionFn = (
  prev: { error?: string },
  formData: FormData
) => Promise<{ error?: string }>

type Props = {
  action: ActionFn
  initial?: Partial<Client>
  submitLabel: string
  cancelHref: string
}

export function ClientForm({ action, initial, submitLabel, cancelHref }: Props) {
  const [state, dispatch, pending] = useActionState(action, {})

  return (
    <form action={dispatch} className="grid gap-5">
      {initial?.id && (
        <input type="hidden" name="client_id" value={initial.id} />
      )}

      <label className="block">
        <span className="text-sm font-medium">Client type</span>
        <select
          name="client_type"
          defaultValue={initial?.client_type ?? 'individual'}
          className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--accent)]"
        >
          <option value="individual">Individual</option>
          <option value="entity">Entity</option>
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium">Display name</span>
        <input
          name="display_name"
          defaultValue={initial?.display_name ?? ''}
          required
          className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--accent)]"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Risk rating</span>
        <select
          name="risk_rating"
          defaultValue={initial?.risk_rating ?? 'standard'}
          className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--accent)]"
        >
          <option value="low">Low</option>
          <option value="standard">Standard</option>
          <option value="high">High</option>
        </select>
      </label>

      <div className="grid gap-5 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">External reference</span>
          <input
            name="external_ref"
            defaultValue={initial?.external_ref ?? ''}
            placeholder="Optional — must be unique per firm"
            className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Override refresh due date</span>
          <input
            name="refresh_due_date"
            type="date"
            defaultValue={initial?.refresh_due_date ?? ''}
            className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--accent)]"
          />
        </label>
      </div>

      <p className="text-xs text-[var(--muted)]">
        Leave "Override refresh due date" blank to use the firm's default cadence for the selected risk rating.
      </p>

      <FormError message={state.error} />

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="bg-[var(--accent)] px-4 py-3 font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
        >
          {pending ? 'Saving...' : submitLabel}
        </button>
        <a
          href={cancelHref}
          className="border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-sm font-semibold"
        >
          Cancel
        </a>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `apps/web/`: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**
```bash
git add apps/web/app/dashboard/clients/client-form.tsx
git commit -m "feat: add shared ClientForm component"
```

---

### Task 7: Add client page

**Files:**
- Create: `apps/web/app/dashboard/clients/new/page.tsx`

- [ ] **Step 1: Write the add page**

Create `apps/web/app/dashboard/clients/new/page.tsx`:
```typescript
import { ClientForm } from '../client-form'
import { addClientAction } from '../actions'

export default function NewClientPage() {
  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-3xl border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_22px_70px_rgba(44,36,22,0.11)] md:p-8">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
          Client management
        </p>
        <h1 className="text-3xl font-semibold">Add client</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          Refresh due date defaults to the firm cadence for the selected risk
          rating unless overridden.
        </p>
        <div className="mt-8">
          <ClientForm
            action={addClientAction}
            submitLabel="Add client"
            cancelHref="/dashboard/clients"
          />
        </div>
      </section>
    </main>
  )
}
```

- [ ] **Step 2: Navigate to `/dashboard/clients/new` and add a test client**

Fill in: client_type=individual, display_name="Test Client Alpha", risk_rating=standard. Submit.
Expected: redirect to `/dashboard/clients`, "Test Client Alpha" appears in the list with due date derived from the firm's standard cadence (36 months from today).

- [ ] **Step 3: Commit**
```bash
git add apps/web/app/dashboard/clients/new/page.tsx
git commit -m "feat: add new client page"
```

---

### Task 8: Edit client page

**Files:**
- Create: `apps/web/app/dashboard/clients/[id]/edit/page.tsx`

- [ ] **Step 1: Write the edit page**

Create `apps/web/app/dashboard/clients/[id]/edit/page.tsx`:
```typescript
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Client } from '@/lib/types/clients'
import { ClientForm } from '../../client-form'
import { editClientAction } from '../../actions'

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()

  if (!client) notFound()

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-3xl border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_22px_70px_rgba(44,36,22,0.11)] md:p-8">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
          Client management
        </p>
        <h1 className="text-3xl font-semibold">Edit client</h1>
        <div className="mt-8">
          <ClientForm
            action={editClientAction}
            initial={client as Client}
            submitLabel="Save changes"
            cancelHref={`/dashboard/clients/${id}`}
          />
        </div>
      </section>
    </main>
  )
}
```

- [ ] **Step 2: Test the edit flow**

From the client list, click Edit on "Test Client Alpha". Change risk_rating to "high". Save.
Expected: redirect to client detail page, risk badge shows "high".

- [ ] **Step 3: Commit**
```bash
git add apps/web/app/dashboard/clients/[id]/edit/page.tsx
git commit -m "feat: add edit client page"
```

---

## Chunk 4: Client detail, CSV import, dashboard wiring

### Task 9: Client detail placeholder

**Files:**
- Create: `apps/web/app/dashboard/clients/[id]/page.tsx`

- [ ] **Step 1: Write the detail page**

Create `apps/web/app/dashboard/clients/[id]/page.tsx`:
```typescript
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Client } from '@/lib/types/clients'
import { archiveClientAction } from '../actions'

const RISK_BADGE: Record<string, string> = {
  low: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  standard: 'bg-amber-50 text-amber-800 border-amber-200',
  high: 'bg-red-50 text-red-800 border-red-200',
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()

  if (!client) notFound()

  const c = client as Client

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-4xl">
        <header className="flex flex-col justify-between gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
              Client
            </p>
            <h1 className="mt-2 text-3xl font-semibold">{c.display_name}</h1>
            <p className="mt-2 flex items-center gap-2 text-sm text-[var(--muted)] capitalize">
              {c.client_type}
              <span
                className={`inline-block border px-2 py-0.5 text-xs font-medium capitalize ${RISK_BADGE[c.risk_rating] ?? ''}`}
              >
                {c.risk_rating} risk
              </span>
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              href={`/dashboard/clients/${id}/edit`}
              className="border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold"
            >
              Edit
            </Link>
            {c.status === 'active' && (
              <form action={archiveClientAction}>
                <input type="hidden" name="client_id" value={id} />
                <button
                  type="submit"
                  className="border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800"
                >
                  Archive
                </button>
              </form>
            )}
          </div>
        </header>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <div className="border border-[var(--line)] bg-[var(--panel)] p-5">
            <p className="text-sm text-[var(--muted)]">Refresh due</p>
            <p className="mt-2 text-xl font-semibold">
              {c.refresh_due_date ?? '—'}
            </p>
          </div>
          <div className="border border-[var(--line)] bg-[var(--panel)] p-5">
            <p className="text-sm text-[var(--muted)]">Last refreshed</p>
            <p className="mt-2 text-xl font-semibold">
              {c.last_refreshed_at
                ? new Date(c.last_refreshed_at).toLocaleDateString('en-GB')
                : 'Never'}
            </p>
          </div>
          <div className="border border-[var(--line)] bg-[var(--panel)] p-5">
            <p className="text-sm text-[var(--muted)]">External ref</p>
            <p className="mt-2 text-xl font-semibold">
              {c.external_ref ?? '—'}
            </p>
          </div>
        </div>

        <section className="mt-6 border border-[var(--line)] bg-[var(--panel)] p-5">
          <h2 className="text-lg font-semibold">Documents</h2>
          <p className="mt-3 text-sm text-[var(--muted)]">
            Document uploads and AI extraction will appear here in Slice 3.
          </p>
        </section>

        <section className="mt-4 border border-[var(--line)] bg-[var(--panel)] p-5">
          <h2 className="text-lg font-semibold">Audit timeline</h2>
          <p className="mt-3 text-sm text-[var(--muted)]">
            Full audit trail for this client will appear here in Slice 4.
          </p>
        </section>

        <footer className="mt-8 text-right">
          <Link
            href="/dashboard/clients"
            className="text-sm text-[var(--muted)] hover:underline"
          >
            ← Back to clients
          </Link>
        </footer>
      </section>
    </main>
  )
}
```

- [ ] **Step 2: Navigate to the test client detail page**

Click "Test Client Alpha" in the client list. Expected: detail page with refresh due date, last refreshed (Never), external ref (—), and placeholder sections for Documents and Audit timeline.

- [ ] **Step 3: Commit**
```bash
git add apps/web/app/dashboard/clients/[id]/page.tsx
git commit -m "feat: add client detail placeholder page"
```

---

### Task 10: CSV import page

**Files:**
- Create: `apps/web/app/dashboard/clients/import/import-form.tsx`
- Create: `apps/web/app/dashboard/clients/import/page.tsx`

- [ ] **Step 1: Write the import client component**

Create `apps/web/app/dashboard/clients/import/import-form.tsx`:
```typescript
'use client'

import { useActionState, useRef, useState } from 'react'
import Papa from 'papaparse'
import { validateCsvRow, type CsvRow } from '@/lib/schemas/client-csv'
import { FormError } from '@/components/form-error'
import { importClientsAction, type ImportResult } from '../actions'

type ParsedRow = {
  rowIndex: number
  raw: Record<string, string>
  valid: boolean
  data?: CsvRow
  errors?: { field: string; message: string }[]
}

export function ImportForm() {
  const [state, dispatch, pending] = useActionState<ImportResult, FormData>(
    importClientsAction,
    {}
  )
  const [rows, setRows] = useState<ParsedRow[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const parsed: ParsedRow[] = results.data.map((raw, i) => {
          const result = validateCsvRow(raw)
          if (result.success) {
            return { rowIndex: i, raw, valid: true, data: result.data }
          }
          return { rowIndex: i, raw, valid: false, errors: result.errors }
        })
        setRows(parsed)
      },
    })
  }

  const validRows = rows.filter((r) => r.valid).map((r) => r.data!)
  const invalidRows = rows.filter((r) => !r.valid)

  if (state.inserted_count !== undefined) {
    return (
      <div className="mt-6 border border-[var(--line)] bg-[var(--panel)] p-5">
        <p className="font-semibold text-[var(--accent-strong)]">
          Import complete —{' '}
          {state.inserted_count} client
          {state.inserted_count === 1 ? '' : 's'} added.
        </p>
        {state.row_errors && state.row_errors.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-medium text-red-700">
              {state.row_errors.length} row(s) failed server-side:
            </p>
            <ul className="mt-2 space-y-1 text-sm text-red-600">
              {state.row_errors.map((e) => (
                <li key={e.row_index}>
                  Row {e.row_index + 1}: {e.error_message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <a
          href="/dashboard/clients"
          className="mt-6 inline-block bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white"
        >
          View clients
        </a>
      </div>
    )
  }

  return (
    <div className="mt-8 grid gap-6">
      <div>
        <p className="mb-2 text-sm font-medium">Expected CSV headers:</p>
        <code className="block border border-[var(--line)] bg-white p-3 font-mono text-xs">
          client_type,display_name,risk_rating,external_ref,refresh_due_date
        </code>
        <ul className="mt-3 space-y-1 text-xs text-[var(--muted)]">
          <li>
            <strong>client_type</strong>: &ldquo;individual&rdquo; or
            &ldquo;entity&rdquo; (required)
          </li>
          <li>
            <strong>display_name</strong>: text (required)
          </li>
          <li>
            <strong>risk_rating</strong>: &ldquo;low&rdquo;,
            &ldquo;standard&rdquo;, or &ldquo;high&rdquo; (required)
          </li>
          <li>
            <strong>external_ref</strong>: text, optional
          </li>
          <li>
            <strong>refresh_due_date</strong>: YYYY-MM-DD, optional
          </li>
        </ul>
      </div>

      <label className="block">
        <span className="text-sm font-medium">Upload CSV file</span>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="mt-2 block w-full text-sm"
        />
      </label>

      {rows.length > 0 && (
        <div>
          <p className="mb-3 text-sm font-medium">
            Preview: {validRows.length} valid, {invalidRows.length} invalid
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-[var(--muted)]">
                  <th className="pb-2 pr-3">#</th>
                  <th className="pb-2 pr-3">Type</th>
                  <th className="pb-2 pr-3">Name</th>
                  <th className="pb-2 pr-3">Risk</th>
                  <th className="pb-2 pr-3">Ref</th>
                  <th className="pb-2 pr-3">Due date</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.rowIndex}
                    className={`border-b border-[var(--line)] ${
                      row.valid ? '' : 'bg-red-50'
                    }`}
                  >
                    <td className="py-2 pr-3 text-[var(--muted)]">
                      {row.rowIndex + 1}
                    </td>
                    <td className="py-2 pr-3">{row.raw.client_type}</td>
                    <td className="py-2 pr-3">{row.raw.display_name}</td>
                    <td className="py-2 pr-3">{row.raw.risk_rating}</td>
                    <td className="py-2 pr-3">
                      {row.raw.external_ref || '—'}
                    </td>
                    <td className="py-2 pr-3">
                      {row.raw.refresh_due_date || '—'}
                    </td>
                    <td className="py-2">
                      {row.valid ? (
                        <span className="text-emerald-700">✓</span>
                      ) : (
                        <span
                          className="text-red-700"
                          title={row.errors
                            ?.map((e) => `${e.field}: ${e.message}`)
                            .join('; ')}
                        >
                          ✗{' '}
                          {row.errors?.map((e) => e.message).join(', ')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {invalidRows.length > 0 && (
            <p className="mt-3 text-sm text-red-700">
              {invalidRows.length} row(s) will be skipped. Fix the CSV and
              re-upload to include them.
            </p>
          )}

          {validRows.length > 0 && (
            <form action={dispatch} className="mt-4">
              <input
                type="hidden"
                name="rows"
                value={JSON.stringify(validRows)}
              />
              <FormError message={state.error} />
              <button
                type="submit"
                disabled={pending}
                className="bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {pending
                  ? 'Importing...'
                  : `Import ${validRows.length} client${
                      validRows.length === 1 ? '' : 's'
                    }`}
              </button>
            </form>
          )}
        </div>
      )}

      <a
        href="/dashboard/clients"
        className="text-sm text-[var(--muted)] hover:underline"
      >
        ← Back to clients
      </a>
    </div>
  )
}
```

- [ ] **Step 2: Write the import page server shell**

Create `apps/web/app/dashboard/clients/import/page.tsx`:
```typescript
import { ImportForm } from './import-form'

export default function ImportClientsPage() {
  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-3xl border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_22px_70px_rgba(44,36,22,0.11)] md:p-8">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
          Client management
        </p>
        <h1 className="text-3xl font-semibold">Import clients from CSV</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          Upload a CSV file. Valid rows are previewed before import. Invalid
          rows show inline errors and are skipped.
        </p>
        <ImportForm />
      </section>
    </main>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run from `apps/web/`: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Test CSV import end-to-end**

Create a local file `test-import.csv`:
```
client_type,display_name,risk_rating,external_ref,refresh_due_date
individual,Alice Brown,standard,AB001,2027-12-01
entity,Beta Corp,high,BC001,
individual,,low,,
individual,Charlie D,medium,,
```

Navigate to `/dashboard/clients/import`. Upload `test-import.csv`.
Expected preview:
- Row 1 (Alice Brown): ✓
- Row 2 (Beta Corp): ✓
- Row 3 (empty name): ✗ — display_name is required
- Row 4 (Charlie D): ✗ — invalid risk_rating

Click "Import 2 clients". Expected: "Import complete — 2 clients added."

- [ ] **Step 5: Commit**
```bash
git add apps/web/app/dashboard/clients/import/
git commit -m "feat: add CSV import page with client-side validation and row-level error reporting"
```

---

### Task 11: Update dashboard page

**Files:**
- Modify: `apps/web/app/dashboard/page.tsx`

- [ ] **Step 1: Add clients count query and replace the "Foundation status" card**

In `apps/web/app/dashboard/page.tsx`, after the existing `membership` query (which already provides `firm.id`), add:
```typescript
const { count: clientCount } = await supabase
  .from('clients')
  .select('id', { count: 'exact', head: true })
  .eq('firm_id', firm.id)
  .eq('status', 'active')
```

Replace the static "Foundation status" card:
```tsx
// Remove:
<div className="border border-[var(--line)] bg-[var(--panel)] p-5">
  <p className="text-sm text-[var(--muted)]">Foundation status</p>
  <p className="mt-2 text-xl font-semibold">Slice 1</p>
</div>

// Replace with:
<Link
  href="/dashboard/clients"
  className="block border border-[var(--line)] bg-[var(--panel)] p-5 transition-colors hover:border-[var(--accent)]"
>
  <p className="text-sm text-[var(--muted)]">Active clients</p>
  <p className="mt-2 text-xl font-semibold">{clientCount ?? 0}</p>
  <p className="mt-1 text-xs text-[var(--accent)]">Manage clients →</p>
</Link>
```

Also add `Link` to the import at the top of the file if not already imported:
```typescript
import Link from "next/link";
```
(It is already imported — no change needed.)

- [ ] **Step 2: Verify dashboard renders with the clients card**

Navigate to `/dashboard`. Expected: "Active clients" card shows current count, clicking it goes to `/dashboard/clients`.

- [ ] **Step 3: Commit**
```bash
git add apps/web/app/dashboard/page.tsx
git commit -m "feat: add active clients count card and link on dashboard"
```

---

## Chunk 5: Migration and smoke test

### Task 12: Push migration and smoke-test the full flow

- [ ] **Step 1: Check Supabase CLI is linked**

Run from repo root: `supabase status`
Expected: shows linked project ref matching the project in `supabase/.temp/linked-project.json`.

- [ ] **Step 2: Push the Slice 2 migration**

Run: `supabase db push`
Expected: `20260510000000_slice_2_clients.sql` applied with no errors.

- [ ] **Step 3: Run the full smoke-test walkthrough**

1. Go to `/dashboard` — Active clients card shows 0.
2. Click "Manage clients →" — client list shows empty state with filter tabs.
3. Click "Add client" — fill: individual / "Smoke Test Client" / standard / no ref / no date. Submit.
4. Redirected to list — row shows correct name, risk badge (standard), and a due date ~36 months out.
5. Click the client name — detail page shows refresh due date, Last refreshed: Never.
6. Click Edit — change risk_rating to "high". Save. Badge now shows "high risk".
7. From list, hover the row — Archive button appears. Click Archive. Row disappears.
8. Click "All" tab — still empty (archived clients are excluded from the list query).
9. Go to Import CSV — upload `test-import.csv` — preview shows 2 valid / 2 invalid. Import 2 clients.
10. Return to `/dashboard` — Active clients card shows 2 (Alice + Beta Corp).
11. Go to `/dashboard` audit events — should show: client.created (×3), client.updated (×1), client.archived (×1), client.bulk_imported (×1).

- [ ] **Step 4: Run the test suite**

Run from `apps/web/`: `npm test`
Expected: 8 CSV schema tests pass, 0 failures.

- [ ] **Step 5: Final commit and tag**

```bash
git add -A
git commit -m "feat: complete slice 2 client management layer"
git tag v0.2-slice-2-client-management
```

- [ ] **Step 6: Update DEV-LOG.md**

Add a new entry under today's date (2026-06-05) covering:
- What was built (types, schema, 4 server actions, list page, add/edit/detail pages, CSV import)
- Key decisions (JSONB for details, shared ClientForm, PapaParse browser-side parse, Zod-validated preview before submit)
- What was learned

---

## Notes for the implementer

**Do not re-run or modify `20260510000000_slice_2_clients.sql`**. It only needs `supabase db push`. The RPCs and RLS are already correct.

**Next.js 15**: `params` and `searchParams` in page components are now `Promise<{...}>` — always `await` them. Using them synchronously causes a TypeScript error.

**Zod v4 note**: The `.refine()` method still uses `{ message: '...' }`. The `.transform()` output type informs what `.refine()` receives. The `safeParse()` result still has `.error.issues` with `.path` and `.message` on each issue.

**Supabase count query**: `{ count: 'exact', head: true }` returns `{ count: number | null, data: null, error: ... }`. Access via `const { count } = await supabase.from(...)...`.

**archiveClientAction** is a direct form action (not wrapped in `useActionState`) because there is no error state to render — it redirects unconditionally. Using it directly as `<form action={archiveClientAction}>` is correct.

**papaparse default import**: `import Papa from 'papaparse'` — the package has a default export with a `.parse()` method. The `@types/papaparse` package provides the types.

**Filter tab "All"** shows all active clients regardless of due date. Archived clients never appear in any tab — the list query filters `status = 'active'`.
