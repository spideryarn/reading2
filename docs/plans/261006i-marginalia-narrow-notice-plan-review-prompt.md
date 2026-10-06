# Plan review: Marginalia's "needs a wider window" line fades and can be dismissed

You are reviewing a **plan**, read-only, before it is built. Do not edit anything.

## The candidate

A live pre-commit candidate in this worktree. Base: `c86537261` (origin/dev). Untracked files, which
`git diff` will not show you:

- `docs/plans/261006i-marginalia-narrow-notice-fades-and-can-be-dismissed.md` — the plan. Read it first.
- `tests/marginalia-narrow-notice.test.tsx` — the red-first test (7 of 8 fail today, by design).

Nothing else is changed yet. Code the plan will touch, to read as it stands:

- `src/web/marginalia/MarginaliaColumn.tsx` § `MarginaliaHead` (the `!room` branch)
- `src/web/reader/Reader.tsx` § `marginColumn()` and the `band-covers` class comment
- `src/web/Toast.tsx` (the clock the plan lifts into a hook), `tests/toast.test.tsx`
- `src/web/styles/marginalia.css` § `.marg-narrow`
- `src/web/styles/narrow-window.css` § the `.small-screen-hint` rule that names `.marg-narrow`
- `src/web/SmallScreenHint.tsx`, `src/web/layout.ts` (`fit.margW`, `bandCoversProse`)
- `docs/project/narrow-windows.md`, `docs/project/marginalia.md`

This list is where to start, not a limit on scope. You may run
`npx vitest run tests/marginalia-narrow-notice.test.tsx` and `tests/toast.test.tsx`; neither needs a
database or the network.

## What to do

Attack the plan independently first. Is this the right change for what Greg reported (his words are
quoted at the top of the plan)? Is it the simplest version? What breaks, on which window widths and
input devices? Is the "comes back when" table true of the code as it stands — check each row against
when `MarginaliaHead` and its `!room` branch are actually mounted and unmounted in `Reader.tsx`.
Are the tests able to fail for the right reason, and is anything load-bearing untested?

## Severity and findings

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding a stable ID (`F1`, `F2`, …), its severity, whether it is **established** (direct
evidence, no unresolved inference) or **reasoned**, and the fix you would make. End with one line:
`VERDICT: build` / `VERDICT: build with fixes` / `VERDICT: do not build` — refuse only on an
established P0 or P1.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- Whether keeping the faded element in the document, hidden with `visibility: hidden`, is sound for
  assistive technology and for the `:has(.marg-narrow)` rule, or whether there is a cleaner way to
  stop the small-screen banner arriving late.
- Whether a `transition` on `visibility` with a delay behaves when the class is added (fade out) and
  never needs to fade back in (the element is remounted instead).
- Whether a touch device, where `mouseenter` fires on tap with no `mouseleave`, can leave the clock
  stopped for good — the toast has the same shape today.
- Whether not remembering the dismissal is the right default.
