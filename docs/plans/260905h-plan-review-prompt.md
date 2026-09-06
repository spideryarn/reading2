# Review: a plan to contain one mode's render failure inside the reading view

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment` (a git worktree of
the Spideryarn repo), branch `worktree-a2-mode-failure-containment`. TypeScript + ESM throughout, no
build step for tests (vitest + tsx). The client is React 19 under `<StrictMode>`, with `nuqs` for URL
state. This is a **plan review, before any code is written.**

## The candidate

Live pre-commit: base `6eecb377f24d92446086a006d5b3103daae40aef`; scoped paths: none modified yet;
untracked: `docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md` (the plan under
review) and `docs/plans/260905h-plan-review-prompt.md` (this file).

Start with the plan doc. The code it proposes to change, which you should read:

- `src/web/main.tsx` — where the single root error boundary is installed
- `src/web/AppBoundary.tsx` — that boundary
- `src/web/activation.ts` — the press/token store the plan adds an operation to
- `src/web/useAutoRun.ts` — the only consumer of that store's claim/consume operations
- `src/web/App.tsx` — 5,959 lines; `Reader` starts at line 1615, the mode-band composition point is
  around lines 3240–3420, and `IdeasBand` / `VisitorIdeasBand` / `useIdeasMode` are at 3582–3800
- `src/web/Dock.tsx` — `Drawer` and its `role="dialog" aria-modal="true"` are around lines 900–1050
- `src/web/styles.css` — `.dock-scrim` (3564), `.dock-drawer` (3575), `.dock` (3233, 3305)
- `tests/public-network-trace.test.tsx` — the existing full-`App` harness the new shell test copies
- `tests/modes-that-start-themselves.test.tsx` — the existing guard on activation behaviour
- `tests/passage-mode-cleanup.test.tsx` — imports `IdeasBand` from `App.js` today

This is where to begin, not the limit of scope.

## What it is meant to do

The parent review is `docs/plans/260905e-main-app-architecture-review.md`; the authoritative brief is
its section `### A2. A mode failure should leave the article readable` and its checklist under
`## Implementation stages and handoff` → `### Stage: Establish the behavioural baseline and contain
one mode failure`, plus `### A6` for the Dock part. **Read those two sections; they are the contract
this plan is measured against.** The plan is allowed to be smaller than A2 only where A2 itself says
so.

Invariants that must not break:

1. **No paid job may start without a real click.** `activation.ts`'s whole design is that a mount is
   not a press. Back/Forward must spend nothing. Exactly-once activation must survive `<StrictMode>`
   double-invoking every effect.
2. **A boundary must not mutate the activation store during render**, and must not depend on effects
   inside the subtree that just failed.
3. Reading-view behaviour, URLs, mode ids and the block-id contract are unchanged.
4. No reader-visible text may contain an exception message or article prose.

Deliberately out of scope: converting other overlays to modals; extracting any controller other than
Ideas; touching `src/web/lib/offline-store.ts`, `src/web/lib/api.ts`, `TableView.tsx`,
`src/web/annotate.ts`, `src/converse.ts` or `vite.config.ts` (other agents own those right now).

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.tsx`) and a script (`node --import tsx <script>`), and you can build
a throwaway harness under `/tmp`. You have no network, not even loopback, so anything needing Postgres
will skip. No test has been run for this plan yet — it is a plan, not a diff.

## Attack it

Independently, before you read my questions below.

The invariant to break is **(1)** above: find a sequence of presses, navigations, remounts,
StrictMode double-invocations or failures under which the proposed design either (a) leaves a
spendable token that a later Back or retry converts into a job POST, or (b) destroys a token the
reader legitimately just pressed for, or (c) spends one twice.

Then attack the containment claim: find a render failure inside the Ideas feature that the proposed
boundary placement would **not** catch, or a piece of state that the boundary's fallback would leave
in a shape that makes the rest of the reading view wrong rather than merely reduced.

Then judge the plan as a plan: is any stage's "done" unfalsifiable? Is any test it proposes one that
would pass on the current, unfixed tree (a test that was never red proves nothing)?

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the concrete scenario the plan does not handle, or the authoritative contract it contradicts
  - (b) the smallest change that closes it — exact replacement wording, or a code block

Severity, graded by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

An unintended paid model call is **incorrect charging**. Refuse only on an established P0 or P1, and
name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- Capturing the pending press as a **prop** read during `Reader`'s render, and retiring it in the
  boundary's `componentDidCatch`, assumes the props React hands `componentDidCatch` are the ones from
  the render that threw. I believe that is true, but it is the load-bearing assumption of the whole
  retirement seam and I would like it attacked.
- Under `<StrictMode>` React re-renders and, in development, invokes the failing render twice. I am
  not certain what that does to the boundary's `componentDidCatch` count, nor whether a double
  retirement could eat a second press armed in between.
- The reset key `slug|access|mode` may be wrong in one direction or the other: too coarse (a
  sub-mode change inside a mode leaves a stuck fallback) or too fine (something in it changes on a
  scroll and silently retries a broken feature in a loop).
- The A6 conclusion — that the drawer is modeless w.r.t. the dock because `.dock` is `z-index: 96`
  above a `z-index: 92` scrim — is a reading of CSS in a file 12,000 lines long. If there is a
  stacking context that makes it false, the whole A6 conclusion inverts.

Do not change any file.
