-- Slice 10b: entity CDD embeddings.
--
-- entity_cdd_records (officers, PSCs, ownership chain) is a separate table
-- from document_extractions, so its content was never reaching
-- extraction_embeddings. This migration lets extraction_embeddings store
-- embeddings for either source: extraction_id becomes nullable, and a new
-- nullable entity_cdd_id column is added with a check constraint ensuring
-- exactly one of the two is set.

alter table public.extraction_embeddings
  alter column extraction_id drop not null,
  add column entity_cdd_id uuid references public.entity_cdd_records(id) on delete cascade,
  add constraint extraction_embeddings_source_check
    check (
      (extraction_id is not null and entity_cdd_id is null)
      or (extraction_id is null and entity_cdd_id is not null)
    ),
  add constraint extraction_embeddings_entity_cdd_id_key unique (entity_cdd_id);

create index extraction_embeddings_entity_cdd_id_idx
  on public.extraction_embeddings (entity_cdd_id);

-- ───────────────────────────────────────────────
-- RPC: upsert_entity_cdd_embedding
-- ───────────────────────────────────────────────
--
-- Inserts or replaces the embedding for an approved entity CDD record.
-- Validates firm membership via the record's own firm_id.

create or replace function public.upsert_entity_cdd_embedding(
  p_entity_cdd_id uuid,
  p_content_hash text,
  p_embedding vector(512)
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_record public.entity_cdd_records%rowtype;
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'upsert_entity_cdd_embedding requires an authenticated user';
  end if;

  select * into v_record
  from public.entity_cdd_records
  where id = p_entity_cdd_id;

  if not found then
    raise exception 'entity CDD record not found';
  end if;

  if not public.is_active_member_of_firm(v_record.firm_id) then
    raise exception 'user is not an active member of this firm';
  end if;

  insert into public.extraction_embeddings (firm_id, client_id, entity_cdd_id, content_hash, embedding)
  values (v_record.firm_id, v_record.client_id, p_entity_cdd_id, p_content_hash, p_embedding)
  on conflict (entity_cdd_id)
  do update set
    content_hash = excluded.content_hash,
    embedding = excluded.embedding,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.upsert_entity_cdd_embedding(uuid, text, vector) from public;
grant execute on function public.upsert_entity_cdd_embedding(uuid, text, vector) to authenticated;
