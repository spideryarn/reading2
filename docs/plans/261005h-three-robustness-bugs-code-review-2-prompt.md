# Code review, round two: three robustness bugs (261005h)

Read-only this round: change no file. A browser check is running against this tree.

## The candidate

Branch `worktree-qi-three-robustness-bugs`, two commits made since round one:

| Commit | What | See it with |
|---|---|---|
| `26b87446f` | Round one's fixes C-1, C-2, C-3, two postmortems, doc edits | `git show --stat 26b87446f` |
| `529d038ae` | Server guards for round one's C-4 and C-5 | `git show --stat 529d038ae` |

**Treat `26b87446f` as unreviewed code written by somebody else.** It was written by the round-one
reviewer inside that review and has been read and gated but not independently reviewed. Round one
is `docs/plans/261005h-three-robustness-bugs-code-review-sol.md`; the plan is
`docs/plans/261005h-three-robustness-bugs-unknown-wire-values-rootless-children-list-chain-timer.md`.

Start with `src/web/keynav.ts` § `Chain` (`startChain`, `endChain`, `chainedRow`),
`src/web/DiagramPanel.tsx` § `useReaderRow` and the `chain` holder made with `useMemo`,
`src/web/maths.ts` § `renderArticleMaths`, `src/web/stale-shell.ts` § `reloadIfStale`,
`src/public/dto.ts` § `publicTree`, `src/section-path.ts`, and the tests those commits touch. That
does not limit scope.

## What to do

An independent pass on those two commits: are the fixes right, what do they break, do the tests
hold them. Run the test files yourself (nothing here needs the network). Discovery of new,
unrelated findings in the three original stages is closed; a regression introduced by these two
commits is in scope whatever it touches.

Severity, fixed: **P0** ships a regression or loses data; **P1** wrong or incomplete in a way a
reader would meet; **P2** worth doing, not blocking; **P3** note. Ids `D-1`, …; *established* or
*reasoned*; and a verdict per commit: ship / do not ship.

## What I ran, as raw facts

- After `26b87446f`: `npx vitest run` on step-chain, diagram-step, maths-stale-chunk, lazy-page,
  stale-shell, keynav, doc-links, maths, maths-access: 9 files, 189 tests passed. `npm run
  typecheck`: all four projects pass.
- After `529d038ae` (its author's run): section-path-missing-children, public-dto, skim: 148 tests
  passed; typecheck passed.
- The full `npm test` and the browser check are running now; neither has reported.

## My own doubts, last, and only doubts

- `chainedRow(chain, true)` compares the target row's `top` and `bottom` exactly against the values
  read in `endChain`. `endChain` runs inside the scroll's `done`. Is the rectangle read there always
  the settled one, or can a sub-pixel difference between that read and the next press invalidate an
  aim that should stand (the rapid-tap and clamped-end cases)? In jsdom every rectangle is whatever
  the test says; a real browser's are fractional.
- `endChain` captures `readingLine()`. The controls bar can hide or show after a jump settles
  without `scrollY` changing. Does that invalidate aims it should not, or is that correct?
- The Diagram's chain holder is `useMemo(() => ({ current: null }), [blocks, root, kind])` with a
  lint suppression. React may discard a memo; is anything relying on it for correctness rather than
  as an optimisation, and does a re-created holder strand a listener?
- `useReaderRow` now mutates `chain.current` inside a measurement callback and uses an object state
  to force a render. Any render loop, or a render on every scroll frame that was not there before?
- Maths: after a reload is requested the article is held for five seconds. If the browser does not
  reload, the reader waits five seconds for an article that was otherwise ready. Acceptable, given
  it can happen once per build per session?
