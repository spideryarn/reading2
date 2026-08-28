Bottom line: Defect 1 is real and the immediate `output/` copy is justified. Defect 2 is real, but “90-minute ingestion lag” is not yet proved. Polling needs several adjacent fixes or it will create new false confidence.

## Defect 1

Diagnosis: substantially right.

`data/` and `output/` are two halves of one filesystem artefact store, not independent inputs ([artifacts-fs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-fs.ts:54)). Copying only `data/` creates a structurally incomplete fixture.

Two corrections:

- The measurements attribute 12 failures to missing `output/`, not 13: 13 became 1.
- Two nearby commits do not establish “at any commit.” They establish the defect for those commits and the current test structure.

The skip conclusion also needs narrowing. The 202 skipped tests probably include descendants that Vitest marked skipped after a `beforeAll` failed on missing output. They were not necessarily 202 independently fixture-aware skips. The run was already red; forcing that red gate is what hides their absence.

I would do this:

1. Copy `output/` now, beside `data/`. This restores a usable gate and completes the external fixture state the script already chose to import at [deploy.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/deploy.ts:583).
2. Before copying, require both directories and named sentinel files such as `output/writes.html` and `output/writes.blocks.json`. Fail with a clear prerequisite message. Merely asserting that `output/` exists, without copying it, improves the error but leaves the gate unusable.
3. Add a regression test around an extracted fixture-preparation helper.
4. Later, replace laptop state with a small committed fixture corpus under `tests/fixtures/`. That debt is already acknowledged in [deploy-pipeline.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/deploy-pipeline.md:466). This likely does not require rewriting 14 tests independently; central fixture loaders can carry most of it.

Your objection is valid, but it already applies. The test gate currently means “does this exact committed source work against this laptop’s declared test environment?”, not “can a fresh clone reproduce everything?” Copying `output/` completes that environment; it does not create the underlying compromise.

One concrete example of the compromise: copying `output/` lets `doc-links` accept the ignored Noema file linked from [open-questions.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/open-questions.md:16). So this must remain an interim repair.

For skips, I would not use “at most 2.” Instead:

- Keep ordinary `npm test` permissive.
- Give the deploy run a profile that fails on any unexpected skipped test and names it.
- First identify the surviving two skips.
- Strengthen the database prerequisite: the present `select 1` check at [deploy.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/deploy.ts:384) proves connectivity, not that required tables, columns, `auth.users`, and grants exist. Run the existing schema check and any required capability probes.

## Defect 2

Diagnosis: the one-shot query defect is confirmed; the precise cause is not.

The later successful execution proves that `--deployment`, `--json`, and that deployment ID can work. It only bounds visibility to sometime between the two queries. The first query might instead have suffered a CLI, authentication, network, API, or parsing failure.

Current code conflates all of those because it:

- ignores the command exit code;
- silently drops every non-JSON or malformed line;
- accepts any path containing `__deploy-smoke__`, rather than the exact unique path ([deploy.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/deploy.ts:1191));
- suggests `--verify-only`, although that path never calls `readLogs()` ([deploy.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/deploy.ts:1211)).

Polling is the right shape, after fixing those.

I would:

1. Return a structured query result distinguishing command failure, parse failure, successful-empty, and successful-with-lines.
2. Match the exact smoke path, including its deployment UID.
3. Put the sentinel after the other log-producing probes, then use the remaining static verification work as free waiting time.
4. Poll if still absent. Accumulate rows across attempts so an error visible on an early attempt cannot disappear later.
5. After seeing the sentinel, perform one short final grace query unless Vercel’s ingestion ordering is established.

A provisional 120-second budget with attempts near 0, 2, 5, 10, 20, 40, 70, 100, and 120 seconds is reasonable as an operator-wait budget. It is not a measured p95. Your present observation supports neither “tens of seconds” nor “90 minutes.”

To measure it defensibly, give every probe a unique ID and record:

- request time;
- each query’s exit status;
- first-observed interval;
- timeouts as censored observations.

Collect dozens of independent samples across deployments and times of day. Fifty or more would begin to make a p95 useful; a burst of probes in one deployment may all share the same ingestion batch.

Finally, retain exit status 1 after timeout. The command promised “deployed and verified,” and that postcondition was not met. But report it as:

> Deployed and functional checks passed; log verification was inconclusive.

Do not recommend rollback solely because logs were unavailable. The current summary does, and can even print “SCHEMA ADVANCED; CODE MAY NOT HAVE” for a missing-log failure at [deploy.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/deploy.ts:1297), despite having confirmed the deployment live. That state handling should be corrected alongside polling.

No files were changed.