# Slice 8 — Billing (Stripe)

**Tag target:** `v0.8-slice-8-billing`  
**Stack:** Next.js 15 · TypeScript · Tailwind v4 · Supabase · Stripe  
**Depends on:** Slice 6 complete (`v0.6-slice-6-multi-user`)

---

## Goal

Add Stripe subscription billing to RefreshDesk. Two plans: Starter (free, limited) and Pro (£49/month, unlimited). Freemium model — firms start on Starter automatically, upgrade via Stripe Checkout. Plan limits enforced at the RPC level and in the UI.

---

## Plans

| Feature | Starter (free) | Pro (£49/month) |
|---|---|---|
| Clients | Up to 10 | Unlimited |
| Users | 1 | Unlimited |
| Document uploads + AI extraction | ✓ | ✓ |
| Audit timeline | ✓ | ✓ |
| Email campaigns | ✗ | ✓ |
| CSV import | ✗ | ✓ |
| Join codes / team management | ✗ | ✓ |

---

## Architecture

```
Stripe Checkout (hosted payment page)
  └── POST /api/stripe/checkout        -- creates Stripe Checkout session
  └── GET  /api/stripe/success         -- post-payment redirect handler
  └── POST /api/stripe/webhook         -- Stripe webhook handler (subscription events)

Stripe Customer Portal
  └── POST /api/stripe/portal          -- creates portal session for manage/cancel
```

---

## Schema changes

### Migration: `20260607020000_slice8_billing.sql`

```sql
-- Add billing columns to firms table
alter table public.firms
  add column if not exists stripe_customer_id text unique,
  add column if not exists stripe_subscription_id text unique,
  add column if not exists plan text not null default 'starter'
    check (plan in ('starter', 'pro')),
  add column if not exists plan_expires_at timestamptz;

-- Index for webhook lookups
create index if not exists firms_stripe_customer_id_idx
  on public.firms (stripe_customer_id);

create index if not exists firms_stripe_subscription_id_idx
  on public.firms (stripe_subscription_id);
```

---

## RPCs

### `get_firm_plan()`

Returns the calling user's firm plan details. Used by UI to show upgrade prompts and enforce limits.

```sql
create or replace function public.get_firm_plan()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_firm record;
  v_client_count integer;
  v_member_count integer;
begin
  select f.id, f.plan, f.plan_expires_at
  into v_firm
  from public.firms f
  join public.firm_members fm on fm.firm_id = f.id
  where fm.user_id = auth.uid()
    and fm.status = 'active'
  limit 1;

  if not found then
    raise exception 'no active firm membership';
  end if;

  select count(*) into v_client_count
  from public.clients
  where firm_id = v_firm.id and status = 'active';

  select count(*) into v_member_count
  from public.firm_members
  where firm_id = v_firm.id and status = 'active';

  return jsonb_build_object(
    'plan', v_firm.plan,
    'plan_expires_at', v_firm.plan_expires_at,
    'client_count', v_client_count,
    'member_count', v_member_count,
    'limits', jsonb_build_object(
      'max_clients', case v_firm.plan when 'pro' then null else 10 end,
      'max_members', case v_firm.plan when 'pro' then null else 1 end
    )
  );
end;
$$;
```

### Plan limit enforcement in existing RPCs

Add limit checks to:

- `add_client` (or equivalent) — if plan = starter and client_count >= 10, raise exception 'client limit reached — upgrade to Pro'
- `redeem_join_code` — if plan = starter and member_count >= 1, raise exception 'member limit reached — upgrade to Pro'

---

## API routes

### `POST /api/stripe/checkout`

Creates a Stripe Checkout session for the Pro plan.

```typescript
// Authenticated route — gets firm from session
// Creates or retrieves Stripe customer for the firm
// Creates Checkout session with:
//   - price: STRIPE_PRO_PRICE_ID
//   - mode: 'subscription'
//   - success_url: /api/stripe/success?session_id={CHECKOUT_SESSION_ID}
//   - cancel_url: /settings/billing
//   - customer: stripe_customer_id (if exists) or customer_email
// Returns { url } — redirect the browser to this URL
```

### `GET /api/stripe/success`

Called after successful Stripe Checkout. Retrieves session, confirms subscription is active, updates firm plan to 'pro' in Supabase, redirects to `/settings/billing?upgraded=true`.

### `POST /api/stripe/webhook`

Handles Stripe webhook events. Verify signature with `STRIPE_WEBHOOK_SECRET`.

Events to handle:

| Event | Action |
|---|---|
| `customer.subscription.created` | Set firm plan = 'pro' |
| `customer.subscription.updated` | Sync plan status |
| `customer.subscription.deleted` | Set firm plan = 'starter' |
| `invoice.payment_failed` | Log to audit_events |
| `invoice.payment_succeeded` | Log to audit_events |

Use service role key (webhook runs outside user auth context).

### `POST /api/stripe/portal`

Creates a Stripe Customer Portal session so the firm can manage/cancel their subscription. Returns `{ url }`.

---

## UI

### Settings page — Billing section

Add below Team section:

**Starter plan:**
```
Billing
──────────────────────────────────────────
Plan          Starter (free)
Clients       7 / 10
Members       1 / 1

You're on the free plan.
Upgrade to Pro for unlimited clients, unlimited team members,
email campaigns, and CSV import.

[Upgrade to Pro — £49/month]
```

**Pro plan:**
```
Billing
──────────────────────────────────────────
Plan          Pro
Clients       47
Members       5

[Manage subscription →]   (opens Stripe portal)
```

### Upgrade prompts (inline, not modal)

Show a banner/prompt when a Starter firm hits a limit:

- Client list: if client_count >= 10 show "You've reached the 10-client limit on the free plan. Upgrade to Pro to add more."
- Team section: if member_count >= 1 show "Upgrade to Pro to invite team members."
- Import CSV button: replace with "Available on Pro" badge
- Email campaigns section: "Available on Pro — Upgrade"

---

## Environment variables

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

---

## Stripe setup (manual steps before Claude Code)

1. Create Stripe account at stripe.com
2. Create a Product: "RefreshDesk Pro"
3. Create a Price: £49.00 GBP / month, recurring
4. Copy the Price ID → `STRIPE_PRO_PRICE_ID`
5. Copy Secret Key → `STRIPE_SECRET_KEY`
6. Copy Publishable Key → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
7. Set up webhook in Stripe dashboard → Developers → Webhooks:
   - Endpoint: `https://your-app.railway.app/api/stripe/webhook`
   - Events: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.payment_succeeded`
   - Copy Signing Secret → `STRIPE_WEBHOOK_SECRET`
8. For local testing: install Stripe CLI, run `stripe listen --forward-to localhost:3000/api/stripe/webhook`

---

## File structure (new/changed files only)

```
apps/web/
  app/
    api/
      stripe/
        checkout/route.ts
        success/route.ts
        webhook/route.ts
        portal/route.ts
    settings/
      billing-section.tsx     -- plan display, upgrade button, portal link
      page.tsx                -- add BillingSection
  lib/
    stripe/
      client.ts               -- Stripe SDK initialisation
      plans.ts                -- plan limits constants
supabase/
  migrations/
    20260607020000_slice8_billing.sql
```

---

## Acceptance criteria (smoke test)

1. Migration runs clean — `plan`, `stripe_customer_id`, `stripe_subscription_id` columns on `firms`
2. Settings → Billing section shows current plan (Starter) and usage counts
3. Click "Upgrade to Pro" → redirects to Stripe Checkout hosted page
4. Complete checkout with Stripe test card `4242 4242 4242 4242`
5. Redirected back to `/settings/billing?upgraded=true` — plan shows Pro
6. Stripe webhook fires — `audit_events` has `billing.subscription_created`
7. Click "Manage subscription" → opens Stripe Customer Portal
8. Cancel subscription in portal → plan reverts to Starter
9. Starter firm with 10 clients — Add client button shows upgrade prompt
10. Starter firm with 1 member — Generate join code shows upgrade prompt

---

## What to tell Claude Code

> I am building Slice 8 of RefreshDesk. Slices 1–6 are complete (Slice 7 deploy is deferred). The full plan is at `docs/superpowers/plans/2026-06-07-slice-8-billing.md`.
>
> Build Slice 8 in this order:
> 1. Install stripe: `npm install stripe -w apps/web`
> 2. Migration — add `stripe_customer_id`, `stripe_subscription_id`, `plan`, `plan_expires_at` to firms; add `get_firm_plan` RPC; add limit checks to `add_client` and `redeem_join_code` RPCs
> 3. `lib/stripe/client.ts` — Stripe SDK init; `lib/stripe/plans.ts` — plan limits constants
> 4. API routes — checkout, success, webhook (with signature verification), portal
> 5. Settings billing section — plan display, usage counts, upgrade button, portal link
> 6. Upgrade prompts — inline banners on client list and team section for Starter limits
>
> Key constraints:
> - Webhook route must verify Stripe signature before processing — use `stripe.webhooks.constructEvent`
> - Webhook uses service role Supabase client (no user auth context)
> - Plan limits enforced in RPCs (not just UI) — raise exception with upgrade message
> - `add_client` RPC must check client count against plan limit before inserting
> - Checkout session must create or retrieve Stripe customer by firm ID to avoid duplicates
> - All Stripe API calls wrapped in try/catch with meaningful error responses