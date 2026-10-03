# Store when it happened: an audit of `src/db/schema.ts`, and the columns it was missing

**Status: plan reviewed by GPT Sol ([261003j-plan-review-sol.md](261003j-plan-review-sol.md)); its seven
findings are all accepted and folded in below (§ The plan review). Building.**

## What this is for

> we should make sure that we're storing dates for whenever a human action is performed and you need
> an AI action. I don't know why, but I just have a hunch that occasionally it will be useful. I
> don't know when it's worth displaying this. Use your judgment. Maybe it's not that important. But
> at the very least, I think we should be storing a date time stamp for when everything happens
> going forwards, if we aren't already.
>
> — Greg, 2026-10-03

The rule is in [AGENTS.md § Writing code](../../AGENTS.md) ("Store when it happened"). This plan is
the audit of what the schema stores today, the additive columns that close the gaps, and a test that
stops a new table arriving without a time. **No display anywhere** — that is case by case.

## The audit

44 tables, enumerated from the exported Postgres tables in `schema.ts` using drizzle's
`getTableConfig`, and the write sites read in `src/store/`. "Has a time" means a column that says when the row's event happened,
whatever it is called.

### Already fine

| Table | The time it has |
|---|---|
| `articles` | `created_at`; `archived_at`, `last_opened_at`, `public_at`, `high_power_since` each time their own event |
| `article_visibility_changes` | `at` — a full history |
| `article_tags` | `created_at` |
| `article_revisions` | `created_at`; each artefact's own time is `revision_step_runs.finished_at` for its step |
| `revision_step_runs` | `started_at`, `finished_at` |
| `comments` | `created_at`; `updated_at` on a body edit or a mark |
| `chat_threads` | `created_at`, `updated_at` |
| `chat_messages` | `created_at` (when asked), `edited_at` |
| `search_runs`, `referee_criteria`, `referee_claims` | `created_at` (when asked) |
| `glossary_lookups`, `citation_investigations` | `at` |
| `citation_finds` | `found_at` |
| `upload_source_guesses` | `claimed_at`, `finished_at` |
| `shelf_topic_scores`, `revision_phrase_runs` | `computed_at` |
| `feedback`, `feedback_shipped_emails` | `created_at` (+ `updated_at`, mirror times) |
| `jobs`, `ai_calls`, `uploads`, `ingest_events`, `realtime_sessions`, `checkpoints`, `raw_sources`, `link_previews`, `rate_limit_events`, `queue_state`, `block_identities`, `reader_arrivals`, `billing_*` (bar prices) | each has its own |

### Not an action, so exempt

`billing_tier_prices` (a price list), `revision_blocks` (part of a revision, which is timed),
`bibliographic_records` / `_services` / `_service_slots` (a fetch cache and its leases; `fetched_at`
is there).

### Gaps

| # | Table | What has no time | Fix |
|---|---|---|---|
| G1 | `glossary_hidden_entries` | the reader hiding an entry — no time column at all | `created_at` |
| G2 | `reader_profiles` | when the row was first written (`updated_at` only) | `created_at` |
| G3 | `glossary_lookups` | the first lookup: a later "Dig deeper again" re-stamps `at`, so for a reader-added term the moment the reader added it is overwritten | `created_at` |
| G4 | `citation_finds` | the first find: a re-find replaces the row and `found_at` | `created_at` |
| G5 | `citation_investigations` | the same, for `at` | `created_at` |
| G6 | `articles` | a reader's rename (`title_override`) or `purpose` edit; un-archiving nulls `archived_at` and switching High-powered AI off nulls `high_power_since`, and neither keeps anything | `updated_at` |
| G7 | `comments` | when the model's answer landed (`patch`), or was swept | `finished_at` |
| G8 | `comments` | a recolour — deliberately not `updated_at`, which means "the words were edited" | `colour_at` |
| G9 | `chat_messages` | when the reply finished; `attempt_started_at` is nulled at finish | `finished_at` |
| G10 | `chat_threads` | a reader's rename — deliberately not `updated_at`, which the panel sorts by | `renamed_at` |
| G11 | `search_runs` | when the hits landed | `finished_at` |
| G12 | `referee_criteria` | when the results landed | `finished_at` |
| G13 | `referee_claims` | when the claims landed | `finished_at` |
| G14 | `search_runs`, `referee_criteria` | a recolour (Sol F1) | `colour_at` on each |
| G15 | `jobs` | the reader pressing Stop: `requestCancel` sets `cancelling`, and the later settlement time is not when they pressed (Sol F2) | `cancel_requested_at` |
| G16 | `link_summaries` | when the model's answer landed: `created_at` is the claim (Sol F3) | `finished_at` |

### Deliberately not changed, and why

- **`reading_time` — not added; a question for Greg.** The row is a running total with no time, on
  purpose: the public privacy page promises *"the totals, not a history"*
  ([privacy.md § Reading time](../project/privacy.md#reading-time)), and the schema comment says the
  same. A `created_at`/`updated_at` per passage is "when you first and last read each passage" —
  the start of exactly the history the page says we do not keep. Adding it changes a published
  promise, which is a product call, so the table is exempted in the test with that reason and the
  question goes to Greg.
- **Hard deletes record nothing** — un-hiding a glossary entry, removing a tag, deleting a comment
  or a thread, `deleteGlossary`. Timing a deletion needs a tombstone or a log, which is new
  machinery and (for a comment) keeps something the reader asked to remove. Not built; reported.
- **`reader_profiles.updated_at` is one clock for two fields**, and switching experimental features
  off nulls `experimental_since`. Not split: the next setting is the point at which
  [the schema comment](../../src/db/schema.ts) already says to revisit the shape.
- **`upload_source_guesses.release` replaces `claimed_at` with the epoch** to make the searching row
  reclaimable; `finished_at` normally remains null. The epoch is a queue sentinel, never an event
  time. Left.
- **`referee_claims.created_at` is re-stamped on each run**, so it is that run's start. Left; the
  previous run's claims are overwritten with it, so there is nothing for an older time to describe.

### JSON blobs: items that are separate events

Columns over JSON ([sql.md](../project/sql.md)) — so where an item needs a time the long-term answer
is a row, not a field. What is there today:

| Blob | Items that are separate events? | Matters? |
|---|---|---|
| `article_revisions.quotes` | yes — *Find more* appends | **already handled**: `Quote.addedAt`, 2026-10-03 |
| `article_revisions.glossary` | yes — *Find more terms* appends in a later model call, and `GlossaryEntry` has no time; `generatedAt` is re-stamped each pass | **yes** — stage 3 gives it `addedAt`, copying quotes |
| `jobs.steps` | yes, and each carries `startedAt` / `finishedAt` | handled (a retried step keeps only its last start) |
| `article_revisions.assets` | failed items carry `at`; successful items have no per-item time and are covered by the manifest's `fetchedAt` and the assets step's completion time | handled |
| `chat_messages.tools` | tool runs inside one reply; a duration, no clock | no — one model turn, timed by the message |
| `article_revisions.labels` (`batches`), `simple_summary.check`, `debate.synthesis` | separate model calls inside one step | no — the step run is timed, and `ai_calls` has each call |
| every other blob (`results`, `claims`, `hits`, `citations`, `sources`, `scores`, `diagnostics`, `tree`, `ideas`, …) | no — written whole by one run | no |

Quiz answers are not stored at all (the mark route is stateless), so there is nothing to time.

## The design

**Every new column is nullable, and no existing row gets a time.** `null` means "before we kept
this". That rules out the obvious DDL: `ADD COLUMN created_at timestamptz DEFAULT now()` writes the
migration's own time into every existing row, which is an invented time. So each `created_at` is two
statements —

```sql
ALTER TABLE … ADD COLUMN "created_at" timestamp with time zone;
ALTER TABLE … ALTER COLUMN "created_at" SET DEFAULT now();
```

— the generated migration hand-edited into that form, with the snapshot (nullable, default `now()`)
unchanged. New rows get the time from the database, so G1–G5 need **no store change**: every writer
is covered, including the next one. Their upserts do not name the column, so it keeps the first time.

The event columns (G6–G13) have no default; the store writes them:

- `articles.updated_at` — the latest reader change to title, purpose, archive state or High-powered
  AI. Written in `pg-shelf.ts` § `patch` and on actual High-powered AI transitions in
  `pg-high-power.ts` and `pg-billing` § `switchOnHighPower`; `high_power_since` keeps its meaning.
  Not opens or visibility: each has its own.
- `comments.finished_at` — `now()` in `patch` when the status leaves `pending`, and in
  `sweepPending`; `null` again in `beginAnswer` (a new attempt has not finished).
- `comments.colour_at`, `search_runs.colour_at`, `referee_criteria.colour_at` — `now()` beside
  `colour` in each recolour, including when a colour is cleared; creation and completion clocks are
  untouched.
- `jobs.cancel_requested_at` — the latest accepted Stop, in `requestCancel`, on both the
  immediate-cancellation and the live-claimant branch. A past request, not the attempt's end.
- `link_summaries.finished_at` — in the fenced `fill`; `null` on a claim or reclaim. A losing
  claimant changes neither the answer nor this.
- `chat_messages.finished_at` — in `finish` and the sweep; `null` in `retry`; `appendSpoken` rows
  are born finished and take their `at`.
- `chat_threads.renamed_at` — in `rename`.
- `search_runs` / `referee_criteria` / `referee_claims` `.finished_at` — in `finish` and the sweep;
  `null` on a reset, revise or re-run.

**No display or ordinary API change.** Domain types need not gain these fields. The reader's ZIP
export automatically includes the new columns through its existing whole-row projection
(`src/store/export-bundle.ts`); that behaviour and the column-coverage tests are kept. The legacy
`db:export` remains deliberately lossy and does not gain them. Exporting stored data is separate
from displaying it.

**A finish that loses its fence stamps nothing.** Every `finished_at` is written inside the existing
attempt-fenced update, and each has a test that a rejected stale finish leaves the time alone.

**The drift guard learns about nullable defaults** (Sol F5). `src/db/schema-drift.ts` reports a lost
default only on a `not null` column, and all five `created_at` columns are nullable — so a lost
default would silently stop the times being kept with every check green. Stage 1 extends it.

**The simpler option passed over:** one `updated_at` on every table, bumped by every write. It is
fewer names, but it says only "something changed, most recently", which is what `comments.updated_at`
and `chat_threads.updated_at` were already carefully *not* allowed to mean.

## Stages

1. **`created_at` on five tables, the test, and the drift guard.** One migration (G1–G5).
   `tests/action-tables-have-created-at.test.ts`: every table in `schema.ts` either has a
   `created_at` column or is named in a map with the existing timestamp column that plays that part
   (checked to exist and be a timestamp) or the reason it needs none; a stale entry fails, and the
   rule is shown red on an injected table with no time. `schema-drift.ts` reports a missing default
   on a nullable column too, with an offline regression test. Postgres tests: a row that predates
   the column stays null, a new insert gets a time, an upsert keeps the first time or its absence.
2. **The event columns** (G6–G16). One migration. Store writes as above, each with a Postgres test
   that was red first, including the stale-finish case.
3. **`GlossaryEntry.addedAt`** — no migration. New entries are stamped once, with the same
   completion time as the pass's `generatedAt`. An incumbent's `addedAt`, including its absence, is
   kept through deduplication whichever name or prose wins, and carried beside ids through rewrite
   inheritance. Tests: ordinary append, name/alias collisions, richer-name merges, and
   prompt/profile rewrites keeping an old id, with timed and untimed incumbents.

Each stage: commit, GPT Sol code review (write-capable, in this worktree), gates, commit.

## The plan review

GPT Sol, 2026-10-03, verdict REFUSE on F1 and F2; all seven accepted, none overruled.

| ID | Finding | Disposition |
|---|---|---|
| F1 | search and referee recolours are untimed | G14 |
| F2 | High-powered AI off, and Stop on a job, are untimed | G6 widened; G15 |
| F3 | `link_summaries` has no completion time | G16 |
| F4 | "no export file changes" is false — the ZIP projects whole rows | wording replaced |
| F5 | the drift guard cannot see a lost default on a nullable column | stage 1 |
| F6 | stage 3 needs merge and rewrite rules | stage 3 rewritten |
| F7 | 44 tables not 47; the assets and `release` rows were inaccurate | corrected |

## What landed

(to be filled in per stage)
