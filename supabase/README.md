# Supabase Schema Notes

## Slice 1 Foundation

- `auth.users` is the source of truth for identities.
- `firm_members.user_id` references `auth.users(id)` directly and stores firm-local profile fields such as `full_name`.
- Every tenant-owned table has `firm_id` from Slice 1 onward.
- `audit_events` is append-only. The migration installs `audit_events_prevent_update` and `audit_events_prevent_delete` triggers, both of which raise for every role before mutation.
- `firms.retention_days` defaults to 2555 days and is documented against Money Laundering Regulations 2017, regulation 40.
- Slice 4 portal work is intentionally deferred and will live in `apps/portal/`, not inside `apps/web/`, because it has a separate magic-link auth model and can run on a separate domain.
