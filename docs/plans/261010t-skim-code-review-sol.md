1. **Medium — short-route targets contradicted the growth rule.** `targetsFor(6)` produced `2/1/3`, requiring repair even when the model followed its targets; zero quotes also incorrectly requested one Gist stop. Fixed all sizes from 0–7 and extended exhaustive coverage through every supported `q`. Evidence: [src/skim.ts:269](/var/tmp/spideryarn-worktrees/fbnbmce7-skim-depths-and-previous/src/skim.ts:269), [tests/skim.test.ts:864](/var/tmp/spideryarn-worktrees/fbnbmce7-skim-depths-and-previous/tests/skim.test.ts:864).

2. **Medium — `SKIM_SYSTEM` contradicted both the validator and large-route targets.** It required `Most > More` even below eight quotes, where equality is allowed, and told the model to include nearly every quote even when the targets cap a 120-quote input at 36. Reworded both rules to match `growthFailure` and the per-pass target total. Evidence: [src/skim.ts:1171](/var/tmp/spideryarn-worktrees/fbnbmce7-skim-depths-and-previous/src/skim.ts:1171), [src/skim.ts:1319](/var/tmp/spideryarn-worktrees/fbnbmce7-skim-depths-and-previous/src/skim.ts:1319).

3. **Medium — two tests still reported growth success using cumulative counts.** They passed `visibleCounts` to `growthFailure`, recreating the exact silent-success class this change fixes. They now assert `passSizes` and pass those walked counts to the checker. Evidence: [tests/skim.test.ts:458](/var/tmp/spideryarn-worktrees/fbnbmce7-skim-depths-and-previous/tests/skim.test.ts:458), [tests/skim.test.ts:549](/var/tmp/spideryarn-worktrees/fbnbmce7-skim-depths-and-previous/tests/skim.test.ts:549).

4. **Low — the shared type documentation still claimed passes nested.** Corrected it to distinguish cumulative cap arithmetic from actual pass membership, and corrected the new repair counters’ wording for `Gist ≤ More < Most`. Evidence: [src/types.ts:1354](/var/tmp/spideryarn-worktrees/fbnbmce7-skim-depths-and-previous/src/types.ts:1354), [src/types.ts:1449](/var/tmp/spideryarn-worktrees/fbnbmce7-skim-depths-and-previous/src/types.ts:1449).

5. **Low — `hasPrevious` was correct but insufficiently pinned.** Added integration assertions for stop one, later stops, and a carried stop that is first in More. Evidence: [tests/skim-panel.test.tsx:1818](/var/tmp/spideryarn-worktrees/fbnbmce7-skim-depths-and-previous/tests/skim-panel.test.tsx:1818), [tests/skim-panel.test.tsx:2099](/var/tmp/spideryarn-worktrees/fbnbmce7-skim-depths-and-previous/tests/skim-panel.test.tsx:2099).

6. **Low, wider — one historical evaluator still calls cumulative nesting “today.”** [scripts/eval/skim-diversity.ts:17](/var/tmp/spideryarn-worktrees/fbnbmce7-skim-depths-and-previous/scripts/eval/skim-diversity.ts:17) compares the old nested and own-only policies and ignores `again`. I left it unchanged because modernising it would alter a historical evaluation’s meaning; the author should choose whether to retire, rename, or update it.

No correctness defect was found in `growPasses`: its operations terminate, preserve cumulative caps and rules 7/8, retain only still-deeper `again` entries, skip gaps correctly, and use the same pass-membership implementation as the client. The supplied desktop and phone screenshots also show the left/right door groups wrapping correctly.

Test results:

- Requested Vitest files: **258 passed**.
- Typecheck: all four projects passed; **3,665 source files covered**. The exact npm wrapper could not start because sandboxed `tsx` was denied its IPC socket, so the same script was run directly with Node’s TypeScript stripping.
- `git diff --check`: passed.
- Full `npm test`: blocked before collection because local Postgres/Docker was unavailable.
- Scoped lint: no new diagnostics; it still reports the existing unrelated `noChildrenProp` error at `tests/skim-panel.test.tsx:797` and two existing complexity advisories.

No commit was made.