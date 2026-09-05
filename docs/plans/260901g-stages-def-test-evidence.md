# Stages D–F: what was run, and the five mutations

Raw evidence for [the code review](260901g-stages-def-code-review-prompt.md). Everything here was
run by the orchestrator on the box, 2026-09-05, against the built code — not against the plan.

The reviewer's sandbox has no network and could not start vitest at all in round one, so this file
exists so that the assertions below are evidence rather than a promise.

## Gates

Against the tree at `6d813cd6` (before the `origin/dev` merge):

```
$ npm run typecheck
✓ src/web/tsconfig.json  (355 files)
✓ tests/tsconfig.json  (1203 files)
✓ tsconfig.json  (364 files)
✓ all 1276 source files are covered by some project

$ npm run check
(exit code 0)
```

Against the merged tree at `935c8308`:

```
$ npm run typecheck
✓ src/web/tsconfig.json  (290 files)
✓ tests/tsconfig.json  (1280 files)
✓ tsconfig.json  (386 files)
✓ all 1359 source files are covered by some project

$ npx vitest run tests/converse-stream-end.test.ts tests/referee-mirror-stream-end.test.ts \
    tests/referee-claims-run.test.ts tests/referee-criteria-run.test.ts \
    tests/converse-stop.test.ts tests/converse-citations.test.ts \
    tests/explain.test.ts tests/search-stream.test.ts
 Test Files  8 passed (8)
      Tests  109 passed (109)
```

The two migrated-in-Stage-C callers are in that list on purpose: `explain` and `search` are the
reference implementations this change copied, and they must not have moved.

## The five mutations

Each one was applied to the built code, the test run watched go red, and the file restored from a
byte-identical copy. **A test that was never red proves nothing** —
[silent-success.md](../reusable/silent-success.md).

### M1–M3 — `finish_reason: "error"` in the three referee runners

Mutation: in each of `src/referee-mirror.ts`, `src/referee-claims-run.ts` and
`src/referee-criteria-run.ts`, `case "provider-failed":` ends with `throw providerFailedMidAnswer()`.
Turn each of those three lines into `break;` — which is what the code did before this change, once
the unfireable conjunction had let the value through.

```
$ sed -i -e 's/^      throw providerFailedMidAnswer();$/      break;/' -- src/referee-mirror.ts
  (and the same for the other two)
$ npx vitest run tests/referee-mirror-stream-end.test.ts tests/referee-claims-run.test.ts \
    tests/referee-criteria-run.test.ts

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/referee-claims-run.test.ts > what the provider says about how it stopped >
       refuses a run the provider itself said it errored out of, even though it parses
AssertionError: expected true to be false // Object.is equality
 FAIL  tests/referee-criteria-run.test.ts > what the provider says about how it stopped >
       refuses a run the provider itself said it errored out of, even though it parses
AssertionError: expected true to be false // Object.is equality
 FAIL  tests/referee-mirror-stream-end.test.ts > what the provider says about how it stopped >
       refuses a run the provider itself said it errored out of, even though it parses
AssertionError: expected true to be false // Object.is equality
      Tests  3 failed | 40 passed (43)
```

`expected true to be false` is `expect(sawDone).toBe(false)`. **A complete, parseable payload plus
`finish_reason: "error"` plus `[DONE]` produced a successful result in all three.** That is the bug,
reproduced three times, and it is why "no existing assertion changed" was never going to find it: no
assertion was pointed at it.

Restored, and the same command:

```
      Tests  43 passed (43)
```

### M4 — `finish_reason: "error"` in `converse`

Mutation: the `throw providerFailedMidAnswer()` in `case "provider-failed":` of `src/converse.ts`
becomes `break;`.

```
 FAIL  tests/converse-stream-end.test.ts > a provider that says it failed >
       throws rather than storing the half-answer as a whole one
AssertionError: expected null not to be null
      Tests  1 failed | 2 passed (3)
```

`failure` is `null` — converse yielded a clean `done` for a stream the provider said it had errored
out of.

(The first run of this mutation reported `AssertionError: the given combination of arguments (null
and string) is invalid for this assertion`, because `expect(null).toContain(…)` complains about its
argument types rather than about the fact. An `expect(failure).not.toBeNull()` was added above it so
the red message says what went wrong. That is the only change made to the tests during verification.)

### M5 — the truncation fold, both halves

**M5a, the fix.** Drop the second disjunct, which is exactly the code before this change:

```ts
-  !stopped && text.trim() !== "" && (lastRoundRanOutOfRoom || aRoundRanOutOfRoomMidProse);
+  !stopped && text.trim() !== "" && lastRoundRanOutOfRoom;
```

```
 FAIL  tests/converse-stream-end.test.ts > truncation is folded over the rounds, not read off
       the last one > flags a turn whose first round ran out of room mid-sentence
AssertionError: expected false to be true // Object.is equality
      Tests  1 failed | 2 passed (3)
```

A two-round turn whose first round writes prose, asks for a tool and ends `length`, and whose second
ends cleanly, reports `truncated: false` without the fix. The reader was shown a sentence that stops
halfway and the flag said it had not.

**M5b, the control.** Drop the prose guard, so the fold fires on *any* truncated round:

```ts
-        if (roundText.trim() !== "") aRoundRanOutOfRoomMidProse = true;
+        aRoundRanOutOfRoomMidProse = true;
```

```
 FAIL  tests/converse-stream-end.test.ts > truncation is folded over the rounds, not read off
       the last one > does not flag a round cut off inside its tool arguments having written nothing
AssertionError: expected true to be false // Object.is equality
      Tests  1 failed | 2 passed (3)
```

**This is the one that matters most**, and it is the reason the control test is not decoration: the
guard really is holding the fix back from over-reaching rather than passing by luck. Without it,
round one being cut off inside its tool arguments having written no prose makes the panel apologise —
*"This answer ran out of room and stopped mid-sentence"*, with a retry offered — for an answer that
is whole. That was round one's finding F2.

Restored, and:

```
      Tests  3 passed (3)
```

## After the review: the full suite, and two more reproductions

**The full suite, at Stage G, before the review's fixes:**

```
$ npx tsx scripts/tmux-job.ts --name streamend-suite npm test
 Test Files  712 passed | 1 skipped (713)
      Tests  12895 passed | 35 skipped (12930)
EXIT=0
```

No failures at all, mine or anybody else's — so there is nothing in this branch to attribute.

### M6 — F5, a deadline that fires after the terminator

**Reproduced here independently of Sol's timing harness**, and deterministically. The whole reply —
prose, `finish_reason: "stop"` and `[DONE]` — is **one enqueued chunk**, so `sseChunks` takes it in a
single `read()` and then walks its own line buffer, yielding the prose from inside that walk. It is
suspended *there*, with the terminator received and not yet seen, which is exactly the gap. The test
is the consumer, so sleeping 250 ms between events against `timeoutMs: 50` resumes it only once the
deadline has certainly fired.

Against the code as it stood after Stage G:

```
 FAIL  tests/converse-stream-end.test.ts > a terminator that had already arrived when our own
       clock fired > delivers the finished answer rather than throwing it away as a timeout
AssertionError: expected 'The AI service did not finish within …' to be null
      Tests  1 failed | 3 passed (4)
```

**A complete answer, thrown away with a timeout apology over the top of words the reader had already
watched appear.** Green after gating the three signal checks on `!end.terminated`.

### M7 — F7, the reset that did not reset

Mutation: comment out the new `options.end.terminated = false;` in `openRouterStream`.

```
 FAIL  tests/ai-call.test.ts > a `StreamEnd` handed to a second stream >
       starts the second stream with no memory of how the first one ended
AssertionError: expected true to be false // Object.is equality
      Tests  1 failed | 36 passed (37)
```

Two streams through one `StreamEnd`: the first ends on `[DONE]`, the second at EOF with nothing to
say why, and `classifyEnd` calls the second one `finished`.

### The suites that are not mine, run anyway

`classifyEnd`'s precedence is shared, so the F5 fix reaches `quiz-mark`, `explain` and `search` as
well as the four this plan migrated. All three were run and are green:

```
$ npx vitest run tests/ai-call.test.ts tests/openrouter-stream.test.ts \
    tests/converse-stream-end.test.ts tests/converse-stop.test.ts \
    tests/quiz-mark-stream.test.tsx tests/explain.test.ts tests/search-stream.test.ts \
    tests/referee-mirror-stream-end.test.ts tests/referee-claims-run.test.ts \
    tests/referee-criteria-run.test.ts
 Test Files  10 passed (10)
      Tests  177 passed (177)
```
