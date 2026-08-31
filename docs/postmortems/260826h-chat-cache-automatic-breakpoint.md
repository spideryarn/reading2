# Chat re-paid for the article on every turn after the first

**Found 2026-08-26**, by GPT Sol reviewing [reader-profile.md](../plans/260826t-reader-profile.md) — a plan
for a feature that would have made it permanent. Not found by a test, not found by the eval written
to catch exactly this, and not found by the doc that claims the eval covers it.

## What was wrong

`converse` used OpenRouter's **automatic** prompt caching: `cache_control: { type: "ephemeral" }` at
the top level of the request body, rather than on a message part. That form marks *the last
cacheable block* and advances it as the conversation grows. Chat's shape looks made for it — a
fixed article near the front, a tail that gets longer every turn — and the code said so:

> The automatic form, not an explicit breakpoint — and it fits this call better than the other two.
> … The explicit form would need the messages rebuilt as content arrays for no gain here.

The block it marks is the **final user message**. And the final user message is not what gets
stored:

```
turn 1 sends   … article … │ "The reader is at spya-k3m9qt.\n\nWhat is entropy?"   ← marked, written
turn 1 stores                "What is entropy?"                                    ← bare
turn 2 sends   … article … │ "What is entropy?" │ answer │ "The reader is at …\n\nAnd free energy?"
                             └─ diverges from what was cached ─┘
```

`buildConverseMessages` prepends `readerPositionLine` to the *current* question only
([`src/converse.ts`](../../src/converse.ts)); history is replayed from the stored bare `m.text`; and
the route stores the bare trimmed question ([`src/routes.ts`](../../src/routes.ts)). So the cached
block was never reproduced. Writes happen only at the breakpoint, so there was no article-only entry
sitting underneath to fall back on either.

**Every turn after the first paid a full cold write of the whole article** — 1.25× the uncached
price — whenever the reader had scrolled. Which is always: `at` is set by ordinary reading.

The answers were correct. Nothing errored. The only symptom was the bill.

## The root cause is the fix for the previous bug

`3a99eb0` ("Add chat, in the band between the spine and the prose") wrote the reader's position
**inside the article body**:

```ts
.map((b, i) => `[${i}]${b.id === at ? " ←READER IS HERE" : ""} ${b.id}: ${b.text}`)
```

That was the well-documented bug that [prompt-caching.md](../project/prompt-caching.md#the-marker-that-used-to-ruin-it)
is built around, and `abb5de1` ("Let a reader copy, retry, edit and stop a chat turn") fixed it: the
position moved out of the body and into the varying suffix, which is correct and is still correct.

The same commit added the automatic breakpoint. So the position moved out of the article and landed
in **the one message the automatic breakpoint marks**. The fix for the first bug is what created the
second, and the second is invisible in exactly the places the first was loud.

Two beliefs had to both be true for the design to work, and only one of them was checked:

1. the article must not vary — **checked, pinned by a test, correct**;
2. the marked block must be reproduced identically on the next request — **never stated, never
   checked, and false**.

Belief 2 is a property of automatic mode specifically. An explicit breakpoint does not have it,
because you choose where the prefix ends; automatic mode chooses for you, and it chooses the one
place you have no control over.

## Why nothing caught it

Three defences existed and all three were blind, each for its own reason.

**`cachedText` could not see it.** It walks the messages and stops at the first `cache_control`.
Converse had none — the marker was in the request body, not on a part — so the function fell through
to its "return everything" branch. That branch was written deliberately and correctly, as erring
*towards* "long enough" for the `underCacheFloor` check it feeds:

> where the boundary is not explicit … this returns *all* the message text, which errs towards
> "long enough" rather than towards crying wolf.

A safe default for one question became a measurement for another. `tests/article-prompt.test.ts` then
asserted `cachedText(converse) contains the article` and `length > 0` — which is true of a function
that has no idea where the prefix ends.

**The eval never called it.** [`evals/prompt-caching.ts`](../../evals/prompt-caching.ts) makes real
calls and reads the provider's own numbers back, which is the only thing that could have caught
this. It prints *"this checks the request-path cache (search / chat / explain)"*. It calls
`findPassages` and nothing else. Search only.

**The doc repeated the eval's claim rather than the eval.** `prompt-caching.md` lists chat's cache
as one of three request-path entries and reports *"all three articles pass"* — true of what was run,
and read by everybody as covering the three features.

## What it cost

Not measured before the fix, and it is not worth spending money to measure now that it is fixed. The
arithmetic is in the doc: on the constitution article, a cold write is 47,739 tokens at $0.119
against $0.0097 for a read. A ten-turn conversation paid roughly **$1.08 instead of $0.21**.

## The fix

The article now carries its own `cache_control`, as explain's has always done, and the top-level
marker is gone. The prefix stops before anything that varies. The growing tail is uncached, which is
what it should have been all along — it changes every turn by construction, so there was never
anything there worth caching, and "the breakpoint advances with the conversation" was a feature
description rather than a benefit.

Red first, per `CLAUDE.md`: `tests/article-prompt.test.ts` § *"marks the article explicitly, so the
prefix survives turn two"* builds turn one and turn two and asserts their cached prefixes are
byte-identical. It fails on the old code and passes on the new. Its sibling, *"stops at the
breakpoint for converse too"*, is the test that could not have been written before, because before
there was no breakpoint to stop at.

## What would have caught this class of thing

- **A default that means "I don't know" must not be read as an answer.** `cachedText`'s fallback was
  right for the floor check and wrong as a measurement, and nothing in its shape said which it was.
  Returning `null` for "no breakpoint found" and letting each caller decide would have made the
  converse test impossible to write in its useless form.
- **A coverage claim belongs next to the thing that runs, not next to the thing that describes it.**
  The eval's own header names three features; its code names one. That gap is readable in ten
  seconds and nobody read it, because the doc had already answered the question.
- **When a provider chooses something for you, write down what you are assuming about the choice.**
  The comment argued for automatic mode on shape and never named the invariant it needs. Had
  "requires that the last user message be reproduced byte-identically next turn" been written
  down, the position line prepended three lines above would have contradicted it on sight.
- **The eval should cover every feature it says it covers.** Extended to a two-turn chat call as
  part of this fix — see [reader-profile.md § Steps](../plans/260826t-reader-profile.md#steps).

## See also

- [prompt-caching.md](../project/prompt-caching.md) — the operating manual, now corrected
- [silent-success.md](../reusable/silent-success.md) — the shape of this, exactly: a thing reports
  success while doing nothing, and the check you would naturally run shares an assumption with the
  code
- [reader-profile.md](../plans/260826t-reader-profile.md) — the plan whose review found it
