# The success signal that outlived the thing it was meant to witness

**2026-09-01.** The final cross-family review of quiz sub-mode
([260831al-review-quiz-sub-mode-stage4-review-sol.md](../plans/260831al-review-quiz-sub-mode-stage4-review-sol.md))
returned six findings, all six real. **Three of them were one bug wearing three costumes**, and this
document is about that shape rather than about the three fixes, which are small and already landed
in `f5479ca` and `95d8be9`.

The shape: **something that means "I stopped" was read as something that means "I finished."**

1. `finish_reason: "length"` — the model hit `MARK_MAX_TOKENS` and stopped mid-sentence — was
   treated as evidence the reply was whole. A truncated mark was delivered as a complete one and the
   question ticked answered.
2. A reader who navigated away set `stopped = true`, logged, and then **fell through to
   `yield { type: "done" }`** with whatever partial text had arrived — a success frame for a mark
   nobody asked to finish.
3. `evals/quiz.ts` printed `**FAILED**`, `continue`d, and then printed `marks: ${CASES.length}` — a
   constant — while every quality counter incremented only on success. Eight failures out of eight
   exited 0 and reported eight marks with zero banned phrases.

All three arrived in **one commit: `5253ee3`, "Set the questions before building anywhere to put
them" (2026-09-01)** — the commit that created `src/quiz-mark.ts` and `evals/quiz.ts` together.

## The root cause is a sentence, and it has been copied five times

`markAnswerStream`'s end-of-stream check was not written for quiz. Its docstring says so:
*"Modelled line for line on `explainStream` in src/explain.ts"* (`src/quiz-mark.ts:539`). What it
copied, comment and all, was this:

> `finish_reason` counts as a second witness — a provider that omits the terminator but says why it
> stopped has still told us the answer is whole.

That sentence is true of `"stop"` and **exactly false of `"length"`**. It is the whole bug, and it
is not quiz's. Its lineage, all of it by `git log -S`:

| when | commit | what happened |
|---|---|---|
| 2026-08-26 **00:27** | `9da8de4` | The sentence is written, in `src/converse.ts`, answering a cross-family review that had just found the opposite bug (an EOF with no terminator delivered as a whole answer). |
| 2026-08-26 **10:38** | `62a5d85` | `explain.ts` becomes a generator, copying `converse`'s post-loop sequence verbatim — sentence included. The same commit lifts `sseChunks`, `StreamEnd`, `readerAborted`, `stoppedByReader` and `explainAbort` into the new `src/openrouter-stream.ts`. **The mechanism is shared; the judgement is not.** |
| 2026-08-26 **15:59** | `be59cf9` | A GPT-5.6 review finds truncation in chat. `converse.ts` gains `truncated` (`src/converse.ts:1931`) — **a local patch beside the wrong sentence, which is left standing and is still there today** at `src/converse.ts:1683`. |
| 2026-08-26 | `cb1f269` | `search.ts` copies the sequence. Its comment says *"see the long comment on the same two checks in explain.ts"*. |
| 2026-09-01 | `bd2f38e` | `referee-mirror.ts` copies the sequence, same day as quiz. |
| 2026-09-01 | `5253ee3` | `quiz-mark.ts` copies the sequence. Bugs 1 and 2. |

So the correct one-line cause is: **a wrong judgement about what "finished" means was written once,
corrected in place only in the file where it was found, and then copied — with its wrong comment
intact — into four more files over six days.** By 2026-09-01 there were five independent
implementations of one invariant and only one of them was right.

### And this was predicted, in writing, five days earlier

[260826e-converse-stall-misfiled-as-incomplete.md](260826e-converse-stall-misfiled-as-incomplete.md)
is a postmortem about the *previous* divergence in the same post-loop sequence, and it names the fix:

> Two independent copies of an abort-classification state machine — three signals, two ways to end a
> loop, three ways to interpret why — are exactly the kind of invariant that drifts silently when it
> lives in two files instead of one.

[260826m-simplification-audit.md § 3.4](../plans/260826m-simplification-audit.md) turned that into a
scheduled item, and it lists **"SSE completion, finish-reason and clean-abort detection"** by name as
belonging in a shared transport. It was ordered last — *"§3.4 when there is room"* — and marked
**Risk: real**. In the five days since, two more copies were added. This is not a missed lesson; it
is a scheduled fix losing a race against new call sites.

## Checking the assumptions in the brief

Three held, one needs correcting, and one is unverifiable from inside the repo.

**`converse` handles truncation properly — true**, via `truncated: boolean` on its `done` event
(`src/converse.ts:1931`, documented at `:801`). It is the only one of the five that does.

**`explain` accepts `length` as a clean `done` deliberately and says so — true**, but the comment is
not where you would look for it. It is not on the guard; it is a field comment inside the *success
log line* (`src/explain.ts:731`): *"`length` means the answer stopped because it ran out of room, not
because it was finished — and it is stored as a clean `done` either way, because there is nowhere on
a `Comment` to say otherwise."* The guard above it still carries the wrong sentence. **That split is
the mechanism of the whole incident:** an agent reading `explain.ts` top to bottom to copy its
stream handling reads the wrong sentence on the guard and never reaches the right one sixty lines
later in a log call. The deliberate decision is invisible at the place a copier copies from.

**`explain` has the same fall-through-to-`done` abandonment shape — true**, and arguably right there:
explain has no stop button, the words arrived and the reader watched them, and there is a comment
saying so. Quiz is the case where it is not right, because `done` is the frame that ticks a question
answered.

**There are three streaming callers — wrong, there are five.** `src/search.ts` and
`src/referee-mirror.ts` have the identical post-loop sequence, the identical
`if (!stopped && !end.terminated && finishReason === null)`, and no `length` handling at all. Neither
is currently shipping a visible bug, and **the reason is luck of payload rather than judgement**:
both ask for JSON, so a reply cut off at the token ceiling is unparseable, and each catches it
downstream — `search.ts` routes it to `[ai-overflowed]` via its brace-balancing extractor,
`referee-mirror.ts` throws out of `parseHits`. **Prose has no such second witness.** The three
prose callers are `converse`, `explain` and `quiz-mark`, which is precisely the set where truncation
matters, and only `converse` handles it.

**The `[DONE]`-after-`length` claim — I could not verify it, and the conclusion does not need it.**
The new test at `tests/quiz-mark-stream.test.tsx:344` asserts it, but it is a mock, so it encodes the
belief rather than confirming it; there is no captured real stream in the repo. It is very likely
right — `data: [DONE]` is a stream-level sentinel in the OpenAI-compatible wire format and has
nothing to do with a per-choice `finish_reason`. But the guard was unfireable either way, for a
plainer reason: it was the conjunction `!end.terminated && finishReason === null`. **A non-null
finish reason can only ever make that guard less likely to fire, never more.** So no value of
`finish_reason` could have produced a failure, and "the finish reason counts as a second witness" was
describing a loosening as though it were a check. The `[DONE]` fact sharpens which conjunct went
false first; it is not load-bearing for "the guard could not fire."

## What would mechanically have caught it

`docs/reusable/silent-success.md` is loaded into every agent's awareness and all three shipped
anyway. Worse: **`evals/quiz.ts` cites that document in its own file header**, twenty lines above the
summary that then reported eight failures as eight marks —

> A green count with a patronising answer under it is exactly `docs/reusable/silent-success.md`.

An agent that has the pattern in mind, in the file, in writing, still wrote the pattern. So awareness
is not the control. Three things are.

### 1. A discriminated union over how a stream ended (bugs 1 and 2)

This is the one that matters, and it is what `CLAUDE.md` means by *"make a wrong state something the
compiler refuses."* Today the shared module exports the thinnest possible fact:

```ts
export interface StreamEnd { terminated: boolean }
```

— and every caller then reconstructs the rest by hand, in the right order, from three signals, a
boolean and a string, with `finishReason` scraped out of the chunks by five separate copies of
`if (choice?.finish_reason) finishReason = choice.finish_reason`. `sseChunks` already sees every
chunk and is already the only thing that sees `[DONE]`. It should return the classification, not one
bit of it:

```ts
type StreamOutcome =
  | { kind: "finished"; finishReason: string | null }
  | { kind: "truncated" }              // finish_reason "length"
  | { kind: "filtered" }               // finish_reason "content_filter"
  | { kind: "wants-tools" }            // finish_reason "tool_calls"
  | { kind: "abandoned" }              // the caller's own signal
  | { kind: "cut-off"; timedOut: boolean; stalled: boolean }
  | { kind: "unterminated" };          // EOF, no [DONE], no reason
```

with each caller doing `switch (outcome.kind)` and a `never` check on the default. Bug 1 becomes
unwriteable: you cannot reach the `done` path with `kind: "truncated"` without writing a case that
says so. Bug 2 becomes unwriteable: `abandoned` is a case the compiler makes you answer. And a sixth
caller cannot copy the sequence wrongly, because there is no sequence to copy.

### 2. One adversarial-stream table that every caller's tests run

Today each of the five test files was hand-written and each covers a different subset: `explain` has
"says a silence is a silence", `search` has the duplicate-`hits`-key case, `converse` has the stop
button, `quiz-mark` now has `length` and `content_filter`. **Nobody tests the same five endings
against all five callers.** A shared table — `[DONE]` after `length`, `content_filter` mid-reply, EOF
with no terminator, a body that opens and says nothing, an abort mid-stream — run `describe.each`
over every exported streaming generator, catches the copy problem directly, and a sixth caller either
joins the table or the table's own coverage assertion goes red. This repo already enforces
completeness this way in `tests/doc-links.test.ts`.

### 3. Never let a summary count its input (bug 3)

The eval's summary function had `CASES` in scope, so `marks: ${CASES.length}` was reachable and
looked right. The fix that shipped adds `marked` and `failed` counters, which works but relies on
whoever edits next remembering to increment them. **The version that cannot go wrong is a shape
change**: the loop collects `Array<{ ok: true; reply } | { ok: false; err }>`, and the summary takes
only that array. Then `CASES.length` is not in scope where the numbers are printed, and every count
and its denominator come from the same list by construction. The general rule, worth a line in
`silent-success.md`: **a report must be computed from what was measured, never from what was
attempted.**

## The recommendation

**Do the classification half of § 3.4 now, and leave the transport half scheduled.**

§ 3.4 as written is one item covering four things: the key/endpoint/headers, the two clocks, the
completion classification, and text/usage accumulation. It is L-effort, marked "Risk: real", and it
has been last in the queue for six days while the codebase grew from three copies to five. **The
evidence only demands one quarter of it**, and that quarter is the cheapest and least risky: it adds
a type and a return value to a module that already exists and already owns `[DONE]`, `StreamEnd` and
the abort helpers. It touches no fetch, no clock, no prompt. Fewer moving parts, which is the tie-break.

On Greg's question — if `explain` genuinely wants different behaviour, is that a parameter or a sign
the abstraction is wrong? **Neither.** It is the line the abstraction should be drawn along:

- **Classification is shared.** *What happened* has one true answer — the reply was cut at the token
  ceiling, or the reader left, or the stall clock fired. Five files currently compute that, and only
  one of them computes it correctly.
- **Policy stays in the caller.** *What to do about it* legitimately has five answers. `explain`
  delivers a truncated answer because a `Comment` row has nowhere to say otherwise; `converse` sets a
  flag the panel renders; `quiz-mark` refuses, because `done` ticks a question. None of that belongs
  in the shared module and none of it should be a parameter — **a `strictTruncation?: boolean` would
  put the judgement back in one place and the reason for it in five, which is where we started.**

A `switch` with a `never` default gives the policy a name and a home. That is the real gain, and it
is bigger than the bug fixed: today, reading `explain.ts`, you cannot tell its truncation behaviour
from `quiz-mark.ts`'s old one, because *deliberately allowing it* and *never having thought about it*
look identical in the code — an absence. Under the union they are a written case with a comment
versus a compile error. That distinction is the thing that would have stopped this copy, and it will
stop the seventh.

**Not recommended:** a lint or grep test forbidding a second copy of
`!end.terminated && finishReason === null`. It would have caught this one and it teaches nothing —
the next copy will be spelled differently, and a rule that only matches a string is a rule about a
string.

## What has happened since

Written 2026-09-01, and the counts above are as-found. Since then:

- **`classifyEnd` and `StreamOutcome` exist**, in [`src/ai-call.ts`](../../src/ai-call.ts) rather
  than `openrouter-stream.ts` — see the plan for why a parser should keep only framing facts.
- **Three callers are on it**: `quiz-mark`, `explain`, `search`. Each kept its own policy, and in
  each the migration went in with **no existing test rewritten**.
- **The unfireable guard fired once on its way out.** `finish_reason: "error"` reached that
  conjunction in both `explain` and `search`, where each already threw `providerFailedMidAnswer()`
  for the same event arriving as `chunk.error` data — so a provider that said it had errored had its
  half-answer stored as a whole one. Both now throw. That is the bug this postmortem predicted
  rather than found.
- **Four copies remain**: `converse` (which needs its per-round fold designed) and the three referee
  files, which are somebody else's open work.
- **`explain`'s truncation policy is unchanged and that is deliberate.** A truncated explanation is
  still stored as a whole comment, now as a written `case "truncated"` with a comment and a test
  saying it is a decision — which is exactly the distinction this postmortem argued the union would
  buy. Changing what the reader is *shown* is Greg's call, not an agent's.

## Files

- [`src/ai-call.ts`](../../src/ai-call.ts) — `StreamOutcome` and `classifyEnd`, and the
  `openRouterStream` loop that populates `StreamEnd.finishReason` for every caller.
- [`src/openrouter-stream.ts`](../../src/openrouter-stream.ts) — `StreamEnd`, `sseChunks`,
  `readerAborted`, `stoppedByReader`, `explainAbort`.
- The five callers **as found**, with line numbers that were true when this was written and are not
  now: [`src/converse.ts`](../../src/converse.ts) (`:1683`, `:1931`),
  [`src/explain.ts`](../../src/explain.ts) (`:677`, `:731`),
  [`src/search.ts`](../../src/search.ts) (`:748`),
  [`src/referee-mirror.ts`](../../src/referee-mirror.ts) (`:1608`),
  [`src/quiz-mark.ts`](../../src/quiz-mark.ts) (`didNotFinish`, the fixed one).

## See also

- [260826e-converse-stall-misfiled-as-incomplete.md](260826e-converse-stall-misfiled-as-incomplete.md)
  — the previous divergence in the same post-loop sequence, which recommended this fix
- [260826m-simplification-audit.md § 3.4](../plans/260826m-simplification-audit.md) — the scheduled
  item, and why only a quarter of it is urgent
- [260831al-review-quiz-sub-mode.md § Stage 5](../plans/260831al-review-quiz-sub-mode.md) — the six
  findings and what was done about each
- [silent-success.md](../reusable/silent-success.md) — the pattern, and the demonstration that
  knowing it is not a control
- [quiz.md § The rule is counted, not enforced](../project/quiz.md) — where the two refusals are
  written down for readers of the feature
