The stage-3 review fixes are **finished**. All five findings were reproduced, addressed, and verified. No commit was created.

### Findings

1. **Reproduced — persisted reset outside its window**

   - Red: encoder accepted the year-5138 reset: `expected function to throw`.
   - Green: encoder now rejects it, while the decoder degrades old/malformed bytes to non-retryable `unknown`.
   - This restores the independent persistence boundary: a producer regression cannot resurrect stage 2’s timestamp bug.

2. **Reproduced — current lines could look legacy**

   - Red: encoded `collector-failed` input lacked `codex`: `expected false to be true`.
   - Green: every current encoding now supplies either its observation or an explicit non-retryable `unknown`.
   - The legacy case now uses old bytes via `JSON.stringify` after deleting the key, never today’s encoder.

3. **Reproduced — synchronous collector throw escaped settling**

   - Red: combined run settled while Claude remained unresolved: `expected true to be false`.
   - Green: both collectors are invoked through promise continuations, so synchronous throws enter `Promise.allSettled` and the other collector remains awaited.

4. **Reproduced — absence 3 is not producer-reachable**

   - Red: expecting a preserved value from model-only input received top-level `unknown` with the missing-general-bucket reason.
   - Green: the producer test explicitly asserts that safe collapse. The record test separately proves the persisted format can represent model-only buckets.
   - I followed your override and **disagree with Sol’s preservation change**: it would weaken the safeguard against substituting model-specific limits for general headroom.
   - The stage-3 report now describes absence 3 accurately.

5. **Reproduced — comment defeated substring assertion**

   - Red: with real wiring removed and the exact decoy comment present, the AST assertion returned `false`.
   - Green: restoring the actual descendant call returned `true`.
   - Sol’s exact TypeScript snippet was incompatible with this checkout: TypeScript 7’s package root exposes version metadata, not `createSourceFile`. I used the repo’s already-declared, TypeScript-capable Babel AST parser—the established stable alternative—without adding a dependency.

Changed tests:

- [fleet-usage-history-record.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tests/fleet-usage-history-record.test.ts): findings 1–2, honest format-level absence coverage.
- [fleet-usage-history-wiring.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tests/fleet-usage-history-wiring.test.ts): findings 3 and 5.
- [codex-usage.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tests/codex-usage.test.ts): finding 4’s producer behavior.
- [stage-3 report](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/docs/plans/260909d-codex-usage-stage3-report.md): corrected the absence-3 claim.

### Verification

- Six focused suites: **106 tests passed**
- Direct server/tool TypeScript project: passed
- Direct test TypeScript project: passed
- Touched-file lint: passed, with four pre-existing informational findings in `scripts/overseer.ts`
- `git diff --check`: passed
- Full `npm test` and wrapper `npm run typecheck`: not run, as requested
- No network or live reading attempted

### Additional stage-4 cautions

Beyond the existing eight:

- Treat non-null `rateLimitReachedType` as decision-significant; displaying only its percentage could show apparent headroom despite a backend reached-state.
- The live card must re-evaluate reset expiry against the viewer clock. Historical chart points must not.
- `overseer usage --json` bypasses `usageLines()` and currently collects only Claude; updating text output alone will leave JSON incomplete.
- Codex history currently lives privately inside `UsageHistory`, while `UsageCard` has two mounts. Stage 4 needs explicit ownership so both intended locations receive the same reading.
- Persisted validation currently permits duplicate bucket IDs and duplicate window slots. A stage-4 consumer using `find()` or bucket-plus-slot keys must reject that ambiguity rather than choose arbitrarily.