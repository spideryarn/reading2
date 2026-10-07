**Verdict: ship with the fixes made.** The established stage-E contract violations below are fixed in this worktree, without committing. No established P0 or P1 remains unfixed. The broader checkpoint deadline risk, F29, remains for a shared-storage decision.

Reviewed candidate `a079914e2f51ea223245568ebe7cfbf9b9c54e66`, using `git diff HEAD~1..HEAD`, the stage-E plan and its previous review. This report uses the conventional review path because the prompt supplied no actual `--output` filename.

**F22 — P1, established, fixed: the request counter omitted failed calls and transport retries.**

Reproduction: `tests/structure-slices-adversarial.test.ts`, the two F22 cases. One failing slice and one successful peer reported one call instead of two. Three transport attempts per successful request reported three calls instead of nine across two slices and the root. These tests were seen red before the fix.

The counter was downstream of `finalMessage()`, so rejection bypassed it; a returned message also concealed the wire's earlier attempts. `runSlices` now retains the metered call and adds `call.attempts()` in `finally`. A synchronous failure before a call is opened counts zero. Returned usage is still accumulated before interpreting refusals, truncations or invalid answers. Failed attempts without returned usage cannot be assigned invented token totals; their unknown usage remains the wire ledger's responsibility. This corrects run telemetry, not the charging ledger, which already records wire attempts.

**F23 — P1, established, fixed: a root statement passed as a question.**

Reproduction: the F23 test returns a valid short gist with `question: "The document discusses ownership."`. The candidate accepted it and appended a question mark, rather than re-asking and falling back. Seen red before the fix.

`acceptRoot` now requires the question returned by the existing question rule to equal the trimmed supplied question. An unfinished statement therefore fails acceptance; the root gets its bounded re-ask and then D. The ordinary article's question rule is untouched. This validates the finished question shape and duplication rule, not the truth or semantics of its wording.

**F24 — P1, established, fixed: expiration signalled abort but did not invalidate a late success or immediately stop admission.**

Reproduction: the three F24 tests resolve a slice or root one millisecond after its cap, or advance the clock beyond a slice's cap while a peer has an invalid answer. The candidate could publish a slices proposal or buy the peer's re-ask after expiration. Each regression was seen red before its fix.

The cap timer now stops admission immediately and records `out-of-time`. A separate wall-clock check handles expiration before timer dispatch. Late answers are awaited, counted, validated and checkpointed when good, but cannot make this attempt successful. The stop decision happens before the checkpoint await, so that await cannot reopen the race. Both slice and root cases leave zero armed timers.

This does not make an abort-ignoring transport settle by force. Awaiting every started call necessarily depends on the real transport honouring abort; the bounded queue tests exercise that cooperative case. F29 addresses the separate storage dependency.

**F25 — P2, established hardening, fixed: an already cancelled invocation still entered the model wrapper.**

Reproduction: the F25 test pre-aborts `opts.signal`. The candidate invoked the wrapper twice before ultimately throwing cancellation; the fixed path invokes it zero times. Seen red before the change.

Checks now precede checkpoint work in `ask` and every new-call admission. This is not evidence of two paid requests in production: `streamMessage` already handles an aborted signal with zero network attempts. The improvement keeps cancellation at the coordinator boundary too. Cancellation during calls is exercised through the queue, and cancellation after slices while reading the root checkpoint still throws rather than returning D.

**F26 — P1, established, fixed: terminal failure reached the coordinator one microtask too late.**

Reproduction: the F26 test makes the first slice reject and its peer return a root without sections. The candidate started three calls; only the two already in flight were allowed. Seen red before the fix.

The failure used to set `stopped` only after returning through `askSlice` to a pool worker. The peer could re-ask in that interval. Required requests now stop admission at the terminal failure site inside `ask`. Already started peers still settle and good answers are checkpointed. A separate regression waits for a peer that rejects after the first failure and completes without an unhandled rejection.

**F27 — P2, established, fixed: a throwing progress observer abandoned the pool.**

Reproduction: the F27 test throws from `onProgress` after one slice completes while another waits on a gate. The candidate returned its rejection before the gated peer settled. Seen red before the fix.

Progress exceptions are now logged and swallowed. They cannot decide whether paid work is awaited or checkpointed. The regression verifies that the invocation remains pending until the peer is released and all successful answers, including the root, are kept. The queue's current observer is a simple assignment and does not normally throw; this closes the broader callback boundary without changing its progress text.

**F28 — P1, established, fixed: a failed started refill still admitted the root.**

Reproduction: the F28 test supplies two 300-block slices with undivided 130- and 170-block sections, then rejects their refill calls. The candidate proceeded to a root request. Seen red before the fix.

A refill that has started is now subject to the same terminal-failure rule as a slice: stop admission, await peers, then return D. This deliberately replaces the candidate's keep-on-failed-refill behavior to satisfy the review prompt's F17 contract. Updated integration tests distinguish three cases: failed or empty refill gives D; a valid single section, including the same giant section, keeps the original; a refill that cannot fit before admission is skipped. Refills still have no re-ask, and no headings windows are mixed into a model tree. The existing `slice-failed` failure kind covers the failed refill.

**F29 — P2, reasoned, wider finding: the finish reserve is an allowance, not a bound on checkpoint I/O.**

`runSlices` awaits checkpoint reads and writes without their own deadline. Its call timer is cleared before checkpoint persistence; the shared checkpoint implementation in `src/store/checkpoints-pg.ts` and database pool in `src/db/client.ts` do not establish a settlement bound that fits the reserve. Cooperative model cancellation alone therefore cannot prove a hard end-to-end deadline under stalled storage.

Input to investigate: replace a checkpoint read or write with an operation that remains pending beyond the finish reserve, and drive the real queue walk under a clock. I did not run that storage-stall scenario or access Postgres. The queue evidence below uses promptly settling storage fakes, so it does not establish production behavior under such a stall.

Smallest wider closure: give the shared checkpoint/database operations bounded, cancellable settlement, propagate the remaining deadline, and test slow reads and writes through the queue. Racing a write and forgetting it would need an explicit persistence policy; merely increasing the reserve does not provide a bound. No shared storage code was changed here.

**F30 — P2, established, fixed: a partially resumed fallback was logged as wholly resumed.**

Reproduction: the F30 test first completes `generateStructure`, deletes one slice checkpoint, then retries with insufficient admission time. No model calls are made, some slices are reused, and D is returned. The candidate reported `wholeDocumentResumed: true`. Seen red before the fix.

The flag now also requires `sliced.ok`. A failed slicing attempt with partial reuse is not reported as a wholly resumed proposal. A successful partially resumed run still reports false because it made calls; a successful unchanged run still reports true and makes zero calls. The flag does not quantify partial reuse; adding that count to run logging would be a separate telemetry improvement.

**Other contract checks and decisions**

- Promoted-section tests reject overlap, gap, missing first block and out-of-slice starts. A real starts-only answer naming an ID outside its slice is re-asked and then gives D. One-block slices contribute sections. The existing integration tests cover heading-adjacent seam planning, retained seam starts and no dropped promoted sections. Starts-only parsing deliberately retains the ordinary parser's repairs; acceptance and final seam checks operate on the resulting proposal.
- Checkpoint read exceptions are misses. A stored invalid answer is replaced. Changing a slice's text and HTML with stable block IDs buys that slice again. Unchanged slices, refills and root reuse their canonical requests and make zero calls. Sharing the namespace is safe with those distinct request keys.
- The ordinary request digest remains `908b510ae3360ace`. No ordinary request assembly or model path was changed. `structure-slices.ts` continues to import only types from `structure.ts`; the cycles check remains clear.
- D remains the right fallback when the root cannot be accepted. A composed substitute gist would add a third publication convention with its own quality and acceptance rules. Successful slice checkpoints already preserve the expensive work for a later attempt. Root acceptance failures receive one re-ask; transport failures also have the wire's separate retry policy, now reflected in counts.
- Progress still reports completed initial slices; refills and root do not emit separate phase lines. The queue test asserts the exact out-of-time detail text. Other source/failure detail strings were inspected, but their entire mapping was not exercised through the pipeline; the forced unsound-tree and unaskable-label tests remain wiring tests.

**Validation**

Final passing runs, each requested as one test file:

- `tests/structure-slices-adversarial.test.ts`: 18 tests.
- `tests/structure-slices-queue.test.ts`: 3 tests.
- `tests/structure-step-slices.test.ts`: 34 tests.
- `tests/structure-step-slices-request.test.ts`: 2 tests.
- `tests/stated-limits.test.ts`: 5 tests.

Total: 62 passing tests across five files. The queue tests run the real `advanceJobWith`, pipeline structure step and generation code against fake storage protocols and fake models. They prove budget propagation, D committing before the queue abort, and reader Stop producing cancellation with no structure product committed. They do not test SQL fencing or publication transactions.

The budget-propagation test was additionally watched red after temporarily deleting the `src/jobs.ts` assignment: it expected `700000` and received `undefined`. The assignment was restored, and the queue file passed again. This closes the specific untested handoff identified in the prompt.

`node --import tsx scripts/typecheck.ts` passes. The whole-tree Biome import-cycle check passes. Touched-file lint exits zero with an existing optional-chain warning in `src/pipeline.ts` and informational complexity notices, including the request coordinator. `git diff HEAD --check` is clean. No full-suite run, model request, network access, Postgres operation or commit was performed. The paid book-through-queue run remains the next empirical check.

**Files changed**

- `src/structure-slices.ts`
- `src/structure.ts`
- `src/pipeline.ts`
- `tests/structure-slices-adversarial.test.ts` — new.
- `tests/structure-slices-queue.test.ts` — new.
- `tests/structure-step-slices.test.ts`
- `tests/stated-limits.test.ts`
- `docs/plans/261005a-long-documents-stage-e-code-review-sol.md` — this report.

`src/jobs.ts` was temporarily mutated for validation and restored byte-for-byte; it has no final diff. The independently appearing investigation document was not edited as part of this review.
