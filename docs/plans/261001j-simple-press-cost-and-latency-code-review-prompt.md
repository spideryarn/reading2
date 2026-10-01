# Code review: one Simple press, one article cache (261001j)

Review and, where it is inside this stage, FIX the code built from
docs/plans/261001j-simple-press-cost-and-latency.md. Your plan review is
docs/plans/261001j-simple-press-cost-and-latency-plan-review-sol.md; check each P1/P2 was done.

Scoped diff: docs/plans/261001j-simple-press-cost-and-latency-code-review.diff (commit 4170ef33
against e85ef1d8, which already contains the 261001i guard). The heart: the stagger in
`generateSimpleSummary` (src/simple-summary.ts — `FIRST_LEVEL`, `stagger`, `markArticle`,
`firstBegun`, `untilAborted`, and how `writeLevel` waits), `MeteredCall.onStart` in
src/messages-stream.ts, and the new describe block "the staggered fan-out" in
tests/simple-summary.test.ts plus the onStart test in tests/messages-stream.test.ts.

Look hardest for:
1. Any path where a level is stranded (waits for ever), a billed call is opened into a press that is
   already lost, an abort is lost, or a stored result changes. Include the guard's retries, the
   validation retry, a refusal or truncation on Fuller, the job's own signal, and the case where
   Fuller succeeds without `message_start`.
2. Whether `onStart` is right against the SDK's real stream events (raw `streamEvent`), fires
   exactly once, and cannot throw into the stream.
3. Whether the tests could stay green with the stagger broken (e.g. all three fired at once, nothing
   marked, the gate never awaited) — try a mutation or two.
4. The cache floor decision for high power (Opus) and the interaction with `opts.cacheArticle`.
5. Anything else wrong or worse than it needs to be, including the spike script's honesty
   (evals/simple/fanout-spike.ts) since the plan's numbers rest on it.

Gates: `npx vitest run tests/simple-summary.test.ts tests/messages-stream.test.ts
tests/stage-stamp-agreement.test.ts tests/meta-fallback-fingerprint.test.ts tests/simple-check.test.ts
tests/faq.test.ts` and `npm run typecheck` (judge by exit code). No paid model call. Do not commit.

Fix inside the stage, failing test first for a behaviour; report wider things for me to decide.
Finish with P0/P1/P2 and file:line, what you changed, gate results, and a verdict.
