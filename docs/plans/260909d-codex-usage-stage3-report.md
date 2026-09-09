Implemented stage 3 without committing.

### Persisted shape

`UsageHistoryLine` now has top-level `codex?: CodexObservation`:

- `value`: `accountId`, `readAt`, buckets, windows, credits, reset credits, `individualLimit`, `spendControlReached`, and limit-reached state.
- `unknown`: `why` plus `retryable`.

It is record-owned and mapped field-by-field from `CodexUsageReading`. Malformed persisted Codex data becomes a non-retryable `unknown` while the Claude observation survives.

The six absence locations are:

1. Missing `codex` key: legacy writer.
2. `codex.kind === "unknown"`: attempted collection failed.
3. Value with no general `codex` bucket.
4. General bucket without the expected window.
5. `accountId: null`.
6. `resetCredits: null`.

New omission markers also receive explicit Codex `unknown`; they cannot masquerade as legacy lines. `SUMMARY_SCHEMA` and `LINE_SCHEMA` remain `1`.

### Composition and race protection

Both collectors run inside the daemon’s awaited `usage.run()` using `Promise.allSettled`. Codex rejection becomes `unknown`; Claude rejection is rethrown. The synchronous `onPass` consumes and clears the Codex stash before writing.

Red→green evidence:

- Moving Codex collection into async `onPass` made the no-overlap test fail: four Claude passes began while the first Codex read remained unresolved (`expected 1, received 4`).
- Restoring awaited collection made it pass.
- Reverting the actual `runParsed` callsite to Claude-only wiring failed the new composition-root assertion.
- Restoring `usageHistoryDaemonOptions(usageRetention)` made it pass.

The test uses the real daemon, retention hook, scratch JSONL writer, shutdown path, and disk reader.

### Specification gaps found

- Stage 2 currently converts “general Codex bucket absent” into the same structural `unknown` arm used for collection failures, distinguished only by `why`; it does not preserve the otherwise-valid model-specific buckets.
- `resetCredits: null` cannot distinguish “source cannot supply this” from “app-server omitted it” because the reading has no source discriminator.
- Unexpected rejected collector promises were unspecified; I classified them as retryable operational failures.
- When a combined record is oversized, the store does not salvage an otherwise-valid Codex value. The new line honestly records Codex as unknown, but partial salvage would require changing the out-of-scope `tools/fleet/usage-history.ts`.

### Stage 4 cautions

- The newest attempt must supersede older values even when Codex is unknown, absent, omitted, unreadable, or unsupported.
- Claude `collector-failed` lines may still contain valid Codex observations.
- Use file order for newest-state selection; use `codex.readAt` only for value age.
- Find the general bucket by `limitId === "codex"`; never substitute a model bucket or treat missing windows/reset credits as zero.
- The reader currently projects omission markers without their top-level Codex field.
- The browser whitelist still drops `codex`.
- Preserve values above 100 and clamp only bar geometry.
- Window keys need bucket identity plus slot, not duration alone.

Checks:

- 9 relevant suites: 144 tests passed.
- Direct TypeScript check passed.
- Touched-file lint passed with four pre-existing informational findings in `scripts/overseer.ts`.
- Final Sol review: all findings closed.
- `tests/no-undeclared-spend.test.ts` could not start because its `git ls-files` subprocess was denied with `EPERM`.
- No full `npm test`, network access, or live reading attempted.
- No commit created.