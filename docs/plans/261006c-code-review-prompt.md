# Code review: the title follows the prose below 1600px with the Marginalia column on

You are the reviewer-fixer for one small bug-fix stage. You may write in this worktree.

## The candidate (committed)

- Worktree: `/var/tmp/spideryarn-worktrees/qi-kfmr6j93-title-align`.
- Exactly one commit: `ef88def15`. `git show ef88def15`.
- Changed paths: `src/web/layout.ts`, `src/web/reader/Reader.tsx`, `src/web/styles/marginalia.css`,
  `tests/layout-margin.test.ts`, `docs/project/marginalia.md`, and three files under `docs/plans/261006c-*`.
- Start with `src/web/layout.ts` § `margTitleReserve` and `fitMargin`, then
  `src/web/styles/narrow-window.css` § `.reader.text-alone .masthead-inner` and the phone `.masthead` rule,
  `src/web/styles/shell.css` `.masthead`. This does not limit scope.
- The plan and its results (a browser measurement table) are in
  `docs/plans/261006c-the-title-follows-the-prose-below-1600px-with-the-marginalia-column-on.md`.
  **Read it as a reviewer of the conclusions, not only of the code.**
- You may run `node --import tsx node_modules/vitest/vitest.mjs run tests/layout-margin.test.ts`. You have no network
  and no database; do not report a test that needs either as a failure.

## What to do

Attack it independently first: is the fix right at every width, root size, rail state and safe-area inset; does anything
else read `--marg-title-reserve`, call `margTitleReserve`, or depend on the masthead's right padding (the title editor,
the masthead's own controls, the visitor view, print, the phone rules); do the tests actually pin the behaviour, and would
they have gone red on the old code; are the comments and the doc true?

**Fix what is inside this stage, narrowly and red-first; report, do not fix, anything wider.** Do not commit. Do not
invent or alter any quotation attributed to Greg.

Severity: **P0** breaks readers or loses data; **P1** a wrong result a reader would see, or the fix does not fix the bug;
**P2** worth doing, does not block; **P3** a note. Give every finding an ID (C1, C2…), file and line, and say for each
whether you fixed it. End with one line: `VERDICT: land` or `VERDICT: do not land`, and for the latter the smallest thing
that would change it.

## My own suspicions (already mine; worth less; spend most of the run elsewhere)

- The sentence I would least like to be wrong about: "at 612px the title's left edge does not move, and the only change
  is that it wraps at the prose's width". Measured 0 → 0 on one article with a 16px root; not measured at other roots.
- The browser "before" was simulated by forcing the CSS variable to 0px rather than by checking out the old commit.
