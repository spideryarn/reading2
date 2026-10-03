I would refuse this version because F1 and F2 establish reader actions that remain untimed, contrary to **AGENTS.md’s “Store when it happened” rule**. The additive migration design itself is sound.

No files changed. I ran schema introspection and two offline probes; I could not run Postgres checks.

**F1 — P1, established: search and referee recolours are missed.**

[pg-searches.ts:492](/home/greg/code/spideryarn2/.claude/worktrees/store-when-it-happened/src/store/pg-searches.ts:492) and [pg-referee-criteria.ts:372](/home/greg/code/spideryarn2/.claude/worktrees/store-when-it-happened/src/store/pg-referee-criteria.ts:372) both expose reader recolour actions. Their updates set only `colour`. Neither `created_at` nor the proposed `finished_at` records a later recolour. G8 fixes this for comments alone.

Add this exact wording to the gaps and stage 2:

> `search_runs` and `referee_criteria` also need nullable `colour_at`, with no default. Their `recolour` methods write it alongside `colour`, including when clearing a colour. Preserve their existing creation and completion clocks. Test recolouring both pending and finished rows.

**F2 — P1, established: two other reader actions are wrongly treated as timed.**

Turning High-powered AI off sets `high_power_since` to null in [pg-high-power.ts:48](/home/greg/code/spideryarn2/.claude/worktrees/store-when-it-happened/src/store/pg-high-power.ts:48). The plan explicitly excludes this writer from `articles.updated_at`, leaving no time for that action.

Likewise, Stop on a live job sets `cancelling` while leaving `finished_at` unchanged in [pg-jobs.ts:2024](/home/greg/code/spideryarn2/.claude/worktrees/store-when-it-happened/src/store/pg-jobs.ts:2024). A later settlement time does not record when the reader pressed Stop. Both contradict the stated reader-action rule.

Replace G6’s write-site restriction with:

> `articles.updated_at` records the latest reader change to title, purpose, archive state or High-powered AI. Write it in `pg-shelf.patch` and on actual High-powered AI transitions in `pg-high-power.ts` and `pg-billing.switchOnHighPower`. Preserve the existing `high_power_since` semantics.

Add:

> Add nullable `jobs.cancel_requested_at`, with no default, recording the latest accepted Stop request in `requestCancel`, on both the immediate-cancellation and live-claimant branches. It describes a past reader request, not the current attempt’s completion. Test both branches.

**F3 — P2, established: `link_summaries` lacks the completion time that motivates G7–G13.**

[pg-link-summaries.ts:255](/home/greg/code/spideryarn2/.claude/worktrees/store-when-it-happened/src/store/pg-link-summaries.ts:255) stamps `created_at` when claiming work. [Its `fill` method](/home/greg/code/spideryarn2/.claude/worktrees/store-when-it-happened/src/store/pg-link-summaries.ts:263) writes the model’s answer without moving that clock. Calling this table “already fine” applies a weaker lifecycle standard than the plan applies to chat, search and referee output.

Add:

> `link_summaries.created_at` records the current generation’s claim, not when its answer landed. Add nullable `finished_at`, with no default; clear it when claiming or reclaiming, and stamp it in the existing fenced `fill` update. A losing claimant must change neither the answer nor its completion time.

**F4 — P2, established: “no export file changes” is false.**

[export-bundle.ts:163](/home/greg/code/spideryarn2/.claude/worktrees/store-when-it-happened/src/store/export-bundle.ts:163) serialises database rows directly. New columns therefore reach the reader’s ZIP regardless of domain types. `ARTICLE_TABLE_COVERAGE` and the column-coverage test intentionally support this behaviour.

The legacy `db:export` is a separate, deliberately lossy rollback format. Leaving timestamps out of that format is consistent with its existing contract; suppressing them from the reader’s ZIP would contradict its fidelity contract.

Replace the **Not surfaced** paragraph with:

> **No display or ordinary API change.** Domain types need not gain these fields. The reader’s ZIP export automatically includes the new columns through its existing whole-row projection; preserve that behaviour and the column-coverage tests. The legacy `db:export` remains deliberately lossy and does not gain these fields. Exporting stored data is separate from displaying it.

**F5 — P2, established: the default-dependent design falls outside the current drift alarm.**

[src/db/schema-drift.ts:232](/home/greg/code/spideryarn2/.claude/worktrees/store-when-it-happened/src/db/schema-drift.ts:232) reports a lost default only when the declared column is non-null. All five proposed `created_at` columns are nullable.

I exercised `compareSchema` with a nullable, defaulted declaration and an actual column lacking its default: it returned `defaultLost: []` and no warnings. Consequently, a lost default silently stops timestamp collection, while both schema drift and the proposed column-existence test stay green.

Add to stage 1:

> Extend the drift guard to report missing database defaults on nullable columns as well as non-null columns, retaining the generated/identity exceptions. Add an offline regression test for nullable `created_at`; update the warning to explain that omitted values can become null. Add migration tests proving that pre-existing rows remain null, new inserts receive a time, and upserts preserve the original time or its absence.

**F6 — P2, reasoned, with an established destructive mapping: stage 3 needs merge and rewrite rules.**

[Glossary `merge`](/home/greg/code/spideryarn2/.claude/worktrees/store-when-it-happened/src/glossary.ts:562) constructs its result field by field. An offline probe supplied two entries carrying `addedAt`; `dedupe` returned a merged entry without it.

Furthermore, `idsByTerm` carries only IDs through prompt/profile rewrites. “Copying quotes” and testing an ordinary append do not specify how these paths preserve the incumbent’s time—or its deliberate absence.

Replace stage 3’s completion criterion with:

> Stamp genuinely new entries once, using the same completion time as the pass’s `generatedAt`. Preserve the incumbent’s `addedAt`, including absence, through deduplication regardless of which name or prose wins. Carry timestamps and their absence alongside IDs through rewrite inheritance. Test ordinary append, name/alias collisions, richer-name merges, and prompt/profile rewrites retaining an old ID, with both timed and untimed incumbents.

This stage fits the requested JSON-item audit; it is not inherently scope creep.

**F7 — P3, established: three audit statements are inaccurate.**

The independent `getTableConfig` walk returns **44 tables**, corroborated by 44 table declarations.

Replace:

> 44 tables, enumerated from the exported Postgres tables in `schema.ts` using drizzle’s `getTableConfig`.

The assets claim is also inaccurate: stored `AssetEntry` and `PdfFigureEntry` variants have no item timestamp; `fetchedAt` belongs to the containing manifest.

Replace that audit row’s explanation with:

> Failed items carry `at`; successful items have no per-item time and are covered by the manifest’s `fetchedAt` and the assets step’s completion time.

Finally, source-guess `release` operates on a `searching` row, whose `finished_at` is normally null. “`finished_at` still stands” incorrectly suggests that a real completion time survives.

Replace that bullet with:

> `upload_source_guesses.release` replaces `claimed_at` with the epoch to make the searching row reclaimable; `finished_at` normally remains null. Treat the epoch as a queue sentinel, never an event time.

The remaining core choices hold up: adding the column without a default and then setting its default leaves existing rows null; the final nullable/defaulted snapshot remains consistent. Hand-edit the newly generated SQL **before any application**—the ledger guards subsequently enforce its hash. G1–G5’s existing upserts omit `created_at`, so they preserve the first time or legacy null.

The proposed schema-wide test is not inherently tautological. Its implementation should enumerate actual tables, validate alternative timestamp columns, and demonstrate failure on an injected new table without a timestamp. It cannot establish that every mutation writes its clock; the store tests must do that.

Keeping `reading_time` exempt is supported by the explicit schema policy and published privacy wording. The proposed completion/reset paths otherwise match the stores; preserve their attempt fences and test that a rejected stale finish cannot change the new timestamp.

REFUSE