# Code review: Marginalia's "needs a wider window" line fades and can be dismissed

You are reviewing **code**, and you may fix what you find. Fix what is inside this stage, narrowly,
and red-first where it is behaviour (a test that fails before your fix). **Report, do not fix,**
anything wider you notice. Do not commit; leave your changes in the working tree. Do not edit
anything under `infra/`, `.env*`, or a defence named in
`docs/project/security-map.md § Where the defences physically live`.

Write your findings as your final answer.

## The candidate

A committed candidate: exactly one commit, `72121e004`, on top of `c86537261`.
`git show --stat 72121e004` lists the paths; `git show 72121e004` is the diff. The changed paths:

- `src/web/Toast.tsx` — the toast's clock lifted into `useGoesByItself`, now on pointer events
- `src/web/marginalia/MarginaliaColumn.tsx` — `NarrowLine`, drawn by `MarginaliaHead` when `!room`
- `src/web/styles/marginalia.css` — `.marg-narrow` as a row, `.marg-narrow-close`, `.is-gone`, the fade
- `tests/marginalia-narrow-notice.test.tsx` (new), `tests/toast.test.tsx`, `tests/close-cross.test.ts`,
  `tests/every-mode-draws-its-surface.test.tsx` (one new case in § the notes beside a band)
- `docs/project/narrow-windows.md`, `docs/project/web-client.md`
- `docs/plans/261006i-marginalia-narrow-notice-fades-and-can-be-dismissed.md` — the plan; read it
  first, and read it **as a reviewer of its claims too**, not only of the code
- `docs/plans/261006i-marginalia-narrow-notice-plan-review-sol.md` — your plan-stage review (F1 to F6)

Start there; it does not limit scope. Also worth reading as it stands: `src/web/reader/Reader.tsx`
§ `marginColumn()`, `src/web/styles/close.css`, `src/web/styles/narrow-window.css` § the
`.small-screen-hint` rule that names `.marg-narrow`, `src/web/styles/feedback.css` § the toast.

You can run these; none needs a database or the network:

```
npx vitest run tests/marginalia-narrow-notice.test.tsx tests/toast.test.tsx tests/close-cross.test.ts
npx vitest run tests/every-mode-draws-its-surface.test.tsx -t "the notes beside a band"
npx tsc --noEmit -p src/web/tsconfig.json
```

My runs, raw: the first command 35 passed (with `tests/marginalia-head-path.test.tsx`); the second
12 passed; `npm run typecheck` green on all four projects; `tests/doc-links.test.ts`,
`tests/layout-margin.test.ts` and `tests/headings-crumbs-wiring.test.tsx` 76 passed.

## What to do

Attack it independently first. Does it do what Greg asked (his words head the plan)? Is each of
your six plan findings actually fixed in the code, not only in the plan's table? What does a reader
see go wrong, at which width, on which input device, in which browser? Does the toast still behave?
Can each new test fail for the right reason? Is any comment or doc sentence now false?

## Severity and findings

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding a stable ID continuing from the plan review (`F7`, `F8`, …), its severity,
whether it is **established** or **reasoned**, and whether you **fixed** it (name the files) or are
**reporting** it. End with one line: `VERDICT: approve` / `VERDICT: approve with the fixes made` /
`VERDICT: do not land` — refuse only on an established P0 or P1 you could not fix.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- `opacity: 0` on a `position: fixed` box that stays in the document: anything it still blocks
  (text selection under it, a tap, the hover pause firing on an invisible box and mattering)?
  `pointer-events: none` is meant to cover it.
- The hook keeps running its timeout after the line has gone if the pointer was over it when the ×
  was pressed and then leaves; `setGone(true)` twice is harmless, but say if you see worse.
- Focus is on the × when it is pressed and the × then becomes `visibility: hidden`, so focus falls
  to the body. The toast has the same shape (its card unmounts).
- The 32px `.close-x` makes the box taller than the one-line box it was; whether that reads badly
  is the browser check's job, which is running separately.
- Whether `PointerEvent` handlers leave an old browser we support with no hover pause at all.
