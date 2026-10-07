# Code review: 261007h F4a and F7, and a round-2 check of every P1 fix

Worktree `/var/tmp/spideryarn-worktrees/fbrgq3f6-design-consistency`. Nobody else is editing it now.
Spec: `docs/plans/261007h-design-system-refresh-controls-that-do-the-same-job-look-the-same-in-every-mode.md`.

## Part A — first review of two commits

- **`1b1fe60d0` F4a** — order chips (`.gloss-sort-btn`, `.srch-sort-btn`: one corner, 28px, a
  neutral "on") and every failure sentence in `--danger` (`--color-danger` in `tailwind.css`'s
  bridge; every `tw:text-destructive` on text in `src/web` → `tw:text-danger`; waits/empties split
  from failures in Diagram and Illustrated). Start with `tests/failure-colour-and-order-chips.test.ts`,
  `src/web/styles/glossary.css`, `src/web/DiagramPanel.tsx`, `src/web/IllustratedView.tsx`,
  `src/web/tailwind.css`. Plan § F4, § Judgement calls, R11, R12.
- **`c433e121b` F7** — `/design` § Controls across modes (`src/web/DesignPage.tsx`,
  `src/web/styles/design-page.css`) and the docs (`docs/project/controls.md` § Controls that do the
  same job look the same, `docs/project/design-css-overview.md`). Read the docs as a reviewer of
  the claims: does each row of controls.md's table name the right piece and a test that really
  holds callers to it? Does /design draw the real classes, and say anything false? Plan § F7, R19.

Independent pass, then for each: a failure now in `--danger` that is really a wait, an empty, a
warning that is not a failure, or a fill; a wait or empty still painted as a failure; contrast of
`--danger` on any ground other than page/panel/raised (e.g. a tinted card, a hover card, an admin
table); the 28px order chip's effect on six bands' rows and the 40px finger floor; the neutral "on"
readable as chosen; `--color-danger` and `tests/css-tokens.test.ts`'s text guard; the
`eager-client-graph` change (six modules marked as shared with the reader — true?).

## Part B — round 2, narrowly: each P1 fix that no reviewer has checked

These fixes were made after (or by) the round-1 review that found them; check **only whether each
fix is right and complete**, not general discovery:

1. **F1 E1** (`5fb8b4783`, then `f868ce9d9` and `337fee2ed`): `BandWaiting` draws an unseen copy of
   the spinner and sentence before 600ms (`.band-waiting-ghost`, the words as CSS `content` from
   `data-words`) so the box keeps its height. Run `npx vitest run tests/band-waiting-layout.test.tsx`
   if Chrome launches for you; if not, reason from `src/web/BandWaiting.tsx` and mode-band.css. Is
   anything announced early; does a non-string child lose its footprint; does the ghost survive a
   caller's own `display`/`gap`?
2. **F1 E2–E4** (`5fb8b4783`): Search's first answer and Referee's two lines are immediate
   (`delayMs={0}`); Illustrated's known empty is immediate and spinnerless; plates keyed by fetch.
3. **F4b C1, C2** (`32be0fb09`): notch clearance on the signed-out document bar; the reveal's
   root margin.
4. **F5b D1** (`aa75c4947`): the skip link finishing the dock's entrance.
5. **F5a H1, H2** (`f7febe8e6`): chip-row spacing and Quotes row padding under a coarse pointer.
6. **F2 K1, K2** (`337fee2ed`): the ghost sentence's flex sizing; Skim's depth bar reveal.

## What to do

You may write. Fix what is inside these commits' scope, narrowly and red-first; report anything
wider. Do not commit. Findings to the answer file first, then fixes, then update it.

Run `npx vitest run tests/failure-colour-and-order-chips.test.ts tests/diagram-css.test.ts tests/css-tokens.test.ts tests/tailwind-utilities-resolve.test.ts tests/eager-client-graph.test.ts tests/doc-links.test.ts tests/band-waiting.test.tsx tests/tap-target.test.tsx tests/skip-to-modes.test.tsx tests/reveal-once.test.ts`.

## Severity

P0 data loss / security / charging / broadly unusable · P1 user-visible wrong behaviour or a
contract violated · P2 design or maintainability risk · P3 prose. IDs `M1`, `M2`, … for Part A;
`R2-1`, `R2-2`, … for Part B. Refuse only on an established P0 or P1.

End with `VERDICT: ready` / `VERDICT: ready with these fixes` / `VERDICT: not ready`, and a list of
files you changed.
