Code review of commit f3367eed1 in this repo (`git show f3367eed1`), built from docs/plans/261007n-openrouter-spend-the-ledger-does-not-record.md after your plan review in docs/plans/261007n-plan-review-sol.md. The findings it fixes are in docs/investigations/261007c-openrouter-spend-the-ledger-does-not-record.md.

What it does: `beginSpend` in src/ai-spend.ts throws `UnrecordedSpendRefused` before any network I/O when the process entry file (realpath of process.argv[1]) is under evals/ or scripts/ and no collector with a sink is open; transcribe.ts and structure-slices.ts rethrow it; about thirty evals/scripts were converted so they record (sinks + owners, `withLedger("eval", …)`, long-structure's `evalSpend` helper that writes to costStore only on non-fake runs).

You may fix what you find, inside this change's scope: edit files, add tests. Do not commit, do not run anything that calls a paid API or touches a production database, and do not run git commands that discard work. Run `npm run typecheck` and the relevant vitest files (`npx vitest run <files>`) after any edit.

Check especially:
1. Each converted eval/script: does every paid path now run inside a collector with a durable sink, without an inner sinkless collector shadowing it? Is `process.exit`/`closeDb` still after the awaited `withLedger`/`collectSpend`? Was `loadEnvLocal()` called before `environmentOwnerId()` / costStore use where needed? Did any conversion change what a free subcommand does (e.g. now needs a database it did not)?
2. long-structure `evalSpend` (evals/long-structure/calls.ts): is fake-ness detected correctly in every caller, so the dry run never writes and never needs costStore?
3. The refusal: correctness of `refusesUnrecordedSpend`/`real()` (Windows separators irrelevant; symlinks; an entry like `scripts/stage.ts` that runs job steps — those are under runStep's sinked collector, confirm), the test seam, and that nothing in src/ that a server or test process runs could now throw.
4. Any doc or comment the commit made false or left false (grep the changed evals' headers for "not recorded"/"no ai_calls row").

Report numbered findings with file:line and severity, what you fixed, the commands you ran and their results, and a one-line verdict.
