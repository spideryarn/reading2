# Plan review: the title follows the prose below 1600px with the Marginalia column on

You are reviewing a **plan** for a small bug fix, read-only. Findings only; change nothing.

## The candidate (live, pre-commit)

- Worktree: `/var/tmp/spideryarn-worktrees/qi-kfmr6j93-title-align`, base `97471ab5ff4e75214a0b5cd63b2bd8f30e17f9f1`.
- The plan: `docs/plans/261006c-the-title-follows-the-prose-below-1600px-with-the-marginalia-column-on.md` (untracked).
- The fix is small enough that it is already in the tree, uncommitted, so you can judge the plan against it:
  `git diff 97471ab5f -- src/web/layout.ts src/web/reader/Reader.tsx src/web/styles/marginalia.css tests/layout-margin.test.ts docs/project/marginalia.md`
- Start with `src/web/layout.ts` § `fitMargin`, `margTitleReserve`; `src/web/styles/marginalia.css` § the room;
  `src/web/styles/narrow-window.css` § `.reader.text-alone .masthead-inner` and the phone `.masthead` rule (about line 233);
  `src/web/styles/shell.css` `.masthead`. This does not limit scope.
- You may run `node --import tsx node_modules/vitest/vitest.mjs run tests/layout-margin.test.ts` if your sandbox allows it.

## What to do

Attack the plan independently first. Is the diagnosis right? Is dropping the gate the right fix for the long term, or does it
break something at a width or in a state the plan does not name (a phone with the column on, a large root font, the rail off,
safe-area insets, the title editor, a band opening and closing, the public/visitor view)? Work the CSS arithmetic for the
masthead's inner box at 612, 768, 1000, 1200 and 1400px with a 16px root rather than trusting the plan's prose.

Severity: **P0** breaks readers or loses data; **P1** a wrong result a reader would see, or the fix does not fix the bug;
**P2** worth doing, does not block; **P3** a note. Give every finding an ID (F1, F2…), the file and line, and what you would do.
End with one line: `VERDICT: build` or `VERDICT: do not build`, and for the latter the smallest thing that would change it.

## My own suspicions (already mine; worth less; spend most of the run elsewhere)

- Between about 600 and 1000px the bar's right padding now grows by `margReserve`. I believe the title's left edge does not
  move and only its wrap width does, but I have reasoned this, not measured it; a browser check is running separately.
- On the phone rule the bar's padding is a shorthand in a media query; `.reader.text-alone .masthead { padding-right }` in
  marginalia.css is more specific and imported later, so I believe it wins there too.
