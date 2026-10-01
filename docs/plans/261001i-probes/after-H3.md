# Probe H3 (after): log how long each pipeline step takes, server-side, per job

## 1. Docs opened, in order
- `AGENTS.md` / CLAUDE.md (in context) — pointed to dev-and-deployment-overview -> `logging.md`; helped.
- `docs/project/logging.md` — rules, the component table (`jobs`, `pipeline`, `http`); helped. Its table line for `jobs` / `pipeline` said `ms` is logged, which was the hint that this may exist.
- `docs/project/ingest-queue.md` (top map) — "Where a job's life is decided"; named `runStep`, `walkClaim`, `noteEnded`; helped a lot.
- Skimmed `docs/project/architecture.md`, `performance.md`, `debugging.md` via grep only; not useful (performance.md is browser timing).

## 2. Code files you would edit
- Probably none for the core ask: `src/jobs.ts` `runStep` already logs `step done: <name> — <slug>` with `{ step, ms, ...spendFields }`, and `step failed` with `ms`; `noteEnded` logs total job `ms` + status.
- Gap to check/decide: skipped steps log only at `debug` (no ms, correct); `info` per-step line exists. If a gap is wanted (e.g. a single per-job summary listing every step's ms), edit `src/jobs.ts` (`noteEnded`) and `docs/project/logging.md` (component table).
- Tests: `tests/jobs.test.ts` / `tests/jobs-walk.test.ts` (assert on the log line).

## 3. Existing helpers/components/functions you would reuse
- `src/log.ts` § `since` (elapsed ms), § `log("jobs")`, § `errorFields`.
- `src/jobs.ts` § `runStep` (`stepStarted`, `spendFields`), § `noteEnded`, § `jobSpend`.
- `src/pipeline.ts` § `plog` — per-stage detail lines (tokens, model, `ms`).
- No new helper needed.

## 4. Rules/policies I would follow
- Server code logs via `src/log.ts`, never `console.log`; CLI output is not logging (`logging.md`).
- Nothing sensitive or article prose in the line; do not put step `detail` in (the comment in `runStep` explains: extract's detail is the title) (`logging.md`, `src/log.ts` rule 3).
- Test first: write a failing test, watch it red (CLAUDE.md); `npm test`, `npm run typecheck`, lint on touched files.
- Work in a worktree, GPT Sol review before commit, commit own files by name, push to `dev` (CLAUDE.md).
- Doc edit to `logging.md` only a signposting-level change, no approval needed.

## 5. Where I got lost
- The main finding: the feature appears to exist already, and no doc says "per-step timing is logged at `jobs` `step done`". I only found it by grepping `src/jobs.ts` for `ms`/`Date.now`. `logging.md`'s component table does not name the `step done` / `job done` lines or their fields.
- `src/jobs.ts` is ~4000 lines; grep was the only way in. `ingest-queue.md` is 1600+ lines.
- I could not run the app to confirm the line prints, per the probe rules.

## 6. Confidence
7/10 that the task is largely already satisfied; 5/10 on what residual gap (if any) was intended.
