-- Slice 5: Refresh campaigns — firm MLR supervisor email.
--
-- Adds:
-- - mlr_supervisor_email column to firms table
-- - update_firm_supervisor_email RPC (security-definer, admin-only)

alter table public.firms
  add column if not exists mlr_supervisor_email text;

create or replace function public.update_firm_supervisor_email(
  p_supervisor_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_firm_id uuid;
begin
  select fm.firm_id into v_firm_id
  from public.firm_members fm
  where fm.user_id = auth.uid()
    and fm.status = 'active'
    and fm.role = 'admin'
  limit 1;

  if v_firm_id is null then
    raise exception 'Not an active admin of any firm';
  end if;

  update public.firms
  set mlr_supervisor_email = p_supervisor_email,
      updated_at = now()
  where id = v_firm_id;
end;
$$;
