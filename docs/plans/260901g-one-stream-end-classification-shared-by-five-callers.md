# One stream-end classification, shared

**`260826m § 3.4`, narrowed to its first quarter and finally done.** Seven modules stream a model
call and each decides for itself what "finished" means. They already share the *mechanism*. They do
not share the *judgement*, and the judgement has been wrong in six of the seven since 2026-08-26.

The evidence is [260901c-the-success-signal-that-outlived-its-witness.md](../postmortems/260901c-the-success-signal-that-outlived-its-witness.md):
one sentence, written into `converse.ts` at 00:27 on 2026-08-26, corrected in place only where it was
found, and copied verbatim — comment included — into six more files over six days. Three of the six
findings against quiz mode were that sentence.

## What is actually duplicated

A survey of every caller, 2026-09-01. **Seven in production**, not the five the postmortem counted:
`converse.ts`, `explain.ts`, `search.ts`, `referee-mirror.ts`, `quiz-mark.ts`,
`referee-claims-run.ts`, `referee-criteria-run.ts` — the last two landed the same week — plus
`evals/referee-claims.ts`, and an **eighth copy inside [`src/ai-call.ts`](../../src/ai-call.ts)**
(around line 815) which computes the same verdict again for the spend ledger.

Byte-identical in all seven, in this order:

| the check | what it is |
|---|---|
| `readerAborted(signal, deadline, stalled)` → `stopped` | the reader left, and the loop ended cleanly because of it |
| `deadline.aborted \|\| stall.signal.aborted` → `explainAbort` | our own clocks, not theirs |
| `!end.terminated && finishReason === null` → `ENDED_UNFINISHED` | **the broken one** |
| `if (chunk.error) throw providerFailedMidAnswer()` inside the loop | a 200 carrying a failure |
| the `catch` triad — `stoppedByReader` / `ProviderRefused` / else | same three branches, different log wording |

And `if (choice?.finish_reason) finishReason = choice.finish_reason` appears in all seven loops.

**Why the third one can never fire.** It is a conjunction, and a non-null finish reason can only make
a conjunction *less* likely to be true. So no value of `finish_reason` has ever failed a stream in
any of these files. The comment beside it — *"`finish_reason` counts as a second witness"* —
describes a loosening as though it were a check.

## What is genuinely different, and must stay different

This is the line the whole design turns on. **Classification has one true answer; policy does not.**

| caller | what `finish_reason: "length"` means to it |
|---|---|
| `converse` | success, with `truncated: true` on the result. Throwing would turn every long answer red and throw away text the reader watched arrive. |
| `explain` | not checked at all — a truncated explanation is stored as a whole comment. A real bug, and *not* this piece of work's to fix. |
| `search`, `referee-mirror`, `referee-claims-run`, `referee-criteria-run` | usually caught downstream, because the payload is JSON and a truncated object does not parse. A `length` that lands *after* the object closed is a legitimate short result today. |
| `quiz-mark` | fatal — `MARK_CUT_OFF`, retryable. The reference implementation. |

Four defensible answers to one question. The same is true of what a reader-abort means: chat keeps
the partial and flags it, quiz-mark discards it, the JSON callers keep it only if it parses, explain
keeps it silently.

**So the shared module reports and never decides.** A `classifyEnd` that threw on `length` would
break six callers to fix one.

### The constraint that rules out the obvious shape

`converse` runs **up to four requests per turn** for tool rounds (`src/converse.ts:1475`), resetting
`finishReason` and `end` at the top of each. So a classification is **per provider request/stream,
not per feature request/turn** — one value per `openRouterStream()` call, which converse then folds
into a turn. (The first draft said "per stream, not per request", which is the same thing said
confusingly: a stream *is* a request. Corrected on review.) Anything that
returns one verdict per *feature request* is wrong, and a `length` on round 2 currently vanishes
entirely.

## The shape

`openRouterStream` in [`src/ai-call.ts`](../../src/ai-call.ts) is the single shim every caller goes
through, and it sees every parsed chunk before yielding it. It is where this belongs — not
`sseChunks`, which is a parser and should keep only **framing** facts, `[DONE]` among them. A finish
reason is payload.

The first draft also argued that the ledger's own end-of-stream verdict (around `ai-call.ts:815`)
was a copy of the same decision. Overstated, and corrected on review: that verdict is coarser and
sees only the composite signal. Folding it in is a later, separate question.

```ts
export type StreamOutcome =
  | { kind: "finished" }        // [DONE], or finish_reason "stop"
  | { kind: "truncated" }       // "length" — ran out of room mid-sentence
  | { kind: "filtered" }        // "content_filter"
  | { kind: "wants-tools" }     // "tool_calls"
  | { kind: "provider-failed" } // "error"
  | { kind: "abandoned" }       // the reader left
  | { kind: "timed-out" }       // our deadline
  | { kind: "went-quiet" }      // our stall timer
  | { kind: "unterminated" }    // EOF, no terminator, nothing said why
  | { kind: "unknown-finish-reason"; reason: string; terminated: boolean };
```

**That last member is the review's correction, and it is the one that matters.** The draft resolved
an unrecognised reason to `finished` or `unterminated` depending on the terminator — which reads as
tidy and is a *decision* smuggled out of the callers into the shared module. "An unrecognised stop is
a clean one" has a cost on each side: accept it and one bad case behaves as it did before; refuse it
and a gateway spelling `stop` as `end_turn` fails every call it serves, by throwing away complete
replies people have already read. `quiz-mark` weighed exactly that and chose a deny-list. Burying the
same choice in the classifier would have made it everybody's, invisibly, and made quiz's deny-list
look like a coincidence.

Each caller `switch`es on it with a `default: never` — which is the point. `CLAUDE.md` asks for a
wrong state the compiler refuses rather than one a test finds later, and the ninth spelling of this
decision should not be writable by hand.

### The additive step that touches no peer's file

`StreamEnd` is already the out-param (a generator's `return` is invisible to `for await`), so it
grows two **optional** fields rather than required ones:

```ts
export interface StreamEnd {
  terminated: boolean;
  finishReason?: string | null;
  answered?: boolean;
}
```

Optional deliberately. Required fields would break all seven `const end: StreamEnd = { terminated:
false }` literals, and `referee-claims-run.ts` is being edited by another agent as this is written.
Nothing in this stage touches a file somebody else is holding.

## Stages

### Stage A — the shared truth, and nothing uses it yet ✅
- [x] `StreamOutcome` and `classifyEnd` in `src/ai-call.ts`; `openRouterStream` populates the two new
      `StreamEnd` fields for every caller, and clears them per stream so a reused `end` cannot carry
      a stale verdict forward.
- [x] `tests/openrouter-stream.test.ts` gains a case per outcome. The three that earn their keep are
      the precedence ones: our deadline and our stall timer both abort the reader's signal too, so
      "the reader left" and "we gave up" arrive as the same aborted signal and only `readerAborted`
      tells them apart. Mutating the order — asking the provider before our own clocks — turns all
      three red.

*Abandonable as:* a shared classifier with tests and no users. Harmless.

### Stage B — one real caller, which proves the union says enough ✅
- [x] `quiz-mark.ts` switches on `classifyEnd` and loses its local scrape, its `didNotFinish`, its
      `stopped` flag and its `sayAbandoned` helper. It was the right first caller because it was the
      only one that already classified every reason — so if the union could not say what it says,
      the union was wrong. It could.
- [x] **Its suite stayed green with no test rewritten**, which was the whole success criterion: a
      test that had to change would have been a behaviour change, and there was not meant to be one.
- [x] The exhaustiveness check earned itself immediately. Adding `unknown-finish-reason` to the union
      turned `quiz-mark.ts` into a compile error at the `never` default — the ninth spelling of this
      decision is now unwriteable by hand, which is what `CLAUDE.md` means by letting the types catch
      it.

One thing worth recording about the wiring. A classifier over fields nobody populates would answer
`unterminated` for every stream and look principled — the same silent success in a new place. So the
claim "`openRouterStream` really writes `finishReason`" was checked the only way that counts:
stubbing that one line out turns two quiz tests red, because they push a real
`finish_reason: "length"` through the real shim.

*Abandonable as:* one caller on the shared truth and six on their own copies — which is where we
already are, minus one.

### Stage C — the two quiet callers ✅, and four still to go
- [x] **`explain.ts`** and **`search.ts`**, one commit later, on the same terms as Stage B: their
      suites stayed green with **no existing test rewritten**, which is what "behaviour-preserving"
      has to mean if it is to mean anything. Both lost their local `finishReason`, their in-loop
      scrape and — in search's case — a `stopped` flag that was set in two places and is now one
      reading of the classifier's answer. Cognitive complexity went **down** in both (explain 45→38,
      search 69→61), which is the shape of the change: three chained `!stopped && …` conditionals
      replaced by one `switch`.
- [x] **One deliberate behaviour change in each, and it is the same one.** `finish_reason: "error"`
      now throws `providerFailedMidAnswer()` rather than being handed on. Both files already threw
      exactly that for the same event arriving as `chunk.error` **data**; the field form reached the
      old guard, where a non-null reason could only make the conjunction less likely to fire, so a
      provider that said it had errored got its half-answer stored as a whole one. New tests in
      `tests/explain.test.ts` and `tests/search-stream.test.ts` cover it, and both go red if the
      branch is turned back into a `break`.
- [x] **What was deliberately *not* changed**, with a test pinning each so the next reader finds a
      decision rather than an omission: explain stores a `truncated` or `filtered` answer whole,
      because a `Comment` has nowhere to say otherwise and throwing would take back paragraphs the
      reader already watched arrive; search leaves both to its strict parse, which is a better
      witness — a truncated JSON object does not parse, and a `length` after the object closed is a
      legitimately short result.
- [x] The comment in `tests/explain.test.ts` that called `finish_reason` **"a second witness"** is
      gone. That sentence is the one the postmortem is about, and it was still sitting in a test
      name describing a loosening as a check. **This is the one existing test that changed** — its
      name and its comment, with the fixture and the assertion untouched. "No existing assertion
      changed" is the precise claim, and Stage B's is the same one.

**Two things the review made explicit, and both were changes I had not named.**

- **A clean reader-abort now logs where it used to be silent.** Both files logged "abandoned" from
  the `catch`, and set a flag without logging when the same abort ended the loop *cleanly* — which
  it does, because `sseChunks` cancels its reader and a cancelled read resolves `{ done: true }`.
  One event, two paths, one of them mute. Unifying them is the whole point of the classifier, so the
  line stays and now says so in both files. In search it means a clean abort can produce the generic
  line *and* one of the specific ones below it; that pairing is not new, it is what the throwing path
  always did. Nothing thrown or yielded changed. **No assertion noticed, which is the useful part**:
  "no existing assertion changed" is evidence and not proof, and this is exactly what it misses.
- **`classifyEnd` puts the reader ahead of a `finish_reason` that has already arrived.** A provider
  that said `error` and then lost its reader before `[DONE]` classifies as `abandoned`, so the caller
  applies its abandonment policy rather than its failure policy. Deliberate: it is what every caller
  did before the function existed, and the alternative tells off a reader who has gone for the
  provider's fault. It differs from an `error` arriving as `chunk.error` **data**, which every caller
  throws on inside the loop and which never reaches the classifier. Written into `classifyEnd`'s
  own comment, where the precedence lives.

**Still on their own copies: four.** `converse` needs its per-round fold designed — it runs up to
four requests per turn and a `length` on round 2 currently vanishes. `referee-mirror`,
`referee-claims-run` and `referee-criteria-run` are somebody else's open work this week; all three
are byte-identical to what `search.ts` had, so each is a mechanical commit once the file is free.

## What this is not

**Not** the transport half of `§ 3.4` — key, endpoint, headers, clocks and accumulation stay where
they are. **Not** a change to what any caller does today: Stage B must be behaviour-preserving, and
the test that proves it is that no existing assertion changes. **Not** `explain`'s truncation *policy* — Stage C made the
provider's `error` fatal, which was never in doubt, and left "a truncated explanation is stored as a
whole comment" exactly where it was, because that one is a product decision about what a reader is
shown and it is Greg's, not an agent's.

## The simpler option passed over

**Leave it and fix `explain` alone.** That is one file and an afternoon, and it is what the last six
days chose. The reason not to: the count went from five to seven *while the postmortem about it was
being written*, and both new copies carry the unfireable guard. Fixing instances has lost this race
twice; the classifier is what stops there being an eighth.

## The reviews

- Stage A and B: [260901g-…-review-sol.md](260901g-one-stream-end-classification-review-sol.md)
  — reviewed the plan, and its one correction (`unknown-finish-reason`, rather than folding an
  unrecognised reason into `finished`) is the member of the union that matters.
- Stage C: [260901g-stage-c-review-sol.md](260901g-stage-c-review-sol.md) — *"the core migrations
  are sound, and throwing on `provider-failed` is right in both callers"*, with four findings. All
  four are dealt with above or in the code: a `LOG_LEVEL` that leaked into later test files (the
  raise is now conditional and restored straight after the imports, copied from
  `tests/all-skipped-publication-log.test.ts`); the two unnamed changes; and three test overclaims
  worth fixing — the grade-word assertions now read **one** log line rather than the joined capture,
  the search provider-error test now asserts a hit really streamed before the refusal, and the
  explain truncation test no longer says "stores" for something it observes as a yield.
