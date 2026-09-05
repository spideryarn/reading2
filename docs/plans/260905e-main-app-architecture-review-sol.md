# Verdict: NOT READY

The catalog/action separation is a good direction, and the proposal correctly revisits earlier judgments rather than treating them as product decisions. However, implementing it as written leaves several established P0/P1 failure paths. The documentation should close these contracts before becoming implementation-ready.

## Findings

### F1 — P0 — Established: uncertain job submission has no enforceable idempotency

- **Candidate:** [“Identity, intent, cancellation and retries”](</Users/greg/dev/spideryarn/reading2/docs/plans/260905e-mode-catalog-and-command-bar.md:182>) and [Stage 2](</Users/greg/dev/spideryarn/reading2/docs/plans/260905e-mode-catalog-and-command-bar.md:313>).
- **Source evidence:** [`useJobs.run`](</Users/greg/dev/spideryarn/reading2/src/web/useJobs.ts:139>) submits no client request ID; [`parseJobRequest`](</Users/greg/dev/spideryarn/reading2/src/routes.ts:4554>) accepts none. The database uniqueness constraint in [`jobs_active_work`](</Users/greg/dev/spideryarn/reading2/src/db/schema.ts:2035>) covers only queued/running jobs, not completed work.
- **Failure:** The server accepts and completes a paid job, but the response is lost. Matching the jobs list by “work identity” cannot enforce at-most-once once the first job is terminal, ambiguous, or pruned. An automatic resend can create and charge for the same job again.
- **Smallest replacement wording:**
  “Every paid action carries a client-minted idempotency key persisted under a unique owner/action constraint; repeating the key returns the original job, including after completion. Until that server contract exists, an uncertain POST is never resent automatically: reconcile only an unambiguous observed job, otherwise return `outcome: "unknown"` and require a new user decision.”

### F2 — P1 — Established: the proposed local error boundary can preserve an unclaimed paid activation

- **Candidate:** [A2, local feature error boundary](</Users/greg/dev/spideryarn/reading2/docs/plans/260905e-main-app-architecture-review.md:190>) and [its implementation stage](</Users/greg/dev/spideryarn/reading2/docs/plans/260905e-main-app-architecture-review.md:514>).
- **Source evidence:** [`Dock`](</Users/greg/dev/spideryarn/reading2/src/web/Dock.tsx:1437>) arms an activation before changing mode. [`useAutoRun`](</Users/greg/dev/spideryarn/reading2/src/web/useAutoRun.ts:123>) claims it only in a post-render effect. [`claimActivation`](</Users/greg/dev/spideryarn/reading2/src/web/activation.ts:241>) allows the first matching mount to claim an ownerless token. There is no production cancellation operation for an activation whose first render throws.
- **Failure:** A deliberate click arms a paid mode; its initial render throws; the new local boundary keeps the shell usable. Returning to Plain and later pressing Back/retrying can mount the controller and claim the stale token, starting paid work without a new deliberate click.
- **Smallest replacement wording:**
  “When the initial target render fails before activation is claimed, the boundary retires the exact `(slug, target, nonce)` activation it intercepted. Boundary retry never reuses spend intent. Test: Dock press → initial render throw → Plain → Back/retry produces zero job POSTs until a fresh explicit activation.”

### F3 — P1 — Established: the typed action inputs omit existing user choices

- **Candidate:** [“The action layer”](</Users/greg/dev/spideryarn/reading2/docs/plans/260905e-mode-catalog-and-command-bar.md:131>) and [Stage 2](</Users/greg/dev/spideryarn/reading2/docs/plans/260905e-mode-catalog-and-command-bar.md:313>).
- **Source evidence:** [`StepRun`](</Users/greg/dev/spideryarn/reading2/src/web/useStepJob.ts:82>) includes `force`, `useProfile`, and prerequisite information; [`start`](</Users/greg/dev/spideryarn/reading2/src/web/useStepJob.ts:519>) preserves an explicit profile opt-out. [`ChatApi.send`](</Users/greg/dev/spideryarn/reading2/src/web/useChat.ts:234>) requires thread and option semantics beyond `{question, anchor}`.
- **Failure:** Migrating existing UI triggers through `artefacts.ensure { outputs }` or `chat.ask { question, anchor }` must either discard choices such as “do not use my profile,” infer mutable UI state, or send into the wrong/new thread. The plan simultaneously defers thread/draft behavior as an open question while saying it does not block the pilot.
- **Smallest replacement wording:**
  “Action arguments contain every semantic choice currently owned by the initiating control. At minimum, `artefacts.ensure` carries `useProfile`; `chat.ask` uses a discriminated new/existing-thread target and carries `useProfile` plus any Remember stance. Actions must not recover omitted authority from mutable UI state. Command-bar thread and draft behavior must be decided before `chat.ask` enters the pilot.”

### F4 — P1 — Established: immediate natural-language execution can hide prerequisite cost

- **Candidate:** [intent and confirmation rules](</Users/greg/dev/spideryarn/reading2/docs/plans/260905e-mode-catalog-and-command-bar.md:192>) and [command UI](</Users/greg/dev/spideryarn/reading2/docs/plans/260905e-mode-catalog-and-command-bar.md:272>).
- **Source evidence:** The authoritative Illustrated decision requires prices and waits to be shown before pressing, including prerequisites, in [diagram.md](</Users/greg/dev/spideryarn/reading2/docs/project/diagram.md:1564>). The live view likewise presents the price before activation in [`IllustratedView`](</Users/greg/dev/spideryarn/reading2/src/web/IllustratedView.tsx:72>).
- **Failure:** “Generate Illustrated” may implicitly generate Sketch. With voice/free text, that expanded plan and total price often become known only after submission. Treating unambiguous wording as sufficient intent permits hidden prerequisite spend, contrary to the explicit product decision.
- **Smallest replacement wording:**
  “Do not add a redundant confirmation when a deterministic paid row displayed its current total cost and wait before selection. A free-language or voice plan executes immediately only if its full effects—including prerequisites and total cost/wait—were disclosed before submission; otherwise show one inline confirmation of the interpreted paid plan.”

### F5 — P1 — Established: issue-order cache tickets can discard the newest successful response

- **Candidate:** [A0, cache ticket/epoch design](</Users/greg/dev/spideryarn/reading2/docs/plans/260905e-main-app-architecture-review.md:118>).
- **Source evidence:** The proposal makes every response older than the latest issued ticket ineligible, while allowing a metadata-reservation/network failure to skip saving.
- **Failure:** On an empty cache, request T1 reserves first, T2 reserves second, T2 fails, and T1 succeeds. T1 is rejected as stale, T2 has no body, and nothing becomes available offline even though a valid response arrived.
- **Smallest replacement wording:**
  “A later failed ticket must not permanently supersede an earlier successful response. Define ticket retirement/outcome handling so the newest successful eligible response can commit when all later tickets failed. Test an empty-cache T1-success/T2-failure ordering. Bound metadata reservation latency; if reservation does not complete promptly, start the network request and skip caching.”

### F6 — P1 — Established: the atomicity design covers response writes but not the other cache writers

- **Candidate:** [A0](</Users/greg/dev/spideryarn/reading2/docs/plans/260905e-main-app-architecture-review.md:118>) and [cache implementation stage](</Users/greg/dev/spideryarn/reading2/docs/plans/260905e-main-app-architecture-review.md:502>).
- **Source evidence:** [`readCached`](</Users/greg/dev/spideryarn/reading2/src/web/lib/offline-store.ts:127>) asynchronously writes a copied old row to update `lastOpened`; [`writeCached`](</Users/greg/dev/spideryarn/reading2/src/web/lib/offline-store.ts:155>) can concurrently store a fresh body. [`evict`](</Users/greg/dev/spideryarn/reading2/src/web/lib/offline-store.ts:210>) also selects victims from a snapshot and deletes them later.
- **Failure:** A cache read copies an old row, a network response stores new content, then the delayed LRU touch puts the old copied row back, restoring stale body and `savedAt`. Eviction can similarly delete a fresh replacement chosen from an obsolete snapshot. Ticketing only network response commits does not fix these writers.
- **Smallest replacement wording:**
  “The atomic protocol covers every operation that writes or deletes cache records: response commit, LRU touch, invalidation, and eviction. Metadata touches update only metadata against the current row in one transaction; they never put a previously read body. Eviction validates the selected record’s version in the deleting transaction.”

### F7 — P3 — Established: the validation evidence is no longer current

- **Candidate:** [evidence § Documentation check](</Users/greg/dev/spideryarn/reading2/docs/plans/260905e-main-app-architecture-evidence.md:73>).
- **Evidence:** At current HEAD `7a618dd0488e5548961d4c81450cfcccb4666aad`, the permitted command failed with 13 passing and 1 failing test: `docs/project/summaries.md` links to the now-missing `types.ts § TreeNode.question`.
- **Consequence:** The recorded result was accurate at the earlier HEAD, and the failure appears to be unrelated peer drift, but the live candidate cannot be described as presently doc-link green.
- **Smallest replacement wording:**
  “A current-HEAD rerun on 2026-09-05 produced 13 pass / 1 fail due to an unrelated peer change: `summaries.md → types.ts § TreeNode.question`. The candidate’s four files introduced no reported link failure.”

I did not rerun the full suite, database tests, or provider tests. The evidence file correctly reports the two pre-existing fixture-publication failures rather than claiming that all tests pass. No files were changed.

The earlier offline scope was checked from memory and then reverified against the candidate and current source.
