You are GPT Sol, reviewing and fixing the code built from a plan. You may edit files in this worktree.

**Fix what is inside this change**, narrowly: each finding red-first, with the test that reproduces
it, then the fix. **Report, do not fix, anything wider.** Do not commit. Do not run the whole suite;
run the files you touch with `npx vitest run tests/<file>`, and `npm run typecheck` (read its exit
code).

Plan: docs/plans/260929g-on-a-phone-a-band-link-closes-the-band.md, including § GPT Sol's plan
review (your own, docs/plans/260929g-on-a-phone-a-band-link-closes-the-band-plan-review-sol.md,
all six findings taken). The change is commit edc312c2: `git show edc312c2`.

The conclusions I would least like to be wrong about:

1. Every in-band press that should show a passage goes through `bandJump`, and nothing that is not
   an explicit press does: check each band's `onJump` callers for effects that jump on mount or on
   a URL change (as Trajectory's did) — Timeline's row effect, Search's hit stepping, Glossary's
   term selection, Structure/Outline, Chat's citations, Remember/Quiz, Referee's panels, Debate,
   Citations, Ideas, Quotes, Summary, FAQ, Tweets. A jump that fires from a mount or a restore on a
   phone would now hide the band the reader just opened.
2. Focus: `bandFocus` (a ref read during render for `takeFocus`), the pill's mount-only focus, the
   restore effect on `bandAway` → false (does it also run on first render, a mode change, or a
   Trajectory step-aside/return, and steal focus?).
3. The pill vs `ReturnChip` swap, `--return-chip-h`, and the Dock strip.
4. Diagram's `onFollow` split.

Output: numbered findings, severity (must-fix / should-fix / nit), file:line, and **fixed** (name
the red-first test) or **reported** (with the change you propose). One-line verdict at the end.
