## Review outcome

I would not ship stage 2 unchanged. I found two serious issues: the Sentry change defeats a deliberate privacy boundary, and the storage-publication path still exposes a raw diagnostic to readers.

### Findings

1. **Critical — `diagnosticFor` turns the reader code into a false certificate that arbitrary text is safe for Sentry.**

   [`diagnosticFor`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/job-failure.ts:170>) appends a registered code to any uncoded diagnostic. But [`authored`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/monitoring-scrub.ts:37>) explicitly treats that code as proof that the entire message was authored by us, and [`sanitise`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/monitoring-scrub.ts:213>) consequently forwards it verbatim.

   I reproduced this:

   ```text
   stageFailure(MODEL_REFUSED, "ARTICLE_SENTINEL: private prose")
   → Sentry: "ARTICLE_SENTINEL: private prose [ai-model-refused]"
   → withheld: false
   ```

   So this works around a correct `monitoring-scrub` rule and invalidates its provenance check. The immediate safe fix is to stop appending the code and accept that uncoded diagnostics remain in logs but are withheld from Sentry. If selected diagnostics should reach Sentry, they need a separate explicitly safe/authored channel—not a suffix that any detail can acquire.

   There are two further inconsistencies:

   - An already-coded diagnostic keeps its original code even when it conflicts with the declared reader failure. The test at [`tests/job-failure.test.ts:353`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/tests/job-failure.test.ts:353>) blesses a `MODEL_REFUSED` failure whose diagnostic ends in `[db-busy]`, so the code can genuinely misrepresent the diagnostic.
   - `TooLongForOnePass` does not pass through `diagnosticFor`; its uncoded diagnostic at [`src/token-budget.ts:141`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/token-budget.ts:141>) is still withheld. I reproduced that too. Therefore comments saying diagnostics reach “the log and Sentry,” including [`src/job-failure.ts:99`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/job-failure.ts:99>) and [`src/messages.ts:701`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/messages.ts:701>), are already false.

2. **High — the seam does not close: `PublishRefused.message` still reaches `job.error` raw.**

   The main `runStep` catch is correctly sealed through `readerFailureOf` at [`src/jobs.ts:679`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/jobs.ts:679>). `DraftGoneError` is also safe: it bypasses that catch and becomes the fixed lost-draft sentence through `endAsStorageFailure`.

   However, `endAsStorageFailure` deliberately copies `PublishRefused.message` directly into `job.error` at [`src/jobs.ts:1034`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/jobs.ts:1034>). That message is constructed at [`src/store/pg-revisions.ts:368`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/store/pg-revisions.ts:368>) from internal publication reasons that can contain revision IDs, hashes, run statuses, validation problems, and instructions such as “re-run hierarchy”; see [`src/store/pg-revisions.ts:1301`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/store/pg-revisions.ts:1301>) and [`src/store/pg-revisions.ts:1493`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/store/pg-revisions.ts:1493>).

   This needs the same split: generic/declared reader copy in `job.error`, raw publication reasons in diagnostics. Other exceptions escaping the outer walk are logged and eventually settled as the fixed interrupted failure; I did not find another raw generic exception being persisted.

3. **Medium — cancellation can produce contradictory reader state.**

   `readerFailureOf` is evaluated before the abort branch at [`src/jobs.ts:709`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/jobs.ts:709>). On cancellation, capture/reporting is skipped at [`src/jobs.ts:720`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/jobs.ts:720>), but that reader sentence is still written into `step.error` before the job is marked cancelled at [`src/jobs.ts:742`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/jobs.ts:742>).

   Consequences:

   - The generic sentence can say the problem “has been recorded” when Sentry capture was deliberately skipped.
   - A refusal racing with Stop can leave a non-retryable step sentence while cancellation clears `failureKind` and makes the job retryable.

   Cancellation should select its own interrupted/stopped reader state before persisting the step failure.

4. **Medium — the generic `blocked` copy gives advice that is not generally true.**

   Totality is real: [`STEP_GAVE_UP`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/messages.ts:721>) is a `Record<FailureKind, …>`, so adding a fifth kind without copy is a type error.

   The step labels are useful orientation and are already reader-visible; I do not consider them an internal leak. But “A shorter piece sometimes gets through” is not a sound generic remedy for all blocked failures. `RawDocumentUnavailable` at [`src/pipeline.ts:1489`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/pipeline.ts:1489>) and `NoBlocksProduced` at [`src/pipeline.ts:1669`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/pipeline.ts:1669>) are examples where shortening is unrelated. The total fallback should make only the universal claim: repeating the unchanged request is unlikely to help.

5. **Medium — the seam test protects `runStep`, not the whole failure class, and it does not prove durable persistence.**

   The new test does inspect the resulting `job.error`/`step.error` pair through the store at [`tests/step-failure-seam.test.ts:86`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/tests/step-failure-seam.test.ts:86>). That is valuable.

   But it only injects failures into `STEPS.fetch.run`, so it cannot catch the `endAsStorageFailure`/`PublishRefused` hole above. Also, filesystem `getJob` returns a clone of the in-memory index at [`src/store/jobs-fs.ts:460`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/store/jobs-fs.ts:460>); it does not reload the persisted file. Thus serialization or database-column loss could pass this test. Add an outer-publication case and at least one actual Postgres or reload-based assertion if the test is intended to prove the persisted pair.

### Other questions

- **`failureKindOf(err)` versus `reader.kind`:** the current choice is right. Shelf rendering and retry authorization both use `jobWorthRetrying`, which treats missing and `retry` identically at [`src/job-failure.ts:251`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/job-failure.ts:251>). `settleExpired` overwrites the ending with `INTERRUPTED`; it does not interpret the previous kind. Keeping `undefined` honestly records that no throw site declared a classification.

- **`StepFailure` shape:** keeping `message`, `retryable`, and `retry` together is the better type. It prevents the exact split-state problem the hook warns about.

- **No button for non-retryable empty-state failures:** correct if the only available action would repeat the identical request. Existing populated-band actions such as “Find more” or “Write it again” are semantically new requests, so retaining those is consistent.

- **Deferred work:** Readability, `NoBlocksProduced`, and generic refusals may remain generic under option (a). The PDF page cap is genuinely actionable and should get declared copy soon, but it is not a correctness blocker for this stage. The internal PDF chunk-size limit should remain generic. Not repeating an arbitrary SDK configuration message is the correct privacy choice. Deferring thread-page `starting` is also acceptable; it is a duplicate-submission UI issue, not a seam issue.

- **Stale explanation:** [`src/job-failure.ts:221`](</home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/job-failure.ts:221>) still describes the old mechanism—throwing reader sentences as `Error.message` from six stages—and should be updated.

### Verification

Focused suites for messages, monitoring scrub, job progress, quiz panel, quiz generation, Anthropic calls, background reload, refusal reasons, and the step-job driver passed. The equivalent direct TypeScript check passed for web, tests, and root projects.

The new seam suite could not complete faithfully in this read-only workspace: three cases passed, while two hit `EROFS` writing `data/_jobs`. The storage-backed `job-failure` case likewise could not contact local Supabase. Those are environment limitations, not code-test failures.