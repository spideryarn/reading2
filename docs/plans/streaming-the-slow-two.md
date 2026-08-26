# Streaming the two features that still make you wait

**2026-08-26.** Chat and explain stream: words appear as the model writes them.
Two features did not — **semantic search** and **glossary term lookup** — and
both can sit for the better part of a minute. Greg asked for streaming on both,
plus a loading spinner.

This file was first written to explain why neither was done. **Half of it was
wrong, and search now streams.** The wrong half is kept rather than deleted,
because the mistake is more useful than the conclusion was.

## First, a correction that came before the correction

The report that prompted this said both features "make you wait with nothing on
screen". **That was wrong, and it was wrong because nobody looked at the
screen** — it came from reading the server code and inferring the UI.

Both already had spinners. Search's waiting state was in fact the best in the
app:

> ⟳ Reading the article for you…
>
> The whole piece goes to the model, so this takes a few seconds. You can carry
> on reading — the answer is saved either way.

A spinner, why it is slow, and permission to leave. Glossary lookup had the
spinner and neither sentence, which is the only way the two actually differed.
It says both now, in its own words (`gloss-look-wait` in
[`GlossaryPanel.tsx`](../../src/web/GlossaryPanel.tsx)) — and its estimate has
since been corrected from "a few seconds" to "up to a minute", because a comment
four lines above it already said "the better part of a minute" and the honest
number is the pessimistic one.

## Search: the refusal, and why it was wrong

The original argument, in full, because it is the thing worth learning from:

> Chat, explain and lookup produce **prose**, which is renderable a word at a
> time. Semantic search asks for a **JSON array of passages** and renders a
> list. Half a JSON array is not half a result list — it is a syntax error — so
> there is nothing useful to paint until it parses. Making search *genuinely*
> incremental means changing what the model is asked to emit — JSON Lines, one
> passage per line — which changes the prompt, and therefore the answers, and
> therefore the ranking. That is a **product decision about result quality**,
> not a plumbing change.

Every sentence up to the last two is true. **The conclusion does not follow.**

Hits come back **best first**, and a *complete hit object* is renderable the
moment its closing brace arrives. Scanning the arriving text for finished
elements of the existing `{"hits":[…]}` reply changes neither the prompt, nor
the answers, nor the ranking. JSON Lines was never required. The plan weighed
two options — leave it, or change the format — and never saw the third, which
costs nothing an eval would need to measure.

Both reviewers found this independently and said so bluntly. It is built:
[search.md § The results arrive one at a time](../project/search.md#the-results-arrive-one-at-a-time)
is the write-up, [`src/search-hits-stream.ts`](../../src/search-hits-stream.ts)
is the extractor.

**What actually went wrong here is worth naming**, because the reasoning looked
careful. A real obstacle (the format is not incrementally renderable *as
written*) was used to justify a conclusion it did not reach (therefore nothing
can be shown early). The tell was that the argument ended at "that is a product
decision" — the place where a plan stops looking. And
[AGENTS.md](../../AGENTS.md) has a standing agreement — *"Stream any model call a
person is waiting on"* — which this document never cited, in the course of
deciding not to.

## Glossary lookup: still not done, and this part holds up

The model call is already a stream. [`explain.ts`](../../src/explain.ts) exports
`explainStream`, and [`routes.ts`](../../src/routes.ts) already drives it for
comments: open SSE, `frame("begin", …)`, forward each `delta`, persist on `done`,
and keep the partial answer if it throws. Glossary lookup is the same shape with
a different anchor.

The obstacle is not the streaming. It is **where the answer is stored.**

`lookUpTerm` in [`api.ts`](../../src/api.ts) does two jobs in one function:
validate-and-load, then call the model *and persist the result*. It is reached
through `GlossaryStore` — a contract with a filesystem implementation and, in
`postgres` mode, `notMigrated()` — so a route that streamed by calling
`explainStream` directly and writing the entry itself would **bypass the seam**.
`store/index.ts`'s own header names the cost of that exactly:

> A write that lands in the store nobody is reading is the worst available
> outcome: it reports success and loses the data.

So the honest version needs the contract split — roughly `prepareLookup` (all the
validation, which must still happen *before* any SSE headers go out, exactly as
the comment route creates its comment first) and a `saveLookup(slug, entry)` the
route can call on `done`.

**Why not today:** `src/store/` is mid-landing. `pg-lookups.ts`, `pg-chat.ts` and
`pg-searches.ts` appeared while this was being written, and `store/index.ts`
still wires glossary to `notMigrated` — so the seam this change needs is being
rebuilt by somebody else, right now, as item 10 of
[postgres-storage-implementation.md](postgres-storage-implementation.md).
Changing a contract while its implementations are being written is how two
correct pieces of work destroy each other.

**It is more than the "perhaps twenty lines" this file first claimed.** Review
caught that too, and it is a fair hit: `GlossaryLookup`
([types.ts](../../src/types.ts)) is a value that either exists or does not — no
`status`, no `error`. A streamed answer needs somewhere to keep a half-written
one, and a failed lookup currently persists nothing at all, which is why the
panel's failure state is local component state. So the work is the contract
split *and* a shape change to the stored type. Still small; not twenty lines.

**Whoever finishes the glossary store should do it then**, and this file is the
handover.

## What to do next

1. When the glossary store seam lands: give `GlossaryLookup` a status, split
   `lookUpTerm`, stream the lookup, render partial text in the panel. Follow the
   comment route in `routes.ts`.
2. If a third feature ever needs this shape, that is the moment to extract the
   route-side SSE-plus-persist pattern rather than write it a third time — see
   [simplification-audit.md § 3.4](simplification-audit.md), which is the same
   argument one layer down.

## See also

- [search.md](../project/search.md) — what streaming search actually does, and
  the one safety property the extractor depends on
- [comments.md](../project/comments.md) — the feature whose streaming this copies
- [copy.md](../project/copy.md) — the rules the waiting sentences follow
- [glossary.md](../project/glossary.md) — why the lookup is `explain` with a
  different selection rather than a second mechanism
