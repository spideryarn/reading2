# Review this plan before it is built

You are reviewing a plan doc for a small, well-scoped bug fix in a TypeScript + React + Vite
reading app. Be adversarial. I want findings, not encouragement.

**The repo root is the current working directory.** Read whatever you need; the paths below are
real.

## The plan

`docs/plans/260908a-the-top-bar-stops-being-drawn-when-it-has-nothing-in-it.md`

## Context you should read

- `src/web/styles/shell.css` — `§ the bar that leaves while you read`, the `.controls` rule, and
  the two `:has()` guards near the end. **The specificity reasoning in this file is load-bearing
  and has been got wrong before**; check my ladder against it.
- `src/web/styles/tokens.css` — `--bar-bottom`, `--bar-h`, `--bar-hide`, `--safe-top`.
- `src/web/styles/narrow-window.css` — `§ a small device`, which holds the **dock's** half of the
  same switch. I claim this plan does not touch it.
- `src/web/reader/Reader.tsx` — the `<div className="controls">` block (~line 1858) and what can
  appear inside it; the `<Dock …>` mount (~line 2298).
- `src/web/scroll.ts` — `stickyOffset`, `stickyDestination`, `watchBarVisibility`. I claim these
  are all already correct for an absent `.controls`.
- `src/web/layout.ts` — where I propose to put the predicate.
- `src/web/Dock.tsx` — the `drawer` prop union, the Comments `DockTab` (~line 1553), and
  `fitSignature` (~line 969).
- `docs/plans/260905g-move-the-wordmark-and-feedback-button-into-the-dock.md` § Stage 3 — the
  original spec, which you reviewed at the time; finding G3 in that file is yours.

## What I most want checked

1. **The CSS specificity ladder in § The shape of the fix.** Are the four rows right? Does
   `:root:has(.controls):has(.controls:focus-within, .mode-band)` really compute to (0,4,0)? Is
   `:root:not(:has(.controls))` really (0,2,0)? Is the (0,2,0) tie with
   `:root[data-bars="hidden"]` genuinely harmless, in **every** state, including inside the
   `@media` block in `narrow-window.css`? Is there any state — a visitor, a keyboard reader
   mid-tab, a rotation, `prefers-reduced-motion`, the installed app with a notch — where the
   ladder resolves to the wrong value?
2. **Anything else that reads `.controls` and would break on its absence.** I checked `scroll.ts`,
   `ViewportProbe.tsx` and `useColumnContext.ts`. Did I miss one? Are the tests that pose a
   `.controls` (`tests/bar-motion.test.tsx`, `tests/mobile-chrome.test.ts`) asserting anything
   that stops being true?
3. **Is the predicate's condition list complete and correct?** `.controls` today can hold: a
   visitor's `ViewOnlyChip` (`!owner`); the granularity pills and the paragraph pill/notice
   (`!inMode`, i.e. Hierarchy only); and `commentError`. Is there any other way to get content in
   there — a descendant portal, a dev-only chip, a `::before`, a focus target that must exist for
   tab order?
4. **Does removing 44px of sticky flow box have consequences I have not named?** Scroll anchoring,
   `?at=` restoration, deep links, the `.reader::before` status-bar paint, the masthead's sticky
   interaction, `fitView`'s arithmetic.
5. **Is my `-2F` separation argument sound**, or are the two reports actually one cause I should
   fix together? Read the table in the plan and check my reasoning against
   `narrow-window.css`.
6. **Anything in the plan that is simply wrong**, or any simpler option I dismissed too fast.

Answer with numbered findings, each with a severity (P0/P1/P2), the file and line, and what you
would do instead. If a claim in the plan is unsupported, say so — I would rather hear "you have
not shown this" than a guess.
