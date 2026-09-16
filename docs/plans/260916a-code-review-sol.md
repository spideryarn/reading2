1. Fixed `useJumpOrigin`’s depth-only render regression. It now has an origin-only cached snapshot, so same-article pushes update ReturnChip’s depth without re-rendering Spine. Added a regression test that failed before the fix. [router.ts](/home/greg/code/spideryarn2/.claude/worktrees/wt-back-to-x/src/web/router.ts:1703)

2. Fixed version parsing to fail closed. A future `{ v: 9, from: ... }` stamp previously fell through as legacy and could produce a misleading one-step return. Unknown versioned shapes are now rejected. [jump-history.ts](/home/greg/code/spideryarn2/.claude/worktrees/wt-back-to-x/src/web/jump-history.ts:175)

3. Fixed an abandoned-jump arm leak missed by the earlier F14 change. A nonmatching push or any replace can make nuqs abandon the queued jump, but previously only `popstate` cleared its arm. The stale arm then hid both chip and rail mark indefinitely. Push and replace paths now end it; both new tests failed before the fix. [router.ts](/home/greg/code/spideryarn2/.claude/worktrees/wt-back-to-x/src/web/router.ts:1427)

4. Confirmed the rollback mitigation against the actual previous source. Old `readStamp` reads `mine.from`; the new writer emits none, so it returns `null`. Old `withStamp(state, null)` deletes the unchanged `spya` key, so it clears new stamps too.

5. Re-checked the depth sequences. Back, Forward, truncating the forward stack, replace, second jump, intermediate dismissal, pathname exit/return, and `popstate` preserve the stored distance. The installed nuqs wrapper delegates each current-app push to native `pushState` exactly once.

6. Kept the layout effect. Its `{layoutKey, at}` seam correctly separates reflow correction from URL restoration; nuqs’s optimistic `at` also protects the 300ms debounced-write window. It cancels swipe/jump glides, runs before the passive spy, and adds one targeted row lookup/layout read rather than another 2,000-row scan. Gist-column re-anchoring is the plan’s deliberate behavior. Added coverage for the debounce window. [reflow test](/home/greg/code/spideryarn2/.claude/worktrees/wt-back-to-x/tests/reading-position-holds-across-a-reflow.test.tsx:232)

7. Verified the reversed tests. The former “cols push strips” assertions are correctly replaced by end-to-end depth/landing checks. F6 is not weakened: dismissal changes only history state at an identical URL, making it a sharper `useSyncExternalStore` identity test.

8. Wider decision: pathname inheritance is exact only while the browser retains the origin. The HTML standard permits an implementation-defined state-history limit and FIFO eviction; once an intermediate origin is evicted, classic History exposes too little information to detect it, and `history.go(-depth)` can land incorrectly. [HTML Standard](https://html.spec.whatwg.org/multipage/nav-history-apis.html#shared-history-push/replace-state-steps). I corrected the source comments but did not introduce a parallel history or arbitrary cap. `url-state.md` and the plan still say “provably right”; changing that rule wording needs the repository’s approved important-doc edit process.

Validation:

- Focused suites: 373 passed.
- Typecheck: all 2,189 covered source files passed via `node --import tsx scripts/typecheck.ts`; the npm wrapper itself hit sandbox `EPERM` opening tsx’s IPC socket.
- Scoped lint and `git diff --check`: clean.
- Full `npm test`: blocked before collection because this sandbox cannot reach Docker/Postgres.
- The unrelated untracked feedback note was untouched.

Verdict: fixes required; locally sound after them, with browser history eviction the one unresolved platform limitation for you to accept or redesign around.