# Trajectory becomes Skim, its FAQ snippets go, and the Marginalia rename is audited

Two reports from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0), 2026-10-01:

**spya-skxhcz** (no Sentry issue id given), sent from Trajectory on `jco-2005-01-libre-spya-hk9cc7`:

> Let's rename "Trajectory" to "Skim" (along with all variables, UI elements, docs, signposts,
> database columns, etc.) But keep "Trajectory" as a keyword in the Commands so that it still
> matches for that.
>
> We also recently renamed Annotations -> Marginalia mode. Make sure equivalently that we've renamed
> all the places in the code and evergreen docs and references, and added it as an alias-keyword in
> Commands.
>
> (You don't have to rename historical plans etc. These instructions should hopefully be covered
> already by rename-or-move.md or something like that. The key point is to make sure we keep
> signposts etc up to date, and that the code and UI and database and docs etc stay in sync (so that
> it's easy to grep, and there's less confusion for an agent reading the code about what's what).

**spya-bjbcxp** (SPIDERYARN-READING2-8Z), sent from Trajectory on `arxiv-2508-spya-wrzxkg`:

> In Trajectory/Skim mode:
> - Remove the FAQ snippets (they don't add much)
> - Update the fonts to be clear about what's author-generated vs AI-generated (as elsewhere)

The font half is **not** this plan's: it belongs to the `fb8g-ai-typeface-everywhere` session,
which has not landed yet (checked `git log` and `gjd-remote ls`, 2026-10-01 ~21:00). When it lands
it should find the mode under its new name.

## What is out of scope

- Historical folders keep the old name: `docs/plans/`, `docs/postmortems/`, `docs/user-feedback/`,
  `docs/research/`, `docs/tutorials/`, `evals/results/`, `src/web/changelog-versions.ndjson`, and the
  applied migrations in `drizzle/` with their `meta/` snapshots. Comments that cite a plan **by its
  file name** (`docs/plans/260928a-trajectory-mode-…`) keep that file name; it is a path.
- The natural-language word "trajectory" in fixtures and article prose (e.g. "their trajectories
  were poisoned") is not the mode.
- `stop`, `depth` URL params do not contain the name and keep it.

## Stage 1 — the FAQ snippets come off the Trajectory stop

The FAQ question that sat above the current stop (`StopQuestions`, `questionsAt` in
`src/web/stop-card.ts`, the band's `useFaqRead` and the visitor band's `faq`) is removed with
everything that existed only for it. The stop card keeps terms, ideas and events, and the Quiz cue
above the quote (8J) is a different feature and stays. A test asserts the question no longer
appears when FAQ pairs one with the stop's block (red on the old code). Doc: `trajectory.md`.

Done is: typecheck clean, the touched test files green, committed.

## Stage 2 — the rename, Trajectory → Skim

One name everywhere, so that a grep for `skim` finds the mode and a grep for `trajector` finds only
history, the Commands keyword, and the back-compat translations below.

| What | From | To |
|---|---|---|
| Mode id / `?mode=` value | `trajectory` | `skim` |
| Label | Trajectory | Skim |
| Step name (`StepName`, `STEP_ORDER`, `STEPS`, job steps, AI job / `purpose`, model config) | `trajectory` | `skim` |
| Files | `src/trajectory.ts`, `src/web/TrajectoryPanel.tsx`, `TrajectoryPurpose.tsx`, `useTrajectory.ts`, `trajectory-route.ts`, `modes/trajectory/TrajectoryMode.tsx`, `styles/trajectory.css`, `scripts/trajectory-coverage.ts`, `scripts/eval/trajectory-*.ts`, `tests/trajectory*.test.*` | `skim` equivalents, by `git mv` |
| Types | `Trajectory`, `TrajectoryStop`, `TrajectoryFound`, `TrajectoryResponse`, `TrajectoryDepth`, `TrajectoryDrops`, `PublicTrajectory` | `Skim`, `SkimStop`, … `PublicSkim` |
| Constants | `TRAJECTORY_*` (messages, system prompt, prompt version import alias) | `SKIM_*` |
| Store method | `loadTrajectory` | `loadSkim` |
| API path | `/api/trajectory/:slug` | `/api/skim/:slug` |
| Public DTO field | `trajectory` | `skim` |
| Export bundle file | `trajectory.json` | `skim.json` |
| CSS class prefix | `traj-` and `--traj-*` | `skim-` and `--skim-*` |
| DB column | `article_revisions.trajectory` | `article_revisions.skim` |
| Prompt version tag | `trajectory/7` | **kept** — see § After the plan review, F1 |
| Doc | `docs/project/trajectory.md` | `docs/project/skim.md`, and every signpost to it (`CLAUDE.md`, `reading-view-overview.md`, …) |

**What keeps the old name, deliberately**:

- `MODE_CATALOG.skim.aliases` gains `"trajectory"` — Greg's ask. Typing *Trajectory* in the command
  bar finds Skim.
- `RETIRED_MODES` in `src/modes.ts` gains `trajectory: "skim"`, the existing table for an old
  `?mode=` value (`outline`, `hierarchy` → `structure`). It is read by `modeFromParam`, which serves
  both the client (`modeParam`) and the server (`readMode`), so a bookmarked or shared
  `?mode=trajectory` link, and a remembered last view, open Skim. Check the other translators the
  Marginalia rename had to touch (Dock `withMode` / `acceptDockMode`, `last-view.ts`) and make sure
  each goes through it. A test opens `?mode=trajectory` and lands in Skim.
- `feedback-payload.ts` keeps accepting `trajectory` from a tab that loaded before the deploy
  (normalised through the same table), since a stale tab's report should not be refused.
- The prompt text's own use of the word "skim" is unchanged; no prompt wording changes, so no version
  bump beyond the respelling.

**Not kept**: `/api/trajectory/:slug`. A tab open across the deploy gets a 404 in the band until it
reloads. One route, briefly, on a beta — accepted rather than a second path forever.

### The database: one migration, in place (proposed) — or expand now and contract later

The persisted spellings of the name, found by the sweep:

1. `article_revisions.trajectory` (jsonb column), and `.version` inside it (`trajectory/N`).
2. `revision_step_runs.step_name = 'trajectory'`, and the hand-kept CHECK `revision_step_runs_step`
   (`tests/db-step-constraint.test.ts` pins it to `STEP_ORDER` both ways).
3. `jobs.steps[].name` (jsonb), and `jobs.reset.regenerate[]` if a reset named it.
4. `ai_calls.purpose` and `ai_calls.step_name` — the cost ledger.

No localStorage key, Sentry tag or Storage path carries the name (sweep, 2026-10-01).

**Proposed: one migration that renames in place**, in one transaction: `RENAME COLUMN trajectory TO
skim`; drop the CHECK, `UPDATE
revision_step_runs SET step_name='skim'`, re-add the CHECK with `skim`; rewrite the job step names in
`jobs.steps` (and `reset`). (Superseded in part by § After the plan review: the version tag and `ai_calls` stay.) Generated with drizzle so
its snapshot exists (the rename prompt needs a TTY — `database.md` § That rename question; the
answer we want is *rename*, not *create*), the data statements appended by hand.

Why it is acceptable, and what it costs:

- **Production**: `npm run deploy` applies migrations and then waits for Vercel, so for a few minutes
  the old code reads a column that is gone and every Trajectory read, and any read that selects the
  whole revision row, fails. CLAUDE.md names exactly this case as fine on the beta. The Overseer
  reviews the migration before deploying (the brief).
- **The shared local database**: every other worktree still on old code breaks on these reads the
  moment this applies, until it merges `dev`. That is the real cost — `database.md` § What no lock
  can cover. Apply it locally only at push time, and say so to the Overseer.
- ~~The ledger relabel~~ — dropped after review (F6): `ai_calls` is append-only.

**The alternative passed over: expand now, contract later.** Add `skim`, copy, widen the CHECK to
take both names and teach its test a retired-name allowance, and leave `DROP COLUMN trajectory` and
the narrowing for a second migration in a later deploy, queued in `overseer-queue.md`. It spares the
other worktrees and the deploy window, at the price of a second migration somebody must remember,
an allowance in the constraint test, and old code writing routes into a column nobody reads in the
meantime. Simpler-first says one migration; GPT Sol is asked to weigh this in the plan review.

### Done is

`npm run typecheck` clean; the renamed and touched test files green, the pg ones included; `npm
test` green but for known-flaky contention reds re-run alone; `git grep -i trajector` outside the
historical folders shows only: the alias, `RETIRED_MODES`, the feedback normalisation, the
migration, comments that cite a plan by file name, and comments that say "called Trajectory until
2026-10-01". A Sonnet browser check: `?mode=trajectory` on an article opens Skim; the command bar
finds Skim from "traj".

## Stage 3 — the Marginalia rename, audited

The same sweep over `annotations` (2026-10-01): the 261001n rename was thorough. What still says
"annotations" in the mode's sense is all deliberate — `MODE_CATALOG.marginalia.aliases` already
contains `"annotations"` (pinned by `tests/marginalia-name.test.ts`), `?mode=annotations` is
translated to the `?margin=1` switch (`isMarginaliaModeWord`), and the remaining hits are plan file
names, a quotation of Greg, or other meanings (comment marks in `styles/annotations.css`, OpenRouter
`url_citation` annotations, PDF annotations, the `annotateHtml` pass). So the alias Greg asked for is
already there; this stage confirms it by test rather than changes code, and fixes any doc it finds
stale.

One collision worth knowing, not changed: the Comments row in `CommandBar.tsx` also has
`annotations` as an alias; `tests/command-bar.test.tsx` pins Marginalia ranking first.

## Reviews

GPT Sol on this plan (`--sandbox review`), and on the code after stage 2 (`--sandbox
workspace-write`).

## After the plan review (GPT Sol, `261001r-plan-review-sol.md`)

Sol agreed with rename-in-place over expand/contract: a safe expand needs old writes bridged across
two deploys, and add-and-copy lets the two columns diverge silently, which is worse than a loud few
minutes. What changed:

- **F1 (P1), accepted: the prompt version tag stays `trajectory/7`.** It is also persisted in
  `revision_step_runs.prompt_version`, and `stampForStep` throws `StampDisagrees` when the two
  differ. It names an unchanged prompt, not the mode; the next real prompt change bumps it to
  `skim/8`. A comment at `PROMPT_VERSION` says so.
- **F2 (P1), accepted: the input-hash namespace `"trajectory-input\n"` stays.** Changing it changes
  every recomputed hash, so every stored route would read stale. Comment at the literal.
- **F3 (P2), overruled: the IndexedDB offline copy of `/api/trajectory/<slug>`.** It is a cache of a
  stored read, not paid work: online, the route is fetched again from `/api/skim/` at no model cost.
  The only loss is a reader who is offline at the moment of their first open after the deploy. Not
  worth a translation layer in the offline store.
- **F4 (P2), accepted:** feedback from a stale tab normalises both `article.mode: "trajectory"` and
  `job.step: "trajectory"` (a step alias, not `RETIRED_MODES`). Stored feedback rows are evidence and
  are not rewritten.
- **F5 (P2), accepted as a stated window:** the migration rewrites the step names in `jobs.steps` and
  `jobs.reset` for all rows, and leaves `work_key` (an immutable hash) as it is: for a terminal job
  it is history, and an active Trajectory job across the deploy minutes is rare; at worst one
  duplicate run. Old code writing `step_name='trajectory'` after the CHECK narrows fails loudly in
  that window.
- **F6 (P2), accepted: `ai_calls` is not rewritten.** The ledger is append-only by contract
  (`src/cost-categories.ts`). A tested legacy alias classifies `trajectory` with `skim`.
- **F7 (P2), accepted:** the test suite runs on a private database built from the tree's own
  migrations (`testing.md`), so nothing needs the shared local database until push. Applied to it
  only immediately before the push, and the Overseer told in the same breath.
- **F8 (P3):** the Dock reads through `modeInSearch`, which already uses `modeFromParam`.

## Progress

- 2026-10-01: sweep done (Sonnet). Stage 1 landed in the worktree as 7e43dac60. Plan reviewed by Sol.
- Stage 2 built (two Opus agents, code and docs). Migration `drizzle/20261001224759_skim.sql` (first generated as `…211832…`; regenerated on top of dev's `bulk_import_minimal` and its new `metadata` step after a merge),
  generated by drizzle with the rename answer, plus the hand-written step-name and job rewrites and a
  postcondition that refuses if a job still names `trajectory`. Kept spellings: the alias,
  `RETIRED_MODES`, `RETIRED_STEPS` in feedback, `RENAMED` in cost categories, `trajectory/7`, the
  hash namespace. Plan files' *links* to `trajectory.md` and the renamed scripts were repointed,
  path only, so `tests/doc-links.test.ts` stays green; their prose is untouched.
- Stage 3: one real miss from the Marginalia rename — a test about the notes' error boundary opened
  them through the legacy `?mode=annotations` rather than `?margin=1`; now canonical (the legacy
  word keeps its own test). `interface-vision.md`'s step "Rename Annotations to Marginalia" marked
  done. The `annotations` Commands alias was already there.
- Code review (GPT Sol, write access, `261001r-code-review-sol.md`): three narrow fixes, all taken —
  the migration refuses a job that names both spellings rather than collapsing them (C1);
  `useFaqRead`, split out only for the removed snippets, folded back into `useFaq` (C2); a doc link
  (C3). No wider findings. The job rewrites were also run by hand on sample rows in a rolled-back
  temp table: order kept, NULL and regenerate-less resets untouched.
