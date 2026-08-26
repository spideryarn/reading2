# Supabase Postgres search options — research notes (2026-08-26)

## 1. Full-text search in plain Postgres

Standard modern pattern is a generated `tsvector` column + GIN index, queried with
`websearch_to_tsquery` (Google-style syntax: quotes, `or`, `-negation`) and ranked with
`ts_rank`/`ts_rank_cd`.

DDL sketch (title + body, combined):

```sql
alter table articles
  add column fts tsvector
    generated always as (
      to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
    ) stored;

create index articles_fts_idx on articles using gin (fts);

select id, title, ts_rank(fts, websearch_to_tsquery('english', :q)) as rank
from articles
where fts @@ websearch_to_tsquery('english', :q)
order by rank desc
limit 20;
```

For weighted fields (title matters more than body), use `setweight()` when building the
tsvector (`setweight(to_tsvector(title), 'A') || setweight(to_tsvector(body), 'B')`) and
`ts_rank` picks that up automatically.

`ts_rank` vs `ts_rank_cd`: `ts_rank_cd` (cover density) rewards matches where query terms
appear close together, which is generally the better relevance signal for prose, but per
Supabase's own hybrid-search doc it is **not indexable** — it can only rank rows already
narrowed down by the `@@` operator in the WHERE clause, not drive the index scan itself. So
the pattern is: GIN index + `@@` for the fast filter, `ts_rank_cd` (or `ts_rank`) only in the
`order by` over the already-filtered rows.

Source: https://supabase.com/docs/guides/database/full-text-search

## 2. BM25

**Not available on Supabase, hosted or local, as of 2026.** ParadeDB's `pg_search` extension
gives real BM25 (via Tantivy, the Rust Lucene-alike) but:
- Supabase does not ship it in either the hosted extension allow-list or the
  `supabase/postgres` Docker image used for local dev.
- ParadeDB's own list of "supported hosts" (Alibaba Cloud, Ubicloud, Tembo) does not include
  Supabase. There have been discussions between the two teams but no shipped integration
  (GitHub supabase/discussions#18061).
- Workaround people use: run ParadeDB as a *separate* Postgres instance and logically
  replicate the table(s) into it — i.e. a second database, not a Supabase feature.
- `rum` (the alternative-to-GIN inverted index extension) **is** in the `supabase/postgres`
  image; it speeds up `tsvector` ranked queries (can index `ts_rank_cd` ordering) but it is
  still native Postgres FTS ranking, not BM25.

Bottom line: what we actually get on Supabase is `tsvector`/`ts_rank`, not BM25. Good enough
for this project's scale; BM25 is not worth chasing unless FTS relevance turns out to be a
real problem.

Sources:
- https://github.com/orgs/supabase/discussions/18061
- https://supabase.com/partners/paradedb
- https://github.com/paradedb/paradedb
- https://supabase.com/docs/guides/database/extensions/rum

## 3. Trigram / fuzzy title matching

`pg_trgm` is a standard, always-available extension (`create extension if not exists
pg_trgm;`), works identically on hosted Supabase and the local Docker stack.

```sql
create extension if not exists pg_trgm;

create index articles_title_trgm_idx
  on articles using gin (title gin_trgm_ops);

select id, title, similarity(title, :q) as sim
from articles
where title % :q                -- '%' = "similar enough" per pg_trgm.similarity_threshold
order by sim desc
limit 10;
```

Use case: typo-tolerant title search / "did you mean" — FTS's `tsvector` doesn't do fuzzy
matching at all (a misspelled word just won't match a lexeme), so `pg_trgm` is the
complementary layer for titles specifically, not a replacement for FTS over body text. Common
pattern is to run both and union/re-rank, or only fall back to trigram similarity when the FTS
query returns zero rows.

Source: https://www.postgresql.org/docs/current/pgtrgm.html, Supabase extension docs.

## 4. Semantic / hybrid search

**pgvector is NOT enabled by default** — needs an explicit `create extension vector;` (via
Dashboard or SQL), same on hosted and local.

Index recommendation for 2026: **HNSW is the default choice** — better recall, no need to
retrain/rebuild as data grows the way IVFFlat does (IVFFlat's cluster centroids are chosen at
index-build time and degrade as the table changes). IVFFlat only wins on build time/memory for
very large collections where HNSW's build cost is prohibitive — not our situation (a few
hundred articles' worth of paragraphs).

Dimension limit: pgvector can *store* vectors of many dimensions but can only *index*
(HNSW or IVFFlat) up to **2000 dimensions**. This matters for model choice below (OpenAI's
`text-embedding-3-large` defaults to 3072 dims but supports Matryoshka truncation down to
smaller sizes; `text-embedding-3-small` is 1536 by default; Voyage models are typically in the
1024–2048 range with truncation options too) — pick a model/dimension that's ≤2000, or truncate.

Supabase's own documented hybrid-search recipe (`supabase.com/docs/guides/ai/hybrid-search`)
is exactly RRF over two CTEs:

```sql
create table documents (
  id bigint primary key generated always as identity,
  content text,
  fts tsvector generated always as (to_tsvector('english', content)) stored,
  embedding extensions.vector(512)
);
-- GIN index on fts, HNSW index on embedding (vector_ip_ops if using inner product)

create or replace function hybrid_search(
  query_text text,
  query_embedding vector(512),
  match_count int,
  full_text_weight float = 1,
  semantic_weight float = 1,
  rrf_k int = 50
) returns setof documents language sql as $$
with full_text as (
  select id, row_number() over (order by ts_rank_cd(fts, websearch_to_tsquery(query_text)) desc) as rank_ix
  from documents
  where fts @@ websearch_to_tsquery(query_text)
  order by rank_ix
  limit least(match_count, 30) * 2
),
semantic as (
  select id, row_number() over (order by embedding <#> query_embedding) as rank_ix
  from documents
  order by rank_ix
  limit least(match_count, 30) * 2
)
select documents.*
from full_text
  full outer join semantic on full_text.id = semantic.id
  join documents on documents.id = coalesce(full_text.id, semantic.id)
order by
  coalesce(1.0 / (rrf_k + full_text.rank_ix), 0) * full_text_weight +
  coalesce(1.0 / (rrf_k + semantic.rank_ix), 0) * semantic_weight
  desc
limit least(match_count, 30);
$$;
```

(reconstructed from the doc's description — the FULL OUTER JOIN + per-arm `row_number()` +
`1/(k+rank)` RRF formula, weights adjustable, `rrf_k` default 50.)

Caveat repeated from §1: `ts_rank_cd` inside the CTE only ranks rows already selected by
`@@`, it doesn't drive the index scan — the GIN index does that part.

**Server-side embedding generation**: Supabase does have "Automatic Embeddings"
(`supabase.com/docs/guides/ai/automatic-embeddings`) — a pipeline of Postgres triggers → pgmq
(queue) → pg_cron (batching/retry) → pg_net (async HTTP) → an Edge Function that calls an
embedding API and writes the vector back. This is real infrastructure, not a toggle:
- Needs 4 extensions enabled (pgvector, pgmq, pg_net, pg_cron) plus an Edge Function.
- Works on the local Docker stack too (uses `http://api.supabase.internal:8000` as the
  internal Edge Function URL there instead of the public project URL).
- The doc's own worked example calls **OpenAI's `text-embedding-3-small`** via the Edge
  Function — it is NOT free/local by default in the version documented; it's explicitly
  "model-agnostic," swap in any API.
- Separately, Supabase Edge Functions can run the **`gte-small`** model natively in the Edge
  Runtime (384 dims) with no external API call and no per-token cost — this is the "free
  in-Postgres-ish" option, but it's a smaller/weaker model than a paid API, and it's a
  different feature (Edge Function "AI Inference") from the automatic-embeddings pipeline
  above, which the docs show wired to OpenAI. You could wire gte-small into the same
  trigger→queue→cron pipeline instead of an external API if you wanted zero marginal cost.

Sources:
- https://supabase.com/docs/guides/ai/hybrid-search
- https://supabase.com/docs/guides/ai/vector-columns
- https://supabase.com/docs/guides/ai/automatic-embeddings
- https://supabase.com/docs/guides/ai/vector-indexes/ivf-indexes

## 5. Embedding APIs — sensible 2026 choices for this project

- **Anthropic has no embeddings API** and doesn't plan one — they explicitly point people at
  **Voyage AI** as their recommended embeddings partner (confirmed via Anthropic's own
  cookbook: `anthropics/claude-cookbooks/third_party/VoyageAI/how_to_create_embeddings.md`).
  So "use Anthropic for everything" isn't an option here; embeddings mean a second vendor
  regardless.
- Since this project already calls OpenRouter (`src/models.ts`) as well as Anthropic directly,
  worth noting OpenRouter also proxies some embedding models, but the two purpose-built options
  people actually reach for are:
  - **Voyage AI**: `voyage-4-lite` ≈ $0.02/M input tokens, `voyage-4` ≈ $0.06/M,
    `voyage-4-large` ≈ $0.12/M (figures from mid/late-2026 pricing pages; treat as
    approximate, I did not fetch Voyage's own pricing page directly).
  - **OpenAI**: `text-embedding-3-small` ≈ $0.02/M tokens (Batch API ≈ $0.01/M);
    `text-embedding-3-large` is pricier and higher-dimensional (3072 dims, needs truncation to
    fit pgvector's 2000-dim index cap).
  - Both are cheap at this project's scale. A few hundred articles × maybe 50-200
    paragraph-ish blocks each × ~100-300 tokens/block is on the order of a few million tokens
    total for a one-time full backfill — i.e. low single-digit dollars either way, and
    re-embedding on edit is equally cheap. Cost is not the deciding factor here; pick based on
    quality/dimension-fit and whichever vendor is less integration overhead.
  - I'd lean **OpenAI `text-embedding-3-small`** (1536 dims, under the 2000-dim pgvector index
    cap, well-documented, cheap) as the simplest first cut, unless there's a reason to prefer
    Voyage's domain-tuned models — but this is a judgment call, not something the docs settle.

## 6. Chunking — what to index/embed for this project

Given the project's architecture (stable block ids, paragraph-level blocks — see
`docs/project/block-ids.md`, `docs/project/architecture.md`), the natural FTS unit is
**the block itself** (or the whole article, whichever the reader is meant to land on) — since
every feature here addresses text by block id, keyword search should too, so a hit resolves
directly to a scroll target with no extra offset-mapping step.

For **embeddings**, indexing single small paragraph-blocks individually is usually noisier
than useful — very short chunks (one sentence, a heading) embed poorly and produce
low-quality nearest-neighbor matches because there's not enough content for the vector to
carry meaning. The generally-recommended pattern (not Supabase-specific, general RAG practice)
is to embed a **window of blocks** — e.g. concatenate a block with its neighbors up to
~200-500 tokens — while still storing the *first* (or most-central) block id of the window as
the anchor, so a semantic hit still resolves to a stable id and a scroll position. This keeps
the FTS unit (block) and the embedding unit (window-of-blocks-anchored-to-a-block) different
without breaking the "everything addresses text by block id" invariant.

---

## Summary table

| Option | Gives | Effort | Cost | Local Docker | Hosted Supabase |
|---|---|---|---|---|---|
| `tsvector` + GIN + `websearch_to_tsquery`/`ts_rank(_cd)` | Keyword FTS, ranked, phrase/negation syntax | Low — one generated column + index + query fn | Free | Yes (core Postgres) | Yes (core Postgres) |
| `pg_trgm` similarity | Typo-tolerant title matching | Low — one extension + GIN index | Free | Yes | Yes |
| `rum` index | Faster ranked FTS (can index `ts_rank_cd` order) | Low-medium, optional | Free | Yes (ships in image) | Yes (listed extension) |
| ParadeDB `pg_search` (BM25) | Real BM25 relevance, Elastic-like features | High — not offered by Supabase, needs a separate Postgres + replication | Extra infra/hosting cost | No | No |
| `pgvector` + HNSW | Semantic similarity search | Medium — enable extension, embed content, index | Free (extension); embedding API calls cost money | Needs `create extension vector` (works) | Needs `create extension vector` (works) |
| Hybrid FTS+vector via RRF | Best of both, Supabase's documented recipe | Medium-high — combines the above in one SQL function | Same as above | Yes | Yes |
| Automatic embeddings pipeline (pgmq+pg_net+pg_cron+Edge Fn) | Keeps embeddings in sync automatically on write | High — 4 extensions + Edge Function + triggers | Embedding API cost + a bit of infra complexity | Yes, documented | Yes, documented |
| `gte-small` in Edge Function | Free, local embedding generation, no external API | Medium (Edge Function plumbing) | Free (no token cost) | Yes | Yes |

## Recommended staged path

1. **Do first, cheap and useful now**: plain `tsvector` generated column + GIN index +
   `websearch_to_tsquery` + `ts_rank`, plus `pg_trgm` on `title` for typo tolerance. This is a
   day of work, zero ongoing cost, and matches what `docs/project/search.md` already describes
   (literal matcher as the default, "free one"). No new infra, no API keys.
2. **Defer until literal search feels insufficient**: semantic search via `pgvector` +
   `text-embedding-3-small` (or Voyage), added as a second matcher behind the existing "one box,
   two matchers" UI already described in `docs/project/search.md`. Start with a manual/batch
   embedding step (e.g. run during ingest, stage 6/7-ish) rather than building the full
   automatic-embeddings trigger/queue pipeline — that pipeline is real infra for keeping
   embeddings live-in-sync on every edit, which this project's read-mostly, ingest-once
   articles probably don't need yet.
3. **Skip/defer indefinitely**: BM25 via ParadeDB — not available on Supabase without standing
   up a second Postgres instance, and `ts_rank`/`ts_rank_cd` should be good enough for this
   project's scale (a personal/small-audience reading tool, not a search-heavy product).
4. **If semantic search is added**, chunk at the window-of-blocks level (anchored to a single
   block id) rather than one embedding per tiny paragraph block, to keep embeddings meaningful
   while preserving the block-id-addressing invariant.

## Honesty / caveats

- The exact hybrid-search SQL function body was reconstructed from WebFetch's summary of
  Supabase's doc page, not copy-pasted verbatim from the live page — the RRF formula and CTE
  shape are right (confirmed by the doc's own description), but double-check the literal SQL
  against `https://supabase.com/docs/guides/ai/hybrid-search` before shipping it.
- Vovoyage/OpenAI pricing figures came from third-party pricing-aggregator sites, not vendor
  pricing pages directly — treat as approximate, re-check current price before committing to a
  budget.
- Could not directly confirm from a primary Supabase source whether `pg_trgm` ships pre-
  installed vs. needs `create extension` on hosted Supabase (both local and hosted definitely
  support enabling it; whichever way, it's a one-line DDL either way so it doesn't change the
  effort estimate).
