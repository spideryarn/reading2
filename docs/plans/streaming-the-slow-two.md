# Streaming the two features that still make you wait

**2026-08-26.** Chat and explain stream: words appear as the model writes them.
Two features do not — **semantic search** and **glossary term lookup** — and both
can sit for the better part of a minute. Greg asked for streaming on both, plus a
loading spinner.

This is what was done, what was not, and why.

## First, a correction

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

**Done now:** the glossary lookup says the same two things, in its own words
(`gloss-look-wait` in [`GlossaryPanel.tsx`](../../src/web/GlossaryPanel.tsx)).
That is the whole of the "loading spinner" half of the request, because the
spinners were already there.

## Streaming: possible, and deliberately not done today

### Glossary lookup — a small change, blocked on a moving seam

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

It is perhaps twenty lines once that settles. **Whoever finishes the glossary
store should do it then**, and this file is the handover.

### Semantic search — streaming is a feature change, not plumbing

Different problem, and worth being clear that it is different.

Chat, explain and lookup stream **prose**, which is renderable a word at a time.
Semantic search asks for a **JSON array of passages** and renders a list. Half a
JSON array is not half a result list — it is a syntax error — so there is nothing
useful to paint until it parses. Streaming the raw text would show the reader the
model typing `{"passages":[{"quote":"…` which is worse than the spinner.

Making search *genuinely* incremental means changing what the model is asked to
emit — JSON Lines, one passage per line, parsed and appended as they land. That
is doable and might be nice. But it changes the prompt, and therefore the
answers, and therefore the ranking: today the model chooses and orders the whole
set at once, which is part of why the results are good. Trading that for earlier
pixels is a **product decision about result quality**, not a plumbing change, and
it should be measured rather than assumed — [`evals/`](../../evals/README.md) is
where that would be settled.

**Recommendation: leave it.** The current waiting state already tells the reader
why it is slow and that they can walk away, which is most of what streaming would
buy here. Revisit only if the wait is measured and people are actually abandoning
it.

## What to do next

1. When the glossary store seam lands: split `lookUpTerm`, stream the lookup,
   render partial text in the panel. Follow the comment route in `routes.ts`.
2. Leave search alone unless an eval says JSON-Lines retrieval is as good.
3. If a third feature ever needs this shape, that is the moment to extract the
   route-side SSE-plus-persist pattern rather than write it a third time — see
   [simplification-audit.md § 3.4](simplification-audit.md), which is the same
   argument one layer down.

## See also

- [comments.md](../project/comments.md) — the feature whose streaming this copies
- [copy.md](../project/copy.md) — the rules the waiting sentences follow
- [glossary.md](../project/glossary.md) — why the lookup is `explain` with a
  different selection rather than a second mechanism
- [search.md](../project/search.md) — the two matchers, and why the literal one
  is the default
