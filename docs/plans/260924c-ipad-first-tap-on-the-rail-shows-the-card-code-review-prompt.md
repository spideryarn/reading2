# Code review: 260924c — iPad first tap on the rail shows the card

You are reviewing **built code**, with write access. Base commit `3ddb24dc`; the candidate is
uncommitted in this worktree (live pre-commit candidate).

**Other agents are editing OTHER files in this same tree right now** (quotes, PDF, comments, sse,
etc.). Do not touch, revert, format or stage any file outside the list below. No git commands that
change state (no add/commit/checkout/restore/stash/reset).

## Candidate (the only files you may edit)

Modified (see `git diff -- <path>`):
- `src/web/Spine.tsx` — `bandClick`, `RailPress`, `isKeyboardClick`, `PRESS_MS`; the `<aside>`'s
  `onPointerDown`/`onPointerCancel`; the band `onClick`.
- `tests/spine-hover.test.tsx` — the WebKit bug 282988 section at the end, and `mountSpine(onJump)`.
- `tests/spine-tap.test.ts` — the `bandClick` table.
- `tests/link-tap-escapes.test.tsx` — one new test: glossary term inside a link, both clicks
  mislabelled `mouse`.
- `docs/project/touch.md` — the spine entry's new paragraph.
- `docs/plans/260915b-shelf-actions-reachable-on-touch.md` — the dated line under § Wider.

Untracked:
- `docs/plans/260924c-ipad-first-tap-on-the-rail-shows-the-card.md` (the plan; read it first —
  § The fix is revised after the plan review)
- `docs/plans/260924c-ipad-first-tap-on-the-rail-shows-the-card-plan-review-sol.md` (the plan review,
  findings F1–F3)

## The conclusion to check

On iOS 18.2+ a finger's click reports `pointerType: "mouse"` while its pointerdown says `touch`.
The spine read the click, so an iPad's first tap on a band jumped. The claim: the band click now
decides finger-or-not from a queued press recorded at the rail's pointerdown; a finger jumps only
if its own press began with that band's card open; a pointer click with no recorded press may
reveal but never jump; keyboard clicks jump; a real mouse and a pen behave exactly as before; and
useHoverCard.ts § clickPress (links and glossary) needed no change.

The finding I would least like to be wrong about: **that a real mouse, on any device, still jumps
on its first click in every sequence** — including after hover-opened cards, after focus, and when
Floating UI's handlers on the band button run — and that no reachable sequence makes a finger jump
without its card having been shown by an earlier press.

## What to do

Attack it independently first: event order across React delegation, Floating UI's `useHover`
(`mouseOnly`), `useFocus`, `useDismiss` (outside press on pointerdown), `armedId` staleness in the
`<aside>` handler's closure, the queue's growth and pruning, `timeStamp` semantics, the tests'
fidelity (does each one fail against the old code, or against a plausible bug?).

**Fix what is inside this stage, narrowly and red-first** (write or adjust a test, see it fail, then
fix). **Report, do not fix, anything wider.** Run `npx vitest run tests/spine-hover.test.tsx
tests/spine-tap.test.ts tests/link-tap-escapes.test.tsx tests/spine-card.test.tsx` and
`npm run typecheck` (read its exit code) after any change.

## Severity and form

P0 data loss/security/charging/unusable; P1 user-visible wrong behaviour or contract violated;
P2 design/maintainability risk; P3 prose. Refuse only on an established P0/P1. IDs continue from
the plan review: start at F4 (reuse F1–F3 only for the same findings). For each: severity,
evidence (file:line), what you changed (if anything) and the test that shows it. End with a
one-line verdict and the list of files you edited.

## My own suspicions (worth less; spend most of the run elsewhere)

- A hover-opened card (mouse, `byTouch: false`) then a finger tap on the same band on a hybrid:
  the press records `armed = that band`, so the finger's first tap jumps. Arguably fine (the card
  was showing) — is it?
- `e.pointerType === "mouse"` clearing the queue: could a mouse pointerdown ever interleave with a
  finger's pending click on real hardware?
