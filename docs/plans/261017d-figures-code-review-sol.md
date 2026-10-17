1. **Medium — [src/skim.ts:1542](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/skim.ts:1542)**  
   Pass repair counted figures at their anchors’ pre-repair depths. Moving an anchor could therefore make the subsequent count stale and cause `trimFigures` to delete a figure that another carry could preserve.  
   **FIXED:** Revalidate and re-plan against each repaired route until figure placement stabilises, with a bounded loop. Added the previously failing 2/2/4 regression at [tests/skim.test.ts:2125](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/tests/skim.test.ts:2125).

2. **Low — [src/skim.ts:1681](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/skim.ts:1681)**  
   The prompt described depth, optional cues, and pass targets as applying to every stop, contradicting section 5: figures have no independent depth, require cues, and do not count toward quote targets.  
   **FIXED:** Consistently says “quote stop(s)” in the system prompt and user message, with assertions at [tests/skim.test.ts:2171](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/tests/skim.test.ts:2171).

3. **Low — [src/store/pg.ts:1455](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/store/pg.ts:1455), [src/store/pg.ts:4162](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/store/pg.ts:4162)**  
   Freshness comments incorrectly said Skim used blocks only for positions and never read article prose. `skimInput` now needs complete block HTML and figure captions. The implementation already reads complete blocks on both generation and freshness paths, so hashes do not silently diverge through an HTML-stripping read.  
   **FIXED:** Corrected the comments in the store, pipeline, and Skim module.

No further blocker was found in figure validation/trimming, stop identity and deep links, arrival/flash behavior, visitor quote-only routes, or the public DTO boundary.

Validation:

- Typecheck passed for all projects via the equivalent `node --import tsx scripts/typecheck.ts`; the requested npm wrapper was blocked by sandbox IPC permissions.
- Focused unit scope: 445/445 tests passed, including all Skim unit suites and `public-dto.test.ts`.
- Lint reported no errors; only existing complexity advisories.
- Changes remain uncommitted because the sandbox makes the worktree’s external Git directory read-only.

Verdict: SHIP-AFTER-FIXES (figure-aware re-planning and prompt wording fixes applied).