# Slice 6 — Multi-User Firms

**Tag target:** `v0.6-slice-6-multi-user`  
**Stack:** Next.js 15 · TypeScript · Tailwind v4 · Supabase · Resend  
**Depends on:** Slice 5 complete (`v0.5-slice-5-campaigns`)

---

## Goal

Allow a firm admin to invite team members via a join code. New users enter the code on signup to join an existing firm instead of creating a new one. Three roles: admin, member, read-only. Admins can manage the team from the settings page.

---

## Current state

`firm_members` table already exists with:
- `user_id`, `firm_id`, `role`, `status` (active/pending/inactive), `full_name`

`role` is currently unconstrained — needs a check constraint added.

---

## Schema changes

### Migration: `20260607010000_slice6_multi_user.sql`

```sql
-- 1. Add role constraint to firm_members
alter table public.firm_members
  drop constraint if exists firm_members_role_check;

alter table public.firm_members
  add constraint firm_members_role_check
  check (role in ('admin', 'member', 'read_only'));

-- 2. New table: firm_join_codes
create table public.firm_join_codes (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  code text not null unique,
  role text not null default 'member' check (role in ('member', 'read_only')),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz,                    -- null = never expires
  max_uses integer,                          -- null = unlimited
  use_count integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.firm_join_codes enable row level security;

-- Read: firm admins only
create policy "firm admins can read join codes"
  on public.firm_join_codes for select
  to authenticated
  using (
    firm_id in (
      select firm_id from public.firm_members
      where user_id = auth.uid()
        and status = 'active'
        and role = 'admin'
    )
  );
```

---

## RPCs

### `generate_join_code(p_role text, p_expires_at timestamptz, p_max_uses integer)`

- Caller must be an active admin of a firm
- Generates a random 8-character uppercase code (e.g. `XKCD7291`)
- Inserts into `firm_join_codes`
- Writes `audit_events`: `firm.join_code_created`
- Returns `{ code, expires_at, role }`

```sql
create or replace function public.generate_join_code(
  p_role text default 'member',
  p_expires_at timestamptz default null,
  p_max_uses integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_firm_id uuid;
  v_code text;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_role not in ('member', 'read_only') then
    raise exception 'role must be member or read_only';
  end if;

  select firm_id into v_firm_id
  from public.firm_members
  where user_id = v_user_id
    and status = 'active'
    and role = 'admin'
  limit 1;

  if v_firm_id is null then
    raise exception 'not an active admin of any firm';
  end if;

  -- Generate unique 8-char code
  loop
    v_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (
      select 1 from public.firm_join_codes where code = v_code
    );
  end loop;

  insert into public.firm_join_codes (
    firm_id, code, role, created_by, expires_at, max_uses
  ) values (
    v_firm_id, v_code, p_role, v_user_id, p_expires_at, p_max_uses
  );

  insert into public.audit_events (
    firm_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_firm_id, v_user_id, 'firm.join_code_created', 'firm', v_firm_id,
    jsonb_build_object('code', v_code, 'role', p_role)
  );

  return jsonb_build_object('code', v_code, 'role', p_role, 'expires_at', p_expires_at);
end;
$$;
```

### `redeem_join_code(p_code text, p_full_name text)`

- Called during signup when user enters a join code
- Validates code exists, is active, not expired, not over max_uses
- Checks user is not already a member of this firm
- Inserts `firm_members` row with the code's role and status `active`
- Increments `use_count`
- Writes `audit_events`: `firm.member_joined`
- Returns `firm_id` so signup can redirect to dashboard

```sql
create or replace function public.redeem_join_code(
  p_code text,
  p_full_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_join_code public.firm_join_codes%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  select * into v_join_code
  from public.firm_join_codes
  where code = upper(trim(p_code))
    and is_active = true
  for update;

  if not found then
    raise exception 'invalid or inactive join code';
  end if;

  if v_join_code.expires_at is not null and v_join_code.expires_at < now() then
    raise exception 'join code has expired';
  end if;

  if v_join_code.max_uses is not null and v_join_code.use_count >= v_join_code.max_uses then
    raise exception 'join code has reached its maximum uses';
  end if;

  if exists (
    select 1 from public.firm_members
    where user_id = v_user_id
      and firm_id = v_join_code.firm_id
      and status = 'active'
  ) then
    raise exception 'already a member of this firm';
  end if;

  insert into public.firm_members (
    user_id, firm_id, role, full_name, status
  ) values (
    v_user_id, v_join_code.firm_id, v_join_code.role, p_full_name, 'active'
  );

  update public.firm_join_codes
  set use_count = use_count + 1
  where id = v_join_code.id;

  insert into public.audit_events (
    firm_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_join_code.firm_id, v_user_id, 'firm.member_joined', 'firm', v_join_code.firm_id,
    jsonb_build_object(
      'full_name', p_full_name,
      'role', v_join_code.role,
      'join_code', p_code
    )
  );

  return v_join_code.firm_id;
end;
$$;
```

### `remove_firm_member(p_user_id uuid)`

- Caller must be an active admin
- Cannot remove yourself if you are the only admin
- Sets `firm_members.status = 'inactive'`
- Writes `audit_events`: `firm.member_removed`

### `update_member_role(p_user_id uuid, p_role text)`

- Caller must be an active admin
- Cannot demote yourself if you are the only admin
- Updates `firm_members.role`
- Writes `audit_events`: `firm.member_role_changed`

---

## Signup flow changes

Current signup creates a new firm for every user. Need to split into two paths:

**Path A — Create new firm** (existing flow, default)
**Path B — Join existing firm** (new, via join code)

### Updated signup page (`/signup`)

```
┌─────────────────────────────────────────┐
│  Create your account                    │
│                                         │
│  Full name  [____________________]      │
│  Email      [____________________]      │
│  Password   [____________________]      │
│                                         │
│  ○ Create a new firm                    │
│  ● Join an existing firm                │
│                                         │
│  [shown if "Join"]:                     │
│  Join code  [________]  e.g. XKCD7291  │
│                                         │
│  [Create account]                       │
└─────────────────────────────────────────┘
```

- If "Create a new firm" selected: existing flow (redirect to `/onboarding`)
- If "Join an existing firm" selected: show join code field, on submit call `redeem_join_code`, redirect to `/dashboard`

---

## Settings page — Team section

Add a Team section to `/settings` (below the existing firm settings):

```
Team members
──────────────────────────────────────────────────────
Kevin MCD          admin       [You]
Jane Smith         member      [Remove]
Bob Jones          read_only   [Change role ▾] [Remove]

Invite new member
──────────────────────────────────────────────────────
Role for new member:  [Member ▾]
[Generate join code]

Active join codes
──────────────────────────────────────────────────────
XKCD7291   member   Generated 2 min ago   [Deactivate]
```

---

## Role permissions

| Action | admin | member | read_only |
|---|---|---|---|
| View clients | ✓ | ✓ | ✓ |
| Add/edit clients | ✓ | ✓ | ✗ |
| Upload documents | ✓ | ✓ | ✗ |
| Approve/reject extractions | ✓ | ✓ | ✗ |
| Archive clients | ✓ | ✗ | ✗ |
| Import CSV | ✓ | ✓ | ✗ |
| Manage team | ✓ | ✗ | ✗ |
| Change firm settings | ✓ | ✗ | ✗ |

Enforce in UI by passing `membership.role` to components and hiding/disabling actions. RLS + RPCs already enforce at the DB level via the `is_active_member_of_firm` check — role-specific enforcement needs adding to RPCs that should be role-gated (archive, settings).

---

## File structure (new/changed files only)

```
apps/web/
  app/
    signup/
      page.tsx          -- add join code path
      actions.ts        -- add redeem_join_code call
    settings/
      page.tsx          -- add Team section
      team-section.tsx  -- member list, generate code, active codes
      actions.ts        -- generate_join_code, remove_member, update_role
supabase/
  migrations/
    20260607010000_slice6_multi_user.sql
```

---

## Acceptance criteria (smoke test)

1. Migration runs clean — `firm_join_codes` table exists, role constraint on `firm_members`
2. Settings page → Team section shows current members with roles
3. Admin generates a join code — code appears in Active join codes list
4. Sign up as a new user (use a different email) → select "Join existing firm" → enter the code → lands on dashboard showing the same firm
5. New member appears in Team section with correct role
6. Admin changes new member's role — updates immediately
7. Admin removes new member — disappears from list
8. Audit timeline on any client shows `firm.member_joined` event
9. Read-only user cannot see Add client button or Upload document dropdown
10. Expired/deactivated code returns a clear error message on signup

---

## What to tell Claude Code

> I am building Slice 6 of RefreshDesk. Slices 1–5 are complete. The full plan is at `docs/superpowers/plans/2026-06-07-slice-6-multi-user.md`.
>
> Build Slice 6 in this order:
> 1. Migration — `firm_join_codes` table, role constraint on `firm_members`, four RPCs: `generate_join_code`, `redeem_join_code`, `remove_firm_member`, `update_member_role`
> 2. Signup page — add radio toggle (Create firm / Join firm), show join code field conditionally, wire to `redeem_join_code` RPC on submit
> 3. Settings page — add Team section: member list with roles, generate join code form, active codes list with deactivate button
> 4. Role enforcement in UI — pass `membership.role` through to client list, client detail, and document upload pages; hide/disable write actions for `read_only` role
>
> Key constraints:
> - All writes via security-definer RPCs (no direct INSERT/UPDATE)
> - `remove_firm_member` and `update_member_role` must prevent removing/demoting the last admin
> - Join code redemption must validate: active, not expired, not over max_uses, user not already a member
> - Read-only role: hide Add client, Import CSV, Upload document, Edit, Archive buttons in UI
> - Admin-only: hide Team section and firm settings from non-admins