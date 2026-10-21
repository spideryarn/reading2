# Plan review: 261021g, phone sizes part two

You are reviewing a plan, read-only. The candidate is commit `9a8f62146` in this worktree:
`docs/plans/261021g-phone-sizes-part-two-citations-spacing-and-remaining-touch-targets.md`. Its
predecessor, which shipped the 13px text floor and Chat's 40px targets, is
`docs/plans/261021c-minimum-text-and-touch-target-sizes-on-a-phone.md`. Read both in full first.

The files the plan will touch, so read them:
- `src/web/styles/mode-band.css` (`.chat-sources`, `.bring-in*`, `--band-corner-btn`, `--band-about-room`)
- `src/web/ChatPanel.tsx` § `WebSources`, `src/web/BringIntoChat.tsx`
- `src/web/components/ui/button.tsx` (shadcn `Button`, its size variants)
- `src/web/styles/gutter.css` (the `@media (hover: none)` block at the end: the touch bar)
- `src/web/styles/tap-target.css`, `src/web/styles/close.css`
- `tests/tap-target.test.tsx`, `tests/minimum-text-size.test.ts`
- `docs/project/controls.md` § The numbers, `docs/project/touch.md` § The gutter
Grep for anything else you need; the reading list does not limit scope.

The house rule: under a finger (`any-pointer: coarse`), no text under 13px and nothing to press
under 40 × 40px; desktop unchanged. Greg's words are quoted at the top of the plan.

## What to do

An independent attack on the plan first. In particular:
1. Does Stage 1's layout fix what Greg described (line and paragraph spacing of the citations as
   much as size)? Is there a simpler or better shape for the sources list on a phone?
2. Stage 2: for each table row, is the proposed mechanism right, and will it work in this
   codebase? For example, will a `min-h-10` in the shadcn `Button` base lose to, or beat,
   `className` overrides such as `h-7` / `size-7` at call sites, and which call sites would that
   change in ways the plan has not counted (the shelf chips are meant to be excluded)? Does
   Tailwind v4 with the `tw:` prefix have an `any-pointer-coarse:` variant?
3. Anything in the "written up, not built" list that is in fact cheap and safe, or anything built
   that should not be.
4. The guard: is a cascade test per rule enough?

## My own doubts, labelled as mine

- The `Button` floor is broad: 273-ish call sites. I am least sure it is safe everywhere (dense
  rows, toolbars, inside the hover card, inside dialogs).
- The gutter bar covering ~1.5 lines of the paragraph above instead of ~1.

## Format

Findings with IDs (R1, R2, …), each with severity P0 (breaks prod) / P1 (wrong, must fix before
building) / P2 (should fix) / P3 (nit), the evidence (file:line), and a suggested change. End with
a one-line verdict: `VERDICT: build as planned` / `build with changes` / `rethink`.
