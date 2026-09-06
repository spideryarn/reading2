# Review (round 2): the code that contains one mode's render failure

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment`, branch
`worktree-a2-mode-failure-containment`. TypeScript + ESM, React 19 under `<StrictMode>`, vitest.
Round one of this code review is `docs/plans/260905h-code-review-sol.md` — your findings F10–F14. All
five are fixed. **Treat the fixes as unreviewed code written by someone else, and spend most of the
run on what has changed since.**

## The candidate

Live pre-commit; base `6eecb377f24d92446086a006d5b3103daae40aef`. Not durable — the resulting commit
SHA goes into this file once it lands.

Modified against the base: `src/web/App.tsx`, `src/web/activation.ts`, `src/web/AppBoundary.tsx`,
`tests/passage-mode-cleanup.test.tsx`.

Untracked (a pathspec cannot name these):

```
src/web/FeatureBoundary.tsx
src/web/modes/ideas/IdeasMode.tsx
tests/a-broken-mode-leaves-the-article-readable.test.tsx        17 tests
tests/the-ideas-extraction-changed-no-requests.test.tsx          3 tests
docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md
docs/plans/260905h-baseline.md
docs/plans/260905h-traces.md
docs/plans/260905h-plan-review-sol.md, -sol-2.md, -code-review-sol.md
```

Start with `src/web/FeatureBoundary.tsx` § `componentDidCatch`, the new test at
`tests/a-broken-mode-leaves-the-article-readable.test.tsx` § *the boundary retires the press its own
failed render was holding*, and `src/web/AppBoundary.tsx`. Not the limit of scope.

## Previous findings

| ID | Claim | Disposition | What changed |
|----|-------|-------------|--------------|
| F10 | A non-`Error` render throw breaks the boundary's own handler | fixed | `componentDidCatch` retires the press **first**, then reports, then derives the log name defensively (`typeof … === "string"`, default `"Error"`, in a `try`). A `throw null` containment case added. **The same defect fixed in `src/web/AppBoundary.tsx`**, which had it too and has no outer boundary to catch the secondary throw |
| F11 | The request-trace test is not mounted under the app's `<StrictMode>` | fixed | Now mounts `StrictMode → NuqsAdapter → AppBoundary → App`. **Both** trees re-captured with one byte-identical temporary harness (the pre-extraction tree is still on disk at `../a2-trace-base`, detached at the base commit). The arrays changed a great deal — Plain 9 → 12, Ideas 12 → 16, Chat 11 → 16, and the job-poll normalisation now actually fires. All three diffs still empty. `docs/plans/260905h-traces.md` rewritten with the new capture and a note that the first was not the production lifecycle |
| F12 | The racing-newer-press claim is untested at the React level | fixed | New test mounting `FeatureBoundary` alone under `StrictMode`, child arms a newer press during render and throws. Proved red against exactly the mutation you named (looking the token up at catch time): `expected null not to be null`. **Your one-shot shape did not work** — React re-renders the whole root synchronously after a concurrent-render throw, so a child that throws once is re-rendered successfully and never caught; the probe therefore throws until it has been caught, with the mocked report as the stop condition |
| F13 | A successful Retry can start a paid job without the tests noticing | fixed | New case: stop throwing, clear the trace, press "Try Ideas again", assert the fallback is gone **and** no job POST |
| F14 | `generation` and its keyed `Fragment` are redundant | fixed | Both removed, with the `Fragment` import; `retry` is `setState({ broken: false })`; docstrings updated |

**One correction to the code's own claim, arising from F12** and worth your attention because it is
the load-bearing sentence of the whole design. The retirement comment used to say it retires *the
press pending when the render that threw began*. That is not exactly true: React's synchronous
recovery pass means the render finally **caught** need not be the first that threw, so `this.props`
in `componentDidCatch` is the caught render's. I have rewritten the comment to say so, and to argue
that the gap is unreachable because a press is armed by a real `onClick` and a click cannot
interleave with a synchronous recovery pass. **Please attack that argument specifically.**

## What you can and cannot run

Tree read-only; `/tmp` writable. You can run one test file
(`npx vitest run tests/a-broken-mode-leaves-the-article-readable.test.tsx`, 17 tests, jsdom, no
network) and a script, and build a harness under `/tmp`. No network, not even loopback.

Results I have run: containment 17/17 · trace 3/3 · `tests/modes-that-start-themselves.test.tsx`
21/21 **unchanged** · `tests/public-network-trace.test.tsx` 60/60 ·
`tests/passage-mode-cleanup.test.tsx` 4/4 · `tests/doc-links.test.ts` 14/14 · `npm run typecheck`
clean · `npm run check` gates clean, test lane `1 failed | 711 passed | 1 skipped` where the one
failure is `tests/chat-web-links.test.ts`'s wall-clock ratio assertion, which passes 44/44 run alone
on this shared box and is unrelated.

## Attack it

Independently, and concentrated on the five fixes and on anything they disturbed.

The invariant is still the money one: a sequence of presses, mode changes, Back/Forward steps,
remounts, StrictMode double-invocations, article or reader changes, or failures under which this code
(a) leaves a spendable token a later navigation converts into a `POST /api/jobs`, (b) destroys a
token the reader legitimately pressed for, or (c) spends one twice. F10's reordering moved the
retirement ahead of the reporting — check that nothing depended on the old order. F14 removed the
child key — check that nothing depended on it.

Then: does the `throw null` fix in `AppBoundary.tsx` leave any other way for a diagnostic to swallow
the failure it is recording, in either boundary?

For each finding: an ID (continue the chain; new findings start at **F15**), a severity, established
or reasoned, (a) the sequence that shows it fails its own claim, (b) the smallest closure as a code
block.

Severity by consequence: **P0** data loss, exploitable security, incorrect charging, or the service
broadly unusable; **P1** user-visible wrong behaviour or an authoritative contract violated; **P2**
design or maintainability risk with no wrong behaviour today; **P3** non-behavioural prose defect. An
unintended paid model call is incorrect charging. Refuse only on an established P0 or P1, naming what
established it.

## My own suspicions — read last

- The F12 probe arms a **new** press on every render attempt, so at catch time the store holds one
  nonce and the props hold the previous one. That is a clean demonstration of *a* correct behaviour,
  but I am not certain it is the behaviour a real racing press would produce, and I would like the
  test's fidelity attacked as well as its result.
- Retiring before reporting means a failure in `retireActivation` itself would now lose the report.
  I judged that the better order because the money matters more than the diagnostic, but say if the
  trade is wrong.
- The boundary is gated on `mode === "ideas"` at the call site, so it unmounts on leaving the mode.
  The `mode` term in `resetKey` is therefore dead. I kept it as documentation for the next feature;
  that may be worse than removing it.

Do not change any file.
