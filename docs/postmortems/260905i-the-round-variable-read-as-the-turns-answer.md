# The round variable read as the turn's answer

**2026-09-05.** Migrating `src/converse.ts` onto the shared `classifyEnd`
([260901g](../plans/260901g-one-stream-end-classification-shared-by-five-callers.md) § Stage E)
turned up a bug that is not the one that migration was about. `truncated` — the flag that makes the
chat panel say *"This answer ran out of room and stopped mid-sentence"* and offer a retry — read
only the **last** round's `finish_reason`, in a function that makes up to four provider requests per
turn.

So: a model cut off at `max_tokens` mid-sentence on round two has its partial tool call reassembled
anyway (`wanted` needs only an id and a name, and `parseToolArgs` turns truncated arguments into
`{}` rather than failing), the tool runs, round three writes a clean ending, and the turn is
delivered with `truncated: false`. **The reader was shown a sentence that stops halfway and told
nothing.** Fixed in `31830f73`.

That is a small bug. What makes it worth a document is that it is **the third time this exact
mistake has been made in this one file**, and the first two were each fixed in place without anybody
naming the shape.

## The class: a loop-scoped variable read after the loop as though it summarised the loop

`converse` was written as a function that made one request. It became a function that makes up to
`MAX_TOOL_ROUNDS + 1`, and every variable the round loop rebuilds at the top of each iteration
became, silently, **a variable that holds the last round's value and is read as the turn's**.

| when | commit | the variable | what it reported |
|---|---|---|---|
| 2026-08-26 | `2e5d6d69` | `usage` | The turn's token counts were read once after the loop, so **a three-round turn was billed as a third of its real cost.** Fixed by summing per round and clearing. |
| 2026-08-27 | `f1a7d7e6` | `finishReason`, `roundText`, `calls` | The failure log line reported only the final round, so *"the budget was not the problem"* looked proven when it had been checked for one request out of four. Fixed by adding `roundLog`, an array with one record per round. |
| 2026-09-05 | `31830f73` | `finishReason`, again, via `truncated` | An answer truncated on an earlier round was delivered as whole. Fixed by folding over the rounds. |

Three variables, three fixes, one shape. And the shape has a property that makes it very hard to
see: **the wrong reading is correct whenever the turn has one round**, which is most turns, all the
old tests, and every case anybody had in mind while writing the code. It fails only on the path that
was added later and is exercised least.

`f1a7d7e6` came closest to naming it. Its docstring on `roundLog`, still in the file, says:

> `finishReason`, `roundText` and `calls` are all **reset at the top of every round**, which means
> that at the moment anything throws, every round but the last is unrecoverable.

That sentence is the general fact. It was written about **logging**, so the fix was a log array, and
`truncated` — reading the same `finishReason`, forty lines further down, for a decision the reader
sees rather than a line an engineer reads — was left alone. The knowledge was in the file, one
scroll above the bug, scoped to the symptom it had been found through.

## Why the existing controls did not catch it

- **`npm test` was green throughout.** No test drove a turn whose *first* round ran out of room. The
  two-round tests that existed were about tools working, not about tools working after something
  went wrong.
- **`silent-success.md` describes this.** The rule *"a report must be computed from what was
  measured, never from what was attempted"* — written into
  [260901c](260901c-the-success-signal-that-outlived-its-witness.md) six days ago about an eval
  counting `CASES.length` — is the same rule. `truncated` was computed from *a* measurement, just not
  from all of them. Awareness was not the control here either.
- **The type system had nothing to say.** `finishReason: string | null` is the same type whether it
  means "the last round's" or "the turn's". That is the gap, and it is what the recommendation below
  is about.

## The fix that shipped, and why it is not just "make it sticky"

```ts
const truncated =
  !stopped && text.trim() !== "" && (lastRoundRanOutOfRoom || aRoundRanOutOfRoomMidProse);
```

Two disjuncts, not one sticky flag. The first is the old reading, unchanged, so the change is
**strictly additive** — it can turn a `false` into a `true` and never the other way. The second is
guarded on the round having written prose, because `truncated` renders as a *failure with a retry
offered*, and a round cut off inside its tool arguments having written nothing left nothing
mid-sentence in the stored answer. A plain sticky fold would make the panel apologise for an answer
that is whole. That guard was GPT Sol's finding on the plan, and the control test that pins it goes
red the moment the guard is removed
([the evidence](../plans/260901g-stages-def-test-evidence.md) § M5b).

## What would have caught the whole class, ranked

**1. Make the turn's verdict impossible to compute from a round's variable. (Easy, high value.)**
`roundLog` already exists and already holds one record per round. Every turn-level fact should be
derived from it, and no round-scoped scalar should be readable after the loop at all. Concretely:
move `finishReason`, `roundText` and the truncation fold into the record, `const` the array after
the loop, and let the turn's fields be functions of it — `roundLog.some(r => …)`,
`roundLog.at(-1)?.…`. Then "read the last round and call it the turn" is something you have to write
out and can see yourself writing, rather than the default you get by leaving a `let` where it was.
This is the same shape 260901c recommended for `evals/quiz.ts`: **the loop collects, and the summary
takes only what the loop collected.** It was recommended for an eval and is just as true of a turn.

**2. A test that drives a multi-round turn where an early round goes wrong. (Easy, medium value.)**
`tests/converse-stream-end.test.ts` now has one, and its helper `roundsOf(...bodies)` hands out one
SSE body per round, which is the piece that was missing — before it, writing such a test was enough
work to put off. Every future turn-level field should get a case in it. The class fails only on
multi-round turns, so a suite with no multi-round failure cases cannot see it by construction.

**3. Name the round/turn boundary in the types. (Harder, and the honest long-term answer.)**
The real defect is that a round's facts and a turn's facts are the same shapes in the same scope. A
`RoundOutcome` record built and returned by an extracted `runOneRound()`, with the turn's fields
computed from `RoundOutcome[]`, would make the mistake a type error rather than a reading error —
which is what `CLAUDE.md` means by letting the types catch it. It is a real refactor of a 900-line
generator and it is not this piece of work; recommendation 1 is most of the value for a fraction of
the cost, and it is the step towards this one rather than away from it.

**Not recommended:** a lint rule against `let` declared above a loop and read below it. That
describes half of every accumulator in the repo, including the three correct ones in this same
function.

## See also

- [260901c-the-success-signal-that-outlived-its-witness.md](260901c-the-success-signal-that-outlived-its-witness.md)
  — the postmortem this migration came from, and the source of "a report must be computed from what
  was measured"
- [260826e-converse-stall-misfiled-as-incomplete.md](260826e-converse-stall-misfiled-as-incomplete.md)
  — the same file, a different invariant, and the same "known gap with nowhere to live" ending
- [260901g](../plans/260901g-one-stream-end-classification-shared-by-five-callers.md) § Stage E — the
  migration that found it
- [silent-success.md](../reusable/silent-success.md)
