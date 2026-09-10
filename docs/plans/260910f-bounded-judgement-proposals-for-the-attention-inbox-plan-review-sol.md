Refuse the committed plan as written: F1–F6 and F9 are established P1s. F7–F8 are P2s. Full findings are saved at [260910f-plan-review-findings.md](/tmp/260910f-plan-review-findings.md).

Review basis: the requested plan was `6638d2bd` when review began. HEAD advanced to committed Stage 1a `ac02c4c9`; I rechecked against that revision. A later uncommitted rewrite appeared in the shared tree and was not treated as the candidate. No repository file was changed.

### F1 — P1 — established: the hard budget has a bypass and crash gap

`overseer attention` currently makes paid calls while read-only by default and can run beside the daemon. The plan does not require shared cross-process exclusion, durable reservation before the request, or fail-closed handling of lost/corrupt budget state. Two callers can spend the last allowance, or a crash after the request can restore it. Post-response token/cost accounting is not a hard token/cost limit.

Replace D4 and its Stage 1 bullet with:

> `model-budget.ts` is the only entry to every paid attention call, daemon or CLI. Under one dedicated kernel-backed budget lock, it refuses an absent-after-initialisation, unreadable, future-day or backward-day ledger; checks global call, prompt-token, completion-token and cost reservations; and atomically persists and fsyncs a worst-case reservation before issuing the request. Hold the lock through reconciliation; a crash leaves the reservation spent. `--no-write` controls attention memory only, never budget accounting. Every request has a hard output-token cap. Test concurrent daemon/CLI calls, crash after reservation, restart, midnight crossing, clock rollback, and lost/corrupt ledger state.

### F2 — P1 — established: additive `judgement` is silent on old consumers

The three existing parsers ignore extra fields. An old server/browser will discard `judgement:{kind:"exhausted"}` and can render an empty list as calm. The reverse compatibility case—an old list read by a new consumer—is unspecified.

Replace D6 with:

> A fully judged list remains `kind:"list"` with required `judgement:{kind:"complete"}` for new readers. A stopped pass uses a new `kind:"limited"` arm carrying mechanical items/counts and `judgement:{kind:"exhausted"|"cooling-down", why, until}`. Old parsers reject that unknown arm into their existing loud unknown state. New parsers treat an old `kind:"list"` lacking `judgement` as unknown, never complete. Test every old/new producer-consumer direction across all three parsers.

### F3 — P1 — established: proposal failures can enter the cache

The proposed cached union includes `not-reached`, which covers 429s, cooldown, malformed answers and quote-validation failures. Nothing gives it the current classifier’s `CacheableVerdict` protection.

Add:

> Define `CacheableProposal` containing only successful `proposed` and `unplaced` judgements. Never store `off`, `not-reached`, quota/cooldown/transport/parse failures, failed quote checks, or `from-report` projections. Test failure followed by success for the unchanged key.

### F4 — P1 — established: two displayed judgements lack speaker attribution

`by` is free-form text; `from-report` has no source; marks have no actor or recorder. A displayed “right”, “wrong”, or report-derived instruction could therefore be mistaken for Greg’s judgement, contrary to gate 1.

Replace the relevant shape and UI wording with:

> Stamp `by` in code as `{kind:"model", model: ATTENTION_CLASSIFIER_MODEL, via:"overseer"}`; never accept it from the model. A report-derived proposal names the reporting session and observed execution and renders “reported by session X; recorded by the Overseer; not Greg”. Marks display `recordedVia:"local-cli"` and any claimed actor; without authenticated evidence say “identity not verified”. Test that no rendered arm presents Greg as speaker without authenticated Greg evidence.

### F5 — P1 — established: the report shortcut can cross executions

`same-verified-run` is frozen when the report is received. A new Claude process launched under the same tmux session/name can inherit the old blocked report. D10 also fails to exclude explicitly corrected reports.

Replace D10’s eligibility rule with:

> Carry the current verified execution token into `SessionToScan`. Use a report only when it is uncorrected, the actor name matches, its historical comparison is `same-verified-run`, and `event.observedExecution` equals the current token. Missing, unverifiable, different, or corrected evidence gets no shortcut. Record the token and event ID; test same-name relaunch and correction.

Removing the runtime report shortcut entirely, as the in-progress rewrite proposes, also resolves this.

### F6 — P1 — established: `K/N` is not decision value

The stage sends nothing, so it cannot claim waiting was actually avoided. `K/N` also rewards unjudged or incorrect proposals: routing everything away from Greg can score well even if every reviewed route is wrong.

Replace the metric with:

> Report `N proposed; R independently marked right; W wrong; U unjudged; K of the R correct proposals named a non-Greg holder`. Describe K as “could have avoided asking Greg”, not “would not have needed Greg”. Actual avoided waiting is not measured in a no-send stage. Decide using accuracy among judged proposals, correct non-Greg routes per true question, coverage, and cost per correct non-Greg route.

### F7 — P2 — established: the second model call buys too little

Proposal mode can conditionally select a wider prompt/version. A separate proposer adds a module, cache lifecycle, failure state and second billable request. Both approaches need a bounded cold pass when enabled.

Replace D1/D2 with:

> Use one classifier call. Preserve today’s prompt/version while proposals are off. When enabled, use a proposal-aware version whose positive arm also returns recipient, reason and verbatim `asks`. Validate the combined response and perform one bounded cold reclassification. Split the call only if evaluation shows that widening harms question detection.

### F8 — P2 — reasoned: cached `reach` can become stale

The key covers tail/reports/version, but `reach` comes from changing usage evidence. Caching the full proposal can preserve yesterday’s availability.

Add:

> Cache only recipient, reason and `asks`. Derive `reach` on every pass from current usage evidence; exclude it from the proposal ID. Test available → limited → available without another model call.

### F9 — P1 — established: the veto log lacks a writer protocol

The CLI directly appends marks while the daemon appends proposals. The plan specifies no lock, fsync, idempotency, validation, torn-tail repair, or marker distinguishing never-used from lost. A lost “wrong” mark removes the promised veto.

Replace the two-log design with:

> Use one `proposal-events.jsonl` containing idempotent proposed/marked events, with the daemon as sole appender. The CLI atomically submits bounded files to `proposal-mark-inbox/`; the daemon validates and drains them, then appends and fsyncs. Use an initialisation marker, loud lost-log state, bounded scans, retry/idempotency, and crash/concurrency tests.

D3 itself is defensible for a pure model judgement: content plus prompt version covers the model input. It is not enough to establish current execution for report joins or to scope a human mark to a particular run.

Verification: `npx vitest run tests/fleet-attention.test.ts` passed, 24/24.