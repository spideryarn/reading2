# Code review, round 2 (narrow): 261005c — Structure marks the row clicked

You are reviewing **committed code**, and you may fix what you find. This is the second and last
round; discovery outside the paths below is closed.

## The candidate

- Commit `93ba3980c`, on top of `7624d4c46` (reviewed in round 1:
  `docs/plans/261005c-a-late-scroll-event-code-review.md`). `git show 93ba3980c`.
- **New code nobody has reviewed:** `src/web/useColumnContext.ts` (the `arrived` branch in
  `measure`) and `tests/structure-focus-row.test.tsx` (the second test and its harness changes).
- **Your colleague's round-1 prose fixes**, committed here unreviewed by anyone but me: the comment
  edits in `src/web/scroll.ts`, `tests/mobile-chrome.test.ts`, `tests/scroll-settlement.test.ts`, and
  the `CHAIN_MS` paragraph of `docs/postmortems/261005d-whose-scroll-was-that-decided-by-a-clock.md`.
- Docs changed here: `docs/project/url-state.md` (one clause), the plan's log, the postmortem's
  "neighbour" bullet.
- Consumers of the value: `src/web/modes/structure/StructureMode.tsx`, `src/web/structure.ts`,
  `src/web/StructurePanel.tsx`, `src/web/OutlinePanel.tsx`, `src/web/HeadingsCrumbs.tsx`,
  `src/web/DiagramPanel.tsx`, `src/web/OnScreenLinksStyle.tsx`.

## What to do

1. Is the `arrived` branch right for every consumer of `focusRow`, not only Structure? `focusRow`
   now names the section of a centred arrival while it holds, instead of the section under the 40%
   line. Find a consumer for which that is the wrong answer, or a sequence (a jump to a paragraph
   deep inside a long section; a jump whose anchor is a passage; a folded section; a jump in a mode
   whose band covers the prose; the anchor ending with no scroll event) where the marked row is
   wrong or goes stale in a way a reader would see. Is the measurement re-run whenever it needs to be?
2. Does the new test fail for the right reason, and does it notice a mutation of the branch?
3. Run `npx vitest run tests/structure-focus-row.test.tsx tests/scroll-settlement.test.ts tests/doc-links.test.ts`.
   If the runner refuses to start for lack of memory, say so plainly.
4. Fix what is inside this commit, narrowly and red-first. Report, do not fix, anything wider. Do not
   commit. Do not attribute any words to Greg that are not already quoted in the repo.

Severity by consequence: **P0** data loss, security, charging, unusable · **P1** user-visible wrong
behaviour or a contract violated · **P2** design risk, no wrong behaviour today · **P3** prose.
Ids `D1`, `D2`, …; evidence; whether fixed. End with `VERDICT: approve` / `approve with changes` /
`rework`.

## My own suspicions (mine; worth less than yours)

- On a long article the jump's own scroll event can arrive a second late, so the previous row is
  marked until then. I have left that.
- A mode change ends the hold with no scroll and nothing re-measures; the comment says so.
