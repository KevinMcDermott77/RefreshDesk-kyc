-- Slice 10: pgvector semantic search.
--
-- This migration adds:
-- - pgvector extension
-- - client_embeddings and extraction_embeddings tables (vector(512) columns)
-- - RLS: read-only via firm_members subquery; all writes via security-definer RPCs
-- - IVFFlat indexes for cosine similarity search
-- - search_client_embeddings and search_extraction_embeddings RPCs (security definer,
--   firm-scoped, cosine similarity ranked)
--
-- Embeddings are produced by Voyage AI (voyage-3-lite, 512 dimensions). The
-- content_hash column lets the application skip re-embedding unchanged text.

create extension if not exists vector;

-- ───────────────────────────────────────────────
-- Tables
-- ───────────────────────────────────────────────

create table public.client_embeddings (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  content_hash text not null,
  embedding vector(512) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id)
);

comment on table public.client_embeddings is
  'Voyage AI (voyage-3-lite) embeddings of client summary text, used for semantic search. content_hash allows skipping re-embedding of unchanged text.';

create table public.extraction_embeddings (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  extraction_id uuid not null references public.document_extractions(id) on delete cascade,
  content_hash text not null,
  embedding vector(512) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (extraction_id)
);

comment on table public.extraction_embeddings is
  'Voyage AI (voyage-3-lite) embeddings of approved extraction text, used for semantic search. content_hash allows skipping re-embedding of unchanged text.';

-- ───────────────────────────────────────────────
-- Indexes
-- ───────────────────────────────────────────────

create index client_embeddings_firm_id_idx
  on public.client_embeddings (firm_id);

create index client_embeddings_embedding_idx
  on public.client_embeddings using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index extraction_embeddings_firm_id_idx
  on public.extraction_embeddings (firm_id);

create index extraction_embeddings_client_id_idx
  on public.extraction_embeddings (client_id);

create index extraction_embeddings_embedding_idx
  on public.extraction_embeddings using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ───────────────────────────────────────────────
-- RLS
-- ───────────────────────────────────────────────

alter table public.client_embeddings enable row level security;
alter table public.extraction_embeddings enable row level security;

-- Read-only policies: firm members can read their own firm's data.
-- There are intentionally no INSERT/UPDATE/DELETE policies: all writes go
-- through security-definer RPCs (upsert + search) that validate membership.

create policy "firm members can read their client embeddings"
  on public.client_embeddings for select
  to authenticated
  using (
    firm_id in (
      select firm_id
      from public.firm_members
      where user_id = auth.uid()
        and status = 'active'
    )
  );

create policy "firm members can read their extraction embeddings"
  on public.extraction_embeddings for select
  to authenticated
  using (
    firm_id in (
      select firm_id
      from public.firm_members
      where user_id = auth.uid()
        and status = 'active'
    )
  );

-- ───────────────────────────────────────────────
-- RPC: upsert_client_embedding
-- ───────────────────────────────────────────────
--
-- Inserts or replaces the embedding for a client. Validates firm membership.

create or replace function public.upsert_client_embedding(
  p_client_id uuid,
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
  v_firm_id uuid;
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'upsert_client_embedding requires an authenticated user';
  end if;

  select firm_id into v_firm_id
  from public.clients
  where id = p_client_id;

  if not found then
    raise exception 'client not found';
  end if;

  if not public.is_active_member_of_firm(v_firm_id) then
    raise exception 'user is not an active member of this firm';
  end if;

  insert into public.client_embeddings (firm_id, client_id, content_hash, embedding)
  values (v_firm_id, p_client_id, p_content_hash, p_embedding)
  on conflict (client_id)
  do update set
    content_hash = excluded.content_hash,
    embedding = excluded.embedding,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- ───────────────────────────────────────────────
-- RPC: upsert_extraction_embedding
-- ───────────────────────────────────────────────
--
-- Inserts or replaces the embedding for an approved extraction. Validates
-- firm membership via the extraction's own firm_id/client_id.

create or replace function public.upsert_extraction_embedding(
  p_extraction_id uuid,
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
  v_extraction public.document_extractions%rowtype;
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'upsert_extraction_embedding requires an authenticated user';
  end if;

  select * into v_extraction
  from public.document_extractions
  where id = p_extraction_id;

  if not found then
    raise exception 'extraction not found';
  end if;

  if not public.is_active_member_of_firm(v_extraction.firm_id) then
    raise exception 'user is not an active member of this firm';
  end if;

  insert into public.extraction_embeddings (firm_id, client_id, extraction_id, content_hash, embedding)
  values (v_extraction.firm_id, v_extraction.client_id, p_extraction_id, p_content_hash, p_embedding)
  on conflict (extraction_id)
  do update set
    content_hash = excluded.content_hash,
    embedding = excluded.embedding,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- ───────────────────────────────────────────────
-- RPC: search_client_embeddings
-- ───────────────────────────────────────────────
--
-- Returns clients in the caller's firms ranked by cosine similarity to the
-- query embedding. Firm-scoping happens inside the function (security definer)
-- rather than relying on RLS, since the function needs to compute similarity
-- across firms the caller belongs to.

create or replace function public.search_client_embeddings(
  p_query_embedding vector(512),
  p_match_count integer default 20
)
returns table (
  client_id uuid,
  firm_id uuid,
  similarity double precision
)
language sql
security definer
set search_path = public, auth
stable
as $$
  select
    ce.client_id,
    ce.firm_id,
    1 - (ce.embedding <=> p_query_embedding) as similarity
  from public.client_embeddings ce
  where ce.firm_id in (
    select firm_id
    from public.firm_members
    where user_id = auth.uid()
      and status = 'active'
  )
  order by ce.embedding <=> p_query_embedding
  limit p_match_count;
$$;

-- ───────────────────────────────────────────────
-- RPC: search_extraction_embeddings
-- ───────────────────────────────────────────────
--
-- Returns extractions in the caller's firms ranked by cosine similarity to the
-- query embedding.

create or replace function public.search_extraction_embeddings(
  p_query_embedding vector(512),
  p_match_count integer default 20
)
returns table (
  extraction_id uuid,
  client_id uuid,
  firm_id uuid,
  similarity double precision
)
language sql
security definer
set search_path = public, auth
stable
as $$
  select
    ee.extraction_id,
    ee.client_id,
    ee.firm_id,
    1 - (ee.embedding <=> p_query_embedding) as similarity
  from public.extraction_embeddings ee
  where ee.firm_id in (
    select firm_id
    from public.firm_members
    where user_id = auth.uid()
      and status = 'active'
  )
  order by ee.embedding <=> p_query_embedding
  limit p_match_count;
$$;

revoke all on function public.upsert_client_embedding(uuid, text, vector) from public;
revoke all on function public.upsert_extraction_embedding(uuid, text, vector) from public;
revoke all on function public.search_client_embeddings(vector, integer) from public;
revoke all on function public.search_extraction_embeddings(vector, integer) from public;

grant execute on function public.upsert_client_embedding(uuid, text, vector) to authenticated;
grant execute on function public.upsert_extraction_embedding(uuid, text, vector) to authenticated;
grant execute on function public.search_client_embeddings(vector, integer) to authenticated;
grant execute on function public.search_extraction_embeddings(vector, integer) to authenticated;
