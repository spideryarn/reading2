# Rename the `hierarchy` step to `structure`, everywhere

Report **spya-wdfb4h** (SPIDERYARN-READING2-92), Greg (admin), 2026-10-01, sent from Summary on
`arxiv-2508-spya-wrzxkg`:

> In the past we had a Hierarchy mode, but we've since removed it, and kept Structure mode. My
> understanding is that Structure mode uses the data from Hierarchy mode? If that's right, then
> perhaps we should rename the Hierarchy data/import/variables/database/etc to match Structure mode
> throughout
>
> see rename-or-move.md
>
> And if you notice any other modes/import steps/UI mismatches, update those too. I might have
> already recently suggested doing this in another Feedback report, I can't remember.

**Yes, that is right.** Pipeline stage 4, the `hierarchy` step, cuts the article into the nested
tree (`article_revisions.tree`) and writes its gists; the `labels` step that follows adds the
navigation labels. Structure draws that tree. So do Outline, the Masthead, the shelf entry, hover
cards, Diagram and Debate — the step is not Structure's alone, but Structure is the only *mode* that
is the tree, and the Hierarchy mode that gave the step its name went on 2026-09-29
([260929d](260929d-remove-hierarchy-mode-and-heading-numbers.md)).

No earlier report asked for this (checked `docs/user-feedback/`, `docs/plans/`, `git log -200`,
`gjd-remote ls`, 2026-10-02).

## Precedents, and what they already settled

This is the third rename of this kind, and the first two wrote down their traps:

- [260831ak](260831ak-rename-the-toc-step-to-hierarchy-everywhere.md) — `toc` → `hierarchy`, the
  same step. Its review found the `jobs.steps` jsonb shape (objects, not strings), the CHECK
  ordering (drop, move rows, re-add), and that `jobs.work_key` cannot be recomputed in SQL.
- [261001r](261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md) — `trajectory` → `skim`,
  yesterday. Its migration `drizzle/20261001224759_skim.sql` is the template copied here, and its
  plan review settled four questions this plan takes as given: rename in place rather than
  expand/contract; leave `ai_calls` alone and classify the old name through `RENAMED` in
  `src/cost-categories.ts`; leave the prompt version tag alone; accept the `work_key` window.

## What changes name, and what does not

| What | From | To |
|---|---|---|
| Step name (`StepName`, `STEP_ORDER`, `AiJob`, job steps, model tables) | `hierarchy` | `structure` |
| Files | `src/hierarchy.ts`, `hierarchy-{cascade,deepen,expand,flatten,prompt,starts}.ts` | `src/structure.ts`, `structure-{…}.ts`, by `git mv` |
| Identifiers | `generateHierarchy`, `HierarchyRun`, `HierarchyArtefacts`, `estimateHierarchyTokens`, `hierarchyCurrency`, `HierarchyRequestError`, … | `generateStructure`, `StructureRun`, … |
| The inner first pass (see § The name collision) | the "structure" pass: `structureRequest`, `structureKey`, `StructureCheckpointEntry`, … | the **whole-document** pass: `wholeDocumentRequest`, `wholeDocumentKey`, `WholeDocumentCheckpointEntry`, … |
| Checkpoint namespaces (CHECK + rows) | `hierarchy-structure`, `hierarchy-deepen`, `hierarchy-labels` | `structure-whole-document`, `structure-deepen`, `structure-labels` |
| npm scripts | `hierarchy`, `hierarchy:flatten`, `eval:hierarchy`, `eval:hierarchy-structure` | `structure`, `structure:flatten`, `eval:structure-labels`, `eval:structure-whole-document` |
| Evals | `evals/hierarchy-labels.ts`, `evals/hierarchy-structure/`, `evals/thinking-effort/hierarchy-panel.sh` | `evals/structure-labels.ts`, `evals/structure-whole-document/`, `…/structure-panel.sh` |
| Tests | `tests/hierarchy-*.test.ts` (20 files) | `tests/structure-step-*.test.ts` — the `structure-` prefix already belongs to the mode's UI tests, so the step's take `structure-step-` and the two sets stay apart in `ls` |
| Env var | `SPIDERYARN_DEEPEN_HIERARCHY` | `SPIDERYARN_DEEPEN_STRUCTURE` (off by default, set nowhere — not in `.env.example`, `.env.local`, Vercel or `infra/`; no fallback) |
| UI copy | "Building the hierarchy", "hierarchy · labels" (Article cost) | "Building the structure", "structure · labels" |
| Spend declarations | `hierarchy-structure-messages`, `-chat` | `structure-whole-document-messages`, `-chat` |
| Doc | `docs/project/hierarchy.md` | `docs/project/structure-step.md` (`structure.md` is the mode's and stays) |

**Kept, deliberately:**

- **`?mode=hierarchy`** keeps opening Structure (`RETIRED_MODES` in `src/modes.ts`), and *Hierarchy*
  stays a Commands alias of Structure (`src/mode-catalog.ts`). Readers' bookmarks keep working.
- **Prompt version tags** (`toc/10`, soon `toc/11`; `expand/7`) do not contain the word and are
  persisted in `tree.version` and `revision_step_runs.prompt_version`; a bump would read every tree
  as stale. Untouched.
- **`structureHash` / `structureVersion`** in the labels manifest: persisted jsonb field names, and
  already the right word.
- **`ai_calls.purpose` / `step_name`**: append-only ledger. `RENAMED` in `src/cost-categories.ts`
  gains `hierarchy: "structure"`, so the cost history is one series.
- **Feedback rows** are evidence. A tab open across the deploy may still send `job.step:
  "hierarchy"`; `RETIRED_STEPS` in `src/feedback-payload.ts` gains `hierarchy: "structure"`.
- **History**: `docs/plans/`, `postmortems/`, `user-feedback/`, `research/`, `tutorials/`,
  `evals/results/` (including `hierarchy-waves-2026-09-04`, read by a test by path, and the
  `evals/results/hierarchy-structure/` an eval used to write to — new runs write to
  `evals/results/structure-whole-document/`), `evals/cost/baseline/` (its reproducer selects old
  ledger rows by `"hierarchy"` on purpose — Sol F5), applied `drizzle/` files and their snapshots,
  `src/web/changelog-versions.ndjson`, `scripts/migrate-fs-toc-to-hierarchy.ts` (a one-off for the
  filesystem store, which is gone), and `scripts/db-repair-migration-ledger.ts`'s verbatim
  postconditions. Links *into* history keep working: plan files' links to `hierarchy.md` are
  repointed, path only, as 261001r did.
- **"Hierarchy" the English word** — "the heading hierarchy", "hierarchical" — where it means
  nesting, not the step. Each prose hit is read, not replaced.

## The name collision: the step already has a pass called "structure"

The step's first model call proposes the complete nested tree of internal nodes — root, chapters,
sections, with titles, gists, questions and starts/ranges; optional deepen/expand calls then replace
oversized frontier nodes with finer subtrees. The code calls that first call the "structure" pass
(`structureRequest`, checkpoint namespace `hierarchy-structure`, `evals/hierarchy-structure/`), and
the prompt module already calls it "the whole-document prompt" (`src/hierarchy-prompt.ts`).
Renaming the step without renaming that pass gives `structure-structure`. **The pass becomes
`wholeDocument` / `whole-document`** — Sol's correction of this plan's first choice, `sections`,
which wrongly suggested the call returns only top-level starts. Rejected: `tree` (the artefact every
pass writes into), `outline` (a feature name). `structureHash` / `structureVersion` keep their
names: they hash the finished tree, not the pass.

`src/web/structure.ts` (the mode's projection) and the new `src/structure.ts` (the step) differ by
directory only. Accepted: `src/web/` is the client throughout, and the alternative,
`src/structure-step.ts`, makes every other `src/structure-*.ts` read as a sub-part of something.

## Order: never leaving dev red

Another session (`structure-answer-writes-code`, plan 261001s) is editing `src/hierarchy.ts`,
`hierarchy-prompt.ts`, `-cascade.ts`, `-starts.ts`, the eval and several `tests/hierarchy-*`. It
pushes first (agreed by message, 2026-10-02). Nothing below starts until that is on `dev` and merged
here.

**Stage 1 — the code and the docs, persisted values untouched.** File renames by `git mv`,
identifiers, the inner pass's identifiers, npm scripts, evals, tests, the env var, UI copy, every
doc, `CLAUDE.md` and the entry points (Greg approved the name swap there, 2026-10-01, via the
Overseer). **Internal names and presentation only — every protocol literal stays `hierarchy`** (Sol F2, F3),
because each of these is a string something stores or matches:

- `StepName` / `STEP_ORDER` and every step-keyed record; the `Task` / `AiJob` literal (it becomes
  `ai_calls.job` / `purpose` through `beginSpend`) and the task-keyed records (`TASK_TIER`,
  `TASK_WIRE`, `MODEL_ENV_VAR`, `JOB_DISPOSITION`);
- the default ingest steps (`src/pipeline.ts`), the pipeline registry and `store.read(…,
  "hierarchy", …)`, freshness lookups (`src/store/pg.ts`), the raw Drizzle predicate in
  `src/store/pg-revisions.ts`, feedback's copied `STEPS`;
- the three checkpoint namespaces, and direct checkpoint queries
  (`evals/paperwork/structure-starts-replay.ts`, `evals/deepen/harness.ts`) — renamed early, they
  return zero rows and look fine.

Before committing stage 1, every remaining quoted `"hierarchy` literal in `src`, `scripts`, `evals`
and `tests` is read against this list; a literal moved early is put back by hand. Green and pushable
on its own, no migration.

How: a scripted, word-boundary-aware rename of identifiers and paths (a map, not a regex over
"hierarchy"), then `npm run typecheck` and the tests to find what it missed, then a subagent reading
every remaining prose hit in `src/`, `scripts/`, `evals/` (live code), `tests/` and the evergreen docs
and deciding each one — step, or English word.

**Stage 2 — the stored names and the migration.** `StepName` `"hierarchy"` → `"structure"`; the
namespaces → `structure-*`; `RENAMED`, `RETIRED_STEPS`; one migration copied from the skim one:

1. refuse if any **queued or running** job names `hierarchy`, as `0041` does (Sol F1): `hierarchy`
   is in every ordinary ingest, and an old worker mid-step would finish against a renamed row
   (`StepRunNotHeld`, `src/store/pg-revisions.ts`) or write its in-memory `JobStep[]` back with the
   old name after the postcondition ran. Refuse too if a job names both spellings;
2. drop `revision_step_runs_step` and `checkpoints_namespace`;
3. `UPDATE revision_step_runs SET step_name='structure' WHERE step_name='hierarchy'`;
4. `UPDATE checkpoints SET namespace = CASE namespace WHEN 'hierarchy-structure' THEN
   'structure-whole-document' WHEN 'hierarchy-deepen' THEN 'structure-deepen' WHEN
   'hierarchy-labels' THEN 'structure-labels' END WHERE namespace IN (…)` — explicit, no pattern;
5. rewrite `jobs.steps[].name` and `jobs.reset.regenerate[]` (with ordinality);
6. postcondition: refuse if any job or checkpoint still names the old spelling;
7. re-add both CHECKs with the new lists (`tests/db-step-constraint.test.ts` and
   `tests/db-schema.test.ts` pin them).

Generated through drizzle-kit for the snapshot (no column rename this time — only the CHECKs), the
data statements inserted between drop and re-add. Applied to the shared local database only
immediately before the push, the Overseer told in the same message; it reviews the migration before
the deploy.

**The deploy, for the Overseer.** `npm run deploy` has no maintenance switch, so the window is kept
short and the guard makes it safe: deploy when no ingest is queued or running (a read-only count
first); if one starts in between, the migration refuses and the deploy stops before Vercel — retry
once it drains. In the minutes between the migration and the new code going live, an old worker
*starting* a `hierarchy` step fails the CHECK loudly, and a job *enqueued* by old code holds
`"name":"hierarchy"` in `jobs.steps`, which nothing checks.

**What new code does with that row, traced (Sonnet, 2026-10-02):** `toJob`
(`src/store/pg-jobs.ts`) casts `steps` without checking them; `registry[step.name]` is `undefined`
and `stepIsDone` throws a `TypeError` *before* `runStep`'s catch, so `advanceJob` 500s with the
lease held. The job is requeued twice over ~38 minutes, ends `error`, and **Retry copies the same
step name** into the new job. (With a sibling job on the slug, `readsOf` in `src/sharing-steps.ts`
throws inside the claim instead.) The reader sees a card stuck with no message. **So stage 2 moves
`RETIRED_STEPS` out of `src/feedback-payload.ts` into `src/step-order.ts` and applies it where job
rows are read** (`steps[].name` and `reset.regenerate`) — one table, read by both, so a stale row
runs under its new name and a retry carries the new name. This reverses this plan's first "no alias
in the job reader": a guard that fails the job cleanly would still have lost the reader's ingest,
while the translation finishes it at the cost of one lookup. It also covers the same window left
open by the Skim rename (`trajectory`).

**Checkpoints keep their keys** (Sol F6, verified): `checkpointKey` hashes only the caller's object,
never the namespace (`src/source-hash.ts`), so a moved row is found again and an article
mid-labelling resumes. Before the rename, an exact deepening-key pin is added beside the existing
whole-document one, and the local migration check compares `(article_id, key, value)` before and
after, not counts. The only hash holding the step's spelling is `jobs.work_key`, which the drain
guard covers.

**Stage 3 — the report.** The note in `docs/user-feedback/`, the line off `awaiting-approval.md`.

## Other mismatches looked for, as Greg asked

Step names against the modes that read them: `fetch metadata extract blocks hierarchy labels assets
arc tweets glossary quotes ideas timeline quiz faq simple sketch illustrated skim debate citations
crossrefs`. Apart from `hierarchy`, each step either is its mode's name (`glossary`, `quotes`,
`ideas`, `timeline`, `quiz`, `faq`, `skim`, `debate`, `citations`, `tweets`), is a sub-mode of one
(`sketch`, `illustrated` under Diagram), is pipeline plumbing (`fetch` … `assets`, `labels`), or is
an abbreviation of its feature (`crossrefs`). Two are worth Greg's eye, **not renamed here**:
`simple` (the Summary mode's plain summary) and `arc`. Recorded for a follow-up rather than folded
in: each is its own migration, and bundling them would make one review cover three risks.

## Done is

- `npm run typecheck` clean; `npm test` green but for known contention reds re-run alone; `npm run
  check` read later.
- `git grep -i hierarch` outside the historical folders shows only: the two URL/Commands aliases,
  `RENAMED`, `RETIRED_STEPS`, the migration, comments citing a plan or migration by file name, a
  dated "called `hierarchy` until 2026-10-02", and the English word.
- The migration run locally against a database that *has* `hierarchy` rows and checkpoints, counts
  before and after — a run that moved zero rows looks identical to one that worked.

## Reviews

- Plan: GPT Sol, `--sandbox review`, `261002b-…-plan-review-sol.md`.
- Code: GPT Sol, `--sandbox workspace-write`, after stage 2.

## Progress

- 2026-10-02: sweep (Sonnet) done; plan written. GPT Sol plan review
  ([plan-review-sol](261002b-rename-the-hierarchy-step-to-structure-everywhere-plan-review-sol.md)):
  build with changes; seven findings, all accepted and folded in above — the drain guard (F1),
  `AiJob` and every protocol literal held to stage 2 (F2, F3), `whole-document` not `sections` (F4),
  `evals/cost/baseline/` kept as history (F5), checkpoint keys confirmed namespace-free (F6), an
  explicit `CASE` (F7). Waiting on 261001s to push before stage 1.
- 2026-10-02: **stage 1 on dev** (`b96fb333e`, merged as `d1794917c`). Scripted: 43 `git mv`s and
  ~460 files; stored-literal counts checked equal to HEAD's (115 namespace, 1,196 step). The script
  first rewrote paths inside history's prose too; those files were restored and only their link
  targets repointed. One test (`parse-json`) built `src/${stage}.ts` from the step list — found by
  the full suite, fixed.
- 2026-10-02: **stage 2 built** (`d988cc77f` + review fixes). A literal pass (144 files), then 93
  compiler errors for bare `hierarchy:` keys, then three Opus prose passes (src/scripts, tests/evals,
  docs) reading ~1,480 hits one by one. **Two paths broken by the namespace swap** — a plan name
  (`260904c-hierarchy-structure-in-waves.md`) and the dated results folder
  `evals/results/hierarchy-structure/` — both restored; eval review records restored to their
  original text. The job-reader translation has a test watched red (`tests/retired-step-names`).
  Production counts, read-only: `revision_step_runs` 421 of 4,116; `checkpoints` 139 labels + 30
  whole-document + 0 deepen; 2 finished jobs; none live.
- GPT Sol code review
  ([code-review-sol](261002b-rename-the-hierarchy-step-to-structure-everywhere-code-review-sol.md)),
  write access: five fixes taken — `LOCK TABLE … ACCESS EXCLUSIVE NOWAIT` before the drain guard so
  no enqueue slips between the guard and the rewrites (a busy table refuses; retry); retired-name
  translation in the two raw publication readers in `src/store/pg-revisions.ts`; Article cost shows
  old ledger rows under the new name; review-record links; checkpoint comments. Left, and recorded
  here rather than fixed: `evals/cost/harness.ts` still assumes labels run inside the structure step
  (pre-existing, since 2026-09-06). Taken after: the eval flag `--hierarchy-run` → `--structure-run`.
