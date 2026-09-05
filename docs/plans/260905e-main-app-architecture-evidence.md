# Main app architecture review: evidence and validation

Status as of 2026-09-05: validation record for the documentation-only
[architecture proposal](260905e-main-app-architecture-review.md) and
[mode catalog/command-bar companion](260905e-mode-catalog-and-command-bar.md).

The source audit began at `fd370cfe050fc9ad0bdfd107668b857abaab5219`. This is a shared primary
checkout on the Mac; peers committed/edited source during the run. At the initial documentation
check HEAD was `4e1175da71b19f6970e7daeaba50f71e571b419f`. This task changed only the listed
planning/review documents. It did not implement a refactor or change a fixture to make checks pass.

## Production client build

Command: `npm run build:client`. Exit 0. Selected verbatim output:

```text
vite v8.2.2 building client environment for production...
✓ 2682 modules transformed.
dist/assets/main-BD_zzLhE.css   217.45 kB │ gzip: 37.11 kB
dist/assets/index-De5TCdR_.js    20.69 kB │ gzip:  8.12 kB
dist/assets/main-Dyzrlb38.js  1,471.79 kB │ gzip: 443.84 kB
✓ built in 534ms
```

The reporter warned that the dynamic import of `src/web/lib/supabase.ts` in `PublicChrome.tsx`
is ineffective because several other modules import it statically. Asset sizes are emitted sizes,
not measured network transfer or mobile latency. No device/browser benchmark was performed.

## Typecheck and full check

`npm run typecheck` passed after rerunning outside the restricted sandbox; the initial invocation
could not create tsx's local IPC socket. The successful command checked all three projects and
reported 1,327 source files covered. This is distinct from the later full check, which also passed
typecheck and checked committed source.

`npm test -- --reporter=dot` initially hit sandbox restrictions on the local database, then ran
outside the sandbox against the repo's isolated test database. It reported 5 failing suites,
685 passing, 1 skipped; 12,405 passing tests. Failures included two source-fixture publication
refusals, a billing timestamp assertion and checks reading stale API build output.

`npm run check` was then run with its normal configuration, including both build passes and the
isolated database test lane. It exited 1. Selected verbatim summary:

```text
Test Files  2 failed | 690 passed | 1 skipped (693)
     Tests  12422 passed | 456 skipped (12878)

  ✓ typecheck    clean
  ✓ build        clean
  ✗ test         FAILED
  ✓ cycles       clean
  ✓ chain        clean
  ✓ committed    clean
  ! lint         has findings
  ! knip         has findings
  ! complexity   97 finding(s)
  ! dupes        296 finding(s)
```

Both remaining failed suites were `tests/store-parity.test.ts` and
`tests/store-roundtrip.test.ts`, in setup through `tests/helpers/load-article.ts`. The same error
was reported by each:

```text
PublishRefused: Refusing to publish "source": n0054 → n0055: covers its parent's whole range,
so one rung finer restates the same blocks instead of compressing them (granularity-zoom.md#the-tree)
```

This is a fixture/publication-contract problem outside the documentation change. It is recorded
as an unresolved repository check failure, not described as a green test run. The isolated database
was dropped by the test runner on completion. No production database was used.

## Documentation check

Command: `npx vitest run --project unit tests/doc-links.test.ts --reporter=dot`. Exit 0:

```text
Test Files  1 passed (1)
     Tests  14 passed (14)
```

Round-one Sol independently reran this check at
`7a618dd0488e5548961d4c81450cfcccb4666aad`: 13 passed / 1 failed because of an unrelated
`summaries.md` citation to `types.ts § TreeNode.question`. A peer corrected that citation in
`99d231db`; no fixture or project doc was edited by this task.

After the review corrections, a fresh run at 16:23 local test-runner time on 2026-09-05 again
exited 0: **1 file / 14 tests passed**, duration 1.39s. HEAD inspected immediately after was
`99fe2cb822c188f5e01566df9c0f8c417afe4fed`. The initial green result, intervening peer failure and
new green result are separate snapshots, not contradictory claims about one frozen tree.

Round two independently passed 14/14. After the final F8 amendment and review artifacts were present,
the author's 16:33 rerun passed **14/14**, exit 0, duration 1.35s, on the same inspected HEAD. The
doc check validates relative files and anchors, including code links. These documentation edits do
not justify rerunning every unrelated database suite. `npm run check:staged-revert` also passed:
“nothing in the index undoes a commit.”

## Limits

Source-proved observations are not browser reproductions. Cache ordering was traced through
`apiFetch` → `saving` → `writeCached`; deferred-request reproduction is specified as the first
implementation task. Physical mobile behaviour, annotation cost and geometry savings still require
the measurements and controls in the plan. Previous model recommendations were checked against
the user quotations and current implementation; they are not treated as product authorisation.

Up: [Architecture proposal](260905e-main-app-architecture-review.md)
