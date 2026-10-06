# Slice 10 — pgvector Semantic Search

**Tag target:** `v0.10-slice-10-semantic-search`  
**Stack:** Next.js 15 · TypeScript · Tailwind v4 · Supabase · pgvector · Voyage AI  
**Depends on:** Slice 9b complete (`v0.9b-slice-9b-filing-history`)

---

## Goal

Enable semantic search across clients and extracted document fields. A search bar on the clients page lets users query in natural language — "high risk German directors", "passports expiring 2025", "South African entity clients" — and get ranked results from both client records and document extractions. Results link directly to the relevant client or document.

---

## Architecture

```
Search query (user input)
  └── Embed query via Voyage AI (voyage-3-lite)
        └── pgvector similarity search:
              ├── client_embeddings table (cosine similarity)
              └── extraction_embeddings table (cosine similarity)
                    └── Merge + rank results
                          └── Return typed SearchResult[]
```

Embeddings are generated:
- **At write time** — when a client is created/updated, or an extraction is approved
- **At search time** — query is embedded on the fly, then similarity search runs

---

## Voyage AI setup

- Sign up at [voyageai.com](https://www.voyageai.com)
- Model: `voyage-3-lite` — 512 dimensions, fast, cheap (~$0.02/1M tokens)
- API key stored as `VOYAGE_API_KEY` in `.env.local`
- Install: `npm install voyageai -w apps/web`

---

## Schema changes

### Migration: `20260608000000_slice10_embeddings.sql`

```sql
-- Enable pgvector (may already be enabled — use IF NOT EXISTS)
create extension if not exists vector;

-- Client embeddings
create table public.client_embeddings (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  embedding vector(512) not null,
  content_hash text not null,   -- SHA of embedded text, for dedup
  embedded_text text not null,  -- what was embedded (for debug/audit)
  created_at timestamptz not null default now(),
  unique (client_id)             -- one embedding per client, upsert on update
);

alter table public.client_embeddings enable row level security;

create policy "firm members can read client embeddings"
  on public.client_embeddings for select
  to authenticated
  using (
    firm_id in (
      select firm_id from public.firm_members
      where user_id = auth.uid() and status = 'active'
    )
  );

-- Extraction embeddings
create table public.extraction_embeddings (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  extraction_id uuid not null references public.document_extractions(id) on delete cascade,
  document_id uuid not null references public.client_documents(id) on delete cascade,
  embedding vector(512) not null,
  content_hash text not null,
  embedded_text text not null,
  created_at timestamptz not null default now(),
  unique (extraction_id)
);

alter table public.extraction_embeddings enable row level security;

create policy "firm members can read extraction embeddings"
  on public.extraction_embeddings for select
  to authenticated
  using (
    firm_id in (
      select firm_id from public.firm_members
      where user_id = auth.uid() and status = 'active'
    )
  );

-- IVFFlat indexes for fast ANN search (build after data is loaded)
create index client_embeddings_vector_idx
  on public.client_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 10);

create index extraction_embeddings_vector_idx
  on public.extraction_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 10);
```

---

## Text to embed

### Client record

```
{display_name} · {client_type} · {risk_rating} risk · due {refresh_due_date} · ref {external_ref}
```

Example:
```
Acme Ltd · entity · high risk · due 2027-06-07 · ref REF002
```

### Document extraction

Flatten `extracted_fields` JSONB into a readable string:

```
{document_type} for {client_display_name}: {field1}: {value1}, {field2}: {value2}, ...
```

Example (passport):
```
passport for Jane Doe: full_name: SPECIMEN JANE, date_of_birth: 01/01/1980, nationality: SOUTH AFRICAN, passport_number: M00000001, expiry_date: 29 MAR 2019, issuing_country: REPUBLIC OF SOUTH AFRICA
```

Example (entity CDD):
```
entity CDD for Acme Ltd: company_name: ACME LIMITED, company_number: 11519884, status: active, directors: Friedrich Ludewig (German), pscs: Friedrich Ludewig (75%+ ownership)
```

---

## Embedding pipeline

### `lib/voyage/embed.ts`

```typescript
import VoyageAI from 'voyageai'

const client = new VoyageAI({ apiKey: process.env.VOYAGE_API_KEY! })

export async function embedText(text: string): Promise<number[]> {
  const result = await client.embed({
    input: [text],
    model: 'voyage-3-lite',
  })
  return result.data[0].embedding
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const result = await client.embed({
    input: texts,
    model: 'voyage-3-lite',
  })
  return result.data.map(d => d.embedding)
}
```

### `lib/search/build-client-text.ts`

Builds the embeddable text string for a client record.

### `lib/search/build-extraction-text.ts`

Builds the embeddable text string from `extracted_fields` JSONB, handling all document types (passport, proof_of_address, incorporation, source_of_funds) and entity CDD fields.

### `lib/search/upsert-client-embedding.ts`

Called when a client is created or updated:
1. Build text from client record
2. Hash it (SHA-256) — skip if hash matches existing `content_hash`
3. Embed via Voyage AI
4. Upsert into `client_embeddings`

### `lib/search/upsert-extraction-embedding.ts`

Called when an extraction is approved:
1. Build text from extraction + client name
2. Hash, embed, upsert into `extraction_embeddings`

---

## Trigger points for embedding

| Event | Action |
|---|---|
| Client created | `upsert-client-embedding` |
| Client risk rating updated | `upsert-client-embedding` |
| Extraction approved | `upsert-extraction-embedding` |
| Entity CDD approved | `upsert-extraction-embedding` (using entity CDD fields) |

Wire these into existing server actions (add call after successful RPC).

---

## Search function

### `lib/search/semantic-search.ts`

```typescript
export type SearchResult = {
  type: 'client' | 'extraction'
  client_id: string
  client_name: string
  similarity: number
  snippet: string              // the embedded_text truncated
  document_type?: string       // for extraction results
  document_id?: string
}

export async function semanticSearch(
  query: string,
  firmId: string,
  limit = 10
): Promise<SearchResult[]> {
  // 1. Embed query
  const queryEmbedding = await embedText(query)
  
  // 2. Search client_embeddings
  // 3. Search extraction_embeddings
  // 4. Merge, deduplicate by client_id, rank by similarity
  // 5. Return top limit results
}
```

Use Supabase RPC for the vector search — raw SQL via `supabase.rpc('search_embeddings', ...)`:

```sql
create or replace function public.search_client_embeddings(
  p_firm_id uuid,
  p_query_embedding vector(512),
  p_limit integer default 5
)
returns table (
  client_id uuid,
  similarity float,
  embedded_text text
)
language sql
security definer
set search_path = public
as $$
  select
    ce.client_id,
    1 - (ce.embedding <=> p_query_embedding) as similarity,
    ce.embedded_text
  from client_embeddings ce
  where ce.firm_id = p_firm_id
  order by ce.embedding <=> p_query_embedding
  limit p_limit;
$$;

create or replace function public.search_extraction_embeddings(
  p_firm_id uuid,
  p_query_embedding vector(512),
  p_limit integer default 5
)
returns table (
  client_id uuid,
  extraction_id uuid,
  document_id uuid,
  similarity float,
  embedded_text text
)
language sql
security definer
set search_path = public
as $$
  select
    ee.client_id,
    ee.extraction_id,
    ee.document_id,
    1 - (ee.embedding <=> p_query_embedding) as similarity,
    ee.embedded_text
  from extraction_embeddings ee
  where ee.firm_id = p_firm_id
  order by ee.embedding <=> p_query_embedding
  limit p_limit;
$$;
```

---

## UI spec

### Search bar on clients page

Add to the clients page header, next to Import CSV / Add client:

```
[🔍 Search clients and documents...]
```

- Text input, client-side component
- On submit (Enter or button click): navigate to `/dashboard/search?q={query}`
- Debounced — no live search (keep it simple, avoid hammering Voyage API)

### Search results page (`/dashboard/search`)

```
Search results for "German directors"
──────────────────────────────────────────────────────────────────

● Client          Acme Ltd                                    94%
                  entity · high risk · due 2027-06-07
                  [View client →]

● Passport        Jane Doe                                    71%
                  full_name: SPECIMEN JANE, nationality: SOUTH AFRICAN...
                  [View document →]

No more results.
```

- Server component — fetches results on page load from query param
- Result type badge (Client / Passport / Proof of address / Entity CDD etc)
- Similarity percentage shown
- Links to client detail page or document review page
- Empty state if no results above 0.5 similarity threshold

---

## File structure (new/changed files only)

```
apps/web/
  app/
    dashboard/
      search/
        page.tsx                    -- search results page
      clients/
        page.tsx                    -- add search bar
  lib/
    voyage/
      embed.ts                      -- Voyage AI client, embedText, embedBatch
    search/
      build-client-text.ts          -- client → embeddable string
      build-extraction-text.ts      -- extraction fields → embeddable string
      upsert-client-embedding.ts    -- embed + upsert client_embeddings
      upsert-extraction-embedding.ts -- embed + upsert extraction_embeddings
      semantic-search.ts            -- query embed + dual vector search + merge
supabase/
  migrations/
    20260608000000_slice10_embeddings.sql
```

---

## Backfill

After migration and first deployment, existing clients and approved extractions won't have embeddings yet. Add a one-time backfill route:

```
POST /api/admin/backfill-embeddings
```

Protected by `CRON_SECRET`. Fetches all clients and approved extractions for all firms, embeds in batches of 20, upserts. Run once manually after deploy.

---

## Environment variables

```
VOYAGE_API_KEY=pa-...
```

---

## Acceptance criteria (smoke test)

1. Migration runs clean — `client_embeddings` and `extraction_embeddings` tables exist with vector(512) columns
2. Add a new client → embedding automatically created in `client_embeddings`
3. Approve a document extraction → embedding created in `extraction_embeddings`
4. Search bar appears on clients page
5. Type "high risk entity" → results page shows Acme Ltd with high similarity
6. Type "South African passport" → results page shows Jane Doe's passport extraction
7. Type "German director" → results page shows Acme Ltd (from entity CDD extraction)
8. Results link correctly — client result → client detail, extraction result → document review
9. Query with no good matches → empty state shown (no results above 50% threshold)
10. Run backfill endpoint → existing clients and extractions get embeddings

---

## What to tell Claude Code

> I am building Slice 10 of RefreshDesk. Slices 1–9b are complete. The full plan is at `docs/superpowers/plans/2026-06-08-slice-10-semantic-search.md`.
>
> Build Slice 10 in this order:
> 1. Install voyageai: `npm install voyageai -w apps/web`
> 2. Migration — `client_embeddings` and `extraction_embeddings` tables with vector(512) columns, RLS, IVFFlat indexes, `search_client_embeddings` and `search_extraction_embeddings` RPCs
> 3. `lib/voyage/embed.ts` — Voyage AI client, `embedText` and `embedBatch` functions using `voyage-3-lite`
> 4. `lib/search/build-client-text.ts` and `lib/search/build-extraction-text.ts` — text builders for embedding
> 5. `lib/search/upsert-client-embedding.ts` and `lib/search/upsert-extraction-embedding.ts` — hash check, embed, upsert
> 6. Wire embedding triggers into existing server actions: add client (new client action), update client risk (edit action), approve extraction (review action), approve entity CDD (entity CDD review action)
> 7. `lib/search/semantic-search.ts` — embed query, call both RPCs, merge results, filter below 0.5 threshold, return ranked SearchResult[]
> 8. Search bar on clients page — client component, navigates to /dashboard/search?q=
> 9. `/dashboard/search/page.tsx` — server component, reads q param, calls semanticSearch, renders results
> 10. `POST /api/admin/backfill-embeddings` — backfill route protected by CRON_SECRET
>
> Key constraints:
> - Voyage AI model: `voyage-3-lite` (512 dimensions)
> - Hash check before embedding — skip if content hasn't changed
> - Both search RPCs are security-definer, scoped by firm_id
> - Similarity threshold: 0.5 — don't return results below this
> - Search results page is a server component — no client-side fetching
> - Search bar is a client component (needs useState for input)
> - Backfill processes in batches of 20 to avoid Voyage API rate limits