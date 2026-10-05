# Code review: 261005c — a late scroll event of our own ends a centred arrival

You are reviewing **committed code**, and you may fix what you find.

## The candidate

- Commit `7624d4c46` on top of `93620b647`. `git show 7624d4c46` is the whole of it. Changed paths:
  `src/web/scroll.ts`, `tests/scroll-settlement.test.ts`, `tests/mobile-chrome.test.ts` (one comment),
  `docs/project/url-state.md`, `docs/project/browser-testing.md`, `docs/project/column-context.md`,
  `docs/plans/261005c-*.md` (the plan, your colleague's plan review and its prompt),
  `docs/postmortems/261005d-whose-scroll-was-that-decided-by-a-clock.md`.
- Start with `src/web/scroll.ts` and its readers (`src/web/reader/useReadingPosition.ts`,
  `src/web/position.ts`, `src/web/keynav.ts`, `src/web/comment-jump.ts`); that does not limit scope.
- The plan: `docs/plans/261005c-a-late-scroll-event-of-our-own-ends-a-centred-arrival-and-rewrites-at.md`.
  The plan review's one finding (F1, exact equality rather than a half-pixel tolerance) was accepted
  and is in this commit; that fix has not been reviewed by anyone.

## What to do

1. Your own pass first. Is the change correct for every path that moves the page or asks where the
   reader is? Is anything left in `scroll.ts`, its comments, or the docs that still describes a quiet
   window or a clock that no longer exists, or claims something the code does not do? Do the new
   tests fail for the right reason — would each go red on the incident as it happened? Mutate the
   fix (put a clock or a tolerance back) and check the suite notices. Is the postmortem accurate
   against the code and the git history (`fb21841fb`, `30b5eac34`), and is every claim in the three
   edited project docs true?
2. Run `npx vitest run tests/scroll-settlement.test.ts tests/scroll-glide.test.ts tests/scroll.test.ts tests/bar-visibility.test.ts tests/mobile-chrome.test.ts tests/reading-position.test.ts tests/doc-links.test.ts`
   yourself (nothing outside the tree is needed). If the runner refuses to start for lack of memory,
   say so plainly rather than reporting a pass.
3. **Fix what is inside this change, narrowly, and red-first** (a failing test before each fix).
   Report, and do not fix, anything wider you notice. Do not commit. Do not attribute any words to
   Greg that are not already quoted in the repo.

Severity, by consequence: **P0** data loss, security, charging, service unusable · **P1**
user-visible wrong behaviour or an authoritative contract violated · **P2** design or
maintainability risk with no wrong behaviour today · **P3** prose. Give every finding an id
(`C1`, `C2`, …), its severity, the evidence, and whether you fixed it. End with
`VERDICT: approve` / `approve with changes` / `rework`.

## My own suspicions (already mine; worth less than yours)

- `ourScrollY` now never expires. `scrollToTop` and an instant `scrollToBlock` leave it set.
- `tests/scroll-settlement.test.ts` replaces `window.scrollY` by `defineProperty`, so "the reader
  moved" is simulated rather than produced by a browser.
- The sibling named and left in the postmortem (`DiagramPanel.tsx` § `CHAIN_MS`).
