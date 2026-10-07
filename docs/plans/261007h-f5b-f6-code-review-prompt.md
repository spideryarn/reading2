# Code review: 261007h F5b + F6 (skip-to-modes link; faint grey; shadow tokens)

**Candidate:** commit `6f357c3e5` in worktree `/var/tmp/spideryarn-worktrees/fbrgq3f6-design-consistency`.
`git show 6f357c3e5 --stat` lists every changed path; start with `src/web/reader/SkipToModes.tsx`,
`src/web/styles/dock.css` (the skip-link block), `src/web/styles/tokens.css`, `styles/tokens.css`,
but that list does not limit scope. **Other work is in progress in this worktree (loading lines in
the reading-view panels, by a builder; signed-out pages, by another reviewer); uncommitted changes
in files outside this commit are theirs — ignore and do not touch them.**

**Spec:** `docs/plans/261007h-design-system-refresh-controls-that-do-the-same-job-look-the-same-in-every-mode.md`
§ F5 (skip link), § F6 (grey, shadows) and § "What GPT Sol's plan review changed" (R17, R18).
Greg approved: a "skip to modes" link as the first Tab stop; "lighten the secondary grey one step
on raised surfaces in dark mode"; "a lighter light-theme shadow". The builder lightened the grey
globally (recorded as broader than asked, per R17) and moved CommandBar from `tw:shadow-lg` to
`--shadow-dialog` (a visible change in dark too).

## What to do

You may write. **Fix what is inside this commit's scope**, narrowly and red-first, and **report,
do not fix**, anything wider. Do not commit. Findings to the answer file first, then fixes, then
update the answer with what you changed.

Independent pass:

1. Skip link: is it really the first Tab stop in every reading-view state (signed out on a public
   article, narrow window with bars hidden, an article still loading, a mode opened from "More" with
   no checked radio, the dock's entrance animation)? Does activating it ever drop focus on
   `<body>`? Screen-reader name and role; visible focus mark contrast in both themes; does it
   collide with any fixed element at (8,8) (the corner logo?) or sit under something with a higher
   z-index; print.
2. Tokens: are dark values byte-identical in effect to the old literals for every site moved?
   Was any elevation shadow missed, or any non-elevation shadow (rings, inset marks, dividers,
   focus) wrongly moved? Do the Tailwind arbitrary-value strings compile to a real rule
   (`tests/tailwind-utilities-resolve.test.ts`)? Is the light-theme block's selector the one the
   rest of `src/web/styles/tokens.css` uses?
3. Grey: run `npx vitest run tests/appearance-palette.test.ts tests/css-tokens.test.ts` — does the
   new pair fail at 0.63? Any comment or doc elsewhere that still states 0.63 or 4.44 as current?
4. Tests: run `npx vitest run tests/skip-to-modes.test.tsx tests/dock-fit.test.tsx tests/arrows-belong-to-the-article.test.tsx`.
   Does each new assertion fail if the behaviour is removed?
5. Docs: keyboard.md, design-css-overview.md, /help (`src/web/help/help-topics.tsx`) — accurate?

## Severity

P0 data loss / security / charging / broadly unusable · P1 user-visible wrong behaviour or a
contract violated · P2 design or maintainability risk · P3 prose. IDs `D1`, `D2`, …. Refuse only
on an established P0 or P1.

## My own suspicions (worth less)

- `href="#"` with a `biome-ignore`: is there any path (middle-click, JS failure) where it scrolls
  the page to the top or changes the URL hash the app reads (`url-state.md`)?

End with `VERDICT: ready` / `VERDICT: ready with these fixes` / `VERDICT: not ready`, and a list of
files you changed.
