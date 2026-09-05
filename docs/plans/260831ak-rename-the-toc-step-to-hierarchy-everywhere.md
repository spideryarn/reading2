# Rename the `toc` step to `hierarchy`, everywhere

**Status, 2026-09-01 (small hours): DONE locally. All three stages are built, committed, and
`drizzle/0041` is applied to the local database.** Production is untouched and the rollout is
undecided — see § *What is left*. Commits: `569458f` (A+B), `265356b` (C).

**The first run of the migration proved nothing, and that is worth reading before trusting it.** The
local corpus had been reset to zero before it applied, so every `UPDATE` matched no rows and both
CHECKs re-added against an empty set — the same false negative as `db:migrate`'s tick. The evidence
that it works is separate and deliberate: § *Verification*.

[GPT Sol's review](260831ak-rename-the-toc-step-to-hierarchy-everywhere-review-sol.md) found that the
migration as first planned *"would currently break queued or running jobs, silently fail to migrate
their JSON, and silently skip two locally interrupted filesystem hierarchy runs."* All ten findings
were addressed; see § *What the review changed*.

## What is left

1. **The production rollout, which is Greg's call and is not a rename.** Migrations run before code
   ships ([`scripts/deploy.ts`](../../scripts/deploy.ts):869,898), so there is a window where old
   workers meet the new constraint. Either a maintenance window or expand/migrate/contract across two
   deploys. **The identical problem exists for [260831b](260831b-finish-the-database-move.md)'s stage
   4 (`raw_bytes`), and Greg has already ruled two deploys for that one** — so the precedent exists
   and probably just needs applying here.
2. **`0041`'s drain guard makes the window mandatory rather than remembered.** It aborts if any
   queued or running job still holds a `toc` step, because `jobs.work_key` cannot be recomputed in
   SQL and a stale one lets a re-submitted URL become two articles.
3. Nothing else. The code, the docs, the filesystem and the local database are consistent.

## A correction to `265356b`'s commit message

It says `drizzle/0042`/`0043` belong to the session that owns the migration path. **They do not** —
they are `referee_criteria` and its owner FK, from
[260831an](260831an-referee-mode-for-peer-reviewers.md), a fourth session. That session generated no
migration tonight and had said it would announce first. The commit is otherwise accurate; recorded
here because the message cannot be edited and the next person reconstructing who applied what would
believe it.

## The job

The reading-view mode was renamed `toc` → `hierarchy` on 2026-08-29
([260829f](260829f-defer-arc-and-rename-hierarchy.md)), and the pipeline step deliberately kept the
old name. Greg, 2026-08-31, has now reversed that half:

> I'm leaning towards being comprehensive about the rename including DB schema and variables, because
> my hunch is that life is simpler and less error-prone if everything (i.e. both UI and code and
> database) harmonise. It might break things briefly, but we can run a migration, and we're in Alpha
> so we don't have any real users, so now is the time to harmonise!

**One word, one meaning, in the UI, the code and the database.** He chose the widest scope on offer —
npm scripts and eval directories included — and chose to run the migration now rather than wait.

## What this reverses, and why that is allowed

[`src/modes.ts`](../../src/modes.ts) records the old decision: *"The step keeps the name; the mode
gives it up."* That was the right call when renaming the step meant a migration for no benefit. Greg's
argument is that the benefit is real — two names for one concept is a standing tax on every reader of
this repo — and the cost is at its historic minimum, because there are no real users and the corpus is
small. **Write the new reasoning into `modes.ts` rather than deleting the old**: the next agent will
find the 2026-08-29 comment and needs to know it was superseded on purpose.

## The concern that was raised and overruled, recorded so it is not re-litigated

Renaming was argued against on three grounds, all still true and all accepted as costs:

1. `"toc"` is a **persisted value** in the `revision_step_runs_step` CHECK
   ([`src/db/schema.ts`](../../src/db/schema.ts):1412) — so this is a data migration, not a rename.
2. It **collides with [260831b](260831b-finish-the-database-move.md)**, whose agent owns `schema.ts`
   and migrations and is mid-flight; their stage 2.4 has just repaired a `db:migrate` that was
   silently applying nothing, and its guard is still owed.
3. In prose, "ToC" usually means the *artefact* — *"losing its whole ToC to a gap"* is about a tree.
   Those must **not** become "Hierarchy", or the sentences become wrong.

Greg took 1 and 2 explicitly, with the collision and the broken-migrator spelled out in the question.
**3 is not overruled** — it is a matter of reading each hit, and the docs stage below does that.

## Scope, decided

| Layer | From | To |
|---|---|---|
| Step name (code + DB) | `"toc"` | `"hierarchy"` |
| Files | `src/toc.ts`, `src/toc-flatten.ts` | `src/hierarchy.ts`, `src/hierarchy-flatten.ts` |
| Types / functions | `generateToc`, `TocRun`, `TocArtefacts`, `estimateTocTokens`, `TocRow` | `generateHierarchy`, `HierarchyRun`, … |
| npm scripts | `toc`, `toc:flatten`, `eval:toc`, `eval:toc-structure` | `hierarchy`, `hierarchy:flatten`, … |
| Evals | `evals/toc-structure/`, `evals/toc-labels.ts`, `evals/results/toc-structure/` | `hierarchy-*` |
| Tests | `tests/toc-*.test.ts` (7 files) | `tests/hierarchy-*.test.ts` |
| Docs | `docs/project/table-of-contents.md` | `docs/project/hierarchy.md` |

**Not renamed**, deliberately: the `tree` artefact and `tree.json` (already the right word); the
`labels` artefact; prose where "table of contents" means the artefact or the general concept; Greg's
quoted words; `docs/plans/` and `docs/postmortems/` entries, which are records of what was true then.

## Stages

Each ends green and committable.

**Stage A — docs.** The mode-vs-step distinction, read hit by hit. Includes the five rule-doc
sentences Greg approved (`AGENTS.md` ×2 — `CLAUDE.md` is a symlink to it — `README.md`,
`architecture.md`, `vision.md`, `granularity-zoom.md`). Rename `table-of-contents.md` → `hierarchy.md`
and fix all ~30 inbound links; `tests/doc-links.test.ts` is the gate.

**Stage B — code, no schema.** File renames via `git mv`, identifiers, npm scripts, eval dirs, test
files. Entirely compiler-checked: `StepName` is one union
([`src/types.ts`](../../src/types.ts):1849), so `npm run typecheck` finds every consumer.
**The literal `"toc"` step value is left alone in this stage** so the code still matches the database.

**Stage C — the step name and the migration.** `StepName` `"toc"` → `"hierarchy"`, the CHECK
constraint, and a migration that does both in the right order. This is the only irreversible stage.

### The migration, written out because the ordering is the trap

`schema.ts`:1390's own comment records it: **Postgres validates a re-added CHECK against the rows
already in the table**, so the constraint cannot be narrowed before the data moves. Order:

1. `ALTER TABLE revision_step_runs DROP CONSTRAINT revision_step_runs_step;`
2. `UPDATE revision_step_runs SET step_name = 'hierarchy' WHERE step_name = 'toc';`
3. Re-add the CHECK with `'hierarchy'` in place of `'toc'`.

Any other table storing a step name — `scripts/db-repair-migration-ledger.ts`:229,245 holds a second
copy of the list, and [`src/db/schema.ts`](../../src/db/schema.ts):1550 has another `step_name` — must
move in the same migration. **Find them before writing it, not after.**

### Three more homes for the string, found by probing the live catalogue

The database agent probed the running database rather than reading the schema, and found three places
this plan would have missed. **All three verified here before being written down.** Two of them are
the same trap as the main CHECK, and one is invisible to a `\btoc\b` grep.

**1. `checkpoints_namespace` is a second CHECK, and the word is hyphenated.**
[`src/db/schema.ts`](../../src/db/schema.ts):2219 is `namespace in ('toc-labels','pdf-chunk')`, with
the TypeScript twin at [`src/store/checkpoints.ts`](../../src/store/checkpoints.ts):137,140.
**Decision: rename to `hierarchy-labels`**, with the same UPDATE-before-ADD-CONSTRAINT ordering,
because it carries the identical 23514. **The cost, stated because it is real:** the filesystem
adapter turns this string into a *file name* (the comment at :2220 says so), so renaming **orphans
every existing label checkpoint**. An article mid-labelling loses its resume point and re-buys those
model calls. Acceptable at this size and only just; it is the strongest single argument for doing this
tonight rather than in a month.

**2. `ai_calls.step_name` holds step names with no CHECK over it.**
[`src/db/schema.ts`](../../src/db/schema.ts):1550, nullable text — so the `revision_step_runs` swap
does not touch it and nothing would complain. **Decision: rewrite `'toc'` → `'hierarchy'` here too.**
This is the spend ledger; queries group by step, and leaving it splits the cost history of one stage
across two names with nothing to announce it. The case against — a ledger should record the name the
spend was actually recorded under — loses because this is our own cost analysis, not an audit trail,
and a silently-split series is the worse failure. **What is not acceptable is doing neither**, which
is the state the plan was in an hour ago.

**3. `jobs.steps` is `jsonb`, and locally empty.**
[`src/db/schema.ts`](../../src/db/schema.ts):1133. No CHECK covers it, so a production row holding
`["toc"]` fails nothing and **a green local run proves nothing about it** — the same shape as the
fault that produced tonight's postmortem. **Decision: rewrite the array elements in the migration
anyway**, cheap and idempotent, *and* drain the queue first. Shape:

```sql
UPDATE jobs SET steps = (
  SELECT jsonb_agg(CASE WHEN e = '"toc"'::jsonb THEN '"hierarchy"'::jsonb ELSE e END)
  FROM jsonb_array_elements(steps) e
) WHERE steps @> '["toc"]'::jsonb;
```

**Calibration:** `revision_step_runs` holds **3 rows** with `step_name='toc'` locally, so the UPDATE
has visible work to do. A run that reports success having moved 0 rows is the failure to watch for.

### The generate-collision protocol, agreed

Two sessions ran `drizzle-kit generate` within minutes earlier tonight and produced colliding
`0032`/`0033` indices — two files claiming one index, the journal naming one, the other silently never
running. They may need one more migration for stage 3. **Agreed both ways: announce immediately before
generating, check the journal tail at that moment rather than from memory, and commit promptly
after.**

### What the database agent told us about the migrator, and it changes two things

The session holding `drizzle/` and the migration path (stages 2.4–3 of
[260831b](260831b-finish-the-database-move.md)) sent three warnings unprompted. All three are adopted.

1. **Do not hand-write the SQL or the journal `when`. Generate through drizzle-kit.** This plan was
   going to hand-write the migration. Hand-stamping is exactly what broke the migrator: `0035_timeline`
   carries a round `1788200000000`, later than `0036`, so **`0036` can never run on any database that
   applied `0035` first — probably including production.** `tests/migration-journal.test.ts` now fails
   on any new inversion.
2. **`npm run db:migrate` now refuses rather than silently doing nothing** (`e07a519`). drizzle keeps a
   *watermark*, not a ledger: it reads the newest `__drizzle_migrations` row and applies only entries
   stamped strictly later, which is how four published migrations went missing while the command
   printed its tick. The preflight now exits 1 with no DDL unless applied entries are a contiguous
   prefix in journal order and every applied row's hash matches its file.
   [Postmortem](../postmortems/260831h-db-migrate-applies-nothing-when-a-journal-timestamp-jumps-the-queue.md).
   **Consequence for us: do not edit any existing `.sql`** — `0038_block_contexts` in particular — or
   its hash changes and the preflight correctly refuses.
3. **Why the ordering above is not merely tidy.** *"Postgres validates a re-added CHECK against the
   rows already in the table, so widening it is free and narrowing it is not: if you drop `'toc'` from
   the list while a single `revision_step_runs` row still has `step_name='toc'`, the ADD CONSTRAINT
   fails with a 23514. It passes on a fresh local container with no history and fails on production —
   a delayed fuse and a false negative in one."* `0036_drop_summary_column` is the worked example;
   `0033_quotes` is the counter-example. **A green local migration is therefore not evidence**, which
   is [silent-success.md](../reusable/silent-success.md) wearing a schema.

Ownership was offered back to them — they hold `drizzle/` — and the offer stands if they would rather
land the step rename inside their own stage.

*Local first, and prove it.* Count `'toc'` rows before and after; a migration that reports success
having matched nothing looks identical to one that worked
([silent-success.md](../reusable/silent-success.md)). **Production is a separate decision and a
separate ask** — nothing here authorises it.

## What the review changed — read before touching stage C

[GPT Sol](260831ak-rename-the-toc-step-to-hierarchy-everywhere-review-sol.md), 2026-08-31, `high`.
The three-statement CHECK order was confirmed correct. **Everything around it was not.** Nine findings,
the first two of which would have shipped silent damage.

**1. The rollout is not atomically compatible, and "drain if anything is running" does not cover it.**
The migration runs *before* the new deployment ([`scripts/deploy.ts`](../../scripts/deploy.ts):869,898).
In that window an old worker starting `"toc"` takes a 23514; an old worker *finishing* `"toc"` updates
`WHERE step_name = 'toc'`, matches zero rows now they say `hierarchy`, and throws `StepRunNotHeld`
([`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts):1071). New code deployed first has the
inverse failure. **This needs either a real maintenance window — block new work, stop the workers,
assert zero queued/running jobs across both queues, migrate, deploy, reopen — or an
expand/migrate/contract rollout that accepts both names for a while, which cannot be one commit.**

**2. The `jobs.steps` SQL in this plan matches nothing.** `jobs.steps` is `JobStep[]`, not
`StepName[]` ([`src/db/schema.ts`](../../src/db/schema.ts):1133): elements are `{"name":"toc",…}`, so
`e = '"toc"'::jsonb` and `steps @> '["toc"]'` are both false for every real row. **It would have run,
reported success, and done nothing** — [silent-success.md](../reusable/silent-success.md) again, in the
statement written to guard against exactly that. A correct rewrite reads `element->>'name'`, uses
`jsonb_set`, and aggregates *with ordinality* to keep order. **This finding has been written into
[sql.md § Migrating data inside a JSONB column](../project/sql.md), with the working statement and the
`@>` semantics spelled out**, because the next person writing a jsonb data migration in this repo will
reach for exactly that operator and a plan doc is not where they will look. And `jobs.work_key` hashes the ordered
step names ([`src/jobs.ts`](../../src/jobs.ts):1708) and is compared for dedup
([`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts):161), so rewriting a live job's steps without
recomputing its work key makes one request look like two. Eight filesystem job files locally hold
`name: "toc"`; none has the shape this plan assumed.

**3. Do NOT rename the literals in `scripts/db-repair-migration-ledger.ts`.** This plan said to. They
are `0036`'s historical postcondition, marked *"Verbatim"* at :203. Changing them makes a repair of an
old database either reject ordinary `"toc"` rows or re-add a `hierarchy` CHECK while `toc` rows still
exist — and then stamp `0036`'s hash, **falsely claiming a postcondition the database does not have**.
Historical SQL, snapshots and reconciliation entries keep `"toc"` for ever. Only new state moves.

**4. Filesystem interruption markers go invisible, and the consequence is a silent skip.** The marker
path embeds the step name — `steps/<step>.running`
([`src/store/artifacts-fs.ts`](../../src/store/artifacts-fs.ts):431), read at :637. **There are two
`toc.running` markers locally**, both on articles that have all three outputs. After the rename
`interrupted("hierarchy")` sees no marker, `stepIsDone` sees every output, and — because this step
deliberately has no freshness stamp — **returns true for work explicitly marked interrupted**.

**And the ordering is what makes it silent rather than loud**, spotted independently by the session
holding the bottom bar: `store.interrupted(...)` is the **first** line of `stepIsDone`
([`src/pipeline.ts`](../../src/pipeline.ts):840), before `has`, before the stamp. It is the guard that
runs first — so renaming the step does not break it, it makes it **stop guarding while still
returning an answer**. Nothing fails; a step marked interrupted is simply reported done and skipped.
That is the shape to look for in the rest of stage C, and the reason the whole stage is a rollout
design rather than a rename. Rename
the markers or accept both names for a while. (Artefacts themselves are safe: the `toc` map key points
at stable `tree.json`/`labels.json`/`blocks.json` paths, so renaming the key orphans nothing.)

**5. `ai_calls.purpose` was missed.** The same call persists `"toc"` twice —
[`src/db/schema.ts`](../../src/db/schema.ts):1560 as well as `step_name`, originating at
[`src/hierarchy.ts`](../../src/hierarchy.ts):1461. Migrating one leaves a row reading
`step_name='hierarchy', purpose='toc'` and splits the cost history a second way. The **filesystem**
ledger `data/_ai-calls.jsonl` holds both fields too and needs a migration or a read-time alias.

**6. `typecheck` is not sufficient here.** Drizzle text-column comparisons are plain `string`, so these
exact literals are *not* compiler-caught: the publication guard
([`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts):1171 — miss it and **every migrated
revision becomes unpublishable**), freshness (`case "toc"` and `byStep.get("toc")`,
[`src/store/pg.ts`](../../src/store/pg.ts):1978), and import
(`src/store/import.ts`:1453, a 23514 against the narrowed CHECK).

**7. The migration must be a drizzle artefact, not a loose `.sql`.** `db:migrate` reads only what
`_journal.json` names, so a standalone file is invisible — the precise "nothing applied" failure this
repo just wrote a postmortem about. Route: change `schema.ts`, run `npm run db:generate --name=…`,
then **edit the generated SQL** to insert the data updates between its `DROP CONSTRAINT` and
`ADD CONSTRAINT`; the migrator wraps all pending statements in one transaction. It is `0039`, and
**`0038` must be committed by its owner before we generate or number it.**

**8. Two vocabularies to decide rather than discover.** `toc-labels`: rename rows, CHECK and any
filesystem namespace dirs — but **Sol corrects our cost claim**: the label pipeline does not currently
use the checkpoint store (it writes `labels-progress.json`), and there are no such directories locally,
so the "orphans every checkpoint, re-buys model calls" worry above **does not apply to the current
implementation**. And `"toc/2"` is a persisted *prompt version* ([`src/hierarchy.ts`](../../src/hierarchy.ts):57)
living in tree JSON and `labels.structureVersion`. Nothing reads it today. **Preserve it deliberately
as a historical protocol identifier, or migrate it — but say which.**

**9. Schema-qualify.** `"spideryarn"."revision_step_runs"`; the migrator establishes no search path.

**What Sol cleared:** no other `toc` enum, generated column, trigger, view, partial index or seeded row
exists, and the primary key containing `step_name` updates automatically.

### The marker that turns a rename into a skipped step — read this before the inventory

Ninth of nine persisted homes below is `steps/toc.running`, and burying it there
under-billed it. The database agent's framing is better and is adopted here:

> An unrenamed marker making `stepIsDone` report an interrupted step as done, and skip it, is not a
> rename bug — it's the same class as tonight's `db:migrate`: **a step that never ran, reported as
> complete, with nothing saying so.**

The mechanism, verified: the marker's path embeds the step name
([`src/store/artifacts-fs.ts`](../../src/store/artifacts-fs.ts):431), and
`store.interrupted(...)` is the **opening line** of `stepIsDone`
([`src/pipeline.ts`](../../src/pipeline.ts):840) — before `has`, before the stamp. Rename the step and
that first guard stops finding anything. It does not fail; it returns "not interrupted" and falls
through to `has`, which sees all three outputs, and then to a step that **deliberately has no
freshness stamp** — so the answer is *done*. **Two such markers exist on this laptop right now**, both
on articles with complete outputs.

So the rename does not break the guard. It makes the guard keep answering while no longer asking the
question, which is the failure this repo has met three times in one day. **Rename the markers in the
same change, or accept both names for a while — and prove it with a marker present, not with a clean
tree, because a clean tree passes either way.**

### The second way the step's own state gets quietly discarded

The `toc.running` marker above is one of a pair, and the database agent named the pair better than
either of us had it separately: **both are the step's own state, quietly discarded.**

The other is `jobs.steps`. Measured on the local database, the stored element is not a name:

```
[{"name":"toc","label":"Building the hierarchy","status":"pending"}]
```

It carries a **`status`** beside the name — which of a job's steps has started. And all three job rows
here are `status: "pending"`, so they are **queued work rather than history**: they will run, against
a CHECK that is about to stop accepting the name they hold.

So a migration that rebuilds each element — even one that correctly reads `e->>'name'` — throws away
the `label` and the `status` while looking like it renamed a field. **`jsonb_set` on the `name` key
only, per element, is the difference between renaming a field and rewriting a record.** That is a
data-loss shape, not a rename detail, and it is why the working statement in
[sql.md](../project/sql.md#migrating-data-inside-a-jsonb-column-and-the-operator-that-lies) uses
`jsonb_set` rather than constructing a fresh object.

**Neither of these fails.** The marker makes an interrupted step report done; the wholesale rewrite
makes a half-run job report unstarted. Both survive every check that asks whether the migration ran.

### The complete inventory of `"toc"` as a persisted value

Assembled from three independent sweeps — GPT Sol's review, the database agent probing the live
catalogue, and the stage B agent finding three more while deliberately not renaming them. **Nobody
found all of it alone, which is the argument for stage C being a designed rollout rather than a
careful `sed`.** Every row verified here.

| Where | What holds `"toc"` | Notes |
|---|---|---|
| `revision_step_runs.step_name` | + the `revision_step_runs_step` CHECK | [`schema.ts`](../../src/db/schema.ts):1412. 3 rows locally |
| `ai_calls.step_name` | no CHECK over it | :1577 |
| `ai_calls.purpose` | the `Task` union member | :1588, from [`hierarchy.ts`](../../src/hierarchy.ts):1461 via [`ai-spend.ts`](../../src/ai-spend.ts):750 |
| `checkpoints.namespace` | `'toc-labels'`, + the `checkpoints_namespace` CHECK | :2219, twin at [`checkpoints.ts`](../../src/store/checkpoints.ts):137 |
| `jobs.steps` | `JobStep[]` — `{"name":"toc"}` | :1133. **And `jobs.work_key`, which hashes it** |
| filesystem markers | `steps/toc.running` | [`artifacts-fs.ts`](../../src/store/artifacts-fs.ts):431. **2 exist locally** |
| filesystem ledger | `data/_ai-calls.jsonl` | both fields, `src/store/ai-calls-fs.ts:70` (deleted 2026-09-05) |
| artefact metadata | `PROMPT_VERSION = "toc/2"` | [`hierarchy.ts`](../../src/hierarchy.ts):57 → `tree.json`, and `labels.structureVersion` |
| thrown + reader-facing text | `"run the toc step first"`, `"re-run toc"` | correct **today**; flips with the value, not before |

**Two corrections to what the sweeps reported**, because a plan that repeats them is worse than none:
there is **no `ai_calls.task` column** — the stage B agent named it that, and the `Task` union's value
actually lands in `purpose`, which is the same finding Sol reached from the other end. And the
`toc-labels` checkpoint worry is **smaller than this plan first said**: the label pipeline does not
currently use the checkpoint store (it writes `labels-progress.json`) and no such directories exist
locally, so the "orphans every checkpoint and re-buys model calls" cost does not apply to the current
implementation.

**The two exempt on purpose**, unless someone argues otherwise: the historical literals in
`scripts/migration-reconciliations.ts` and every shipped `.sql` and snapshot — a reconciliation
asserts *this database has been brought to the state migration X produced* and then stamps X's hash,
so modernising its vocabulary makes the ledger lie in the one table whose job is to be trustworthy.
The database agent is adding a never-rename note there, placed where a global find-and-replace will
hit it, **because the failure mode this week was not ignorance, it was `sed`.**

### What stage C built, and the two decisions it had to make

Built 2026-08-31, local only. The code half is `StepName`, both CHECK constraints,
`CheckpointNamespace`, the `Task` union, every step-keyed record and path map, the three
literals `typecheck` cannot see (the publication guard, freshness, import), and the thrown and
reader-facing strings. The data half is two artefacts, deliberately separate because the
filesystem store's copies are unreachable from SQL:

- **[`drizzle/0041_rename_toc_step_to_hierarchy.sql`](../../drizzle/0041_rename_toc_step_to_hierarchy.sql)** —
  generated by `drizzle-kit`, then the data movement inserted between its drops and its re-adds.
  It moves `revision_step_runs.step_name`, `ai_calls.step_name` **and** `ai_calls.purpose`,
  `checkpoints.namespace`, and `jobs.steps`, and it ends with a `RAISE` postcondition over the two
  that have no constraint to catch them — because "matched nothing" and "worked" print the same tick.
- **[`scripts/migrate-fs-toc-to-hierarchy.ts`](../../scripts/migrate-fs-toc-to-hierarchy.ts)** —
  idempotent, `--dry-run`-able, and **run**: it moved the two `steps/toc.running` markers, eight
  `data/_jobs/*.json` step lists and 61 rows of `data/_ai-calls.jsonl`. Proved with the markers
  present rather than on a clean tree: `interrupted("hierarchy")` was **false** for both articles
  before it ran, with all three outputs on disk and no freshness stamp — the silent skip, live — and
  **true** for both after.

**Decision 1 — `PROMPT_VERSION = "toc/2"` is preserved.** It is stamped into every stored
`tree.json` and into `labels.structureVersion`, it identifies *the prompt protocol a tree was built
by*, and nothing reads it. Renaming it would put one identifier on two different prompts and make
every artefact written before tonight indistinguishable from one written after, in exchange for
nothing. `toc/3` is the right spelling for the next real prompt change; that is when the vocabulary
moves, carried by a version bump that means something.

**Decision 2 — `jobs.work_key` is not rewritten; the migration refuses instead.** It is a sha256 of
the ordered step names *and four other things*, one of which is `urlKey(url)`, so SQL cannot
recompute it; the column is `NOT NULL`, so it cannot be blanked either. Leaving it stale is worse
than it sounds: `enqueueOrGet` compares it when the active-slug index refuses a second insert, and
`enqueue` reads `sameWork: false` from a URL request as *different work on a taken slug* and
allocates the next suffix — **one re-submitted URL becomes two articles**. Since the key is only ever
compared for `queued` and `running` rows, the fix is to have none: the migration opens with a `RAISE`
that aborts if any active job still holds a `toc` step. Drained-or-nothing, enforced rather than
remembered, and a refusal rolls the whole transaction back and can simply be run again.

**What is still owed, and is Greg's to decide:** the rollout. Finding 1 above is unchanged — the
migration runs before the deployment, and neither order is compatible on its own. The `RAISE` makes
the maintenance window mandatory rather than optional; it does not schedule one.

### The decision that stopped stage C the first time

**Stages A and B ship; stage C does not.** A and B change no persisted value, so the code and the
database still agree and nothing is half-migrated. Stage C is now a **different and larger piece of
work** — a rollout design, not a rename — and it needs `0038` committed, a maintenance-window or
expand/contract decision from Greg, and its own review. **Nothing in the database has been touched.**

## Risks

- **~~`src/toc.ts` is dirty in the shared tree right now~~ — this happened, and it is worth recording
  how it went.** The peer asked for a five-minute hold; the `git mv` had already run when the message
  arrived. **Nothing was lost** — `git diff HEAD --stat -- src/hierarchy.ts` showed their 307
  insertions carried across, and their four renamed test files kept their content — but the margin was
  luck rather than design. Two lessons: warn peers **before** dispatching the agent that moves files,
  not alongside it; and a rename in a nine-session tree wants the affected files *committed* first, not
  merely announced. Their `#derived-partition` anchor and their `260831ai` plan link both now point at
  a moved file, which is theirs to close.
- **`db:migrate` was silently applying nothing until an hour ago.** Their repair is in the tree but
  its guard is owed, so *"✓ migrations applied"* is exactly the sentence that was lying. Verify by
  counting rows, never by reading the success line.
- **Nine live sessions.** The rename must be one fast atomic commit, not a series.
- An in-flight job holding `steps: ["toc"]` at the moment of the rename fails its CHECK. Acceptable in
  alpha; worth draining first if anything is running.

## How the commit's file set was chosen, which is the transferable part

**Simulate the commit and typecheck it, rather than reasoning about it.**

```
git archive HEAD | tar -x -C /tmp/sim      # a clean checkout of HEAD
<copy the exact set you intend to commit>  # overlay it
ln -s "$PWD/node_modules" /tmp/sim/node_modules
cd /tmp/sim && npx tsc --noEmit -p tsconfig.json   # and src/web, and tests
```

The first attempt at this commit pulled in four other sessions' unfinished features and left
`src/web/App.tsx` worse than HEAD. Nothing in the working tree said so — every tree on this machine
holds the missing halves, so `npm test` and `npm run typecheck` both pass while the repository does
not build. **The simulation is the only check that answers the question a fresh clone asks**, it takes
about forty seconds, and it turned the file set from a judgment into a measurement.

It caught three forced dependencies in this commit that no `grep` for the renamed string could have:
`src/db/schema.ts` imports `src/referee-criteria.ts`; `src/routes.ts` imports the feedback modules;
`src/web/*` imports `log-buffer.ts`. **The unit of a commit is the change, not the file** — and the
piece you are missing usually contains none of the thing you are searching for.

The database agent's version of the same rule, which is a habit rather than a measurement and worth
having as well: *before committing anything, ask what a fresh checkout of just this would do.*

## Verification

`npm test`, `npm run typecheck`, `npm run check`. Then: the row count moved, a fresh
`{ steps: ["hierarchy"] }` job runs, and `rg -n "\btoc\b" src/ tests/ scripts/ evals/` returns only
deliberate survivors. Sol on the migration before it is applied anywhere but locally.
