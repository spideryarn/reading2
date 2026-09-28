# Filter terms for the shelf

**Status:** planned, 2026-09-28. Stages below; each updates this file when it lands.

## What Greg asked for

> Delegate to a new agent that does some simple keyword/clustering on the articles in my shelf so I
> can easily filter to different kinds of article. It should choose terms that somehow enable me to
> filter overlapping subsets (and ideally cover pretty much all of the articles in some form).
> Ideally this would use code/algorithms that can run without an LLM, so that it's fast and cheap
> and can be re-run repeatably, e.g. something along the lines of TF/IDF or k-means (or something
> cleverer/more modern/powerful, you get the gist - see @docs/reusable/third-party-library-selection.md
> ) to generate a bunch of keywords (or perhaps even better, multi-word phrases) that I can filter
> by. Perhaps it would do a one-off pre-processing on each article (this could perhaps involve an LLM
> if that will help), and then it can just reuse that at browse time (or when adding new articles).
> Consider how to show a rich UI for this, e.g. make heavy use of tooltips (e.g. when I hover over a
> term it might indicate the articles that use it most commonly), or perhaps each filter-term gets
> its own row with extra metadata and I can filter by them, or similar. There should be a UI flag
> (or use the existing UI) for whether to only show results from the active ones only, or whether to
> include archived too. Use Sonnet for web search on UI patterns and best practices for clustering,
> faceted search, document retrieval, article browsing, etc etc.
>
> The agent should ask GPT Sol for input and review.
>
> — Greg, 2026-09-28

And a possible later idea, which this plan does **not** build — the write-up is
[260928b-academic-bulk-import-without-llm-processing.md](../research/260928b-academic-bulk-import-without-llm-processing.md):

> Potential future idea: for academics with big libraries of papers, maybe we'd allow them to
> somehow upload the PDFs (without yet triggering the expensive LLM processing?) and/or a
> bibliography (e.g. BibTex, or Zotero/Papers/ReadCube dump) so that they could benefit from this
> browsing interface without having to LLM-process thousands of articles. …
>
> — Greg, 2026-09-28

## The idea, in plain words

Above the shelf, a row of **topics**: short phrases like *neural networks*, *consciousness*,
*Indigenous*, each with a count. Click one and the shelf narrows to the articles that are about it;
click a second and it narrows to articles about both. Hovering (or tapping) a topic says how many
articles use it and which use it most. The topics are picked by a program, not a model: the same
shelf always gives the same topics, it costs nothing, and it takes milliseconds.

```
 Last opened  Added  Title  Length …                      [Unread] [cards|table]
 Topics  memory 7 · neurons 7 · scientists 6 · consciousness 5 · writers 5 ·
         Indigenous 5 · neural networks 4 · Turing machine 4 · …   All 30 ▸
 ┌ selected: [consciousness ×] [neural networks ×]   Clear ┐
 2 of 38 articles
 ┌──────── card ────────┐ ┌──────── card ────────┐
```

The research behind every choice below — algorithms, libraries, other tools' UIs, dead ends — is in
[260928a-shelf-facet-terms-algorithms-and-ui.md](../research/260928a-shelf-facet-terms-algorithms-and-ui.md).

## Design

### Two steps, and only the first is stored

1. **Per article, once: candidate phrases.** Read the article's current revision's prose, count
   1–3-word phrases, keep the top ~200 with their counts. Stored once per `(revision,
   extractor_version)`; recomputed only when the article gets a new revision or the extractor's
   version number goes up.
2. **Per shelf, every time the shelf is loaded: choose the topics.** From the stored candidates of
   the reader's own articles, pick about 30 that together cover nearly every article while
   overlapping. 3–30 ms for 40 articles in the spike, so it is not cached.

### Step 1: extracting candidates (no dependency)

Hand-written, RAKE-shaped: tokenise; split into runs at stopwords and punctuation; take the 1–3-grams
inside each run. Key = lowercased tokens with light plural folding (`networks` → `network`,
`studies` → `study`, not `analysis`); the label shown is the most frequent surface form, lowercase
winning ties so a heading's Title Case does not become the label. A single word must pass a
"nounish" test (not on a generic-English list, not an irregular verb, not ending in *-ly*/*-ed*); a
phrase's last word gets only the shape test (not an irregular verb, not *-ly*/*-ed*) — the
generic-word list applies to single words, or *conscious experience* and *neural activity* would go.

**Three numbers per candidate, not one** (Sol F3 — the spike folded the title weight into the count,
so one title occurrence read as "used 3 times" and passed membership on its own):

- `count` — literal occurrences in the counted text, title and headings included once each. This is
  what the tooltip says.
- `bodyCount` — occurrences in prose blocks only. This is what membership tests.
- `score` — the weighted figure used for ranking: title ×3, headings ×2, prose ×1.

And per article, `words`: the unweighted number of counted prose words, which is what the density
threshold divides by.

**English only, said out loud** (Sol F12). The generic-word list and the suffix rules are English, so
a French article would contribute *les* and *dans* as topics. An article whose counted text has an
English-stopword ratio below a threshold is stored as `skipped: "not-english"` with no candidates,
and the report counts how many were skipped. Deterministic, no language column needed
(`article_revisions.lang` is Readability's reading of the page's `lang` attribute and is often
absent).

**What text is read:** gistable prose blocks, excluding `role = 'footnote'`, code, media and tables,
**and everything under a back-matter heading** — References, Bibliography, Acknowledgements, External
links, See also, Further reading, Notes. The spike found these as headings in 12 of 41 real
articles, not flagged as footnotes, and they fill the candidates with author surnames and journal
names.

**One entry point takes plain text**: `extractCandidates(segments: { text; kind: "title" | "heading" | "prose" }[])`. The block
reading is a separate adapter. That is so a later non-article item (a bibliography entry's title and
abstract — the academic write-up's option A) can feed the same function without a second path.

**Why not `compromise` (POS-tagged noun phrases)?** Measured, not argued: it was 27× slower (82 ms
vs 3 ms per 1k words; 12.5 s for a 152k-word PDF), a 4.7 MB dependency with a 0.5–1.3 s cold
import, and *worse* on this shelf — it tags *Indigenous* and *Aboriginal* as adjectives and so lost a
whole group of articles (coverage 0.71 vs 0.92), and emits junk heads of its own (*higher*, *best*,
*target*). A new dependency would have been a choice to name; the measurement removed it.

### Step 2: choosing the shelf's topics

- **Membership** — an article *has* a topic if the phrase occurs in its prose (`bodyCount`) at
  least `max(2, 0.3 per 1,000 words)` times. Scaled by length, because an absolute threshold let a
  152k-word book join every common word's set. A title hit alone does **not** make membership (the
  spike's *Todo List* was a one-article facet let in that way).
- **Exact duplicates count once; near-duplicates do not get grouped in v1** (Sol F9). Articles whose
  counted text hashes the same (`textHash`, stored with the candidates) are one *work* for document
  frequency and coverage, so five copies of one article cannot make a five-article "topic". The
  spike's fuzzy grouping (Jaccard ≥ 0.6 on top keys) caught more copies, but similarity is not
  transitive — A≈B and B≈C does not make A≈C — and it is quadratic in the shelf. Fuzzy grouping is
  a v2 if the report shows copies that differ slightly are producing fake topics. **Counts shown to
  the reader are always physical articles**, so six copies are six cards and a count of six.
- **Candidate band** — a topic must cover at least `max(2, 3% of works)` and at most 50% of works:
  rarer is not a filter, commoner filters nothing (Castanet's pruning band).
- **Quality** — mean over members of `(1 + ln tf) × idf`, with idf over the reader's own works,
  times `1 + (words − 1)` so a two-word phrase is preferred to a single word of equal weight.
- **Greedy coverage with overlap allowed** — repeatedly take the candidate with the largest
  `quality × sqrt(Σ over its works of 1 / (1 + times already covered))`. Discounting rather than
  removing covered works is what lets topics overlap. Skip a candidate whose work set has Jaccard
  > 0.7 with a chosen topic, or > 0.3 when they share a
  word. "Shares a word" compares words after a crude suffix strip (*-ness*, *-ity*, *-al*, plurals),
  so *conscious* and *consciousness* count as sharing one; the spike's exact-token comparison let
  *conscious AI*, *conscious experience* and *consciousness* all through (Sol F4). If the strip
  proves too eager, near-synonyms stay a stated v1 limitation rather than a claim.
- **A total order everywhere** (Sol F7). Equal gains break by key; a label's surface forms break by
  frequency, then lowercase, then code point. Tested by shuffling the order of articles and of each
  article's candidates and asserting the same topics come out — not merely by running twice.
- **K = 30**, fewer on a small shelf, and **no topics at all below 8 distinct works** — the panel
  says so rather than disappearing (on the 000…002 test shelf, 6 articles that are 2 works, every
  configuration chose nothing).

### Measurements, and how coverage and overlap are defined

Definitions, computed by one exported function so the tests, the report script and this table agree:

- **coverage** — the share of in-scope articles that belong to at least one chosen topic.
- **overlap** — mean (and median) number of chosen topics per article, and the share with ≥ 2.
- **redundancy** — mean and max pairwise Jaccard between chosen topics' article sets (low is good:
  topics that are not restating each other).

**From the spike, before the plan review's changes** — Sol F14 noted its output file says 29 works
and 350,823 words, from a later run than this table; stage 2 regenerates all of it from the real
code. On the local database's one real shelf (the spike, 2026-09-28; 38 active articles, 30 distinct
works, ~357k words; the other 43 rows under that owner are test-suite debris with no current
revision):

| | coverage | topics per article (mean/median) | ≥ 2 topics | Jaccard mean/max |
|---|---|---|---|---|
| **chosen: hand-rolled, density membership, grouped, K=30** | **0.92** | **2.8 / 2** | **0.76** | **0.07 / 0.71** |
| same, K = 20 | 0.76 | 1.7 | — | — |
| same, K = 40 | 0.95 | 3.6 | — | — |
| same, active + archived, K = 30 | 0.95 | — | — | — |
| `compromise` noun phrases, same selection | 0.71 | 2.6 / 2 | 0.53 | 0.10 / 0.75 |
| "occurs twice" membership (no length scaling) | 1.00 | 6.0 / 5 | 0.95 | 0.13 / 0.63 — **but the topics are junk**: *system, world, past, run, change* |

The three uncovered articles were 109–243-word test notes sharing no vocabulary with anything.
The chosen list included *neural networks, consciousness, conscious AI, Turing machine, memory,
neurons, writers, startups, Indigenous, language models, computational irreducibility*, and some
weak ones: *worker, window, message, cycle*. The weak ones are the known v1 cost (below).

**Greg's real shelf is in production, which this box cannot read.** Stage 2 adds
`npm run shelf-terms:report -- --owner <uuid>`, which computes everything in memory and **writes
nothing**, printing the table above and the topic list. To measure the real shelf, Greg (or anyone
with the production `DATABASE_URL`) runs it with that URL in the environment.

### Storage — one row per revision and extractor version

An ordinary additive migration, **one table** (Sol's "smaller version", adopted):

```
revision_phrase_runs (
  revision_id        uuid,
  article_id         uuid,
  extractor_version  smallint,
  words              integer,      -- counted prose words, for the density threshold
  text_hash          text,         -- of the counted text, for exact-duplicate grouping
  skipped            text null,    -- null, or 'not-english' / 'no-text'
  candidates         jsonb not null,  -- [{ key, label, count, bodyCount, score }], ≤ ~200
  computed_at        timestamptz,
  primary key (revision_id, extractor_version),
  foreign key (article_id, revision_id) → article_revisions (article_id, id) on delete cascade
)
```

- **JSONB for the candidate list, and it argues for itself** under
  [sql.md § Columns, not JSON](../project/sql.md): the array is always read whole, never filtered,
  joined, sorted or constrained inside Postgres. Everything that *is* filtered or joined on — the
  revision, the article, the version — is a column. One row also means a fill is one insert, so
  "processed" can never be committed without its candidates (Sol F1).
- **The key includes the version**, so a version bump writes a new row rather than conflicting with
  the old one, and two deployments of different versions can run side by side during a rollout
  (Sol F1). `on conflict do nothing` makes concurrent fills of the same row harmless.
- **The composite foreign key** makes a row whose article and revision disagree impossible, the same
  way `revision_blocks` does (Sol F10).
- **Keyed on the revision**, because a published revision's blocks are immutable (schema.ts §
  article_revisions; Sol F8 confirmed it). The cost: every job publishes a new revision, including
  jobs that change no text, so a recompute follows — about 30 ms per article, acceptable. Old
  revisions are **not** deleted by publication (they are kept on purpose), so a fill also deletes
  that article's rows for revisions other than the current one. That keeps storage at one row per
  article per version rather than one per job ever run.

### Filling it — lazily, but bounded

The shelf-terms route fills what is missing, **within a time budget** (about 2 s of work per
request), newest articles first, and reports how many are still `pending`. The client shows the
topics it has, says *"Still reading 40 articles…"*, and asks again until nothing is pending. A new
article is one article — a few milliseconds on the next shelf load. A version bump or a first visit
to a large shelf is spread across several requests rather than one that takes a minute (Sol F2: a
1,000-article cold fill is ~30 s of CPU).

This is a GET that writes, which [library.md](../project/library.md) warns against for *counters*.
Here the write is an idempotent cache fill of a deterministic function: a retry, a prefetch or a
second tab writes exactly the same row, or nothing. Sol agreed on those terms — bounded, atomic,
`private, no-store`.

**Sol also recommended a pipeline step for new revisions plus a separate backfill command; not
taken.** With the budget, the lazy fill already handles new articles, old articles and version bumps
through one code path, and a pipeline step would reach into the job machinery (another stage's code)
to save a few milliseconds on one shelf load. If the report on a large shelf shows the first visit is
still too slow, a backfill command that calls the same fill function is the next step.

### The route

`GET /api/library/terms` (and `?archived=1` for active + archived), owner-scoped exactly as
`GET /api/library` is. **Every read and every fill starts from one owner-scoped query for the
reader's current `(article, revision)` pairs**, and nothing reads a candidate row except through that
set — so another reader's articles never enter the candidates, the document frequencies or the idf,
which is the whole of the leak surface ([security-map.md](../project/security-map.md), Sol F10).
Sent with `Cache-Control: private, no-store`. Registered before the `/api/library/:slug` pattern for
the same reason `/search` is.

```ts
{ terms: { key: string; label: string; articles: { slug: string; count: number }[] }[];
  scope: { articles: number; works: number; skipped: number };
  pending: number }
```

The coverage statistics are **not** in the response (Sol) — they live in the report script.

### The UI

A `ShelfTerms` component between `ShelfControls` and the count line, in Tailwind (`tw:` prefix):

- **A row of chips with counts**, not a cloud (the research's clearest finding). Collapsed to the
  first ~12 by current count; selected topics first, with ×, and a Clear.
- **"All 30 topics" opens a list with one row per topic** — Greg's *"each filter-term gets its own
  row with extra metadata"*: the label, the count, and the titles of the two or three articles that
  use it most, inline. This is also **the touch answer** (Sol F5): the shared `Tooltip` opens on
  hover and focus but not on tap, and a chip cannot both toggle and hold a tooltip open on one tap.
  So on a phone a tap toggles, and the detail a desktop reader gets from hovering is in the rows,
  not behind a gesture.
- **The tooltip, desktop**: first line *"2 match this view · 7 of 38 on the shelf"*, then the top
  3–5 articles by how often they use it, with the count. The second paragraph says what you could
  not guess: *"Picked automatically from the words your articles use — nobody wrote this list.
  Choosing two shows only articles that have both."*
- **One formula for every count** (Sol F11): `visible = scope ∩ search ∩ Unread ∩ every selected
  topic`; a chip shows `|visible ∩ its articles|`, so a selected chip's count equals the number of
  articles shown. Physical articles, never grouped works. An unselected chip at zero is greyed and
  disabled in place; a **selected** chip at zero stays removable.
- **One pure narrowing function** applied to both arrays — the active shelf and, when included, the
  archived one — in the order scope → search → Unread → topics (Sol F6). The filter therefore lives
  where search and Unread already do, above the cards/table branch, and **both views obey it** with
  no second list.
- **URL state**: `?topics=<key>,<key>`, per [url-state.md](../project/url-state.md). A key that is no
  longer among the chosen topics is **dropped from the selection once the terms have loaded** —
  never applied while they are still loading, so a stale link cannot flash an empty shelf.
- **Archived**: the shelf's existing "Show archived" control at its foot moves its open/closed state
  into the URL (`?archived=1`). When on, topics are chosen over active + archived, and the archived
  list is narrowed by the same function — search and Unread included, which means the archived list
  **stays visible during a search** instead of disappearing as it does today. (Passage search stays
  active-only, as now.) **Assumption pending Greg:** reusing the existing control rather than adding
  a second switch in the topics row.
- **Refetching**: the terms are refetched when the set of articles on the shelf changes (a job
  finishing, an archive, a restore) and when the scope changes; a response for a scope that is no
  longer current is dropped.

### What this does not do (v1)

- No LLM, no embeddings, no clustering library.
- No user editing of topics (hide/rename/pin). Zotero-style "hide this automatic tag" is the obvious
  v2.
- The generic-word list is hand-written, which is why *window* and *message* survive. The spike's
  suggestion for v2 is a shipped English word-frequency table as a fixed background idf.
- Near-synonyms (*neural nets* / *neural networks*) can both appear.
- The public shelf (`/read/public`) gets nothing.

## Stages

Four, after Sol F13 said the first one was carrying too much.

### Stage 1 — the algorithm, pure

- `src/shelf-terms/extract.ts` — segments → candidates (`extractCandidates`), the blocks → segments
  adapter with the back-matter skip, the English check, `textHash`, `EXTRACTOR_VERSION`.
- `src/shelf-terms/choose.ts` — candidates per article → topics; exact-duplicate grouping; the
  membership, band, quality, greedy and redundancy rules; total tie-breaks; and
  `shelfTermMetrics()` (coverage, overlap, redundancy — the one definition).
- Tests, red first: plural folding, stopword split, back-matter skip, footnotes and code out, label
  casing and tie-breaks, `count`/`bodyCount`/`score` kept apart (a title-only phrase is not a
  member), non-English skipped, df band edges, density threshold edges, exact duplicates counted
  once but shown as their physical count, overlap allowed, each redundancy skip, the
  *conscious*/*consciousness* case, fewer than 8 works → none, **shuffled-input determinism**.
- Done when: green, typecheck clean, and the numbers reproduced on the local shelf by a throwaway
  run (the report script proper is stage 2).

**Landed** (2026-09-28): `src/shelf-terms/extract.ts`, `src/shelf-terms/choose.ts`, 53 tests;
all 11 deliberate breaks of the code turned a test red. What changed from the design above while
building:

- The **"contains the other phrase" skip was dropped**: at 0.5 it could never fire, because such a
  phrase always shares a word and the shared-word rule's 0.3 is lower.
- **K = min(30, works).**
- **The English check**: at least 10% of prose tokens are among ~50 English function words; not
  judged under 30 prose tokens, so a short note is let through. `no-text` means no prose at all.
- **Back-matter headings match as a whole heading** (numbering and punctuation allowed), so *Notes on
  the Synthesis of Form* is not skipped; the adapter reads blocks through `isEmbeddable` from
  `src/block-policy.ts` rather than `gistable`, so a change there must bump `EXTRACTOR_VERSION`.
- **Local shelf, active, K = 30: coverage 0.87, 2.84 / 2 topics per article, 0.71 with ≥ 2,
  Jaccard 0.07 / 0.67** (38 articles, 33 works, 329k prose words; extraction 6 ms per 1k words).
  Lower than the spike's 0.92 because exact-hash grouping leaves **re-ingested near-copies** apart:
  three *ball lightning* copies differ by a few words, and the six *Forms of Memory* copies are four
  hashes, which makes *Wagan Watson* — a person in that one work — a four-article topic. That is the
  v2 trigger for fuzzy grouping, firing on a shelf of test ingests; the report script will say
  whether Greg's real shelf has the same problem.

### Stage 2 — storage, fill, route, report

- The migration (drizzle schema + `drizzle-kit generate`), the store functions (the owner-scoped
  current-revision set; read runs; find missing; read blocks; fill within a budget; delete a
  revision's superseded rows), `GET /api/library/terms`, `LibraryTermsResponse` in `src/types.ts`.
- `scripts/shelf-terms-report.ts` + `npm run shelf-terms:report -- --owner <uuid>` — computes in
  memory, **writes nothing**, prints the measurement table, the topic list and how many articles
  were skipped.
- Postgres tests, red first: a fill is written once and reused; concurrent same-version fills; a
  v1 row and a v2 row side by side; a new revision gets its own row and the superseded one is
  removed; the budget leaves `pending > 0` and a second call finishes; **reader A's request creates
  no row for B, returns no B slug and no B-only phrase**; archived scope; `private, no-store`; auth
  required. And a synthetic 1,000-article timing of the warm path (read + choose).
- Done when: green, and this plan's § Measurements regenerated from the real code (Sol F14).

**Landed** (2026-09-28): `revision_phrase_runs` (schema.ts, migration
`20260928023038_shelf_terms_revision_phrase_runs`), `src/store/pg-shelf-terms.ts` (wired as
`shelfTermsStore`, guarded as `shelf-terms`), `GET /api/library/terms`, `LibraryTermsResponse`,
`scripts/shelf-terms-report.ts`, `tests/shelf-terms-pg.test.ts` (10 cases, each of seven deliberate
breaks of the store or route turned its own case red) and `tests/shelf-terms-warm-path.test.ts`.
What differed from the design above, or was decided while building:

- **The owner-scoped set is its own query, not `listArticlesQuery`**, built from the same pieces
  (`ownedByReader`, `onTheShelf`, the `archived_at` test, the join to the current revision,
  `ADDED_AT` order). It does not repeat `listArticles`' per-row "has a tree and blocks" check, which
  that function's own comment says has never excluded a published article. `archived: true` means
  active **and** archived here, not archived only as in `listArticles`.
- **A fill always does at least one article**, whatever the budget, so the client's ask-again loop
  cannot spin. Each fill is one `read committed` transaction: the insert (`on conflict do nothing`),
  then a delete of the article's rows whose revision is not its current one *as it is now* — so a
  republication mid-fill deletes the stale row just written, not the peer's new one — any version.
- **Skipped articles go into the chooser** (as stage 1's `ChooseArticle` intends) and so count as
  works and in the coverage denominator; `scope.articles` counts pending ones too.
- **The report reads through the route's own set query and extracts in memory**; it imports no write
  path. The shell's `DATABASE_URL` wins over `.env.local`.
- **Not applied to the shared local database.** `npm run db:migrate` refuses there: two peer
  worktrees' unmerged migrations (one is `20260928010007_jobs_reset`) are in that ledger and not in
  this tree's journal. The migration was first generated as `20260928012942_…`, stamped *below* the
  newer of those rows, which drizzle would have skipped for ever once they were merged
  ([database.md § A watermark is not a ledger](../project/database.md)); it was regenerated with the
  same DDL and a later stamp before it was committed.
  The Postgres tests are unaffected (they mint a private database from this tree's journal); a dev
  server in this tree will fail `/api/library/terms` until `db:migrate` runs after that migration
  reaches `dev`.
- **Warm path, synthetic 1,000 articles × 200 candidates:** 15.6 MB of candidate JSON, 160 ms to
  parse, 745 ms to choose (the database transfer itself not measured). Acceptable for v1; if a real
  shelf gets there, trimming the stored list below 200 is the first lever.

**Measured on the local database** (owner `f4d08b58…`, extractor v1, `npm run shelf-terms:report`):

| scope | articles | works | skipped | K | coverage | per article mean/median | ≥ 2 | Jaccard mean/max |
|---|---|---|---|---|---|---|---|---|
| active | 38 | 33 | 1 | 20 | 0.76 | 1.55 / 1 | 0.34 | 0.07 / 0.67 |
| active | 38 | 33 | 1 | **30** | **0.87** | **2.84 / 2** | **0.71** | **0.07 / 0.67** |
| active | 38 | 33 | 1 | 40 (33 chosen) | 0.92 | 3.05 / 2 | 0.76 | 0.07 / 0.67 |
| + archived | 41 | 36 | 1 | 20 | 0.76 | 1.49 / 1 | 0.32 | 0.07 / 0.67 |
| + archived | 41 | 36 | 1 | 30 | 0.88 | 2.73 / 2 | 0.68 | 0.07 / 0.67 |
| + archived | 41 | 36 | 1 | 40 (36 chosen) | 0.90 | 3.20 / 2 | 0.83 | 0.07 / 0.67 |

329k prose words active (336k with archived); extraction 6.2 ms per 1k words, about 2 s for the
whole shelf — so a first visit here fills over two requests. The one skipped article is
`sample-spya-vgwr6s`, not English. Uncovered at K = 30: that one, two 99-word *stage-e* test pages,
*todo* (234 words) and *read* (448). The K = 30 active row matches stage 1's throwaway run exactly.

### Stage 3 — the shelf UI

- `src/web/ShelfTerms.tsx`, `src/web/useShelfTerms.ts`, params in `params.ts`, the narrowing
  function, the archived URL state and the `rows` change in `Library.tsx` (small edits — the
  `shelf-table-view` session is in the same file).
- Component tests (jsdom): chips and live counts by the one formula; AND; unselected zero greyed,
  selected zero removable; the shown count equals the rendered cards/rows; table view obeys the
  filter; archived widens scope and stays visible during search; a stale `?topics=` key dropped
  after load and never applied before; the row list shows each topic's top articles.
- A browser check in a Sonnet subagent at desktop and phone widths
  ([browser-control.md](../project/browser-control.md), then
  [browser-testing.md](../project/browser-testing.md)) — including a real tap on a chip.
- Docs: a new `docs/project/shelf-terms.md` under `reading-view-overview.md`, a line in
  [library.md](../project/library.md), the two params in [url-state.md](../project/url-state.md).

### Stage 4 — close

Update this plan with what landed, debrief.

Every stage: commit, then a GPT Sol code review in the worktree (write-capable, fixes inside the
stage, reports anything wider), gates rerun, commit its fixes.

## Assumptions pending Greg

1. **Reuse "Show archived"** for the active/archived switch rather than a second control — and as a
   consequence the archived list now stays visible, filtered, during a search.
2. **AND** between selected topics, not OR.
3. **~30 topics**, and none below 8 distinct works (the panel says why).
4. The panel is called **Topics**.
5. **No LLM pass.** The deterministic version measured well enough; an LLM tagging pass would drift
   between runs, which a filter must not.
6. **English only** for now; other-language articles are skipped and counted.

## Reviews

- **GPT Sol, plan, round 1** —
  [260928a-shelf-facet-terms-plan-review-sol.md](260928a-shelf-facet-terms-plan-review-sol.md)
  (prompt: [260928a-shelf-facet-terms-plan-review-prompt.md](260928a-shelf-facet-terms-plan-review-prompt.md)).
  *Proceed with changes*; no P0. Taken: F1 (one JSONB row keyed on revision + version), F2 (a
  bounded fill, not an unbounded one), F3 (three counts), F4 (suffix-stripped word sharing), F5
  (touch: rows, not a tap-tooltip), F6 (one narrowing function over both arrays), F7 (total order,
  shuffled tests), F8 (delete superseded rows), F9 (exact duplicates only), F10 (one owner-scoped
  set, composite key, `no-store`), F11 (one count formula), F12 (English only), F13 (four stages),
  F14 (regenerate the numbers). **Not taken:** F2's pipeline step and separate backfill command —
  reasoned in § Filling it.
- **GPT Sol, stage 1 code, round 1** —
  [260928a-shelf-facet-terms-stage1-review-sol.md](260928a-shelf-facet-terms-stage1-review-sol.md)
  (prompt: [260928a-shelf-facet-terms-stage1-review-prompt.md](260928a-shelf-facet-terms-stage1-review-prompt.md)),
  reviewing 3725b94c. *Ready with its fixes*; no P0. It fixed S1-1 (NFC and word-joining hyphens
  split keys; capitalised possessives leaked into labels), S1-2 (the English threshold rejected
  English dense with proper nouns: 12% → 10%) and S1-3 (`7.1 References`, `A. Bibliography` were
  not recognised as back matter). It bumped `EXTRACTOR_VERSION` to 2; put back to 1, because no row
  was ever stored at 1. Reported, not fixed, and left for the stage 2 measurements to decide: S1-4
  (a label's forms are aggregated per article, not per occurrence — exact needs per-form counts
  stored), S1-5 (idf counts any stored occurrence, not membership), S1-6 (a long article can still
  lift quality), S1-7 (`stemForOverlap` can conflate *formal*/*form*).
