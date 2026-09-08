# Narrow re-check: the second round of fixes to S2-01, S2-03, S2-07 and S2-06A

**This is a narrowly scoped check of four specific fixes, and nothing else.** You reviewed this
stage twice. Round one found a P0 and five P1s; round two
([260908b-s2fix-review-sol.md](260908b-s2fix-review-sol.md)) found five of eight closed and three
partly closed, plus one new P2. This round fixes exactly those four.

**Discovery is closed on this stage.** Do not open new lines of enquiry into anything you have
already passed. Judge these four and stop. If something genuinely serious catches your eye outside
them, one line at the end under "outside scope".

## What to read

Repository `spideryarn2`, this worktree, at revision `6ebb6672`. The change is `da107403..6ebb6672`
in these files only:

- `tools/overseer/observation.ts`, `tools/overseer/admissible.ts`, `tools/overseer/diff.ts`
- `tests/overseer-observation.test.ts`, `tests/overseer-diff.test.ts`, `tests/overseer-fixtures.ts`

Your round-two review is the specification. Read it first.

## The four fixes, and what to judge about each

### S2-01 (was P0) and S2-07 (was P2) — one mechanism

You showed that an intersection brand cannot carry these invariants: omitting `baseline` from a
`held` result does not revoke the caller's existing reference, and `{...snap, error: "boom"}` keeps
the brand with no cast.

The fix is **two non-exported wrapper classes holding the snapshot in an ECMAScript private field** —
`AdmissibleBox` in `admissible.ts`, `BaselineBox` in `diff.ts`, both read via `.snapshot`. `#`-fields
are nominal in TypeScript, so no object literal, spread, or structurally identical sibling class is
assignable, and neither class value is exported. `ObservedSnapshot`, `ObservedRow` and the clock were
made `readonly` throughout, so the accessor cannot be edited into a lie either.

**`Baseline` is now a separate permission from `AdmissibleSnapshot`**: admissibility means *you may
diff against this*; a baseline means *this may stand as the world*.

**And a second mint site exists, deliberately** — `baselineOf(snapshot: AdmissibleSnapshot): Baseline | null`
— because the daemon persists the last good snapshot as the producer's own wire bytes and, on
restart, re-parses and re-blesses them through `admissible()`. Without it, every restart would diff
against `null` and write a false fleet-wide `session-seen`.

**The trap it had to avoid, and the claim to test:** a plain `baselineOf` would hand the P0 straight
back, one function call instead of one assignment. So `baselineOf()` and `diff()` call **one shared
predicate** — `unplaceable(snapshot)`, rows plus an unreadable generation — and a snapshot the differ
would hold returns `null` here too. The claim is that this makes the rule about **the value** rather
than **its provenance**, leaving no `diff()`-only privilege to route around.

**Judge:** is there any remaining way to obtain a `Baseline` for a snapshot `diff()` would hold, or
to mutate a boxed snapshot after blessing? Is the empty-fleet exemption carried consistently through
both call sites?

### S2-03 (was P1) — the tolerance is no longer a constant

You showed 10 s was unsafe: a countdown sampled near the start of a 4 s collection and again during a
20 s one moves the implied deadline ~16 s with the same real wait throughout, and `tookMs` was
available all along.

The fix: `waitDeadlineToleranceMs(nextTookMs) = nextTookMs + WAIT_DEADLINE_ROUNDING_MS` (2 s).

**Only the later collection's duration enters**, and the argument for that is the part to check: the
earlier collection's duration can only push *its own* deadline later, which **shrinks** the
difference, and a shrinking difference is never reported as a restart. **Is that reasoning sound in
both directions**, including when the earlier collection is the long one and when the wait is
genuinely extended by a small amount?

### S2-06A (was P2) — the duplicated validator is gone

`isRepoValue` is now imported from `scripts/gjd-remote-repo.js` and the copy deleted. That module
runs nothing at import and injects its one impurity, so the runtime import costs nothing; a comment
says why this import earns the exception to the directory's `import type` rule.

**There was no red available and the author said so** rather than inventing one: deleting a copy that
currently agrees with the original is behaviour-preserving. The test added is a **drift detector** —
it asserts the parser's verdict *is* `isRepoValue`'s across 16 values, so it fails the day the
grammars diverge, which is the sequence you named. **Is that the right test, and do the 16 values
cover the boundary?**

## The residual the author left open, which I want your verdict on

`diff(baselineOf(x), next)` **compiles when `baselineOf` returns `null`**, and silently means cold
start — the same shape of hazard as the P0, one level out. `Baseline | null` was kept rather than a
result union because the daemon's file is already written against it; the null is documented as
**READ THE NULL**, and the test helper throws rather than passing it through.

**Is documentation enough here, or does this want a `{ok}` union?** The author's estimate is that
closing it costs one more line in `daemon.ts`. Say plainly which you would do, and why the answer
differs — if it does — from the P0, where "the caller could just do the wrong thing" was not
acceptable.

## Evidence

- `npx vitest run tests/overseer-observation.test.ts tests/overseer-diff.test.ts` — **75 passed**
  (69 before this round, 40 before the first).
- `npm run typecheck` — **zero errors across the tree**.
- **The P0's red was a typecheck failure, not a test failure**, because the defect was a compile-time
  permission:

  ```
  tests/overseer-diff.test.ts(71,3): error TS2578: Unused '@ts-expect-error' directive.
  tests/overseer-diff.test.ts(86,19): error TS2339: Property 'snapshot' does not exist on type 'AdmissibleSnapshot'.
  ```

  The first line **is** the P0: `diff(admitted, admitted)` compiled, so an `AdmissibleSnapshot` was
  being accepted as a baseline.
- **Mutations: 10 applied, 10 caught. Three were run through `tsc` rather than vitest** — the brand
  reverted to an intersection, `Baseline` aliased to `AdmissibleSnapshot`, and `error` made mutable
  again — on the reasoning that a mutation the test runner cannot see is exactly the kind that
  survives. A further test isolates the rounding term, because the boundary test derived its
  expectation from the function and moved with it.

## Severity scale — use exactly these

**P0** a wrong result or break nothing would catch · **P1** a real defect or an expensive-to-undo
design choice · **P2** worth fixing, survives without it · **P3** preference.

For each of the four, state plainly: **closed**, **partly closed**, or **not closed**. Give any
finding an ID, a severity, a `file:line`, and the concrete sequence that produces a bad outcome.

## Constraints

- **Do not change any file.** Read-only. You may run
  `npx vitest run tests/overseer-observation.test.ts tests/overseer-diff.test.ts`.
- Other agents are editing `tools/overseer/store.ts` and `tools/overseer/daemon.ts` in this worktree
  right now. Those are **not** in scope and their state is not this stage's problem.

## My own suspicion, last

The private-field mechanism is strong inside the module, but `AdmissibleSnapshot` and `Baseline` are
*type* exports whose values can only be made in two files — so the guarantee now rests on those two
files being right, rather than on the type system. That is a smaller surface and I think it is the
correct trade, but it is a different kind of guarantee from the one the round-two brief asked for,
and I would rather you said so than let me believe otherwise.
