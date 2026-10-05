Reviewed HEAD `93620b647996940d93969c619fb3ba9725f7c245`. No files changed. The single permitted test file, `source-guess-run.test.ts`, passed all 30 tests. The proposed new tests were assessed by tracing code; they were not run.

1. **G1 — P0, reasoned: mtime and size cannot guarantee report preservation.**  
   A reviewer can replace a report with different bytes of the same size while retaining its mtime. The proposed snapshot then calls it unchanged and overwrites it. Conversely, touching a stale report changes its mtime and causes stale content to be preserved.

   Snapshot content as well as metadata. Treat detected changes as evidence of modification, rather than proof of reviewer authorship. Add a same-size, same-mtime replacement test; the four listed cases do not cover this loss path.

2. **G2 — P1, established: freshness must belong to the final credential attempt.**  
   [runPlan](/home/greg/code/spideryarn2/.claude/worktrees/qi-k9xnhcje-long-doc-followups/scripts/run-codex.ts:688) deliberately gives each credential attempt a fresh last-message file. A single target snapshot before the whole invocation undermines that protection: attempt one can write a report, fail on credentials, and leave that report to be preserved after attempt two.

   This is reachable with `--sandbox review`: it permits writing `/tmp`, while `shouldFallBack` permits credential retries. Snapshot at each actual attempt, and keep an earlier attempt’s report separately when necessary. An untouched target during the final attempt must not become that attempt’s answer.

3. **G3 — P1, reasoned: preflight creation and wrapper integration are underspecified.**  
   [sameWriteTarget](/home/greg/code/spideryarn2/.claude/worktrees/qi-k9xnhcje-long-doc-followups/scripts/subagent-cli.ts:91) opens paths for append and can create an empty target. Snapshotting before that check would classify the wrapper’s empty file as a reviewer-created report and preserve it.

   Resolve the effective target—including the `--launch-dir` default—and complete preflight before snapshotting. Add wrapper-level stand-in tests for ordinary success, launched success/failure, and credential fallback. Helper-only tests cannot establish the wiring.

   Claude’s overwrite **is reachable** at [run-claude.ts:871](/home/greg/code/spideryarn2/.claude/worktrees/qi-k9xnhcje-long-doc-followups/scripts/run-claude.ts:871), so reuse should be required here. Preserve its existing failure semantics: a kept report must not make an empty `parsed.result` pass the current answer-usability check.

4. **G4 — P1, established: aborting `pass0` does not return the accumulated pages.**  
   On a 151-page document, aborting from `onPage(2)` reaches `throwIfAborted()` at the next loop iteration; the catch rethrows the abort. See [pdf.ts:942](/home/greg/code/spideryarn2/.claude/worktrees/qi-k9xnhcje-long-doc-followups/src/pdf.ts:942).

   Select the explicit `firstPages` option now. Bound the loop with `Math.min(doc.numPages, firstPages)` and retain normal cleanup and genuine cancellation behavior. Source-guess must also stop passing the 150-page refusal cap.

   The proposed 151-page test would be red today and green with that change. Assert the actual first-page text, and add evidence that page three is never requested; merely returning two pages also passes an implementation that reads all 151 and slices afterwards.

5. **G5 — P1, reasoned: every non-deadline read error is not necessarily permanent.**  
   The existing identity catch covers both `loadSource` and first-page parsing. Storage/database failures can be transient; parser setup failures can also be faults in the process rather than in the bytes. Turning all of these into permanent `none` loses a potentially recoverable source link after one failure.

   Narrow settlement to explicitly permanent unreadable-source cases. Keep transient failures retryable and deadline failures on the existing path.

   **The settlement mechanism itself is sound:** `settle` uses the claim token, reads the successor’s state if the fence refuses, and takes no allowance. The attempt cap is a maximum, so settling a permanent refusal on attempt one is allowed. Add lost-claim and deadline tests. Also correct the proposed harness log assertion: it records `["claim", "finish:none"]`, not `["claim", "finish"]`.

6. **G6 — P2, established: recommendation (b) omits request components and overstates the diagnosis.**  
   “Nothing checks the request” is inaccurate: [structure-cascade.ts](/home/greg/code/spideryarn2/.claude/worktrees/qi-k9xnhcje-long-doc-followups/src/structure-cascade.ts:934) already estimates complete requests and applies `maxRequestTokensPerBatch`. The missing checks are on the relevant whole-document, slice and labels paths.

   The recommendation must bound the **complete rendered request**: system instructions, outline, section crumbs/gists, context blocks and target text, with room reserved for output. Excerpting only oversized target blocks leaves oversized outlines and context unbounded.

   Also clarify Structure’s behavior: answer overflow currently attempts slices before falling back to the bounded headings tree. Input feasibility must guard those slices too, or explicitly bypass them.

7. **G7 — P2, established: recommendation (d) does not bound every database wait.**  
   Pool-level hardening is the right direction, but the proposed two settings are insufficient:

   - Without `connectionTimeoutMillis`, pool checkout can wait indefinitely before either query timeout applies.
   - Installed `pg` implements `query_timeout` by returning an error and suppressing the later callback; an ordinary in-flight query is not cancelled. A write can still finish afterwards.

   See [pg-pool/index.js:206](/home/greg/code/spideryarn2/.claude/worktrees/qi-k9xnhcje-long-doc-followups/node_modules/pg-pool/index.js:206) and [pg/client.js:706](/home/greg/code/spideryarn2/.claude/worktrees/qi-k9xnhcje-long-doc-followups/node_modules/pg/lib/client.js:706).

   Include acquisition/connect bounds, verify effective server timeout behavior through the production transaction pooler, and define handling for uncertain write completion. Remove the claim that this automatically bounds every caller and leaves all failure paths safe.

8. **G8 — P2, established: (e) leaves the same stale claim in the developer exception.**  
   The reader-facing replacement is correct and is the smallest sound wording change. Its proposed assertion would be red today. However, [TooLongForOnePass](/home/greg/code/spideryarn2/.claude/worktrees/qi-k9xnhcje-long-doc-followups/src/token-budget.ts:149) still says sectioned processing “is not built yet.” Include that diagnostic string in scope, alongside the comments.

9. **G9 — P2, established: write-up (a) presents a latency-dependent failure as certain.**  
   The 2,000 batches, concurrency limit and three-window budget support the risk. Exhaustion depends on call durations; the earlier F4 explicitly used an assumed duration. Also, the job occupies a global slot while running, not continuously while queued between claims.

   Moving (a) to a separate plan is justified for the proposed durable-progress policy: both cooperative pause and expired-lease handling need the same durable evidence and ceiling. I found no equally small change preserving those guarantees. A bounded, larger labels-only retry allowance could avoid a migration, but buys additional attempts without establishing progress. The proposed product ceiling remains a reasonable simpler alternative requiring Greg’s decision.

For **(g), the proposed fix is sound**. `buildSummaryTree` empties the projected `SummaryNode.children` at the depth cut but preserves `SummaryNode.node` and its stored children. Testing **`next.node.children`** therefore keeps legitimate section crumbs, including bounded window sections, while excluding block leaves. “Block leaf” is more accurate than “paragraph,” since headings and media also have leaves. The proposed real-builder ragged-tree test would expose the current defect; preserve positive cases for cut sections and supplements when repairing the hand-built fixtures.

For **(c), the arithmetic and current behavior are accurate**: 1,097 parts exceed the answer budget. Quietly skipping oversized Arc generation is a sound simpler recommendation. Apply eligibility consistently to automatic requests and server generation, so manual requests or reopening cannot recreate the failed job. Calling every thousand-part document a reference work is a product inference, not an established fact.

**Verdict: build with the changes listed.**