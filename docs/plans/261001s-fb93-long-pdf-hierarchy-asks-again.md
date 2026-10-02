# A long book's hierarchy survives one bad answer

**2026-10-01.** Feedback report spya-sutes9 (SPIDERYARN-READING2-93), from Greg: *The Order of Time*,
a 4.2 MB book PDF of 1,041 blocks, stopped at "Building the hierarchy" with `[jb-step-again]`, twice.

> If you see a clean, general, robust, root cause fix, go for it. If fixing it will involve tradeoffs
> or a lot of complexity, stop and let's discuss.
>
> — Greg, 2026-10-01

## What happened

Both attempts made one structure call (Sonnet 5, ~90 k input tokens, 95–130 s, ended normally — not
`max_tokens`) and both answers were refused after they arrived, for **two different reasons**
(Vercel runtime logs, production `ai_calls`, read-only):

| job | output | what refused it |
|---|---|---|
| `spya-ns8vsr` 17:55 | 13,451 tokens, 4,406 of them thinking | `buildTree`: *"The node at root > child 3 > child 4 > child 1 has no [start, end] block range."* — after mending 9 boundaries, one of them a 71-block gap at that node's parent |
| `spya-ppuxcv` 18:29 | 9,473 tokens, no thinking | `parseStructureAnswer`: *"not valid JSON: it breaks at position 24682 of 24685 characters"* |

The second is not truncation (`ranOut` would have said "cut off") and not a complete document
followed by trailing material (`completeDocumentBefore` would have said so). Three characters from
the end, the parser met a closer it did not expect: the model lost count of its own nesting while
closing a deep tree. The answer itself is gone — nothing keeps a refused answer
(src/parse-json.ts § "Nothing keeps the response") — so that is as far as the evidence goes.

**How often.** `revision_step_runs` since 2026-09-06: 240 hierarchy steps done, 3 failed. Every
document of 700+ blocks in that window failed: 0 done, 2 failed (both these). 400–699 blocks: 5 of 5
done. Before 2026-09-06, 19 of 26 runs over 700 blocks finished, most of them the Kuhn paper being
repaired under [260904b](260904b-a-long-pdf-finishes-without-a-retry-click.md).

## The root cause, and its class

**The whole tree is one model answer, and one local fault anywhere in it throws the whole answer
away.** A 1,000-block book is a ~25,000-character nested JSON document; the chance that it contains
at least one fault grows with its length, and the stage gives a fault anywhere the same disposition
as a fault everywhere: the step fails, the reader presses Retry, and a new answer is drawn with the
same odds. The class is *an all-or-nothing gate on a long generated artefact*: the gate is right to
refuse a broken answer, and wrong to make the reader the retry loop.

The stage already took this lesson for *boundaries*: since 2026-08-31 "the partition is derived, not
checked" ([hierarchy.md](../project/hierarchy.md#derived-partition)) — a start is believed, every end
is computed, and nothing about the tiling can refuse an answer. Two kinds of fault were left outside
that rule: a child that states no range at all, and an answer that does not parse.

## The fix — two parts, both small

### 1. A child with no range is a child with no claim, not a broken answer

In `planChildRanges` (src/hierarchy.ts), `spanOf` returns `null` for two different things today: an
**invented id** (a string that is not a block — the model was working from something other than the
input; that refusal stays) and a **missing range** (no pair at all — the model left a field out). One
`null` sends the whole sibling set to `buildTree`'s throw.

The missing range becomes a child whose start carries no information, which the derivation already
handles: the first kept child is pinned to its parent's start as every first child is; a later one
falls back to the previous child's end + 1 (the existing rule), and is dropped into
`droppedChildren` if there is no usable fallback either (also the existing rule). The child after it
cannot borrow an end it never stated, so it uses its own start or is dropped by the same rule.
`recordBoundaryFaults` measures only the claims that were made. It is counted in a new
`BuildReport.rangelessChildren` list, carried to `HierarchyRun`, the pipeline's success log and the
CLI line beside `droppedChildren` — a repair nobody is told about is the bug it repaired
([silent-success.md](../reusable/silent-success.md)).

Rovelli attempt 1 would then have built (unless something later in that answer was also wrong —
unknowable, since the answer is gone).

The **cascade's** `normaliseExpansion` keeps refusing a rangeless child, as it refuses every
unusable child: a scoped call is retried there, which is the deliberate asymmetry hierarchy.md
already describes. Not touched.

### 2. An answer that cannot become a tree is asked for again, once, inside the step

In `generateHierarchy`, when a **freshly bought** answer throws in `treeFrom` (parse, build,
supplement, invariants — the same four the checkpoint gate uses), make the same structure call
**once more** and build that, before giving up. Conditions, all of them:

- **Only `treeFrom` failures.** Truncation (`max_tokens`), refusal, and SDK/transport errors throw
  before `treeFrom` and keep their own dispositions; a truncation retried would truncate again.
- **Once.** A second refusal throws the second error, with the first logged at `warn` — so the
  worst case is two calls, never a loop
  ([260902c](../postmortems/260902c-the-truncation-retry-cost-storm.md) is what a loop costs).
- **Only if the deadline admits it.** `opts.deadlineAt` (the claimant's 740 s deadline, already passed
  in by src/pipeline.ts) must leave at least the first call's own measured duration plus a margin.
  Otherwise fail now, as today, rather than be killed mid-call. No deadline (the CLI) — ask again.
- **Not if the signal has aborted.**
- The reader sees it on the progress line ("the first table of contents did not hold together;
  asking again"), and `HierarchyRun` gets `structureCalls: 1 | 2` beside `structureResumed`, logged
  at zero-or-more like every other count.

The re-asked answer goes through the same checkpoint write, so a later window resumes it.

**Cost:** one extra structure call only on a run that would otherwise have failed — about $0.27
and 95 s for this book. A run that succeeds first time is unchanged, byte for byte: same request,
same checkpoint key.

## What this passes over, and why

- **Simpler: do nothing in code; Retry already re-draws.** That is what Greg did, and it failed again
  with a different fault. At the observed rate on long books the reader is the retry loop, and pays
  for it twice.
- **Simpler still: only part 2.** The re-ask alone covers both observed faults. Part 1 is kept because
  it is a few lines inside a rule the stage already lives by, and it removes one of the two faults
  without buying a second 95-second call — with only one retry, every fault class taken off the
  table matters.
- **Mend the JSON** — close the open brackets when the break is in the trailing run of closers. It
  would likely have rescued attempt 2, but it guesses at a structure the model did not state, and it
  would live in src/parse-json.ts, which every model answer passes through. Deferred until a kept
  refused answer shows what the fault actually looks like.
- **Keep refused answers** (a `hierarchy-structure-refused` checkpoint) so the next fault like this
  can be diagnosed rather than inferred. `raw_response` was removed from `ai_calls` deliberately;
  keeping model text about a reader's article is Greg's call, so it is named here and not built.
- **Constrained decoding** (structured outputs) would make syntax faults impossible. The tree is
  recursive, which constrained JSON schemas handle poorly, and the call goes through OpenRouter.
  Larger change; named, not built.
- **Shorter answers** — drop the redundant `end` from the prompt's ranges, since every end is
  computed. A prompt change, with evals to run (prompting-guide.md). Named, not built.
- **The scoped cascade** (src/hierarchy-cascade.ts, the deepening wave, off by default) is the
  structural answer to "one answer for a whole book", and the "scale everything" Greg hoped for. Not
  turned on here: it is its own decision with its own cost profile.

## What GPT Sol's plan review changed

[The review](261001s-fb93-long-pdf-hierarchy-asks-again-plan-review-sol.md) found the design sound and
seven things to fix, all taken:

1. **"Missing" is only an absent `range` or `null`.** A half-stated range (`[start]`, `[start, 3]`)
   still carries a start claim; treating it as none would file the child's title against the wrong
   prose with nothing measured. It is refused as malformed, as before.
2. **An invented id or a malformed range now throws inside `planChildRanges`, before any sibling is
   visited**, with the same messages the visit used — otherwise a rangeless child ahead of an
   invented id reported itself and buried the precise error.
3. More edge tests: a rangeless last child, one claim left at each boundary, a rangeless child
   snapped onto its heading, and a rangeless rung that is spliced away — **counted**, because the
   figure exists to watch the prompt drift.
4. **The deadline reserve is `first + max(30 s, first / 2)`** (`reaskReserveMs`), not first + 30 s:
   the book's two calls took 129 s and 94 s, and a reserve on the first call's length alone could pay
   for most of a second call and be killed.
5. `structureCalls` is `0 | 1 | 2` (0 when resumed), and `inputTokens`/`outputTokens` sum both calls.
6. Every progress line from the second call is prefixed "asking again: ", so the state is not
   overwritten a moment later; tests cover refusal and transport errors too, and a re-asked answer
   being resumed by the next attempt.
7. Wording: these are the two *observed* fault classes, not the only ones `treeFrom` refuses; the
   cascade protocol is start-only and refuses an unusable *start* (unchanged); there is no hierarchy
   CLI line any more — the counts go to `HierarchyRun` and the pipeline's log. Adding a field to the
   shared `BuildReport` touches the initialisers in cascade, deepen, expansion, the evals and a spike
   script; mechanical, behaviour unchanged there.

## Stages

1. Part 1, test first: a `buildTree` test with a rangeless first child and a rangeless middle child —
   red today with "has no [start, end] block range", green after.
2. Part 2, test first: `generateHierarchy` with a mocked structure call whose first answer is broken
   JSON and second is sound — red today, green after; plus: second also broken → throws after exactly
   two calls; deadline too close → one call; truncation → one call.
3. Sol code review; gates; docs (hierarchy.md); feedback note.

## Done when

`npm test` and `npm run typecheck` green; the tests above were seen red first; a Sol review of the
code arrived and its findings were dealt with; on dev.
