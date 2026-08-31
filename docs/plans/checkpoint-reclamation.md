# What reclaims a checkpoint under Postgres

**Status:** research, read-only. Written to settle the one thing blocking
[finish-the-database-move.md § Stage 2](finish-the-database-move.md) and
[delete-the-importer.md § D2 scoped](delete-the-importer.md).

**The short answer: the reclamation path is already built, already tested, and has been in the repo
since 2026-08-29.** The blocker rests on a factual error about `scripts/checkpoints-sweep.ts`. And
the crash-safety argument against deleting `clearCheckpoint` is aimed at the wrong ordering — the
property GPT Sol raised on 2026-08-26 is real, but `clearCheckpoint` is not what provides it.

Nothing here needs new code beyond the D2 deletions that were already planned.

## 1. The facts, checked

| claim | verdict | where |
|---|---|---|
| `src/store/checkpoints.ts` has no `delete` | **true** | line 122, § *And there is no `delete`* |
| …and the stated reason is the unit of deletion | **true, and it is not crash-safety** | see below |
| Nothing calls the store yet | **true** | `checkpoints.ts:11`; no import of it outside tests and the sweep script |
| The real checkpoints bypass it | **true** | `labels-progress.json` (`src/labels.ts:877`), `pdf-chunks/` (`src/pdf-read.ts`) |
| `scripts/checkpoints-sweep.ts` is a filesystem answer that does not carry over | **FALSE** | the script branches on `STORE` at line 62 and calls `sweepPgCheckpoints` |
| `clearCheckpoint` is at `src/toc.ts:1285` | **stale** — it is at **`src/toc.ts:1384`**, and `src/labels.ts:2544` (impl at `:2411`) | re-derived 2026-08-31 |
| The call is the last step of an ordered write sequence | **true** | `src/toc.ts:1370-1384` |
| That ordering is load-bearing for crash-safety | **true of the ordering, false of `clearCheckpoint`** | § 3 |

### The stated reason for having no `delete`

Not crash-safety, and not retention. Quoting `checkpoints.ts:122`:

> **And there is no `delete`.** `labels.ts` today mints a random `runId`, stamps every write with it,
> and has `clearCheckpoint` refuse to delete a file that is not its own. That machinery exists because
> the unit of deletion — a file holding every batch — was larger than the unit of work. One row per
> entry removes the hazard rather than guarding it, so D drops the `runId` with the file. Cleanup is
> `sweepCheckpoints` below; see § Retention there.

So the file already names its own reclamation path. The plan asks a question its dependency answered.

### The error in the plan

`delete-the-importer.md` § *D2 scoped* says the sweep *"sweeps the `data/` root directly, so it is a
filesystem answer that does not carry over"*. That describes only the `else` branch:

```ts
if (STORE === "postgres") {
  const { sweepPgCheckpoints } = await import("../src/store/checkpoints-pg.js");
  ...
}
const root = path.resolve(import.meta.dirname, "..", "data");
```

— [`scripts/checkpoints-sweep.ts:62-75`](../../scripts/checkpoints-sweep.ts). The script's own
docstring says why it reads the store flag rather than taking a flag of its own: *"Sweeping the store
nobody is reading would report a number that is true about a directory nothing writes to any more."*

## 2. What reclaims checkpoints under Postgres

**Two mechanisms, both built.**

- **`sweepPgCheckpoints`** ([`src/store/checkpoints-pg.ts:151`](../../src/store/checkpoints-pg.ts))
  — one `delete … where last_used_at < before`, dry-run by default, reporting `pg_column_size` so
  the number it prints is the number it would reclaim. Backed by the
  `checkpoints_last_used_at` index. Cutoff `CHECKPOINT_RETENTION_DAYS = 90`.
- **`on delete cascade` from `articles`** (`drizzle/0028_foamy_cassandra_nova.sql`) — the only
  removal with a deadline, and it is automatic.

Tested in `tests/store-checkpoints.test.ts`, including the two mutations that matter: a sweep whose
`where` uses `created_at` instead of `last_used_at`, and a `dryRun` that defaults to `false`
(`tests/store-checkpoints.test.ts:602-608`, `:934`).

### The options, weighed

| option | cost | what it breaks | preserves the ordering |
|---|---|---|---|
| **(a) the sweep + the cascade — already built** | **zero** | nothing | yes, because there is nothing to order: the sweep never runs inside a stage |
| (b) a TTL / `expires_at` column | a migration, and a column duplicating `last_used_at` | nothing, but **it reclaims nothing on its own** — Postgres has no row expiry, so something still has to run the delete. It buys a second copy of a fact to disagree with the first | yes |
| (c) reclamation keyed to the revision or job | a column, a cascade | **fatal.** It is the revision key `checkpoints-pg.ts:18` forbids by name: the entry would die with the attempt that wrote it, which is precisely the work a checkpoint exists to preserve. Written on every run, read on none | n/a |
| (d) last-write-wins bounds them | free, already true | **it bounds nothing.** Last-write-wins bounds rows *per key*, and a key is a content address over inputs that change. Every re-run with a moved outline mints a fresh key set and orphans the old one | n/a |
| (e) the store gains a scoped `delete` | one method, two adapters, plus the D2 deletions it was meant to enable | reopens the hazard `checkpoints.ts:122` closed. And if the call lands before the commit it is **strictly worse than today** — § 3 | only if placed after commit |
| (f) schedule the sweep (`pg_cron`, a Vercel cron, a deploy hook) | small ops work | nothing | yes |

**(a) is the answer, with (f) available the day the number justifies it.** § 4 says it does not yet.

## 3. The ordering property, tested rather than confirmed

Greg's hypothesis was that a single transaction makes the ordering moot. **Half right, and the half
that is wrong is the more useful half.** Two orderings are being conflated.

### Ordering A — `labels` → `blocks` → `tree`, tree last

`src/toc.ts:1352-1381`. This is the property Sol raised on 2026-08-26 and it is genuinely
load-bearing today, for a reason stated in the code: `src/pipeline.ts` decides a step is done by
**whether its output files exist**, and `writeFile` truncates its target before it has anything to
put there. Hence `writeAtomic` (rename) *plus* tree last.

**Under one transaction this becomes moot, and the hypothesis is confirmed.** Stage 2/3 has `toc`
return `{ labels, blocks, tree }` as one `ArtifactParts` map, written by
`writeArtefacts(ref, tx, slug, step, parts, stamp)`
([`src/store/artifacts-pg.ts:1185`, `:1411`](../../src/store/artifacts-pg.ts)) inside the
coordinator's transaction. There is no window in which two of the three are visible without the
third, and no "the file exists so the step is done" heuristic left to fool. Both halves of ordering
A's justification disappear.

### Ordering B — `clearCheckpoint` after all three

**This is not a crash-safety property and never was**, which is why it does not dissolve with
ordering A. `src/labels.ts:1527-1537` says so in its own words:

> The gap is the whole point. If `generateLabels` deleted the checkpoint itself, a caller that
> crashed between here and writing `labels.json` would have lost every batch it had just paid for,
> which is the case the checkpoint exists for. A no-op when no `dir` was given, and **harmless to
> forget: a checkpoint left behind is read by the next run, matched fingerprint by fingerprint, and
> either reused correctly or ignored.**

So the position of the delete protects **money**, not consistency. Losing the checkpoint early costs
a re-bought label run; keeping it too long costs a few kilobytes of `jsonb`. The two failure modes
are not comparable, and the asymmetry points one way.

**And a transaction makes ordering B harder, not easier**, because the checkpoint store is
deliberately *outside* the transaction (`getDb()`, no `tx` — `checkpoints-pg.ts:11-16`). So a delete
inside a stage has exactly two placements:

- **before commit** — the checkpoint is gone while the transaction can still roll back. The window
  the gap exists to close is now *wider* than on the filesystem, because a transaction can fail for
  reasons a `rename` cannot. Strictly worse than today.
- **after commit** — correct, but it is a second non-transactional statement that can itself fail,
  leaving the row behind. Which, by the paragraph above, is harmless.

**Both branches end at "a leftover row is fine".** That is the argument for having no `delete`,
arrived at from the call site rather than from the store.

### The one thing that genuinely changes, and it is Greg's call

Today a **successful** `toc` run clears the checkpoint, so the next run starts cold. With no delete,
entries live 90 days and a later run with identical inputs is served from them.

- **Correctness: unaffected.** Everything the model saw is in `batchFingerprint` — `version`,
  `generator`, `EFFORT`, `SYSTEM`, the batch's blocks plus one neighbour either side, the block ids,
  the sibling grouping, and the whole-tree outline every batch shares. A changed question is a
  changed key. `delete-the-importer.md` § *D2 scoped* already argued this when it retired the
  `sourceHash` gate.
- **Cost: a saving.**
- **The loss: a forced re-run stops buying a fresh roll of the dice** from a nondeterministic model
  when the labels came back valid but poor. Mostly mitigated by accident — `toc` re-runs the
  structure call first, and the outline is an input to *every* batch fingerprint, so any drift in the
  outline invalidates all of them. But if the structure call returns an identical outline, the labels
  come back identical from cache.

Worth saying that **force is already non-uniform today**: a failed run leaves its checkpoint, so a
forced retry already reuses it; only a successful run's force re-buys. No-delete makes the rule
uniform — *reuse whenever the question is identical* — which is the rule the store is built on. If
Greg wants an escape hatch, the honest one is a flag that skips the checkpoint **read**, not one that
deletes rows.

## 4. How much this matters — measured, 2026-08-31, against `data/`

| | measured |
|---|---|
| `pdf-chunks/` across the corpus | **18 files, 302,942 bytes**, 6 articles |
| one PDF chunk | 7,241 – 22,199 bytes; mean **16.8 KB** |
| worst article (`ball-lightning`) | 5 chunks, **94,420 bytes**; `MAX_PAGES = 100` bounds it |
| `labels-progress.json` surviving on disk | **one file**, 14,824 bytes, 2 batches (6,489 + 5,719) |
| one label batch entry | **≈ 6 KB** |
| a full label set (proxy: `labels.json`, 13 files) | 176,868 bytes total, largest **47,831** (`constitution`) |
| the whole corpus, had nothing ever been reclaimed | **under 500 KB** |

That there is exactly **one** `labels-progress.json` across 33 directories is itself the measurement
that `clearCheckpoint` works — and the measurement that nothing else has ever needed it to.

**The growth model is not per-article, it is per distinct question set.** Each re-run whose inputs
moved mints a new key set and orphans the old one: ≈5–50 KB for a dead label set, ≈15–100 KB for a
dead PDF read.

- 100 articles × 3 re-runs ≈ **15 MB**
- 1,000 articles × 3 re-runs ≈ **150 MB**

And there is a floor under the rate, which `checkpoints.ts` § Retention states and which checks out:
**every row costs a paid model call to create, so the table cannot grow faster than the bill.**
150 MB of checkpoints is thousands of dollars of model spend. This is kilobytes-for-ever, not
megabytes-per-ingest — a housekeeping question, not a design question.

## 5. Recommendation

**Build:** nothing.

**Delete, as D2 already planned, in `src/labels.ts`:** `serialise()`, the accumulated `kept[]` array,
`runId` in all four places, `clearCheckpoint`'s type and implementation, and the map-level half of
`usableCheckpoint` (the per-entry shape validation stays — it is the caller-side gate the store
delegates to). `src/toc.ts:1384` and `src/labels.ts:2544` go with it.

**Leave alone:**

- The tree-last write ordering, until stage 2 actually puts the three artefacts in one `parts` map.
  It stops being needed at that moment and not before — deleting it earlier removes a live guard.
- `CheckpointStore`. No `delete`, no TTL column, no revision key.
- The sweep. Unscheduled is the right state at 300 KB.

**Correct in the plans, in the same commit:**

- `delete-the-importer.md` § *D2 scoped* — the sweep does carry over; fix the stale line numbers to
  `src/toc.ts:1384` / `src/labels.ts:2544`, or better, stop quoting line numbers for this call.
- `finish-the-database-move.md` § Stage 2 — replace *"Unresolved, settle before building"* with the
  answer and a pointer here.

**Say out loud in D2's commit message**, because it is the one behaviour change: a successful `toc`
run no longer clears its label checkpoint, so a forced re-run with an unchanged outline reuses the
labels instead of re-buying them.

**Watch, and it is one number:** if `select count(*), pg_size_pretty(sum(pg_column_size(value)))
from spideryarn.checkpoints` ever passes ~100 MB, schedule the sweep. Until then it is a command in
a docstring.

### Where this is uncertain

- **The reroll question is Greg's, not ours.** Everything above says reuse is correct; whether he
  wants `--force` to mean *re-buy regardless* is a product decision. If yes, the right shape is a
  read-skip flag, not a delete.
- **Ordering A's dissolution is argued from the code, not observed.** Stage 2 is unbuilt, so the
  claim that `toc` will return one `parts` map rests on `sketch` being the worked example and on
  `writeArtefacts`' signature. If stage 2 ends up writing `toc`'s three artefacts through more than
  one transaction, ordering A comes straight back and this section needs re-reading.
- **The 90-day constant is a judgement, and it is one nobody has tested against a real reader
  returning to an article.** It is one constant and changing it costs nothing.
