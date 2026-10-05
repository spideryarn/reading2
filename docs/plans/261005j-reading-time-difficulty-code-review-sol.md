**Verdict: request changes for the queue reservation below.** I fixed the investigation’s evidence claims; I found no storage-path defect by reading.

1. **P2 — Blocks still reserves five seconds despite its new fifteen-second call.** [src/jobs.ts:589](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/jobs.ts:589)  
   After extraction, the queue can start `blocks` with, for example, six seconds left. A slow rating then hits the claim’s deadline before its own timeout, propagating cancellation and interrupting the import. Increase the reservation to cover splitting, the fifteen-second call and storage. **Left unchanged:** `jobs.ts` is outside this work’s changed files.

2. **P2 — The investigation mixed the two paid runs.** [Investigation:195](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/docs/investigations/261005b-reading-time-difficulty-multiplier-coefficients-and-where-the-rating-comes-from.md:195)  
   Its table and output bullets described prompt 1 while linking prompt 2. **Fixed:** both runs now have explicit columns and links. Current figures are 20 identical language pairs, 17 ideas pairs, correlation 0.76 and $0.0281. Corrected the example ratings, four pieces receiving a 2, maximum multiplier gap of 0.108, and six `(3,3)` results on attempt A—only two on both attempts.

3. **P3 — Repeatability was presented as accuracy, and the coefficient explanation overstated its evidence.** [Investigation:91](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/docs/investigations/261005b-reading-time-difficulty-multiplier-coefficients-and-where-the-rating-comes-from.md:91)  
   **Fixed:** agreement within one level no longer promises correctness. The Carver double-count explanation now identifies the actual mistake: treating an actual-word **total** slowdown as language-only, then multiplying the residual slowdown into it again. Multiplying separate factors is not itself double-counting. [Carver’s paper](https://readinghalloffame.org/sites/default/files/carver_97.pdf) supports that distinction. Also corrected Wake Forest’s comparison baseline and its “understand” category. [Source table](https://cat.wfu.edu/resources/workload/estimationdetails/)

The remaining review checks were satisfactory:

- Ratings stay beside their blocks; unrated reruns clear them; metadata writes preserve them. Null columns mean unrated only where blocks exist, and completion checks still reject revisions without blocks.
- Owner, shelf and public minutes use the same rating. Public reads exclude model and time; both exports retain them.
- `ctx.signal.aborted` is appropriate at the step boundary: an aborted step must stop even if another error arrives concurrently.
- The sampler, parsing, logging, multiplier, rounding, range and card passed review. The prompt carries the required plain-words rule.
- No existing unstubbed blocks test was found above the 150-word floor. The provider guard also fails swallowed refusals in `afterEach`; a global default stub is unnecessary.

**Verified:** four focused suites, **61 tests passed**; typecheck passed; `git diff --check` passed.

**Not checked:** Postgres tests, migration execution, the full suite, another paid run, or an independent person’s judgement of the ratings. The saved results contain no such judgement.

**Only file edited:** the linked investigation document. No code edits, commits, Git-state changes, new Greg quotations or blockquote changes.