# Plan review: 261003k, Structure's fisheye list keeps the current sections and summary, and scrolls

You are reviewing a plan, read-only. Do not edit files. You may run one test file
(`npx vitest run tests/outline-panel.test.tsx`) or a tsx script if it helps.

Read `docs/plans/261003k-structure-fisheye-list-always-shows-the-current-sections-and-summary-and-scrolls.md`
first, then what it changes and cites:

- `src/web/OutlinePanel.tsx` (the fit in `measure`, the hidden candidates, the Expanded
  follow-along effect), `src/web/outline.ts` (the rungs), `src/web/styles/outline-mode.css`
- `src/web/modes/structure/StructureMode.tsx` (which face is drawn), `src/web/StructurePanel.tsx`
  and `src/web/structure.ts` (the two-column face, which the plan leaves alone)
- `tests/outline-panel.test.tsx`, `tests/mode-surface-changes-no-markup.test.tsx` § `OUTLINE`
- `docs/project/structure.md`, `docs/plans/261001q-structure-fisheye-expanded-and-arrow-keys.md`
  (Expanded, the scroll and follow rule being reused), `docs/plans/260910g-structure-mode-subsumes-outline.md`
  (where the one-line clamp became the floor)

Questions:

1. Does the plan meet what Greg asked for in the quoted report, and only that? Is anything he asked
   for left unmet in the list face, or anything built that he did not ask for? Is leaving the
   two-column face alone right, given what it already draws?
2. The fit rule: "if rung 3 does not fit, show rung 3 and scroll; otherwise the tallest fitting rung
   from 3 up". What breaks? Consider: no current part, the reader in the Notes (supplement), a
   section with no gist, the band covering the prose on a phone, the band stepped aside
   (`display: none`), a classic (non-overlay) scrollbar narrowing the visible list relative to the
   hidden copies, and any measure → state → re-measure loop.
3. Removing the one-line clamp entirely: is anything else relying on `.outln-list.clamp` or
   `data-outline-clamp`? Is there a case where the clamp was still the better answer?
4. The follow rule in the fisheye (whole current-part block in view if it fits, else the current
   row a third down; only when the current row changes). Is it sound against the existing Expanded
   effect, the roving keyboard focus, Home/End, and a tap on a row? The list's content changes when
   the reader crosses into another part; is the scroll position sane afterwards?
5. A wheel or a touch drag over the list now scrolls the list rather than the article when it
   overflows. Is that a problem anywhere, a phone above all?
6. Are the tests the right ones, and can each go red? jsdom does no layout: which claims can only a
   browser prove?
7. Anything simpler that gets Greg the same result?

Give findings as P0/P1/P2 with file:line references, and a one-line verdict at the end.
