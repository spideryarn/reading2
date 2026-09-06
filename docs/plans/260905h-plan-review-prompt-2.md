# Review (round 2): the revised plan to contain one mode's render failure

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment`, branch
`worktree-a2-mode-failure-containment`. TypeScript + ESM, React 19 under `<StrictMode>`, nuqs for URL
state, vitest. Still a **plan review, before any code is written.**

## The candidate

Live pre-commit: base `6eecb377f24d92446086a006d5b3103daae40aef`; scoped paths: none modified yet;
untracked: `docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md` (the revised plan
under review), `docs/plans/260905h-baseline.md` (the measured baseline it now cites),
`docs/plans/260905h-plan-review-prompt.md`, `docs/plans/260905h-plan-review-sol.md` (your round-1
answer) and this file.

Start with the revised plan. Round 1's prompt lists the source files it touches and they have not
changed; re-read `src/web/activation.ts`, `src/web/useAutoRun.ts` and `src/web/Dock.tsx` as needed.

## Previous findings

| ID | Finding, verbatim (abridged to its claim) | Disposition | What changed |
|----|-------------------------------------------|-------------|--------------|
| F1 | A fresh press made while the fallback is visible remains ownerless, and a later Back spends it | fixed | New section *A fresh press must not be parked behind the fallback*: a changed exact press identity resets the boundary once, via `getDerivedStateFromProps`, recording the nonce it reset for whether or not it was broken at the time; a `null` press never resets. Both outcomes tested. I verified in source that `Dock.tsx` arms on every press including the active mode |
| F2 | Stage 1 commits the exact charging bug Stage 2 is meant to prevent | fixed | Stages merged. New section *Why stages 1 and 2 are one stage*. One commit; the Dock-press → throw → Plain → Back test is red before either change and green before the commit |
| F3 | The proposed retirement identity omits `sessionEpoch` | fixed | Identity is `{nonce, sessionEpoch}`; `retireActivation` compares both. I did **not** take your cached-snapshot-object shape: the `useSyncExternalStore` snapshot stays the existing `nonce` primitive and the epoch is a derived plain read, because a snapshot returning a fresh object every call loops. Please check that reasoning |
| F4 | The plan explicitly accepts stale Ideas marks | fixed | New wording: a previously committed controller that fails is unmounted and its existing unmount cleanup clears both values. I verified in source that `useIdeasMode` already has that cleanup, so this is a test to write, not a mechanism to build. Update-failure test specified |
| F5 | The Dock correction omits focus on opening | fixed | Correction is now: drop `aria-modal`, keep the labelled `role="dialog"`, record the opener, focus the close button on open, leave focus untrapped, restore the opener on all four close paths. Test covers Enter-to-open, initial focus inside, untrapped Tab, restoration on each path |
| F6 | The reset key does not contain what its prose claims | fixed | Both limits stated outright; `owner`/`visitor` is no longer called an access identity; owner A → owner B on one slug is tested as a **structural** remount of `Reader` |
| F7 | The `componentDidCatch` spike overclaims | fixed | Conclusion narrowed to "commits once under StrictMode when props are unchanged"; the distinguishable-identity case moves into the stage's racing-press test rather than a second spike |
| F8 | Two proposed checks can report success without proving their claims | fixed, one half narrowed | Positive controls listed: throw-invocation count, the fallback's bracketed code, absence of the root `[render]` fallback, the sanitised report. **Narrowed:** the before/after request-trace diff is the existing owner-side trace tests re-run unchanged (named in the baseline doc), not a new capture-and-compare harness. Please say if that is not enough |

Treat the fixes as unreviewed prose written by someone else, and spend most of the run on what has
changed since round one.

## What it is meant to do

Unchanged from round one. The authoritative brief is
`docs/plans/260905e-main-app-architecture-review.md` § `A2`, § `A6`, and its checklist under
*Stage: Establish the behavioural baseline and contain one mode failure*.

Invariants: no paid job without a real click; Back and Forward spend nothing; exactly-once activation
survives `<StrictMode>`; the boundary never mutates the activation store during render nor depends on
effects in the failed subtree; no reader-visible text carries an exception message or article prose.

## What you can and cannot run

Tree read-only; `/tmp` writable. You can run one test file (`npx vitest run tests/<one>.test.tsx`)
and a script. No network, not even loopback. The baseline in `docs/plans/260905h-baseline.md` is the
raw output of twelve files I ran, each alone: 179 tests, all green.

## Attack it

Independently, and concentrated on the F1 fix, which is the newest and least-considered part.

The invariant to break is still: find a sequence of presses, navigations, remounts, StrictMode
double-invocations or failures under which the design either (a) leaves a spendable token that a
later Back or retry converts into a job POST, (b) destroys a token the reader legitimately just
pressed for, or (c) spends one twice. The reset-on-fresh-press rule is new machinery in exactly that
area — in particular, look for a way it resets the boundary when it should not, or fails to when it
should, and for what happens when a press for a *different* target changes nothing here.

Then: is any stage's "done" still unfalsifiable? Is the F8 narrowing honest?

For each finding: an ID (continue the numbering above — new findings start at F9), a severity
(P0/P1/P2/P3), whether it is established or reasoned, (a) the concrete scenario or contradicted
contract, and (b) the smallest closure as exact replacement wording or a code block.

Severity by consequence: **P0** data loss, exploitable security, incorrect charging, or the service
broadly unusable; **P1** user-visible wrong behaviour or an authoritative contract violated; **P2**
design or maintainability risk with no wrong behaviour today; **P3** non-behavioural prose defect. An
unintended paid model call is incorrect charging. Refuse only on an established P0 or P1, and name
what established it.

## My own suspicions — read last

- The F1 fix's `pressSeen` bookkeeping is the part I am least sure of: it must be updated even when
  the boundary is healthy, or a press made before a failure would spuriously reset the boundary after
  it — but I have not convinced myself there is no ordering in which that update is missed.
- A press for a *different* target (Quotes armed while Ideas' fallback is showing) should be invisible
  to the Ideas boundary because the store is keyed on `(slug, target)`. I believe that is right and
  have not tested it.
- F3's shape: I kept the `useSyncExternalStore` snapshot as a primitive and derived the epoch. If the
  epoch of a stored token could change after minting, that is wrong and I have not proved it cannot.

Do not change any file.
