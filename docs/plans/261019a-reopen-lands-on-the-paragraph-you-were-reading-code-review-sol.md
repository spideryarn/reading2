Verdict: **LAND AFTER FIXES (made).**

1. **High — paragraph memory could regress during the 300 ms URL debounce.**  
   [last-view.ts:896](/var/tmp/spideryarn-worktrees/fbqspg5a-reopen-where-you-were/src/web/last-view.ts:896)  
   An unrelated query change could overwrite a freshly saved paragraph with the older section still in the address. I now preserve the authoritative note while that old `at` is lagging, while Back/Forward or a genuinely different `at` still wins. The address listener now receives the event type via [router.ts:1616](/var/tmp/spideryarn-worktrees/fbqspg5a-reopen-where-you-were/src/web/router.ts:1616). Added regression coverage for all three cases.

2. **Medium — kept-arrival listeners survived reader unmount.**  
   [scroll.ts:1124](/var/tmp/spideryarn-worktrees/fbqspg5a-reopen-where-you-were/src/web/scroll.ts:1124), [useReadingPosition.ts:68](/var/tmp/spideryarn-worktrees/fbqspg5a-reopen-where-you-were/src/web/reader/useReadingPosition.ts:68)  
   A later font or resize event could move the page after leaving the reading view. Kept arrivals now have ownership tokens and an unmount disposer that cannot cancel a newer arrival. StrictMode effect replay explicitly reacquires the hold. Both regressions were reproduced red before the fix.

I found no remaining correctness issue in the hold/spy/layout-key/glide interactions, reader-input release, height-change realignment, hidden-row sampling, saver scoping, or Back/Forward handling. The height rule updates its baseline on each realignment and does not self-loop.

Checks:

- Final focused run: 84 tests passed across four files.
- Broader scroll/position/last-view run: 167 tests passed across nine files.
- Full typecheck passed: 3,829 source files covered.
- Scoped lint: no new errors or warnings; two existing complexity notices remain.
- `npm test` could not run the database lanes because local Postgres was unavailable.
- `npm run typecheck` itself hit the sandbox’s IPC restriction; running the same `scripts/typecheck.ts` gate directly passed.
- No commit or git-state operation performed.

Nothing wider needs a product decision.