# One stream-end classification, shared

**`260826m § 3.4`, narrowed to its first quarter and finally done.** Seven modules stream a model
call and each decides for itself what "finished" means. They already share the *mechanism*. They do
not share the *judgement*, and the judgement has been wrong in six of the seven since 2026-08-26.

The evidence is [260901c-the-success-signal-that-outlived-its-witness.md](../postmortems/260901c-the-success-signal-that-outlived-its-witness.md):
one sentence, written into `converse.ts` at 00:27 on 2026-08-26, corrected in place only where it was
found, and copied verbatim — comment included — into six more files over six days. Three of the six
findings against quiz mode were that sentence.

**Done, and landed on `dev` 2026-09-06** (`fc1d64f6`). All seven production callers and the eval go
through [`classifyEnd`](../../src/ai-call.ts); no local re-implementation of the stream-end
judgement survives anywhere. `grep -rn openRouterStream --include=*.ts` over the tree on 2026-09-04
found eight call sites and no ninth. The contract now lives in
[ai-gateway.md § How a stream ends](../project/ai-gateway.md#stream-end), which is where a reader
should be sent rather than at any one caller.

**This header said "Done, 2026-09-04" for two days and was written before the review**, which is
worth leaving a mark about in a plan whose whole subject is a claim that outlived its evidence. What
followed that sentence: a postmortem that found the fold's bug was the third of its class in one file
(Stage G), and a cross-family review of the built code that **refused**, on two P1s it had reproduced
by running harnesses — one of them a bug **older than this migration**, sitting in the shared
classifier and true of all seven callers (Stage H). A stage marked ✅ is not the same as a stage
reviewed.

**One thing is deliberately still open, and it is Greg's**, not an oversight: `src/web/ChatPanel.tsx`
says a truncated answer *"stopped mid-sentence"*, which claims more than the wire can support. See
Stage H § F6 for the wording GPT Sol proposed.

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

### Stage D — the three referee callers ✅

All three are byte-identical to what `search.ts` had before Stage C, so this is the mechanical
commit the Stage C note promised: same three post-loop guards, same broken conjunction, same
`stopped` flag set in two places.

- [x] `referee-mirror.ts`, `referee-claims-run.ts`, `referee-criteria-run.ts` each lose their local
      `finishReason`, their in-loop scrape, their `stopped` flag and the three guards, and gain one
      `switch (classifyEnd(end, …).kind)` with a `never` default.
- [x] **The same deliberate behaviour change Stage C made in `explain` and `search`, for the same
      reason:** `finish_reason: "error"` throws `providerFailedMidAnswer()`. All three already throw
      exactly that for the same event arriving as `chunk.error` **data**; the field form reached the
      old conjunction, where a non-null reason could only make it *less* likely to fire, so a
      provider that said it had errored had its half-answer handed to `parseHits` and reported as a
      finished run if it happened to parse. **The red-first test is one per file**: a complete,
      parseable payload, `[DONE]`, and `finish_reason: "error"` — green today, and green is the bug.
- [x] `truncated` and `filtered` stay with the strict parse, exactly as in `search`: the payload is
      one JSON object, so a reply cut off anywhere fails `parseHits` and the referee is told about
      the answer rather than about the stream, and a `length` that lands *after* the object closed
      is a legitimately short result. `unknown-finish-reason` is accepted on quiz's deny-list
      reasoning. Pinned with a test in each file, so the next reader finds a decision and not an
      omission.
- [x] The clean reader-abort log line moves out of the `catch` and into `case "abandoned"`, as in
      `explain` and `search` — one event, one path, one sentence.
- [x] **`evals/referee-claims.ts` has no copy to remove**, and the review is right that changing it
      is an addition rather than an unforking. It is done anyway, because it is six lines and the
      hole is the exact class this plan exists for: `ablated()` deliberately has no clocks and no
      invariants, so an arm whose answer was truncated and still parsed moves the numbers the eval
      exists to produce, silently, and looks like a model that found fewer claims. It gains a
      `classifyEnd` that throws on anything but a clean end — its "deadline" is the
      `AbortSignal.timeout` it already passes, there is no reader and no stall clock —
      **and a `chunk.error` throw inside the loop**, which is the review's third finding and the
      reason the classifier alone would not have established the invariant: an in-band error frame
      is data, never reaches `StreamEnd`, and every production caller throws on it in the loop.

**What landed, 2026-09-04.** All three, and the eval. **The red-first evidence is the part worth
keeping**: in every one of the three the pre-fix failure was `expect(sawDone).toBe(false)` →
`received true` — a complete payload plus `finish_reason: "error"` plus `[DONE]` produced a
*successful result*. That is the bug, reproduced three times, and it is why "no existing assertion
changed" was never going to find it: no assertion was pointed at it.

Two things worth recording:

- **Mirror had no home for these tests**, so it has one now:
  `tests/referee-mirror-stream-end.test.ts`. None of the four candidates fitted —
  `referee-mirror.test.ts` opens with *"Nothing here calls a model"*, `referee-mirror-route.test.ts`
  stubs `fetch` to **throw** because its point is that some runs never reach the model,
  `referee-mirror-stream.test.tsx` is the React hook, and `overflow-message-reaches-its-caller.ts`
  exists for one property compared across four callers. Mirror is the only one of the four JSON
  callers with no run-file of its own.
- **`wants-tools` is not quite dead in `referee-criteria-run.ts`**, and its comment says so rather
  than repeating the other two. A `literature` criterion *does* send a tool, but
  `openrouter:web_search` is run server-side by the gateway, so there is nothing for this process to
  call and the finished text arrives on the same stream. Still a `break`; the union needed no change.

*Abandonable as:* six callers on the shared truth, one on its own. Which is where Stage C left us,
minus three.

### Stage E — `converse`, and the fold it needs ✅

The one caller whose migration is not mechanical, for the reason the top of this plan gives: it makes
**up to four requests per turn** and resets `end` at the top of each, so `classifyEnd` is called
**once per round** and the turn's verdict is a fold over the rounds' verdicts.

- [x] The three post-loop guards inside the round loop — the signal-only reader test, the clocks, and
      the broken conjunction — become one `classifyEnd` per round and one `switch`. Precedence is
      unchanged in fact as well as in intent: `readerAborted` already returns false the moment either
      clock has fired, so converse's reader-then-clocks order and the classifier's clocks-then-reader
      order agree on every input.
- [x] `stopped` loses **three** of its five assignments — the one in the `catch` and the signal-only
      test after the loop become one reading of the round's outcome (`abandoned`), and the
      turn-scope `let` stays because every guard after it steps aside when it is true. **The two
      inside the tool batch stay, and that is a correction from the review**: a reader can stop
      *after* a round has already classified as `wants-tools`, while its tools are running, and no
      verdict computed before the batch can know that. `tests/converse-stop.test.ts` pins it. The
      classifier answers "how did this stream end", and a reader who leaves between streams is not
      an answer to that question.
- [x] **`truncated` gains a second disjunct rather than becoming a plain sticky fold**, and the
      difference is the review's second finding. Today it is `finishReason === "length"` where
      `finishReason` is whatever the *final* round reported, and the plan named the hole at the top:
      a model cut off mid-tool-call reports `length`, has its partial calls reassembled — `wanted`
      needs only an id and a name, and `parseToolArgs` turns truncated arguments into `{}` rather
      than failing — goes round again, and the next round overwrites the reason. So the answer the
      reader was shown stopped mid-sentence and the flag says it did not.

      An unguarded "any round that ended `length`" over-fires, though, and the panel's sentence is
      a **failure** with a retry offered — *"This answer ran out of room and stopped mid-sentence"*
      (`src/web/ChatPanel.tsx`, `src/types.ts` § `truncated`). A round that wrote **no prose** and
      was cut off inside its tool arguments left nothing mid-sentence in the stored answer. So the
      addition is guarded on the round having written prose:

      > `truncated = !stopped && text.trim() !== "" && (the last round ended "truncated" || some
      > round ended "truncated" having written prose)`

      The first disjunct is today's reading, unchanged, so the change is **strictly additive** — it
      can turn a `false` into a `true` and never the other way. `!stopped` stays in front of both,
      because a reader's stop must not also be reported as our failure.
      **Red-first test**: a two-round turn whose first round writes prose, asks for a tool and ends
      `length`, and whose second ends cleanly, reports `truncated: false` today.
- [x] **`finish_reason: "error"` throws `providerFailedMidAnswer()`**, as in the four callers before
      it and for the same reason — converse already throws exactly that for the same event arriving
      as `chunk.error` data. Nothing is lost: `src/routes.ts` stores whatever text arrived and marks
      the row `error`, so the reader sees the half-answer *and* is told it is not one.
      **Red-first test**: a complete answer, `[DONE]`, `finish_reason: "error"` — a clean `done`
      today.
- [x] What is **not** changed, and each pinned: a reader's stop is still a `done` with `stopped:
      true` and never a throw (`tests/converse-stop.test.ts` is the whole file about that);
      `filtered` is still stored as an ordinary answer, because a `ConverseEvent` has nowhere to say
      otherwise and that is a product decision about what a reader is shown;
      `wants-tools` keeps its existing meaning, including the `TOOL_CALL_LOST` guard, which is now
      `outcome.kind === "wants-tools"` rather than a string comparison.

**What landed, 2026-09-04.** Both red-first tests were watched red on `tests/converse-stream-end.test.ts`
— a new file, because `converse-stop.test.ts` is about the stop button and should stay about it.
The provider-error one failed on `expect(failure).toContain("[ai-interrupted]")` with `failure` still
`null`, converse having yielded a clean `done`; the fold one on
`expect(last.truncated).toBe(true)` → `received false`. **The control was then mutation-tested**:
dropping the `roundText.trim() !== ""` guard turns it red, so it really is holding the fix back from
over-reaching rather than passing by luck.

One thing not in the plan and worth recording: **`TOOL_CALL_LOST` lost its `!stopped`**, because an
interrupted round classifies as `abandoned` rather than `wants-tools`, so the guard steps aside for
exactly the reason it always did with the union saying so instead of a flag.
`tests/converse-stop.test.ts` § *"does not call a stop a garbled tool call"* pins it.

**Two things converse needs that `StreamOutcome` deliberately does not carry**, and both are the
caller's rather than gaps in the union: a reader who leaves **between** streams, while the tool batch
is running — no per-stream verdict computed before the batch can know that; and whether a truncated
round had written prose, which needs `roundText` and is what keeps `truncated` from apologising for
an answer that is whole.

*Abandonable as:* the whole migration, done.

### Stage F — the docs, and the pointer that still named the wrong file ✅

- [x] `docs/project/ai-gateway.md` gains the shared contract: `classifyEnd`, what it reports, what it
      refuses to decide, and the table of who does what with `length`. That doc owns the gateway, and
      this is a fact about the gateway.
- [x] `docs/project/comments.md` around line 443 currently tells a reader that "the check is in
      `explainStream`" and quotes the broken sentence as the thing to follow. It becomes a one-line
      citation of `ai-gateway.md`. **The `#streaming` and `#stall-clock` anchors stay**, because
      other docs link to them.
- [x] This plan updated with what actually landed.

**The inventory is closed.** `grep -rn openRouterStream --include=*.ts` over the whole tree,
2026-09-04, finds **eight** call sites and no ninth: the seven production callers this plan is about
and `evals/referee-claims.ts`. `src/transcribe.ts` checks `finish_reason: "length"` and is not one —
it goes through `openRouterJson` and has no stream to end. The Messages wire
(`src/messages-stream.ts`) has no copy of this judgement either: the SDK hands it a whole `message`,
so there is no terminator to be missing.

### Stage G — the class Stage E's bug belongs to, made unwriteable ✅

Not in the original plan. Stage E fixed `truncated`; writing the postmortem for it —
[260905i-the-round-variable-read-as-the-turns-answer.md](../postmortems/260905i-the-round-variable-read-as-the-turns-answer.md)
— found that it was **the third time the same mistake had been made in this one file**, and the
first two were each fixed in place without anybody naming the shape.

The shape: **a variable the round loop rebuilds every iteration, read after the loop as though it
summarised the loop.** `usage` (`2e5d6d69`, a three-round turn billed as a third of its real cost),
`finishReason` for the failure log (`f1a7d7e6`), and `finishReason` again for `truncated`
(`31830f73`). It is hard to see because **the wrong reading is correct whenever the turn has one
round**, which is most turns and all the old tests.

`engineering-manager.md` says the prevention a postmortem recommends becomes a stage in the same
run, so it did. Its first recommendation, the easy high-value one:

- [x] `roundLog`'s element becomes a named `RoundRecord` type with `ended` — the round's
      `StreamOutcome["kind"]`, set beside the `switch` — and `prose` beside `chars`, because
      "wrote something" and "wrote more than whitespace" are different questions and `truncated`
      turns on the second.
- [x] **Every turn-level fact is now computed from `roundLog` and nothing else.** The two
      turn-scoped `let`s Stage E introduced are gone; `truncated` is
      `lastRound?.ended === "truncated" || roundLog.some(r => r.ended === "truncated" && r.prose)`,
      and `finishReason` is `roundLog.at(-1)?.finishReason` rather than a leftover read of `end`.
      Identical in behaviour — the two mutations from Stage E were re-run against the new form and
      both still turn their test red — and the difference is that "read the last round and call it
      the turn" is now something you have to write out and can see yourself writing.
- [x] A comment at the boundary saying so, because the next person to add a turn-level field is the
      person this is for.

*Abandonable as:* the same behaviour with the mistake harder to make. **Recommendations 2 and 3 of
that postmortem are not done**: 2 is satisfied for this field (the multi-round helper
`roundsOf(...bodies)` now exists in `tests/converse-stream-end.test.ts`, which was the missing
piece), and **3 — extracting `runOneRound()` so a round's facts and a turn's facts are different
types — is a real refactor of a 900-line generator and is deliberately left**, with the argument for
it written down in the postmortem rather than lost.

### Stage H — the round-two review, and the two P1s it found in the shared classifier ✅

[260901g-stages-def-code-review-sol.md](260901g-stages-def-code-review-sol.md) — GPT Sol on the
**built code**, which is the review that finds what a plan review cannot. It **refused**, on two
established P1s, and it had run harnesses rather than reasoned: *"F5 and F6 are established P1s with
end-to-end reproductions."* Both were reproduced independently here before anything was changed.

- [x] **F5 (P1, accepted, fixed).** `classifyEnd` asked the signals before `end.terminated`, so a
      deadline that fired in the gap between `[DONE]` arriving and the loop noticing it classified a
      **complete answer** as `timed-out` and threw it away — *"The AI service did not finish
      within…"* over the top of words the reader had already watched appear.

      `terminated` is set **only** when `data: [DONE]` literally arrives
      ([`src/openrouter-stream.ts`](../../src/openrouter-stream.ts)), so it is not something the
      provider *said*; it is proof the complete SSE response was received, and nothing later
      unreceives it. The three signal checks are now gated on `!end.terminated`. It does not weaken
      the mid-stream cases those checks exist for: a clock that fires while the stream is running
      ends it *without* `[DONE]`.

      **Not this change's bug — it predates the classifier**, because every caller's old sequence
      also threw on `deadline.aborted` regardless of the terminator. Fixed here because this plan
      owns `classifyEnd`, and one fix covers all seven callers.

      Reproduced without Sol's timing harness, deterministically: the whole reply — prose, finish
      reason and `[DONE]` — arrives as **one enqueued chunk**, so `sseChunks` takes it in a single
      read and is suspended mid-line-buffer with the terminator received and not yet seen. The test
      is the consumer, so sleeping between events resumes it only once the deadline has certainly
      fired. `tests/converse-stream-end.test.ts` § *"a terminator that had already arrived when our
      own clock fired"*, plus three cases in `tests/openrouter-stream.test.ts`.

      **And one existing test asserted the opposite.** *"blames our deadline before anything the
      provider said"* supplied `terminated: true`, which is the fixture that made it wrong — Sol's
      words: *"A terminator is not merely something the provider said; it proves the complete SSE
      response arrived."* Its fixture is now `terminated: false`, which is what it always meant.

- [x] **F7 (P2, accepted, fixed).** `openRouterStream`'s reset cleared `finishReason` and `answered`
      and **not `terminated`**, under a comment promising that a reused `end` "cannot carry a stale
      verdict into a new stream". Nothing reuses one today; the defect is that the comment is the
      thing the next caller will read. Worse after F5, because a stale `terminated: true` now
      suppresses the clock checks too. Red-first in `tests/ai-call.test.ts`.

- [x] **F6 (P1, accepted in substance; the fix is split, and half of it is Greg's).** Sol's
      reproduction: round one writes *"I'll check that.\n\n"* — a complete sentence — emits a usable
      tool call and ends `length`; round two answers cleanly. Stage E's fold reports
      `truncated: true`, and the panel says *"This answer ran out of room and stopped mid-sentence"*.
      Neither sentence is incomplete.

      **The flag is right and the sentence overclaims.** A step *was* cut off and content *was*
      lost, which is what the reader needs to know; whether the stored text ends mid-sentence is not
      observable from `finish_reason`, and Sol says so plainly: *"The available wire signals cannot
      reliably determine grammatical or semantic incompleteness."* So the fold stays — reverting it
      would restore a silent success, which is the failure this whole plan exists to stop, and the
      false positive costs a reader an unnecessary retry where the false negative costs them a
      truncated answer with no warning at all.

      `src/types.ts` § `truncated` now states the observable fact, close to Sol's wording: *"At least
      one provider round hit its output limit after writing prose"*, with a note that the panel's own
      sentence still overclaims. **The panel's copy is not changed**: this job is server-side only by
      its brief and must not touch `src/web/`, and what a reader is shown is a product decision that
      is Greg's. Written down where the field is defined rather than left for somebody to rediscover.

**The narrowly scoped check of those fixes** —
[260901g-stage-h-narrow-check-sol.md](260901g-stage-h-narrow-check-sol.md), which
`engineering-manager.md` requires because the fix for an established P1 is by definition not in the
round it was found in. It passed the three things that mattered and found one more:

- **F5's fix verified, including the part I could not.** *"`terminated = true` has one production
  writer, the literal `[DONE]` branch… Production constructors use `false`; no production caller
  aliases or reuses the object. Gating the signals is correct."* And on the three callers this job
  does not own: *"the changed precedence accepts only an already-complete stream"*.
- **Stage G verified behaviour-neutral**, which was its whole claim: *"no disagreeing completed-turn
  input found"*, with the `noteRound`-then-`classifyEnd` ordering checked explicitly.
- [x] **F8 (P2, new, established, fixed).** The reset sat **after** the response had been validated,
      so a reused `end` was still stale for an attempt that aborted, was refused, or came back with
      no body — the caller would then classify a call that never reached a byte using the previous
      stream's terminator. The three assignments now run **before `send`**, which is what an
      out-parameter meaning "how did *this attempt* end" requires: cleared when the attempt starts,
      not when it starts going well. Red-first, and the mutation that moves it back turns the new
      test red.

**F6 is the one thing left open, and it is deliberately not mine.** Sol's verdict was REFUSE on it a
second time, and on the disposition rather than the reasoning: *"The server-only boundary is
defensible as ownership, but it does not resolve F6. Put the copy change to the product owner."*
Which is exactly what this is. The panel says *"This answer ran out of room and stopped
mid-sentence"* where the server now only claims the answer *may* be incomplete, and Sol's suggested
replacement is:

> A model step hit its output limit after writing part of this answer. The answer may be incomplete;
> try again.

It is one string in `src/web/ChatPanel.tsx`, this job's brief forbids touching `src/web/`, and what a
reader is shown is Greg's call. **Not overruled — handed over.**

*Abandonable as:* the migration, plus a shared-classifier bug that was there before it and is now
fixed for all seven callers, plus one sentence of reader-facing copy waiting on Greg.

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

- The **narrowly scoped check of the F5/F6/F7 fixes and of Stage G**, neither of which was in the
  round-two snapshot: [260901g-stage-h-narrow-check-sol.md](260901g-stage-h-narrow-check-sol.md),
  prompt at [260901g-stage-h-narrow-check-prompt.md](260901g-stage-h-narrow-check-prompt.md). Found
  F8, and refused a second time on F6 — on the disposition rather than the reasoning, which is what
  puts that one in front of Greg rather than in a plan.
- Stages D–G, **on the built code**:
  [260901g-stages-def-code-review-sol.md](260901g-stages-def-code-review-sol.md) — refused, on two
  established P1s it had reproduced by running harnesses rather than by reading. Both were real, one
  of them (F5) a bug older than this migration living in the shared classifier. The prompt is
  [260901g-stages-def-code-review-prompt.md](260901g-stages-def-code-review-prompt.md) and the
  evidence handed to it is
  [260901g-stages-def-test-evidence.md](260901g-stages-def-test-evidence.md). This is the round that
  earned its keep: the plan review a week earlier could not have found F5, because F5 is not in the
  plan.
- Stages D, E and F, **on the plan**:
  [260901g-stages-def-review-sol.md](260901g-stages-def-review-sol.md) — reviewed
  the plan **before it was built**, and three of its four findings changed the design: `stopped`
  cannot be derived from the round's outcome alone, the `truncated` fold over-fired as first
  written, and an in-band `chunk.error` never reaches `StreamEnd`, so the classifier alone would not
  have given the eval the invariant it was promised.
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
