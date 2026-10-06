**Verdict: ship with these fixes applied.** No P0 finding. Changes are uncommitted.

| ID | Severity | Input and reproduced result | Fix and regression test |
|---|---|---|---|
| C1 | P1 | ` FAIL  tests/my file.test.ts > x` was recorded as `file.test.ts`. Reproduced. | Preserved badge delimiters; unsupported paths return unknown. Red-first test in `readiness-failed-files-review.test.ts`. |
| C2 | P1 | A real failing test’s error quoted a child’s ` FAIL ` line. Scanner reported **2 files**; Vitest reported **1**. Reproduced. | Ambiguous diagnostic lines invalidate the names. Added the real capture and a red-first regression. |
| C3 | P1 | A partial summary reported an exact total; an unfinished final FAIL line was ignored. Reproduced. | Require completed groups and agreement with the streamed file tally, counting project/path executions separately. Red-first scanner regressions. |
| C4 | P1 | Newer unnamed failures left older rows marked “latest”; tied hidden rows were called older; capped observations had exact first/last claims; missing-name explanations asserted an unsupported cause. Reproduced in rendered-panel tests. | Corrected latest selection and qualified the copy. Four red-first panel regressions. |
| C5 | P2 | Wire parser accepted binary paths and `{files:[one], total:3}`, which the disk parser rejects. Reproduced; current server normalization prevents visible effects. | Browser now uses the canonical record validator. Red-first wire tests. |
| C6 | P3 | Escaped capped paths produced an **8,853-byte** record, disproving the asserted 8 KB maximum. Reproduced. | Corrected the size estimate and strengthened the store round-trip test. Still safely below **64 KB**. |

Files changed:

- Scanner, shared validator and size comment: `tools/fleet/readiness-parse.ts`, `readiness.ts`, `readiness-store.ts`.
- Panel/client: `tools/fleet/web/src/ReadinessPanel.tsx`, `readiness-client.ts`.
- Tests: `tests/fleet-readiness.test.ts`, `fleet-readiness-failing-files.test.tsx`; added `readiness-failed-files-review.test.ts` and the quoted-error fixture.
- Updated the stage plan and readiness reference; added [the root-cause write-up](/var/tmp/spideryarn-worktrees/sweep7-readiness-failed-files/docs/postmortems/261006p-diagnostic-text-promoted-to-exact-readiness-history.md).

Validation:

- Final targeted run across **9 files: 321 passed, 11 skipped**.
- Unfiltered run: **303 passed, 11 failed**. Those failures involved sandbox-blocked subprocesses; they are not findings. Wrapper checks need rerunning outside this sandbox.
- Typecheck passed: **4 projects**, all **3,337 source files** covered.
- Lint: **0 errors, 0 warnings, 124 informational diagnostics**. `git diff --check` passed.
- No `npm test`, network access or commits.

Wider notes: text parsing cannot prove provenance against a fully forged reporter transcript; structured reporter output would require wider design work. No stage-specific retention, two-writer or log-reconstruction defect was found.