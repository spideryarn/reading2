# Stage 1 review of 261006d

Reviewed commit `3fc557d0f`. Narrow fixes are in the working tree; nothing was
committed. Stage 2 files were left to their owner.

- **F21 — P2, reasoned: attribution is still vulnerable before the SDK emits its
  abort event. Fixed.** The reproduction is established: using the real SDK,
  `stream.abort()` followed synchronously by an external `StallReached` writes
  `aborted / mid_answer / stall`, although the SDK controller was already
  stopped independently. The original delayed-settlement test lets the SDK
  event arrive first and misses this interval. No production caller exposes
  independent `stream.abort()`, so production reachability remains reasoned.

  [The fix](../../src/messages-stream.ts#L693) captures the class when the
  SDK's public controller aborts synchronously. The later SDK event provides
  `abort` only if no controller attribution was captured. External clocks
  still reach that controller after their own signal has acquired its reason.
  Outcome classification is unchanged, so provider-error cleanup does not
  turn an error into a clock abort.

  **Red then green:** the new [same-turn regression](../../tests/messages-stream.test.ts#L1264)
  failed on the candidate with expected `abort`, received `stall`
  (`/tmp/261006d-sdk-red.log`). After the fix, the focused run passed 21 tests,
  including ordinary external clocks, composites and delayed SDK settlement
  (`/tmp/261006d-sdk-green.log`). The final four-file run passed 381 tests.

  **Root cause:** deferred observer attribution — the cause was inferred from
  mutable external state when an asynchronous notification arrived, rather
  than when cancellation occurred. Introduced by `3fc557d0f`'s abort listener.
  A separate read-only agent checked the SDK implementation and this fix.
  Capturing at the synchronous boundary and testing two cancellations without
  an intervening tick are the small, durable countermeasures. Exposing or
  replacing the private SDK stream would add unnecessary machinery.

- **F22 — P3, established: new comments overstate what is known. Fixed.**
  `deadline` was described as one whole call taking too long, and
  `CallDeadlineReached` as exclusively per-call. Actual deadlines include the
  PDF figure step budget, the chat turn budget (`src/converse.ts:2340`) and the
  embeddings sweep budget (`src/embeddings.ts:470`). The PDF locator can start
  near the end of its step budget and be aborted quickly. The comments now
  describe a recognised deadline expiring while the call is active; that does
  not establish a slow provider request. The OpenRouter stream comment also
  incorrectly reduced outcome classification to `signal.aborted`; it now
  states the causal throw check, clean-end race and in-band-error precedence.

  **Evidence:** traced timer creation and signal forwarding to the real seams.
  These are prose corrections, so no behavioral red test is claimed. Existing
  PDF budget and Structure reason-forwarding tests remain green. The specified
  mappings were preserved. Deciding whether counts should distinguish call,
  turn, step and job clocks is wider than stage 1 and remains unmodified.

- **F23 — P2, established: Messages preservation coverage missed a provider
  error followed by a later clock. Fixed in tests.** The production check was
  already correct. Changing it to `stream.aborted || options.signal.aborted`
  passed all 83 remaining Messages tests when the two new assertions were
  excluded. A later clock could therefore overwrite a provider failure without
  the existing tests noticing.

  **Red then green:** added cases wait for a real SDK provider error, then
  fire the clock before awaiting `finalMessage()`, both before and after
  `message_start`. Both failed under the mutation: expected `error`, received
  `aborted` (`/tmp/261006d-mutation-provider-wins-messages.json`). Restoring the
  causal predicate makes both green. They assert the complete failure tuple,
  one request, and the call's non-aborted result. No production change was
  needed for this finding.

The other requested attacks found no stage 1 defect:

- Each OpenRouter aborted end uses `Meter.stopped`; its phase follows that
  seam's acceptance boundary. Messages uses `message_start`. Consumer closure
  without a clock remains `abort`; cancelled reads that resolve cleanly retain
  their clock label. An observed OpenRouter in-band error still wins over a
  later abort.
- Messages retries now test outcome rather than null failure. The eval budget
  still bounds unknown-cost aborted calls: neither abort labels nor their
  non-null phase enter its error-refusal or unreadable-answer branches. Slot
  charging uses settlement kind, not failure-field presence. No changed
  charging decision was found.
- `src/collect-assets.ts:910` supplies ordinary image fetches at lines 999 and
  1095; that timer does not reach an AI gateway.
- The `AbortSignal.any` list-order caveat is reproducible on Node 26.8.1:
  without a listener, reversing temporal and list order chooses list order;
  with a listener it preserves the first firing source. Recognising arbitrary
  timeout reasons as deadlines remains the spec's explicit convention. The
  job deadline's `abort` mapping remains its declared omission.

Mutation controls applied exactly once and were restored by editing back:

| Deliberate defect | Failed tests |
|---|---:|
| Map `StallReached` to `abort` | 2 |
| Force OpenRouter abort phase to `before_answer` | 46 |
| Remove OpenRouter in-band-error precedence | 5 |
| Let a later signal override a Messages provider error | 2 new tests |
| Remove the Messages retry loop's abort guard | 1 (expected 1 attempt, received 3) |
| Revert one runner to plain `Error("stalled")` | 2 |

Validation: the four requested gateway files passed **381 tests**; PDF figures,
Structure slice queue and Dig deeper eval suites passed another **94**. All
three newly added assertions passed again after the test wrapper's generic
return type was corrected. The final retry-guard control and those three
assertions also passed together after all mutations were restored. Scoped
Biome lint and `git diff --check` passed.

`npm test` could not run the complete suite: the private-database setup was
blocked by sandbox access to local Postgres (`EPERM`). `npm run typecheck`
initially hit `tsx`'s blocked IPC socket; running the same script with
`node --import tsx scripts/typecheck.ts` bypasses that launcher restriction.
The initial equivalent run passed all four projects and source coverage. The
last equivalent run reported only `TS2304` at
`tests/cost-analysis-cli.test.ts:466`: the concurrent stage 2 test cannot find
`CostAnalysis`. All other projects and source coverage passed, with no
remaining errors in the stage 1 files. That stage 2 mismatch was reported and
left unmodified; this verdict covers stage 1 after the fixes, not the combined
tree's readiness.

VERDICT: ship it
