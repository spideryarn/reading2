# P04 before: Citations header row overflows at 375px

## 1. Docs opened, in order
- `AGENTS.md` / CLAUDE.md (in context) - signpost; pointed to design-css-overview and narrow-windows indirectly only.
- `docs/project/narrow-windows.md` - helped a lot: "a row of things whose widths you do not control must wrap", the scrollWidth console check, "scroll, never clip".
- `docs/project/citations.md` (head only + grep) - helped: names `citations.css` and `CitationsPanel.tsx`; says nothing about narrow widths.
- `docs/project/browser-testing.md` (grep) - helped: "A phone-width window does not exist, so use an iframe" (resize_page lies).
- `docs/project/mode.md` (lines 88-102) - helped: `.band-head` is optional, what may live in it.
- Not opened but would: `docs/project/design-css-overview.md`, `docs/project/controls.md`, `docs/project/browser-testing-playwright.md`.

## 2. Code files I would edit
- `src/web/styles/citations.css` (preferred: Citations-only fix)
- possibly `src/web/styles/mode-band.css` (`.band-head`, only if the shared row lacks `min-width: 0`/wrap) or `src/web/styles/narrow-window.css`
- `src/web/CitationsPanel.tsx` only if the head's markup must change (head is `.gloss-count` "N works").

## 3. Existing helpers/components to reuse
- `src/web/ModeSurface.tsx` § `head` prop (renders `.band-head`)
- `src/web/styles/glossary.css` § `.gloss-sort`, `.gloss-sort-group`, `.gloss-sort-trail` (flex-wrap pattern to copy), `.gloss-gate-row`
- `src/web/styles/mode-band.css` § `.band-head`
- No new helper needed; a CSS wrap / `min-width: 0` / `overflow-wrap` rule.

## 4. Rules I would follow
- Wrap rather than shrink; scroll only for content that cannot reflow (`narrow-windows.md`).
- Reproduce first: measure in a 375px iframe, check `documentElement.scrollWidth - clientWidth` is 0 after (`browser-testing.md`); browser work goes to a Sonnet subagent (CLAUDE.md).
- Failing test before the fix (CLAUDE.md); likely a CSS-reading test in the style of `tests/spine-width.test.ts` / `tests/touch-controls.test.ts`.
- Work in a worktree, `npm test` + `npm run typecheck`, GPT Sol review, commit by name, push to `dev`.
- Do not add a mode-name title to the band head (`mode.md`).

## 5. Where you got lost
- Could not tell which element is "the header row": `.band-head` (only a count), the `.gloss-sort` order row, or the threshold `.gloss-gate-row`. No doc maps Citations' row structure; I read the TSX.
- Reading the CSS, nothing obviously overflows (sort row and `.cite-meta` already wrap), so the culprit is unconfirmed without a browser; I was told not to run one.
- `narrow-windows.md` is shelf/dock oriented; it says little about band rows at phone width, and the pointer from the reading-view docs to it was not obvious.
- Did not find a test enumerating band rows for overflow; unsure whether one exists.

## 6. Confidence
5/10 on the file and fix shape, 3/10 on the exact offending rule.
