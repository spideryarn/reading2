No blocking code defect found. The fallback implementation is correct and 0.5/8 is reasonable to ship.

### Findings

- **CR-1 — P2 — Partially fixed.** The evaluation had no acceptance threshold chosen before scores were read, so it supports the trade-off but cannot prove “worth shipping.” I corrected that overclaim in [the plan](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/docs/plans/261003o-quick-search-falls-back-to-a-lower-floor-when-nothing-clears-it.md:145) and [investigation](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/docs/investigations/261003f-quick-search-category-words-score-under-the-floor.md:243). The methodological limitation cannot be repaired retroactively.

- **CR-2 — P2 — Not fixed; wider Q2.** `fallback` is logged but [the route stores only hits and model](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/src/routes.ts:4758). No existing consumer needs it: public reading, export, Thorough replacement, retry, duplicate prevention and `?conf=` all work. However, rounding means a raw 0.699 fallback score [prints as 70](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/src/quick-search.ts:270), so the score cannot always signal a fallback. Persisting and displaying the distinction remains the wider product/schema decision in Q2.

- **CR-3 — P3 — Fixed.** The documents incorrectly said absent topics still return nothing, said “results” returns three or four instead of two to four, counted nine request-form intents instead of eight, and described the 0.55 result using only three of five runs. Corrected across the plan, investigation, reference doc and [feedback note](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/docs/user-feedback/261003_1809-quick-search-still-finds-too-little.md:38).

- **CR-4 — P3 — Fixed.** Source comments still described one cap and the removed quick-hit text wash. Corrected in [quick-search.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/src/quick-search.ts:164).

The independent recomputation matched the substantive claims: 62/111 empty, 50 fallback lists, 202 shown, 144 right, 36/50 top hits right, and 13 lists with nothing right. There were **zero unjudged hits** in those 50 lists. The negatives reproduce as 3/15 absent and 1/60 near-miss runs returning results. Replaying the earlier 150 runs changed none.

I would keep 0.5 rather than 0.55: 0.55 is cleaner, but retrieved only 77 relevant passages versus 144 and left Greg’s “results” query empty on two of five measured runs. The evidence does not establish population accuracy, but it does not make the built default wrong.

Checks passed:

- Quick-search and doc-link tests: 47/47
- Full repository typecheck: 2,911 files covered
- Biome lint on `src/quick-search.ts`
- `git diff --check`

The five-file fix remains uncommitted because this sandbox mounts the worktree’s Git metadata read-only; the supplied untracked prompt remains untouched.

**Verdict: land.**