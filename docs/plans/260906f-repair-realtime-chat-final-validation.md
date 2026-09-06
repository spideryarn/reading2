# Realtime chat repair final validation

2026-09-06. Validation of the source snapshot at the time of this run. This is bounded evidence for
the repair; it is not a claim that the full `npm run check` gate is green. The existing checks record
two full-gate runs with unrelated failures in `admin-store.test.ts` and `billing-quota-race.test.ts`.

## Scoped regression suite

Command (run with local Postgres access):

```text
node --import tsx node_modules/vitest/vitest.mjs run tests/chat-*.test.* tests/live-*.test.* tests/conversation-*.test.* tests/dictation-*.test.* tests/doc-links.test.ts
```

The first sandboxed attempt could not reach the private database lane (`connect EPERM
127.0.0.1:54362`) and did not execute tests. The same command with loopback access exited 1:

```text
Test Files  1 failed | 53 passed (54)
Tests       1 failed | 845 passed (846)
Duration    25.84s
```

The only failure was the unchanged performance witness in
`tests/chat-web-links.test.ts` (`grows roughly linearly in the number of unclosed brackets`):
the measured ratio was 17.135, above the test's threshold of 8. An isolated rerun passed:

```text
node --import tsx node_modules/vitest/vitest.mjs run tests/chat-web-links.test.ts
Test Files  1 passed (1)
Tests       44 passed (44)
Duration    193ms
```

The scoped run therefore has one contention-sensitive/flaky witness in an unrelated chat-web-links
performance check, with the isolated test passing. No functional chat, live, conversation,
dictation, or doc-link feature assertion failed in the scoped run.

Raw output is retained at `/tmp/realtime-chat-scoped-vitest.txt` (file timestamp 15:31:17 EEST),
with the isolated witness at `/tmp/realtime-chat-web-links-isolated.txt` (15:31:30 EEST).

## Typecheck and builds

```text
node --import tsx scripts/typecheck.ts
exit 0
✓ src/web/tsconfig.json  (302 files)
✓ tests/tsconfig.json  (1349 files)
✓ tsconfig.json  (414 files)
✓ all 1425 source files are covered by some project

npm run build:client
exit 0
✓ 2701 modules transformed
✓ built in 423ms

npm run build:api
exit 0
✓ 240 modules transformed
✓ built in 156ms
```

The client build retained its existing large-chunk warning; it did not fail the build.

Raw outputs: `/tmp/realtime-chat-typecheck.txt` (15:31:38 EEST),
`/tmp/realtime-chat-build-client.txt` (15:31:59 EEST), and
`/tmp/realtime-chat-build-api.txt` (15:32:05 EEST).

## Touched-file lint

Command:

```text
npx biome lint --max-diagnostics=none src/spoken-label.ts src/routes.ts src/converse.ts src/types.ts src/web/App.tsx src/web/ChatPanel.tsx src/web/chat/controller.ts src/web/chat/effects.ts src/web/chat/model.ts src/web/chat/project.ts src/web/chat/reduce.ts src/web/live/LiveButton.tsx src/web/live/LiveStatus.tsx src/web/live/exchanges.ts src/web/live/tool-responses.ts src/web/live/useLiveConversation.ts src/web/live/wiring.ts src/web/preview-composer.tsx tests/chat-*.test.* tests/live-*.test.* tests/conversation-*.test.* tests/dictation-*.test.* tests/the-ideas-extraction-changed-no-requests.test.tsx
```

Exit 1. Biome checked 72 files and reported 7 errors plus 13 informational findings. The errors
are pre-existing: three `useExhaustiveDependencies` findings in `src/web/App.tsx` at lines 1468,
1505, and 1549, and four `noExportsInTest` findings in `tests/dictation-codes.test.ts` at lines
45, 67, 107, and 109. No fixes were applied.

Raw output: `/tmp/realtime-chat-lint.txt` (15:32:14 EEST). This was the targeted command shown
above; the broader initial touched-file lint recorded separately by the main validation had
additional pre-existing CSS findings.

The run used worktree `HEAD` `39282f8ca7e616a212720a7469e1b680cdf874e3` with the repair changes
present in the working tree. The scoped Vitest run began at 15:30:51 EEST.

## Final capped full gate

After the runtime source freeze, the standard gate ran with worker contention reduced but without
timeout changes:

```text
VITEST_MAX_WORKERS=4 npm run check
```

The source/test hash manifest was captured at 15:40:29 EEST and again at 15:47:52 EEST. Both
reported `HEAD 39282f8ca7e616a212720a7469e1b680cdf874e3`, and the SHA-256 hashes for every modified
or new `src/` and `tests/` file were identical. Raw manifests are
`/tmp/realtime-chat-final-source-hashes-start.txt` and
`/tmp/realtime-chat-final-source-hashes-end.txt`.

The gate ended at 15:46:55 EEST with exit 1. Typecheck, both builds, cycles, migration chain, and
committed-HEAD typecheck passed. The test phase reported:

```text
Test Files  4 failed | 745 passed | 1 skipped (750)
Tests       4 failed | 13575 passed | 58 skipped (13637)
Duration    350.61s
```

The four failures were:

- `tests/jobs.test.ts`: a concurrent caller test expected one `run` call and observed zero.
- `tests/store-jobs-parity.test.ts`: `TEST DATABASE CONTENDED` while claiming a job.
- `tests/client-imports.test.ts`: the new `src/web/chat/project.ts → ../../spoken-label.js`
  import violated the client's shared-pure-module boundary.
- `tests/public-network-trace.test.tsx`: the reopened-panel assertion observed `thread=spya-thr001`
  where it expected no thread parameter.

The full raw output is `/tmp/realtime-chat-final-check.txt`.

Per the final-gate rule, those four named files were rerun once together:

```text
VITEST_MAX_WORKERS=4 node --import tsx node_modules/vitest/vitest.mjs run tests/jobs.test.ts tests/store-jobs-parity.test.ts tests/client-imports.test.ts tests/public-network-trace.test.tsx
```

The rerun ended at 15:47:41 EEST with exit 1:

```text
Test Files  2 failed | 2 passed (4)
Tests       2 failed | 185 passed (187)
Duration    13.87s
```

The two job failures passed on rerun, so they were contention or scheduling-sensitive. The two
functional failures persisted unchanged: `tests/client-imports.test.ts` still reports the
`spoken-label.js` boundary violation, and `tests/public-network-trace.test.tsx` still observes
`thread=spya-thr001`. Raw rerun output is `/tmp/realtime-chat-final-failed-files-rerun.txt`.

The full run includes `tests/chat-spoken-route.test.ts` in the `private-postgres` lane, as recorded
by `tests/store-migration-registry.ts` and its witness registry; the full private-lane run completed
with the 750-file summary above. No separate rerun was made after the final gate.

## Final capped gate after the test-only fixes

After the client import-boundary and reopened-panel test fixes, the source/test snapshot was frozen
at `HEAD f0a614e479f2b0e5b2684e7548cb2e947d696603`.

```text
VITEST_MAX_WORKERS=4 npm run check
```

The run started at 15:53:15 EEST and ended at 15:57:27 EEST with exit 1. Typecheck, both builds,
cycles, migration chain, and committed-HEAD typecheck passed. Tests reported:

```text
Test Files  3 failed | 746 passed | 1 skipped (750)
Tests       5 failed | 13574 passed | 58 skipped (13637)
```

The three failed files were unrelated job/claim tests: `tests/jobs-commit-path.test.ts` (two
fixture/session-commit assertions), `tests/retry-is-only-for-a-failed-job.test.ts` (two fixture
completion assertions), and `tests/store-jobs-parity.test.ts` (one `TEST DATABASE CONTENDED`
assertion). The raw gate output is `/tmp/realtime-chat-final2-check.txt`.

The three named files were rerun once together. The rerun ended at 15:57:48 EEST with exit 1:

```text
Test Files  1 failed | 2 passed (3)
Tests       2 failed | 65 passed (67)
Duration    5.97s
```

Both `jobs-commit-path.test.ts` and `retry-is-only-for-a-failed-job.test.ts` passed on rerun.
`store-jobs-parity.test.ts` failed two assertions, both explicitly reporting test-database
contention (`already running 2 of 1 jobs`; `another claim is being decided`). Its private lane also
reported two tagged connections closed at teardown, without pollution. Raw rerun output is
`/tmp/realtime-chat-final2-failed-files-rerun.txt`.

The source/test SHA-256 manifest was identical before and after this gate (15:53:15 to 15:57:55
EEST); only the timestamp line differed. Raw manifests are
`/tmp/realtime-chat-final2-source-hashes-start.txt` and
`/tmp/realtime-chat-final2-source-hashes-end.txt`.

## Spoken-label helper move audit

The live source references are complete: `src/routes.ts` imports and uses
`shortenedSpokenLabel` for spoken passage and tool fields, while `src/web/chat/project.ts` imports
the same helper when comparing the server's capped metadata with a provisional spoken reply.
`src/spoken-label.ts` preserves the previous 400-character cap and trim semantics.

The repository sweep covered code, docs, plans, tests, scripts, and fixtures for
`MAX_SPOKEN_LABEL`, `SPOKEN_LABEL`, `spoken-label`, and `shortened`. There are no stale live-code
references to the removed local `shortened` function or to the old constant. Other matches are
unrelated locals or ordinary prose/history (for example `src/chat-tools.ts`, PDF fixtures, and
older plans), so no follow-up rename is required.
