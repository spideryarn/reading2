# Probe H3 (after2): log per-step timings on the server, for every job

## 1. Docs opened, in order
- `CLAUDE.md` (AGENTS) — pointed to dev-and-deployment / architecture; logging.md is reached via the dev entry point list.
- `docs/project/logging.md` — very helpful: component table says `jobs` logs each step transition with money, `pipeline` logs tokens and `ms`; "log at the seam the queue owns".
- `docs/project/ingest-queue.md` (grep only) — confirms `noteEnded` writes the one job line; display-clock notes.

## 2. Code files you would edit
Probably none: the feature already exists. If a gap is found (e.g. skipped steps are only `debug`):
- `src/jobs.ts` (`runStep`, `noteEnded`)
- possibly `docs/project/logging.md` to state it plainly.

## 3. Existing helpers/components/functions you would reuse
- `src/log.ts` § `since` (the one duration helper, field name `ms`), `log`/`child`, `errorFields`
- `src/jobs.ts` § `runStep` (already: `stepStarted = Date.now()`, `jlog.info({step, ms: since(stepStarted), ...spendFields(spend)}, "step done")`; the failure path at ~1243/1264 also carries `ms`), § `noteEnded` (job-level `ms`, status, spend)
- `src/pipeline.ts` § `plog` lines with `ms: run.elapsedMs` per stage
- No new helper needed.

## 4. Rules/policies you would follow
- Server logs go through `src/log.ts`, never `console.log` (CLAUDE.md, logging.md).
- No article prose or sensitive data in fields; no `detail` field on the job line (comment in `runStep`, logging.md).
- Do not convert CLI `console.log` in stage `main()` (log.ts header).
- Do not reach into stage files; log at the queue/pipeline seam (architecture.md § Stage ownership via logging.md).
- Test first: a failing test that captures the log line (existing pattern e.g. `tests/checkpoint-hit-rate-is-logged.test.ts`); `npm test` and `npm run typecheck` before finishing; worktree, commit own files by name, push to dev.
- Cross-family review of any plan/code.

## 5. Where you got lost
- The task's premise looks already satisfied: `step done` and the failure line carry `ms`, and `job <status>` carries total `ms`. Only skipped steps log at `debug` without `ms` (intentional, commented). I would report back and ask what is missing (e.g. aggregation, queue-wait time, or production `info` visibility) before building.
- No doc says "per-step timing is already logged" in one place; I found it by reading code after logging.md only mentioned `ms` in passing.

## 6. Confidence
7/10 that nothing more is needed; the real question is what gap the requester sees.
