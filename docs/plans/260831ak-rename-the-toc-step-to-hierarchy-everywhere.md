# Rename the `toc` step to `hierarchy`, everywhere

**Status: plan, in progress.** Written 2026-08-31 evening, immediately before the work.

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

*Local first, and prove it.* Count `'toc'` rows before and after; a migration that reports success
having matched nothing looks identical to one that worked
([silent-success.md](../reusable/silent-success.md)). **Production is a separate decision and a
separate ask** — nothing here authorises it.

## Risks

- **`src/toc.ts` is dirty in the shared tree right now**, held by whoever is writing
  `260831ai-toc-tiling-normalisation.md`. `git mv` carries their uncommitted work across to the new
  name, so nothing is lost, but their session will have a stale path. **They must be told.**
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
