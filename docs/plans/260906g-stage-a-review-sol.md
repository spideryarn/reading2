## Verdict: refuse

F13 and F14 are established P1s. Both leave history entries describing the wrong journey.

### F13 — P1 — established: the masthead is misclassified as the first block

[`measureOrigin`](</home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/keynav.ts:255>) calls anything with `scrollY > stickyOffset()` a block origin. But `stickyOffset()` is the future sticky-bar clearance, while the first row comes after the scrolling masthead and controls. There is therefore a real interval where the reader is still above every article row but `measureRow()` clamps to row zero.

Concrete reproduction against the candidate: `scrollY = 100`, first row at viewport `top = 200` produced:

```json
{"kind":"block","blockId":"spya-paraaa"}
```

Back would restore the first paragraph under the chrome, losing the still-visible masthead rather than returning to the origin.

Smallest fix: determine `top` from whether the first `tr[data-block]` has crossed the reading line, not from page scroll offset. Add a test with `scrollY > stickyOffset()` while the first row remains below that line. The equivalent position-spy boundary should use the same layout fact.

### F14 — P1 — established: an abandoned arm can be claimed by a later unrelated push

[`consumeArmedJump`](</home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/jump-history.ts:193>) deliberately leaves an arm after a mismatch. Nothing clears it on an intervening `replaceState`, navigation, or `popstate`. This matters because the jump write is delayed—up to 120ms on current Safari and 320ms on older Safari—and an external navigation makes nuqs abort that queued write.

Reproduced sequence:

1. Arm `/read/x`, origin A, target B.
2. Navigate to `/` before the delayed push; nuqs cancels it, but the arm survives.
3. Back to `/read/x?at=B`.
4. An ordinary mode push retains `at=B`.

The mode entry received stamp A, and its predecessor was rewritten to A. That mode push now falsely claims to be the abandoned jump.

Smallest fix: abandon the arm on every intervening history operation—nonmatching push, public replace, and popstate. Add the complete canceled-write/navigation/Back/later-push sequence to the tests.

### F15 — P2 — established: `isPlainObject` destroys valid foreign state

[`isPlainObject`](</home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/jump-history.ts:152>) accepts every non-array object, including `Date`, `Map`, typed arrays, and class instances. `withStamp` then spreads them into an ordinary object.

A same-path `replaceState(new Date(...))`, which previously forwarded the Date, now stores `null`; I reproduced that against the wrapper. This contradicts the stated opaque-state/foreign-state preservation contract.

Smallest fix: require an `Object.prototype` or `null` prototype before treating state as a mergeable record.

### F16 — P2 — established: declining a stamp still rewrites the predecessor

For arrays and primitive foreign state, `withStamp` intentionally returns the value unchanged ([candidate lines 139–149](</home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/jump-history.ts:139>)). But the wrapper has already rewritten the predecessor before discovering that the pushed entry cannot carry the stamp ([candidate lines 1229–1231](</home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/router.ts:1229>)).

Thus a jump over array-valued state produces half the pair: truthful predecessor, unstamped destination. No repository writer currently creates such state, hence P2 rather than P1.

Smallest fix: establish that the destination can be stamped before rewriting the predecessor; otherwise perform an ordinary unstamped push without the predecessor rewrite. Add a wrapper-level nonmergeable-state case—the existing test covers only `withStamp` in isolation.

### F17 — P2 — established: the “intermediate origin” test does not establish its claimed construction

The assertion at [`tests/jump-history.test.ts:445`](</home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/tests/jump-history.test.ts:445>) records React renders. React batching can hide the intermediate value even when nuqs was synchronously notified of it.

Using the same React/nuqs observer pattern, a public `replaceState(origin)` immediately followed by `pushState(destination)` rendered only `[null, destination]`; the origin was absent. Therefore this test would not catch the marker-forwarding regression the plan says it proves.

Smallest fix: install a recording wrapper between `enableHistorySync()` and `watchHistoryWrites()`, then assert that the transaction forwards nuqs’s `__nuqs__` marker to both captured inner calls. Keep the render assertion as the user-visible check.

The queued-position test is sound for nuqs 2.10.0: it exercises the real debounce controller, the jump aborts that queue, and it waits beyond both rate-limit windows.

### F18 — P3 — established: the plan contradicts the committed source

[`260906g-back-to-where-you-jumped-from.md`](</home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:3>) still says “planned, not built” and claims `jump-history.ts` does not exist.

It also says:

- line 236: the arm is consumed “in a `finally`”; candidate code consumes it before either write.
- line 270: the top test asserts final `scrollY === 0`; the test cannot observe that and lines 305–309 later admit it.
- lines 291–292: the render assertion proves the result is not due to React batching; F17 establishes that it does not.

Smallest fix: update the status, describe consume-before-write accurately, and limit the test claim to predecessor URL/stamp behavior.

The four permitted suites passed: 189/189 tests. I found no same-path replacement that should currently discard a valid stamp; `last-view`, canonical rewrites, and ordinary query replacements are correctly preserving the entry-bound origin. `positionToWrite` and `measureOrigin` currently use the same `scrollY <= stickyOffset()` boundary—they do not disagree, but F13 establishes that the shared boundary is the wrong measurement.

The review was scoped to committed `25a16a38`. In-progress Stage B edits appeared in the worktree during the review and were excluded; I changed no files.