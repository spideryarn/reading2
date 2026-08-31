# Rename the `toc` step to `hierarchy`, everywhere

**Status, 2026-08-31: stages A and B are done and committed. Stage C — the step-name string and its
migration — is STOPPED and must be redesigned before anyone builds it.**
[GPT Sol's review](260831ak-rename-the-toc-step-to-hierarchy-everywhere-review-sol.md) found that the
migration as written *"would currently break queued or running jobs, silently fail to migrate their
JSON, and silently skip two locally interrupted filesystem hierarchy runs."* See § *What the review
changed*.

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
deliberately has no freshness stamp — **returns true for work explicitly marked interrupted**. Rename
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
([`src/store/import.ts`](../../src/store/import.ts):1453, a 23514 against the narrowed CHECK).

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

### The decision

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

## Verification

`npm test`, `npm run typecheck`, `npm run check`. Then: the row count moved, a fresh
`{ steps: ["hierarchy"] }` job runs, and `rg -n "\btoc\b" src/ tests/ scripts/ evals/` returns only
deliberate survivors. Sol on the migration before it is applied anywhere but locally.
