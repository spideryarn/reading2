The plan needs changes before implementation. The main gaps are incomplete failure coverage, recording a retry before knowing it happened, and rates that mix measured calls with unmeasured ones.

1. **F1 — P1: Some whole-call failures would remain `ok` and disappear from the new figures.**  
   **Location:** plan:53, plan:63; [src/ai-call.ts:2270](/var/tmp/spideryarn-worktrees/count-ai-call-deaths-and-retries/src/ai-call.ts:2270).  
   `meterBody` swallows JSON parsing failures, and `openRouterJson` returns `null` while recording `ok`. PDF then rejects that answer at `src/pdf-read.ts:973`, after accounting has finished. PDF also detects in-band error envelopes after the gateway returns, at `src/pdf-read.ts:970`. The planned stream-only fix misses these cases.  
   **Change:** Explicitly classify malformed JSON and recognised whole-response error envelopes before finishing the meter, preserving the caller’s response contract and existing retry policy. Add tests asserting the recorded metadata on these paths.

2. **F2 — P1: The proposed phase definition does not match every seam.**  
   **Location:** plan:46; [src/ai-call.ts:2263](/var/tmp/spideryarn-worktrees/count-ai-call-deaths-and-retries/src/ai-call.ts:2263).  
   A whole-call seam can receive **503 headers**, then throw while reading the body. That error is not marked `neverAnswered`, so it is not retried—despite never receiving a 2xx. This applies to JSON, image, transcription and decisions. Inferring `mid_answer` from retry eligibility would misclassify it; extracting status only from `ProviderRefused` would lose the known 503.  
   **Change:** Define phase by the explicit acceptance boundary, independently of retry eligibility. Record response status before reading the body; specify that a broken non-2xx body remains `before_answer`. Remove the claim that `mid_answer` means exactly every failure the current retry does not cover.

3. **F3 — P1: `retried` needs a recording protocol, not just a column definition.**  
   **Location:** plan:38; [src/ai-call.ts:1856](/var/tmp/spideryarn-worktrees/count-ai-call-deaths-and-retries/src/ai-call.ts:1856), [src/messages-stream.ts:701](/var/tmp/spideryarn-worktrees/count-ai-call-deaths-and-retries/src/messages-stream.ts:701).  
   Both wires record the failed attempt before deciding and waiting for a retry. Cancellation during backoff—or immediately afterwards—can prevent the successor. Recording “eligible for retry” as `retried = true` contradicts “another attempt followed”. The whole-call callback also receives no attempt ordinal today.  
   **Change:** Make the loop own finalisation of failed-attempt metadata. Record `true` only as the successor actually starts; record `false` when backoff or cancellation ends the call. Preserve the failed attempt’s original finish time and duration. Thread the loop ordinal through all four whole-call seams and retain it on the accepted stream’s meter. Test cancellation during backoff and at successor entry on both wires.

4. **F4 — P1: The separate grouped read contradicts the cube contract and introduces mismatched populations.**  
   **Location:** plan:95; [docs/project/admin-costs.md:30](/var/tmp/spideryarn-worktrees/count-ai-call-deaths-and-retries/docs/project/admin-costs.md:30).  
   The rule explicitly covers every table, pivot and chart, not just money. Existing page figures also follow scope and dimension filters. A separate day/job failure read does not automatically preserve those filters, and two statements can observe different ledger snapshots. Taking denominators from the cube alone does not establish agreement.  
   **Change:** Extend the existing cube. Add phase, class and status where cause breakdowns need dimensions; aggregate retry counts as measures using `COUNT … FILTER`. Neither attempt ordinal nor `retried` needs to become a grouping dimension. Share the folds between page and report.

5. **F5 — P1: The proposed rates treat missing instrumentation as successful observation.**  
   **Location:** plan:92, plan:100; [src/store/ai-calls-spend-pg.ts:383](/var/tmp/spideryarn-worktrees/count-ai-call-deaths-and-retries/src/store/ai-calls-spend-pg.ts:383).  
   Total calls include legacy rows and excluded retry loops, while the new numerators cannot count their events. A window spanning rollout would therefore dilute the rate; an entirely historical window could appear to have zero retries. Ledger “calls” are also attempts, so this is not automatically a percentage of logical calls requiring retry.  
   **Change:** Define the denominator and label explicitly. Use observable managed attempts for retry rates, report unknown coverage separately, and show historical measurements as unavailable. The simplest alternative is to show counts plus total attempts as context without claiming a rate.

6. **F6 — P2: The cause recipe loses distinctions already available on Messages.**  
   **Location:** plan:51; [src/messages-stream.ts:788](/var/tmp/spideryarn-worktrees/count-ai-call-deaths-and-retries/src/messages-stream.ts:788).  
   `overloaded_error` and `authentication_error` events both become `APIError` with no status. Class name alone cannot distinguish them. SDK connection errors can also wrap `TypeError`, leaving the network code at `err.cause.cause.code`, rather than `err.cause.code`.  
   **Change:** Specify an allowlisted mapping for Messages event types and bounded unwrapping of known SDK causes. Test distinct in-band event types and a wrapped `ECONNRESET`.

7. **F7 — P2: Character filtering does not enforce a bounded, content-free vocabulary.**  
   **Location:** plan:54; [src/web/log-buffer.ts:410](/var/tmp/spideryarn-worktrees/count-ai-call-deaths-and-retries/src/web/log-buffer.ts:410).  
   A name or cause code such as `reader_search_term` or a token survives the proposed character filter and truncation. Writable error names and arbitrary abort reasons are not inherently safe labels. The existing client diagnostic boundary already addresses this class of problem.  
   **Change:** Map recognised classes, network codes and abort categories to literal labels. Unknown values become fixed fallbacks such as `other`, `network` or `abort`; never retain a sanitised unknown string.

8. **F8 — P2: The planned stall count has no distinguishing input at the recorder.**  
   **Location:** plan:68; [src/stream-run.ts:175](/var/tmp/spideryarn-worktrees/count-ai-call-deaths-and-retries/src/stream-run.ts:175), [src/ai-call.ts:2161](/var/tmp/spideryarn-worktrees/count-ai-call-deaths-and-retries/src/ai-call.ts:2161).  
   The gateway receives the composite signal, not the separate reader, deadline and stall signals. A stall uses plain `Error("stalled")`; reader Stop also uses plain `Error`. Reason **name** cannot distinguish them. `explainAbort` runs outside the gateway after recording, and cancellation can end the stream without throwing any error.  
   **Change:** Either pass a small, typed abort classification into the recording boundary and handle clean cancellation too, or explicitly exclude stall counts from this version. Do not display an unmeasurable stall count as zero.

The nullable migration and simple phase CHECK are safe for existing rows and old writers during deployment. Realtime can continue inserting nulls, although implementation must account for its `AiCallRow` typing and the explicit mappings in `src/store/ai-calls-pg.ts`.

Changing a recognised in-band stream error from `aborted` to `error` is appropriate. Existing failed-call totals count both outcomes, and I found no charging or slot-accounting dependency on that distinction.

Validation: **251 tests passed** across transport retry, Messages stream, cost cube and cost analysis. Stubbed probes reproduced F1 and F2 and confirmed the SDK shapes behind F6. No files were changed.

**Verdict: change first.**