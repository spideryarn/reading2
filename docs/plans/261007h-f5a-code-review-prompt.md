# Code review: 261007h F5a (a 40px invisible target for small controls under a finger)

**Candidate:** commit `f868ce9d9` in worktree `/var/tmp/spideryarn-worktrees/fbrgq3f6-design-consistency`.
`git show f868ce9d9 --stat` lists every changed path; start with `src/web/styles/tap-target.css`,
`src/web/BlockRef.tsx`, `src/web/styles/quotes.css`, `src/web/PageSection.tsx`. That list does not
limit scope. The commit also carries a two-line change to `src/web/BandWaiting.tsx` (its unseen
footprint no longer carries the spinner's class) — review that too. **Another builder is working in
this worktree on the part-switcher (mode-band.css, summary.css, Structure/Referee/Learn/Diagram/
Search/Skim switchers); uncommitted changes outside this commit are theirs — ignore and do not
touch them.**

**Spec:** `docs/plans/261007h-design-system-refresh-controls-that-do-the-same-job-look-the-same-in-every-mode.md`
§ F5 and § "What GPT Sol's plan review changed" (R15). Greg: "give each the invisible larger hit
area the close cross already has (40px to the finger, drawn the same size). Where two would overlap,
the row grows instead." — *"yes to all as you see fit"*. `.close-x` / `close.css` must be untouched
(`tests/close-cross.test.ts`).

## What to do

You may write. **Fix what is inside this commit's scope**, narrowly and red-first, and **report,
do not fix**, anything wider. Do not commit. Findings to the answer file first, then fixes, then
update the answer with what you changed.

Independent pass:

1. `position: relative` added under the coarse query: does any control that now carries
   `.tap-target` rely on another `position` (absolute, sticky) that this overrides or is
   overridden by? Load order (`tap-target.css` straight after `close.css` in `src/web/styles.css`)
   — does any component rule that should win lose, or vice versa?
2. Overlap: two `.tap-target`s, or a target and a neighbouring control without one, whose
   pseudo-elements overlap so the later one steals taps; inline elements that wrap (the `::after`
   spanning lines); targets that extend over scroll containers' edges or under sticky bars.
   Passage ids in every place `BlockRef` renders them (chips in Glossary, Timeline, FAQ, Chat,
   Tweets, citations, quotes…).
3. Quotes: the coarse-pointer stacking of the ⓘ over its id — does the quote text still fit; RTL
   or long ids; the reader's own quotes row.
4. PageSection's heading margin change under a coarse pointer — /profile and Metadata only?
5. Tests: run `npx vitest run tests/tap-target.test.tsx tests/close-cross.test.ts tests/touch-controls.test.ts tests/styles-entry-is-imports-only.test.ts tests/css-tokens.test.ts tests/chat-list-loading.test.tsx tests/dock-questions-loading.test.tsx tests/band-waiting.test.tsx`.
   Does each new assertion fail if its rule is removed?
6. Docs: controls.md, touch.md — accurate?

The builder reports `BlockRange` in BlockRef.tsx is dead (nothing renders it). Confirm or refute;
report only.

## Severity

P0 data loss / security / charging / broadly unusable · P1 user-visible wrong behaviour or a
contract violated · P2 design or maintainability risk · P3 prose. IDs `H1`, `H2`, …. Refuse only
on an established P0 or P1.

End with `VERDICT: ready` / `VERDICT: ready with these fixes` / `VERDICT: not ready`, and a list of
files you changed.
