# Review: Stage 1 — `componentDidCatch(error: unknown)` in all three error boundaries

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907`,
branch `worktree-worktree-postmortem-preventions-260907`. TypeScript + ESM, React on the client,
vitest. You reviewed the plan this comes from — findings F1–F6, in
`docs/plans/260907e-plan-review-sol.md`. **This review is Stage 1 only.** Stages 2–4 are not built
yet; do not review them again here.

## The candidate

Live pre-commit; base `8954b23f`. Scoped paths, all modified and none untracked:

- `src/web/AppBoundary.tsx`
- `src/web/FeatureBoundary.tsx`
- `src/web/LazyPage.tsx`
- `tests/no-boundary-reads-the-caught-value.test.ts`

`git diff 8954b23f -- src/web/AppBoundary.tsx src/web/FeatureBoundary.tsx src/web/LazyPage.tsx tests/no-boundary-reads-the-caught-value.test.ts`

Untracked, and **context rather than candidate**: `docs/plans/260907e-*.md` (the plan, this prompt,
your previous review).

Not durable — I will record the resulting commit SHA in the plan doc once it lands.

**A note on your previous closing remark.** You wrote that the Stage 1 spike was "still present as
working-copy modifications". It was not — the review had begun while the spike was applied and read
the tree mid-window; `git diff HEAD` was empty by then. The change is now applied deliberately, and
is the candidate above.

## What it is meant to do

`docs/postmortems/260906c-the-safe-helper-was-private-so-three-boundaries-wrote-the-unsafe-spelling.md`.
React declares `componentDidCatch(error: Error, …)` and does not enforce it: the handler is handed
whatever was thrown, so `throw null` and `throw "nope"` arrive there. All three boundaries already
route the read through `nameOfThrown` (`src/web/log-buffer.ts`), and two tests already hold that
line. This stage moves the same guarantee from those sweeps down to the typechecker, by declaring
the parameter `unknown` so the unsafe read cannot be written at all.

The contract: **no behaviour changes.** The emitted JavaScript should be identical; only what the
compiler will accept changes. If any runtime behaviour differs, that is a defect.

Deliberately out of scope: any wider refactor of error handling; the `nameOfThrown` helper itself;
`captureClientFailure`; the two existing boundary tests' own assertions.

## Evidence I already have — check it rather than repeat it

- **Red first.** Before the source change, the new test case failed naming all three:
  `"src/web/AppBoundary.tsx — error: Error"`, `"src/web/FeatureBoundary.tsx — error: Error"`,
  `"src/web/LazyPage.tsx — error: Error"`.
- **Green after**, and `npm run typecheck` exits 0 across all three projects (1,527 source files
  covered).
- **Mutation 1 — the point of the stage.** Adding `void error.name;` inside `AppBoundary`'s handler
  now fails to compile: `src/web/AppBoundary.tsx(58,21): error TS18046: 'error' is of type
  'unknown'.` The sweep test also names it. Reverted.
- **Mutation 2.** Reverting one signature to `error: Error` fails the new case naming exactly that
  file. Reverted.
- `npx vitest run tests/no-boundary-reads-the-caught-value.test.ts tests/every-boundary-contains-a-throw-that-is-not-an-error.test.tsx tests/a-broken-mode-leaves-the-article-readable.test.tsx`
  → 3 files, 23 tests, all passing.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. These three test files need
nothing outside the tree and are worth running yourself. You have no network, not even loopback.

## Attack it

Independently, before my questions below.

1. **Does it change behaviour anywhere?** The claim is that only the accepted type changed. Check
   the emitted semantics, and check `FeatureBoundary` in particular — its handler does real work
   (retiring an activation token, which is money) before the diagnostic, and the ordering there is
   load-bearing.
2. **Is `unknown` actually sound against React's declarations** under this repo's `strict` and
   `noUncheckedIndexedAccess`, or does it merely happen to compile because method parameters are
   bivariant? If a future React types change would break it, say so.
3. **Is the new test case right?** `declaredType` in the test resolves the annotation's spelling.
   Can a handler be written that is unsafe and still passes it — a destructured parameter, an alias
   type that resolves to `Error`, a `type Thrown = unknown` indirection, `any`, a rest parameter, an
   arrow-function class property instead of a method? I want the ways round it.
4. **Does the positive control still hold?** The file asserts it finds the three known boundaries.
   Does my change to `handlers()` weaken that, or the parse, in any way?
5. **Are the three comments I rewrote accurate?** They now assert what the compiler does. A comment
   that is wrong about a guarantee is worse than none.

For each finding: an ID continuing from `F6` (so `F7`, `F8`, …), a severity, and whether it is
**established** or **reasoned**.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

**Established** means direct evidence with no unresolved material inference. Refuse only on an
established P0 or P1.

Finish with a verdict: land it, land it with the changes you name, or do not land it.

## My own suspicions — read these last

Worth less than anything you find independently.

- Question 3 is where I think the weakness is: the test checks a *spelling*, not a resolved type, so
  `error: Thrown` where `type Thrown = unknown` would fail it wrongly, and an alias resolving to
  `Error` would pass it wrongly. I judged that acceptable because the typechecker is now the real
  guarantee and this test is the belt to it — but tell me if that reasoning is too comfortable.
- I am mildly unsure whether rewriting the three comments was in scope for this stage, or whether
  the wording now over-claims.
