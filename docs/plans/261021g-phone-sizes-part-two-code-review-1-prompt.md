# Code review: 261021g stage 1 (the web sources list under a finger)

Candidate: commit `f52400304` in this worktree. Diff: `git show f52400304 -- src/web/styles/mode-band.css tests/tap-target.test.tsx`.
Changed paths: `src/web/styles/mode-band.css`, `tests/tap-target.test.tsx` (plus docs under
`docs/plans/261021g-*`). The plan is
`docs/plans/261021g-phone-sizes-part-two-citations-spacing-and-remaining-touch-targets.md`
(Stage 1 and § Plan review). The markup is `WebSources` in `src/web/ChatPanel.tsx` and
`src/web/BringIntoChat.tsx` (every state it renders: idle button, spinner, done, notes, the
pasted-address list `.bring-in-pasted`). Reading list is a start, not a limit.

Greg's words: the citations an Investigate answer lists were "too close together for an iPhone …
as much about sort of line spacing or paragraph spacing being quite close as font size".

Measured after the change at 390×844 touch: each source is a block, its button always under its
title, hairline between sources, one-line rows 99.4px title-to-title, two-line 113.5; desktop li
heights unchanged (22.8/43.2/63.6).

## What to do

You may edit, but **only** `src/web/styles/mode-band.css` (the `.chat-sources` / `.bring-in`
rules) and `tests/tap-target.test.tsx`. Another stage is being built in other files of this tree
at the same time — do not touch any other file. Fix what is wrong inside this stage, narrowly and
red-first where a test can show it; report anything wider without fixing it.

Attack independently: every BringIntoChat state inside the new block layout (does `.bring-in`
being a direct child of the `li` hold in each state? does `display: flex` on it break
`.bring-in-pasted`'s `flex-basis: 100%` or the spinner/note states?), a source with no Bring
button (non-typed chats pass no `bring`), long unbroken URLs as titles, the `.chat-sources a`
colour/hover rules, specificity against any later rule in other stylesheets that targets these
selectors (grep `chat-sources` and `bring-in` across `src/web/styles/`), and whether the test
assertions would actually fail on a regression.

Run `npx vitest run tests/tap-target.test.tsx` yourself.

## Format

Findings C1, C2, … with severity P0/P1/P2/P3, file:line evidence, and what you changed (if
anything). End with one line: `VERDICT: ship` / `ship with fixes applied` / `do not ship`.
