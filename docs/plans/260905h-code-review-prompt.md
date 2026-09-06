# Review: the code that contains one mode's render failure

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment`, branch
`worktree-a2-mode-failure-containment`. TypeScript + ESM, React 19 under `<StrictMode>`, nuqs for URL
state, vitest. **This is the code review of Stage 1**, built from a plan you reviewed twice
(findings F1–F9). Weight it higher than those plan reviews: a plan review cannot find a boundary that
retires the wrong token.

## The candidate

Live pre-commit; base `6eecb377f24d92446086a006d5b3103daae40aef`. Not durable — I will write the
resulting commit SHA into this file once it lands.

Modified (`git diff` against the base shows these three):

```
src/web/App.tsx                     | 322 +++-----------------
src/web/activation.ts               |  91 ++++++
tests/passage-mode-cleanup.test.tsx |   3 +-
```

Untracked — a pathspec cannot name these, so here they are explicitly:

```
src/web/FeatureBoundary.tsx                                  the new boundary
src/web/modes/ideas/IdeasMode.tsx                            the Ideas controller, moved
tests/a-broken-mode-leaves-the-article-readable.test.tsx     the new tests (14)
tests/the-ideas-extraction-changed-no-requests.test.tsx      the exact request-sequence check
docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md   the plan
docs/plans/260905h-baseline.md                               the measured pre-change baseline
docs/plans/260905h-traces.md                                 the before/after request traces
docs/plans/260905h-plan-review-sol.md, -sol-2.md             your two plan reviews
```

Start with `src/web/FeatureBoundary.tsx`, then `src/web/activation.ts`'s new bottom section, then the
`FeatureBoundary` call site in `src/web/App.tsx` (search for `FeatureBoundary`). That is where to
begin, not the limit of scope.

`src/web/App.tsx`'s 322-line diff is almost entirely a **deletion**: `IdeasBand`,
`VisitorIdeasBand` and `useIdeasMode` moved to `src/web/modes/ideas/IdeasMode.tsx` byte-for-byte,
plus six now-dead imports removed and one added. The only substantive addition there is the
`FeatureBoundary` element.

## What it is meant to do

The plan is the contract; read it. In short:

1. A render exception inside one mode must leave the prose, the spine, the dock and the navigation
   working, and must offer a working way back to Plain and an explicit retry.
2. **No paid job may start without a real click.** `src/web/activation.ts` is the whole of that rule.
   A press is a token; `useAutoRun` claims it in an effect. If the controller's *initial* render
   throws, that effect never runs, so the new `retireActivation` retires the exact token from
   `componentDidCatch`. It must never erase a newer press, another target's token, or another
   session's. Back and Forward must spend nothing. Exactly-once activation must survive StrictMode.
3. The boundary must not mutate the activation store during render, and must not depend on effects in
   the subtree that just failed.
4. No reader-visible text may carry an exception message or article prose.

Out of scope, and owned by other agents right now: `Dock.tsx`, `styles.css`, `TableView.tsx`,
`annotate.ts`, `vite.config.ts`, `src/web/lib/*`, `src/converse.ts`. The Dock's `aria-modal` defect
is a later stage of this same job — do not review it here.

## What you can and cannot run

Tree read-only; `/tmp` writable. You can run one test file
(`npx vitest run tests/a-broken-mode-leaves-the-article-readable.test.tsx` is the interesting one —
14 tests, jsdom, no network needed) and a script, and build a harness under `/tmp`. You have no
network, not even loopback.

Results I have run, so you do not have to take them on trust:

- the new file 14/14; `tests/modes-that-start-themselves.test.tsx` 21/21 **unchanged**;
  `tests/the-ideas-extraction-changed-no-requests.test.tsx` 3/3;
  `tests/public-network-trace.test.tsx` 60/60; `tests/passage-mode-cleanup.test.tsx` 4/4;
  `tests/doc-links.test.ts` 14/14; `npm run typecheck` clean.
- **Red before the fix**, which matters more: with the boundary removed and everything else identical,
  `9 failed | 5 passed (14)` — six of them `expected 'Something in Spideryarn broke while d…' to
  contain '[mode-render]'`, i.e. the root boundary eating the page. With the boundary in but
  retirement disabled, `4 failed | 10 passed` — `Back spent the retired press: expected [ { url:
  '/api/jobs', … } ] to deeply equal []`. That is the charging bug, reproduced and then closed.
- The before/after request traces for Plain, Ideas and Chat diff **empty** (`260905h-traces.md`).

## Attack it

Independently, before my questions below.

**The invariant to break is the money one.** Find a sequence of presses, mode changes, Back/Forward
steps, remounts, StrictMode double-invocations, article changes or failures under which this code
either (a) leaves a spendable token that a later navigation converts into a `POST /api/jobs`, (b)
destroys a token the reader legitimately just pressed for, or (c) spends one twice. The new
`getDerivedStateFromProps` reset-on-fresh-press rule and the `pressSeen` bookkeeping are the newest
machinery and the least exercised; concentrate there.

Then attack the containment: find a failure mode inside Ideas that this boundary does **not** catch,
or a piece of `Reader` state that a contained failure leaves in a shape that makes the rest of the
page wrong rather than merely reduced.

Then the tests: is any of the 14 capable of passing while the thing it names is broken? They were
written with positive controls for exactly that reason — check the controls are real.

For each finding: an ID (continue the chain; new findings start at **F10**), a severity, whether it
is established or reasoned, (a) the input or sequence that shows it fails its own claim, and (b) the
smallest change that closes it, as a code block.

Severity by consequence: **P0** data loss, exploitable security, incorrect charging, or the service
broadly unusable; **P1** user-visible wrong behaviour or an authoritative contract violated; **P2**
design or maintainability risk with no wrong behaviour today; **P3** non-behavioural prose defect. An
unintended paid model call is incorrect charging. Refuse only on an established P0 or P1, naming what
established it.

## My own suspicions — read last

Already my doubts, so confirming them is worth less than what you find yourself.

- `getDerivedStateFromProps` returns `{ pressSeen, broken: false }` on a changed nonce. I believe a
  press for a *different* target cannot reach it, because the wrapper reads
  `pendingActivation(slug, target)` — but the subscription itself is global, so the wrapper
  re-renders on any arm anywhere. I have not proved the derived state cannot be confused by that.
- The boundary is now gated on `mode === "ideas"`, so it unmounts when the reader leaves the mode. I
  changed that late, after the tests were written, to stop the activation subscription existing in
  the other thirteen modes. The tests stayed green — but "still green after a change" is exactly the
  shape of a check that never covered the change.
- `retireActivation` deletes regardless of `owner`. I argued that both an unclaimed token and one
  claimed by a dead mount are wrong to leave. I would like that argued back at.
- The child is keyed on `state.generation` so retry remounts it. I have not thought hard about what
  else that key resets, or whether remounting the controller on retry can itself start a request.

Do not change any file.
