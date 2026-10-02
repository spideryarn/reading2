# Code review round 2 (narrow, read-only): the F10/F11 fixes in quick search (261002e)

Round 1 (`docs/plans/261002e-quick-search-v1-code-review-sol.md`) found two P1s in
`src/quick-search.ts` and fixed them in commit `78b766f82` (`git show 78b766f82 -- src/quick-search.ts
tests/quick-search.test.ts`). Those fixes are unreviewed code. Discovery is closed: check **only**
whether these two fixes are correct and complete.

- **F10**: a split chunk's halves are now drained (`Promise.allSettled`) after a shared cancel before
  the failure propagates, so every chunk's and every retry's ledger meter finishes before
  `quickPassagesStream` throws. Is there any remaining path (deeper recursion, a top-level chunk
  failing while another chunk is mid-halving, a success path) where a meter can finish after the
  generator returns or throws?
- **F11**: classification of the failure (reader left / deadline / provider refusal / unreadable)
  now follows the composite signal's first abort reason. Is `AbortSignal.any`'s `reason` really the
  first source's reason in Node's implementation, and can `cancel.signal.reason` ever be something
  other than the originating failure?

You may run `npx vitest run tests/quick-search.test.ts`. Read-only: change no files. Findings use
IDs F13+, severity P0–P3, evidence file:line. End with `VERDICT: land` or `do not land`.
