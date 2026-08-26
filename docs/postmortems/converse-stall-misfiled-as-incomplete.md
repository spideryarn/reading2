# A stalled chat answer is filed as an incomplete one

**2026-08-26.** `src/converse.ts` and `src/explain.ts` stream an OpenRouter reply through the same
plumbing — [`src/openrouter-stream.ts`](../../src/openrouter-stream.ts) — and both run two clocks
alongside the fetch: an overall deadline, and a stall timer that restarts on every byte. When either
clock fires, `sseChunks` cancels the reader, and a cancelled `read()` resolves `{ done: true }`
rather than throwing — so the consuming loop in both files can exit *cleanly* on a clock firing, with
no error to catch. `explain.ts` has two guards after its loop to catch that case; `converse.ts` has
only one. The second one, guarding the clocks rather than the caller's own signal, was never added to
`converse.ts`. A stalled chat stream is filed under the same message and the same log shape as a
connection that simply stopped mid-answer — the log line a reader would need, to tell "the network
dropped it" from "the provider went silent for 45 seconds", is lost.

## The mechanism

Both files build the same three signals:

```ts
const deadline = AbortSignal.timeout(timeoutMs);
const stall = new AbortController();        // restarted by touch() on every read
const composite = AbortSignal.any(signal ? [signal, deadline, stall.signal] : [deadline, stall.signal]);
```

and hand `composite` to `sseChunks`, whose abort listener does `reader.cancel()`
([`src/openrouter-stream.ts:144`](../../src/openrouter-stream.ts#L144)). `sseChunks`'s own comment
is explicit about which mechanism actually ends the loop: Undici usually rejects the pending
`read()` when its own signal aborts, and the cancel listener is the *backstop* — "for a caller who
stops iterating without an abort, and for any fetch implementation that does not propagate." When
the cancel wins that race, the `for await` loop in the caller breaks with no error at all.

`explain.ts` has two checks after the loop for exactly this:

```ts
// guard 1 — the caller's own signal ended the loop cleanly
if (!stopped && readerAborted(signal, deadline, stall.signal)) stopped = true;

// guard 2 — one of OUR clocks ended the loop cleanly
if (!stopped && (deadline.aborted || stall.signal.aborted)) {
  line.error({ model: used, ms: since(started), timedOut: deadline.aborted,
               stalled: stall.signal.aborted, chars: text.length },
    `stream from ${used} was cut off`);
  throw explainAbort(new Error("aborted"), deadline, stall.signal, timeoutMs, stallMs);
}
```

`converse.ts` has only guard 1 ([`src/converse.ts:561`](../../src/converse.ts#L561)). Its
`timedOut`/`stalled` fields exist only inside the `catch` around the loop
([`src/converse.ts:526-539`](../../src/converse.ts#L526-L539)) — the path taken when the abort
*throws*. When a clock fires and the cancel wins the race instead, `converse` falls through both
guard 1 (false: `readerAborted` requires the *caller's* signal, not deadline or stall — see below)
and the empty-answer branch, straight into:

```ts
if (!stopped && !end.terminated && finishReason === null) {
  line.error({ model: used, ms: since(started), chars: text.length },
    `stream from ${used} ended without finishing`);
  throw new Error("The answer stopped arriving before it was finished. Try again.");
}
```

— the generic "connection died mid-answer" message, carrying no `timedOut`/`stalled` fields at all.
`readerAborted` is why guard 1 cannot cover this case; it is deliberately narrow:

```ts
export function readerAborted(signal, deadline, stalled): boolean {
  return Boolean(signal?.aborted) && !deadline.aborted && !stalled.aborted;
}
```

It returns `true` only when the *caller's* signal fired and neither clock did — the reader pressing
stop. When the stall or deadline is what fired, this is `false` by design (`tests/converse-stop.test.ts`
pins that: "says no when the deadline or the stall fired, even if the reader also did"). So guard 1
is not a near-miss for the clock case; it was never meant to cover it. What's missing is a second,
separate guard — the one `explain.ts` has.

Both failing sentences end in "Try again", so a reader never notices. What's lost is the log line —
`stalled: true` versus `ended without finishing` — which is the one thing an operator would read to
decide whether to blame the network or the provider.

## The introducing commit, and why it happened

`explain.ts` did not always stream. It became a generator, with its own deadline and stall clocks,
in a single commit: **62a5d85, "Find the flaky test, and stop one bad anchor blocking the import"**
(2026-08-26 10:38) — whose commit message is entirely about an unrelated Postgres-import bug; the
streaming work for `explain.ts` rode along in the same commit and isn't mentioned in the message.
That commit is also where `readerAborted`, `stoppedByReader`, `sseChunks` and `explainAbort` were
lifted out of `converse.ts` into the new shared `src/openrouter-stream.ts` module.

The plan behind that work is
[`docs/plans/explain-deeper-answers.md § 2 Streaming the answer`](../plans/explain-deeper-answers.md#2-streaming-the-answer-done).
It explicitly names `converse.ts` as the thing being copied from — "the dual clock", "the post-loop
invariants" — and then, in its own "found by writing the tests rather than by the review" section,
records the exact bug this postmortem is about, **as a known gap it declined to close**:

> **A stall ends the stream cleanly, not with a throw.** `sseChunks` cancels the reader on abort, and
> a cancelled read resolves `{ done: true }` — so a 45-second silence exited the loop with no error
> and was filed as "the answer stopped arriving before it was finished". Both sentences end in "try
> again", so no reader would notice; what is lost is the log line, which is the only thing that says
> whether to blame the network or the provider. `src/converse.ts` has the same shape, guarded only
> for the *reader's* signal.

So this was not missed. It was found, fixed in `explain.ts` (the file the plan was actually about),
written down as also true of `converse.ts`, and never back-ported — the plan's scope was "make
explain stream," not "fix converse," and nothing tracked the gap as a follow-up until
[`docs/plans/simplification-audit.md § 0.1`](../plans/simplification-audit.md) picked it up as a
Tier-0 bug on 2026-08-26, which is the item this postmortem was requested against.

One correction to how that later document (and the request that led to this one) characterises the
drift: `explain.ts`'s comment on **guard 1** — "See the same guard, and the longer account of how it
was found, in `src/converse.ts`" — is accurate. `converse.ts` does have guard 1
(`src/converse.ts:561`). It is **guard 2** that `converse.ts` lacks, and `explain.ts`'s comment on
guard 2 does not claim `converse.ts` has it — it cites `tests/explain.test.ts` instead. The drift is
real (the code paths really did diverge), but it is an asymmetric fix that was never carried across,
not a comment that overclaims about the sibling file.

`converse.ts`'s own guard-1 comment (`src/converse.ts:548-560`) still says "Every version of this
before now assumed an abort *throws*" as if that were now fully handled — true for the caller's
signal, silently untrue for the two clocks.

## Why nothing caught it

`explain.ts`'s guard 2 has a test built for exactly this shape —
[`tests/explain.test.ts` § "says a silence is a silence, not a slow answer"](../../tests/explain.test.ts) —
which mocks a `ReadableStream` that opens and then never sends anything, so only the stall clock ends
it. Its own comment calls out why the test matters: "the one failure a mock made of whole frames
cannot produce."

`tests/converse-stop.test.ts` has no equivalent. Its own docstring says exactly what it is scoped
to: "the reader pressing stop must end in a `done` event with `stopped: true`, never in a throw" —
three tests, all driven by the *caller's* `AbortController`. Nothing in the file drives the deadline
or the stall clock to completion and inspects what `converse` throws. `stoppedByReader`'s own test
("says no when the deadline or the stall fired") proves the code correctly tells the clock case
*apart* from a stop — but nothing asserts what happens *in* the clock case. That is the real gap:
the test that would have caught this exists for one of the two files that need it.

## The fix

**Both, in sequence — not one instead of the other.**

1. **Now: copy guard 2 into `converse.ts`.** It is a five-line, mechanical port of what already
   exists and is already tested in `explain.ts`, using `explainAbort` (already imported by
   `converse.ts`) to produce the stall-specific and deadline-specific sentences instead of the
   generic "ended without finishing" one. This is the fast, low-risk fix and it is what stops the
   log line being wrong today.
2. **Later: `docs/plans/simplification-audit.md § 3.4`**, extracting a shared OpenRouter streaming
   transport that owns the timeout/stall clocks, SSE consumption, and post-loop completion
   classification — the whole "clean-cancellation vs. real completion vs. reader stop" invariant —
   so `converse` and `explain` cannot diverge on it again. §3.4's own text names this bug as the
   reason the first draft of that plan was wrong to leave the two files separate: "the same
   clean-cancellation race is classified correctly in one path and wrongly in the other."

Doing only (2) is too slow — it's explicitly scheduled last ("3.4 when there is room") in the plan's
own ordering, and the wrong log line ships in the meantime. Doing only (1) leaves the underlying
cause — two independent copies of an invariant that has to stay in step — free to drift again the
next time either file is touched, which is exactly how it drifted this time. §0.1 in
`simplification-audit.md` already says as much: "Then §3.4 stops it recurring."

## The test

Mirrors `tests/explain.test.ts` § "says a silence is a silence, not a slow answer", through
`converse` instead of `explain`. It belongs in `tests/converse-stop.test.ts`, next to the existing
`describe("a stop ends in \`done\`, never in a throw", ...)` block — that file already has the
`OPENROUTER_API_KEY` setup, the `vi.stubGlobal("fetch", ...)` / `vi.unstubAllGlobals()` pattern, and
`meta`/`blocks` fixtures this needs. (Its top-of-file docstring currently scopes the file to "the
reader pressing stop"; whoever adds this should widen that sentence — or split the clock-driven
cases into a new `tests/converse.test.ts` mirroring `tests/explain.test.ts`'s shape, if a general
"failures are loud" home is preferred. Either is fine; the important thing is that the assertion
below runs against `converse`, not `explain`.)

Run against the code as it stands today, this **fails**: it currently throws
`"The answer stopped arriving before it was finished. Try again."`, which does not match
`/stopped arriving after/`. Once guard 2 is ported into `converse.ts`, it throws
`"The answer stopped arriving after 0s of silence. Try again."` (via `explainAbort`) and the test
passes.

```ts
describe("failures are loud", () => {
  it("says a silence is a silence, not a slow answer", async () => {
    /* Mirrors tests/explain.test.ts § "says a silence is a silence" — the one
       failure a mock made of whole SSE frames cannot produce: a body that opens
       and then sends nothing at all, so only the stall clock ends the stream.
       sseChunks cancels the reader when the stall fires, and a cancelled read
       resolves `{ done: true }` rather than throwing — so the loop exits
       cleanly, with neither `[DONE]` nor a `finish_reason`, and it is the
       post-loop guards' job to tell that apart from a connection that merely
       stopped.

       explain.ts has a guard for exactly this (checked before the generic
       "ended without finishing" case); converse.ts does not — so today this
       throws the WRONG message, the generic "before it was finished" rather
       than the stall-specific "after Xs of silence", and the log line it
       produces says `ended without finishing` instead of `stalled: true`. See
       docs/postmortems/converse-stall-misfiled-as-incomplete.md. */
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream<Uint8Array>({ pull() {} }), // opens, then says nothing
      } as unknown as Response),
    );
    async function run() {
      for await (const _event of converse({
        meta,
        blocks,
        history: [],
        question: "why?",
        stallMs: 20,
      })) {
        // Draining is the point; the throw happens once the loop ends.
      }
    }
    await expect(run()).rejects.toThrow(/stopped arriving after/);
  });
});
```

## What would have caught this whole class earlier

- **A rule, not just a test:** when a comment says "see the same guard in `<other file>`", that
  cross-reference should be checked, not assumed, whenever either file changes — a grep for the
  referenced symbol in the named file, at review time. `explain.ts`'s guard-1 comment happens to
  still be true; nothing would have caught it if it stopped being true, and nothing caught guard 2
  never being added in the first place.
- **A plan that names a gap should also open a follow-up for it**, not just record it in prose. The
  explain-deeper-answers plan wrote the exact sentence describing this bug and then closed as "done"
  without an item tracking `converse.ts`. `simplification-audit.md § 0.1` is that follow-up,
  eleven-plus commits later.
- **The shared-transport instinct was right the first time.** `docs/plans/simplification-audit.md`
  records that its own first draft declined §3.4 "because a comment said to" keep `converse` and
  `explain` apart, and reversed that once 0.1 showed the comment was documenting drift rather than
  preventing it. Two independent copies of an abort-classification state machine — three signals,
  two ways to end a loop, three ways to interpret why — are exactly the kind of invariant that drifts
  silently when it lives in two files instead of one.

## Whether anything should be rearchitected

Yes, and it is already scheduled: `docs/plans/simplification-audit.md § 3.4`. The right boundary is
what that plan already draws — a transport module owning the clocks, SSE consumption, and completion
classification, with prompt construction, stop-button semantics, empty-answer policy and citation
handling staying in `converse.ts` and `explain.ts`. `src/openrouter-stream.ts` already exists and
already owns the pieces of this that *are* shared (`sseChunks`, `readerAborted`, `stoppedByReader`,
`explainAbort`) — it is the natural home for the rest, per the "put the shared piece where the
invariant already lives" rule the same plan states.

## See also

- [`docs/plans/simplification-audit.md § 0.1`](../plans/simplification-audit.md) — the item that
  requested this postmortem, and § 3.4 — the shared-transport extraction this bug is the evidence
  for
- [`docs/plans/explain-deeper-answers.md § 2`](../plans/explain-deeper-answers.md#2-streaming-the-answer-done) —
  where `explain.ts` gained streaming, guard 2, and the sentence that named this bug in `converse.ts`
  without fixing it
- [`docs/reusable/silent-success.md`](../reusable/silent-success.md) — the pattern this is a case
  of: the code reports a plausible-sounding failure that shares an assumption with the check, so
  nothing downstream notices it is the wrong failure
- [`src/openrouter-stream.ts`](../../src/openrouter-stream.ts) — `readerAborted`, `sseChunks`,
  `explainAbort`, and the comments recording the three earlier bugs this module already guards
  against
