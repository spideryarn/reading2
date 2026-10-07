**Four P1 findings require changes before building.** The main gap is that opting out of gateway retries also bypasses its proposed safety checks.

1. **F1 — P1: The new PDF retry can rebuy a priced refusal.**  
   [Plan line 73](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/docs/plans/261005j-the-other-ai-wires-fail-a-whole-call-on-one-dropped-connection-a-countable-retry-on-the-openrouter-seams.md:73) adds transient-status retries to the PDF loop. But [ProviderRefused](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/src/ai-call.ts:1253) carries status, classification and delay, with no billing information. The outer loop at [pdf-read.ts:1373](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/src/pdf-read.ts:1373) therefore cannot apply the “priced refusal is not retried” rule.

   An in-memory probe confirmed that a `503` carrying `usage.cost: 0.125` produces a priced ledger row but an exception containing no cost information. Adding `503` to this loop’s eligibility would ask again. Embeddings’ existing status loop has the same missing safeguard.

   **Change:** Pass safe retry eligibility from the seam to caller-owned loops, including whether billing was observed. Add priced-refusal tests through the actual PDF and embedding callers, rather than testing only the gateway helper.

2. **F2 — P1: Adding an embedding `TypeError` retry loses the response boundary.**  
   The catch at [embeddings.ts:271](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/src/embeddings.ts:271) surrounds the entire `openRouterJson` operation. Its `TypeError` can originate from [response.text()](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/src/ai-call.ts:2030), after a `200` arrived. Checking the exception class there cannot establish that **fetch itself** rejected.

   The PDF loop already retries this case: a probe returning a `200` with a body that throws `TypeError` made two requests and recorded `error`, then `ok`. Thus the plan’s blanket “a `200` of any kind is never retried” claim does not hold through its opt-outs.

   **Change:** Identify failures at the `send` boundary and preserve that distinction for outer loops. Add `200` body-failure tests for embeddings and PDF, plus the other whole-response seams. Either enforce the boundary throughout or explicitly document narrower guarantees.

3. **F3 — P1: The locator’s spend cap becomes three times larger.**  
   [Plan line 99](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/docs/plans/261005j-the-other-ai-wires-fail-a-whole-call-on-one-dropped-connection-a-countable-retry-on-the-openrouter-seams.md:99) deliberately changes the cap from requests to asks. That contradicts [MAX_LOCATE_CALLS’ contract](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/src/collect-pdf-figures.ts:238): at most eight model calls per article. The counter increments once at [line 855](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/src/collect-pdf-figures.ts:855), regardless of gateway attempts, permitting 24 requests.

   Failed attempts being unpriced does not make them free; the plan explicitly accepts possible billing after a dropped connection.

   **Change:** The simplest fix is another opt-out: `pdf-figure-locate`. Alternatively, enforce a shared eight-attempt budget before every network attempt. Test the actual fetch count under repeated failures.

4. **F4 — P1: The shelf audit misses the naming retry.**  
   [Plan line 75](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/docs/plans/261005j-the-other-ai-wires-fail-a-whole-call-on-one-dropped-connection-a-countable-retry-on-the-openrouter-seams.md:75) identifies only the filing pass. But [model-topics.ts:620](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/src/shelf-terms/model-topics.ts:620) retries the whole `nameLevel`. That includes naming and the filing calls at [line 537](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/src/shelf-terms/model-topics.ts:537).

   Opting out only the final widening pass leaves up to six network attempts for a repeatedly failing branch-naming call.

   **Change:** Account for both outer retries. Ensure calls under either retry opt out of gateway retries, and test naming failures and failures in `nameLevel`’s filing subcalls.

5. **F5 — P2: The stall-clock reset order is underspecified.**  
   [Plan line 58](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/docs/plans/261005j-the-other-ai-wires-fail-a-whole-call-on-one-dropped-connection-a-countable-retry-on-the-openrouter-seams.md:58) says to call `onActivity` before another attempt. Calling it **after** backoff is too late when the first failure arrives near the existing stall deadline. For example, [link-summary’s clock](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/src/link-summary.ts:497) can expire during the wait.

   **Change:** Specify a reset before backoff and before the next request, while retaining the original overall deadline. Test a failure just before stall expiry; merely asserting that the callback eventually ran is insufficient.

6. **F6 — P3: The audit incorrectly describes paper metadata as a silent fallback.**  
   The whole-JSON row says the remaining callers fall back silently. [paper-metadata.ts:276](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/src/paper-metadata.ts:276) propagates a gateway failure, and [pipeline.ts:2292](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/src/pipeline.ts:2292) awaits it without a fallback. A transport failure therefore fails the metadata step.

   **Change:** Correct that caller’s consequence in the audit table.

Verification: 219 tests passed across seven selected unit suites, plus the PDF transport-retry test. No files changed. The in-memory probes used no network or database.

Quick search retains its shared deadline, and quiz-verdict retains its eight-second deadline; I found no established requirement to opt either out. The local runtime returned `TimeoutError` for an expired timeout signal. A custom abort reason can be a `TypeError`, but checking `signal.aborted` prevents retrying it.

**Verdict: change first.**