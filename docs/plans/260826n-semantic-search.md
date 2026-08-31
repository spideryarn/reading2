# Meaning-based search across the library

> Supabase offers pg_vector. Does OpenRouter offer an embedding generation API? If so, try that.
>
> — Greg, 2026-08-26

It does. `POST https://openrouter.ai/api/v1/embeddings`, the same key the app already uses. This plan
adds a third matcher to the home page's search box, blended into the one results list.

**Status: plan, second draft.** The first draft was reviewed by GPT-5.6 Sol and came back
**"NO-SHIP as written"** with four blocking findings. All four were right, all four are answered
below, and each is marked ⟨Sol⟩ where it changed the design rather than being quietly folded in.
[260826k-library-shelf-actions-and-search.md](260826k-library-shelf-actions-and-search.md) built the first two
matchers and deferred this one; that deferral is what this reverses.

---

## The decisions, and the evidence behind each

### The model: `voyageai/voyage-4`

**Chosen by measurement, not by argument.** [`evals/embedding-retrieval.ts`](../../evals/embedding-retrieval.ts)
put four models over this project's own articles: 18 reader-phrased queries, 221 `(query, passage)`
pairs judged once each, blind, shared across every arm, and the whole thing judged **twice** by two
different models to check the verdict was not an artefact of one judge.

| arm | dims | P@3 (Sonnet / Opus) | nDCG@5 | queries with nothing relevant | billed to |
|---|---:|---:|---:|---:|---|
| `openai/text-embedding-3-small` | 1536 | .704 / .741 | .777 | 1 | **your OpenAI account** |
| **`voyageai/voyage-4`** | **1024** | **.667 / .722** | **.737** | 1 | **OpenRouter credits** |
| `voyageai/voyage-4-lite` | 1024 | .630 / .667 | .706 | 0 | OpenRouter credits |
| `baai/bge-m3` | 1024 | .444 / .481 | .492 | 3 | OpenRouter credits |

`voyage-4` and `3-small` cannot be separated on quality. So the tie-break decides, and it is
`voyage-4`: fewer dimensions, and billed where Greg asked for it rather than through the BYOK route
that charges his OpenAI account.

**`baai/bge-m3` was Greg's original choice and the eval removed it.** It loses on every measure under
both judges, and it is the only arm that returned nothing relevant for three separate queries. Its
`corpusMeanCosine` is 0.390 against ~0.18 for the others — everything looks similar to it, which is
exactly the failure a search box cannot afford. Recording this because a decision reversed by
evidence should say so.

**The number that justifies the whole feature:** the literal matcher we already ship found
**0 of ~85 relevant passages, across all 18 queries.** Not few. None. These are questions the current
box structurally cannot answer.

### `input_type` is part of the model, not an option

Voyage takes `input_type` — `"query"` on a search string, `"document"` on a passage — and OpenRouter
passes it through. Typed and untyped vectors differ at cosine 0.93, and the untyped arm scored four
points of nDCG lower. Getting this wrong is not a bug that shows up as an error; it is a quietly
worse search. It is therefore part of the [space identity](#2-a-space-id-not-model-hash) below.

### The account trap, which cost an eval run to find

`OPENROUTER_API_KEY` **exported in a shell** and the one in `.env.local` are different keys on
different accounts, and [`src/env.ts`](../../src/env.ts) deliberately lets the exported one win
(`if (process.env[name] === undefined)`). Verified directly:

| model | shell key | `.env.local` key |
|---|---|---|
| `baai/bge-m3`, `openai/text-embedding-3-small` | 200 | 200 |
| `voyageai/voyage-4`, `voyage-4-lite` | **404** | 200 |

The 404 body is *"No endpoints available matching your guardrail restrictions and data policy"* —
which reads like a bad model id and is not. It is that account's privacy settings refusing every
upstream that serves Voyage.

**So choosing Voyage has a prerequisite:** whichever key production uses must have Voyage's providers
allowed at <https://openrouter.ai/settings/privacy>. This is worth knowing far beyond this feature —
two keys on two accounts, silently shadowing each other, is a trap for anything that calls a model.

---

## What pgvector actually does, verified against the local database

- **Two different caps.** The `vector` *type* holds 16,000 dimensions; both **HNSW and IVFFlat
  indexes cap at 2,000**. `voyage-4` is 1024, so nothing is truncated.
- **`create extension vector schema extensions;`** — with no `schema` clause it lands in `public`,
  against Supabase's own convention. No superuser needed, and it is transactional.
- **No index yet, and the planner proves it.** With HNSW built over the real 612 gistable blocks and
  `ANALYZE` run, **Postgres chose a sequential scan over the index it had just been given**, in
  2.26 ms. See [§ No index](#no-index-yet).
- **1024 dims is ~4KB per row**, over the TOAST threshold, so it does not appear in
  `pg_relation_size()` and the first measurement of it looks wrong.

---

## The four blocking findings, and the design that answers them

### 1. One vector per block, not merged runs

The first draft proposed greedy non-overlapping runs of blocks anchored to the first block's id. Sol:

> The proposed greedy, non-overlapping run makes one block disappear behind another block's ID. A
> query matching the second paragraph lands on the first; short tail blocks are undefined; and runs
> can cross headings unless explicitly prevented.

Correct, and it would have been invisible in testing — the reader lands one paragraph early and
assumes they misread. **Context may overlap; identities may not.** So:

```ts
interface Chunk {
  targetBlockId: BlockId;      // what a hit resolves to. One per gistable block.
  contextBlockIds: BlockId[];  // what was ALSO sent, to give a short block something to mean
  embeddingText: string;       // exactly what went to the model
}
```

Every gistable block gets its own vector. A block under `MIN_EMBED_WORDS` (40) has its heading path
and nearest prose **within the same section** added until it reaches roughly 40–80 words. The
result list shows **the target block's current text**, never the synthetic context — the context
exists to make the vector mean something, not to be read.

**The eval does not yet support this**, and Sol said so: it embedded individual blocks. Before the
chunker is written, `evals/embedding-retrieval.ts` gains a second axis comparing block-only against
target-centred-context, so the enrichment is measured rather than assumed.

### 2. A space id, not "model + hash"

The first draft made `EMBEDDING_MODEL` part of `isDone`. Sol pointed out that identifies less than
`threadIsCurrent` already does in [`src/tweets.ts`](../../src/tweets.ts), and misses the things that
silently change what a vector *means*:

```ts
interface EmbeddingSpace {
  provider: string;              // "voyageai"
  model: string;                 // "voyage-4"
  dimensions: number;            // 1024
  queryFormatVersion: number;    // input_type: "query", and any prefix
  documentFormatVersion: number; // input_type: "document"
  chunkerVersion: number;        // § 1 above — changing enrichment changes the vector
  encoding: "float32le";
}
```

`spaceId` is a hash of that. **`isDone` compares `sourceHash + spaceId`, and every query filters on
the exact `spaceId`.** Without it, swapping one 1024-dim model for another leaves old and new vectors
in one valid-looking table: during a gradual re-embed a new query vector is compared against old
document vectors, and cosine returns a real number that means nothing. There is no error to catch.

Two honest limits, both Sol's:

- **A dimension change is a schema migration**, not "one line and a re-embed" as the first draft
  claimed. `vector(1024)` → `vector(1536)` is DDL.
- **A provider silently changing a model behind a stable id cannot be fully prevented.** We record
  whatever resolved model/provider the response exposes and keep a manual `providerRevision` in the
  space. A fixed canary embedding is the real defence and is deferred.

### 3. Partial coverage makes the blend unfair, so refuse to blend

`embed` is not in `DEFAULT_INGEST_STEPS`, so "not ranked semantically" will routinely mean "not
embedded" rather than "not relevant". Sol did the arithmetic at k=60:

| | RRF score |
|---|---|
| lexical rank 1, absent from the semantic arm | `1/61` = **.0164** |
| rank 30 in **both** arms | `2/90` = **.0222** |

So a mediocre passage from an embedded article outranks the best word-match from an unembedded one.
The blend does not degrade gracefully; it degrades *invisibly and wrongly*.

**So: blend only at full coverage.** If every searchable article has a current set in the current
space, fuse. If any does not, **run words only and say so in the response** — no coverage-normalised
RRF, which would be a constant nobody could defend. At four articles the answer is to embed
everything and to embed automatically on ingest and re-extraction.

### 4. Atomic publication: `isDone` does not protect a search

`isDone` is consulted when the stage runs. Nothing consults it at search time. So a re-extraction
that preserves a block id while changing its text leaves **the old meaning attached to new prose**,
and the search returns it confidently.

Publication, not just generation:

- **Files** — build and validate the whole set in memory, write `embeddings.json.tmp`, **re-read the
  source hash and compare**, then `rename`. If the article moved while we were embedding, discard
  the run rather than let the older one land last.
- **Postgres** — insert a complete set in one transaction, tied to the revision it was built from.
  Only sets with `status = 'complete'`, for the **current** revision and the exact `spaceId`, are
  visible to search.

This is also the answer to a failed batch mid-run and to two ingests of the same slug racing. The
first draft said "fail the stage", which is an invariant rather than a mechanism.

---

## The rest of the design

### Storing: base64 float32, and a set-level manifest

| | one 1024-dim vector | ~660 blocks |
|---|---|---|
| JSON numbers | 21,280 B | 14.0 MB |
| **base64 float32** | **5,464 B** | **3.6 MB** |

Four times smaller, and no precision lost that cosine would notice — pgvector stores float32 anyway.

⟨Sol⟩ **`model` and `dims` do not go on every row.** They belong to the *set*: a manifest row
carrying the `spaceId`, the source hash, the revision, the status and the counts, with the vectors
hanging off it. Per-row copies are a second truth that can disagree with the first; a foreign key and
a `vector(1024)` column constraint cannot.

### Searching: RRF, with a real candidate depth

⟨Sol⟩ **Take 100–150 candidates per arm, not the final 30.** Fusing only each arm's top 30 means a
passage ranked 31 in *both* arms — a strong hybrid signal — never enters the fusion at all, while
something ranked 1 in one arm and nowhere in the other does. Order candidates deterministically
(`row_number` over rank, then slug, then ordinal) so a capped list does not reshuffle between runs.

k = 60, weights 1:1 to start — **and these get evaluated on the fused list**, which the current eval
does not do (it measures embeddings alone). RRF rather than blending scores directly because
`ts_rank_cd` and cosine distance are not in the same units and never will be.

### The response has to say what actually happened

⟨Sol⟩ A semantic arm that returns nothing — no key, no rows, a failed call — degrades to the
full-text results the box already had, and looks like a working search. So the response is explicit:

```ts
arms: {
  words:   { status, candidates, capped },
  meaning: { status, candidates, capped, indexedArticles, totalArticles },
}
hits[].matchedBy: ("words" | "meaning")[]
```

`status` distinguishes `ran` · `no-current-index` · `missing-key` · `failed`. The client shows the
degradation rather than hiding it.

⟨Sol⟩ **`matchedBy` also fixes a live bug in the link builder.**
[`libraryHitHref`](../../src/web/library-hits.ts) currently infers `?find=` by looking for a query
term in the hit's text. For a meaning-only hit that happens to contain one query word, that would
open words mode and highlight a word that had nothing to do with why the hit was found. Highlight
only when the lexical arm actually matched.

### The OpenRouter boundary

⟨Sol⟩ Sorting by `index` is necessary and not sufficient. Every response is validated: exact length,
indices unique and exactly `0…n-1`, every vector the expected dimension, all values finite, norm
non-zero. Plus a timeout and abort, bounded retries on 429/5xx honouring `Retry-After` with jitter,
an explicit batch size (the array cap is 2048), and a maximum query length.

⟨Sol⟩ **And the client must stop paying per keystroke-pause.**
[`useLibrarySearch`](../../src/web/useLibrarySearch.ts) fires after every 250 ms pause; with a
semantic arm that is a paid external call per pause. Words search stays live while typing; **the
blend runs on Enter**, with a short-lived cache of query vectors.

### No index yet

An index the planner refuses to use is a slower write path and a bigger database for nothing. The
DDL, for whoever crosses the line (guidance: tens of thousands of chunks):

```sql
create index block_embeddings_vec on spideryarn.block_embeddings
  using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);
```

**`vector_cosine_ops` must match the `<=>` in the query.** Mismatched, the index is silently ignored
and the query sequentially scans — correct results, no error, measured 3.8 ms against 0.3 ms. Only
`EXPLAIN` can see it, so the test that ships with that index must assert on the plan, not the rows.

### The bootstrap this breaks

Already applied to [database.md](../project/database.md): `grant usage on schema extensions` and a
per-role `search_path` for both `spideryarn_migrator` and `spideryarn_app`. Supabase gives its own
`postgres` role `extensions` through a per-role `ALTER ROLE`; the compiled-in default is `"$user",
public`. Drizzle emits `vector(1024)` and `vector_cosine_ops` **fully unqualified**, so the first
vector migration fails on the real project with `type "vector" does not exist` — while passing
locally, where we connect as `postgres`.

⟨Sol⟩ Two more, before anything is applied to the real project:

- **`CREATE EXTENSION` must precede the migration that says `vector`.** It is the first statement of
  the vector migration, not a step in a document somebody reads in order.
- **`create extension if not exists … schema extensions` does not RELOCATE an already-installed
  extension.** Verify `pg_extension.extnamespace`, `SHOW search_path` and `has_schema_privilege` on
  the real project, then smoke-test a vector cast through *both* the migrator and the runtime
  credentials.

### What is deliberately not being done

- ⟨Sol⟩ **`ai_calls` does not get its first writer here.** It is a table nothing writes; making one
  feature the exception produces a half-populated cost record that reads like a complete one.
  Aggregate usage goes in the artefact and the log line now; a shared recorder across every model
  call comes after the pipeline's Postgres write seam exists. Never put vectors or query text in it.
- **HNSW, its `EXPLAIN` regression test, provider canaries, filesystem query-vector caching** — all
  deferred, all named here so the next person finds a decision rather than an omission.

---

## Order of work

1. Extend the eval with the chunking axis (block-only vs target-centred context) — § 1 is unmeasured.
2. `EMBEDDING_SPACE` in [`src/models.ts`](../../src/models.ts); `spaceId` derivation and its test.
3. `src/embed.ts` — chunking, the validated OpenRouter client, batching, atomic publication.
4. The `embed` stage. ⟨Sol⟩ Which also means: `StepName` in [types.ts](../../src/types.ts), the
   `revision_step_runs` CHECK in [schema.ts](../../src/db/schema.ts), importer step inference in
   [import.ts](../../src/store/import.ts), and `FORCE_ONLY_WHEN_NAMED` in
   [pipeline.ts](../../src/pipeline.ts) — none of which the first draft's order of work mentioned.
5. Artefact manifest, importer, exporter, round-trip — or the round-trip test goes red, as it did
   for the shelf work.
6. The migration: extension first, table, manifest, no index.
7. `LibrarySearch` gains the semantic arm; both adapters; coverage gate; RRF with real candidate
   depth; the arms/`matchedBy` response contract.
8. The client: Enter-to-blend, per-arm status, `matchedBy`-driven highlighting.
9. Docs: [search.md](../project/search.md), [library.md](../project/library.md),
   [database.md](../project/database.md), [setup-dev.md](../project/setup-dev.md), and the two-keys
   trap somewhere it will be found.

## How this fails while reporting success

Every one a mechanism, not a worry — [silent-success.md](../reusable/silent-success.md):

- **The batch comes back out of order** and every paragraph gets its neighbour's meaning. Guarded by
  validating `0…n-1`, not merely sorting.
- **Two embedding spaces coexist** and cosine happily compares them. Guarded by `spaceId` on the set
  and in every query.
- **A hit lands one paragraph early**, because a chunk spoke for a block that was not its own.
  Guarded by one vector per target block.
- **The blend runs at partial coverage** and ranks embedded articles above unembedded ones for
  reasons unrelated to relevance. Guarded by the coverage gate.
- **A re-extraction leaves old meaning on new prose.** Guarded by atomic publication tied to a
  revision.
- **The semantic arm silently does not run** and the box looks fine. Guarded by per-arm `status`.
- **An index is added with the wrong opclass** and does nothing. Only `EXPLAIN` sees it.
- **`input_type` is dropped** and retrieval quietly gets worse with no error. Guarded by it being
  part of `spaceId`, so dropping it invalidates every stored vector rather than mixing silently.
