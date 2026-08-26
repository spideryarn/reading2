# Reorder quality — the incumbent, before the article moved to the front

Captured 2026-08-26, **before** any artefact was regenerated with the reordered prompts.
These are the 'before' numbers, and they stop being obtainable the moment the artefacts are
rebuilt — which is the whole reason they are committed rather than left to be re-derived.

The change under test: the arc, thread and glossary prompts now put the article *first*, ahead
of each stage's own instructions, so that the three can share one cached prefix
([prompt-caching.md](../../docs/project/prompt-caching.md)). Models weight recency, so that is
not a free edit.

After regenerating, run `npm run eval:reorder -- data/<slug>` and compare.
**`vocab` is the one that matters** — a fall of more than a couple of points means the reorder
cost something, and the honest response is to put that stage's prompt back and leave it uncached.

```
=== noema-mythology-of-conscious-ai ===
No --against given: printing the current numbers only.
Keep a copy of the artefacts BEFORE regenerating, or this says nothing.
arc       n=8  words=28.8  template=0.00  vocab=0.72
thread    n=15  words=39.3  template=0.00  vocab=0.82
glossary: no artefact on disk — skipped.
=== constitution ===
No --against given: printing the current numbers only.
Keep a copy of the artefacts BEFORE regenerating, or this says nothing.
arc       n=7  words=31.3  template=0.00  vocab=0.83
thread: no artefact on disk — skipped.
glossary: no artefact on disk — skipped.
How to read it. **vocabRetention is the one that matters** — it is the proxy for
the model still working from the author's own words rather than drifting into
its own. A fall of more than a couple of points is the reorder costing something,
and the honest response is to put that stage's prompt back and leave it uncached.
templateRepetition rising means the writing has got more formulaic. Neither is a
substitute for reading both versions.
```
