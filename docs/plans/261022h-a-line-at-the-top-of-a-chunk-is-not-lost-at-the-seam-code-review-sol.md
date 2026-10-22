1. **Low — ambiguous LCS alignment caused a false seam failure.** Input: a page beginning `For now / For now`, with one correctly emitted copy. The alignment could assign it to the later copy and report two missing opening words. I anchored an exact first output word in [`headOf`](/var/tmp/spideryarn-worktrees/fbrg5kk6-rovelli-paragraph-cut/src/pdf-score.ts:723) and added a regression test. The test fails without the fix.

2. **Low — blank-first-page coverage was missing.** Input: context page 42 ends mid-sentence, requested page 43 is blank/scanned, and page 44 is checkable. Page 44 must not be treated as the seam. The existing `checkable[0] !== first` guard is correct; I added the missing test at [`pdf-seam-head.test.ts`](/var/tmp/spideryarn-worktrees/fbrg5kk6-rovelli-paragraph-cut/tests/pdf-seam-head.test.ts:147).

3. **Low — known heuristic false fires and misses remain.** An unrecognised multiword running head can cause an unnecessary retry when the context ends mid-sentence. Conversely, a footnote ending in a period or out-of-order two-column text can hide a real continuation. I made no change: these are documented limits, and distinguishing them needs stronger layout evidence rather than another threshold.

4. **Low — the scratch measurement does not literally produce the stated result.** The supplied command reports fires on 43, 139 and 140. The latter readings label every record page 2, so production’s raw structural check rejects and recovers them before the content warning matters. The scratch script omits that part of `checkChunk`; I would exclude structurally invalid readings from its fire count. I did not edit the uncommitted evidence.

No other defects found:

- `ENDS_A_SENTENCE` moved unchanged; `reaches` behavior is identical.
- `PageScore.head` is initialized on every path, included in `shared`’s `Omit`, and does not disturb reports, serialization, or quality consumers.
- Phase 2 carries the failure text into `meta.quality` sensibly.
- Mutation testing showed exactly the four rule-dependent tests fail when `seamHead` is disconnected; quiet tests remain green intentionally.

Checks: seam tests 11/11; typecheck and doc-links passed; scoped lint passed. PDF suites passed 713/714—the sole failure was the sandbox blocking an internal `tsx` socket; running that test’s helper via `node --import tsx` passed with the expected 8 pages and 3,522 words.

SHIP WITH THE FIXES MADE