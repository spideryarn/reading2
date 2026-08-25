# Glossary — the terms a piece uses, and two bugs worth knowing about

[vision.md](../vision.md#where-this-goes-after-granularity-zoom) lists an **author's glossary** —
"the terms this piece uses in a non-obvious way, defined from the piece itself" — as a feature we
expect to build. They built one. Two of its problems are the interesting part.

Reference doc: `docs/reference/TOOL_GLOSSARY.md`. Planning:
`docs/planning/250629a_glossary_entity_normalisation.md`,
`docs/planning/finished/250620c_glossary_generate_more_timeout_mitigation.md`.

## What it does

An LLM extracts entities from the article — people, places, concepts — each with a short definition
and a longer Markdown explanation, plus scores for **difficulty** and **centrality**. They appear in
a side pane, sortable by importance, and **inline in the prose** as a dotted underline with a small
book icon, with the definition on hover.

## Bug one: output tokens, not input tokens, caused the timeouts

Extraction was hitting 504s in production. The cause was not the size of the article going in — it
was the number of **output** tokens coming back, because every entity carries two definitions.

The fix was to cap it at **20 entities per call**, with a "Load More" that feeds the
already-extracted entities back into the prompt as `existing_entities` so the model doesn't repeat
itself. Entities are stored individually rather than as one JSON blob, so a later batch can be added
without rewriting the first.

**This is directly our problem.** Our tree generation is many nodes' worth of generated text per
article ([Q7](../open-questions.md#q7) is exactly "what does a tree cost"). The lesson generalises:
*the thing that times out is the length of the answer, so cap the answer and paginate the work.*
Our bottom-up per-node generation already has this shape by accident — one call per node is naturally
bounded. Keep it that way; don't be tempted into "generate the whole tree in one call" without
knowing what the output-token ceiling does to it.

## Bug two: dedup deleted the more specific term

The model would emit both `nonreductive` and `nonreductive explanation` as separate entities. The
dedup logic kept whichever appeared **first in the document** and discarded the other — which in
practice deleted the *more specific* phrase and left the highlighter matching the shorter, wronger
one.

The **plan** (`docs/planning/250629a_glossary_entity_normalisation.md`) was a server-side normaliser
using **richness scoring**: the longer, more specific phrase becomes the canonical name and the
shorter becomes an alias, behind a rollback environment variable.

**That normaliser was never built.** There is no `normaliseGlossaryEntities` in the tree. What
shipped instead is a narrower fix to `deduplicateEntities()` in
`lib/utils/entity-position-tracking.ts`, whose own comment explains the change:

> Previous implementation removed duplicates when any alias overlapped, which was too aggressive –
> legitimate new entities that merely share a synonym were being discarded. The new algorithm
> deduplicates when: 1) entity names are the same (case-insensitive) 2) an entity name matches an
> existing alias, or vice-versa. It purposely does not treat alias-alias clashes as duplicates.

So the shipped behaviour is still **first-wins**, keyed on name/alias identity — the more ambitious
"prefer the richer phrase" rule remains a design document. Another entry for the pattern in
[process-and-docs.md § 129 reference documents](process-and-docs.md#129-reference-documents-and-what-that-costs).

Three things to take from that:

- **Validate server-side even when you have also told the model not to do it.** The prompt does tell
  it — see the FORBIDDEN checklist below — and the model does it anyway. A prompt instruction is a
  request; a normaliser is a guarantee. This is the same instinct as our
  [`validate-tree.ts`](../../../src/validate-tree.ts), which checks the partition invariant rather
  than trusting the generation prompt to have honoured it
  ([granularity-zoom.md § Validate the tree, always](../granularity-zoom.md#validate-the-tree-always)).
- **"Keep the first one" is not a tie-break, it's a coin toss.** It looked reasonable and it
  systematically destroyed the better data. Every dedup rule should be justified by what it keeps,
  not by what's convenient to write. If we ever need one: prefer the more specific phrase, and say
  why in a comment.
- **Over-eager dedup is its own bug.** Their first attempt merged entities that merely shared a
  synonym, silently losing legitimate ones. Both directions fail quietly.

## The prompt, which is the best-written one over there

`lib/prompts/templates/glossary.njk` is worth reading in full before we write anything similar. Four
lines are directly reusable:

**On aliases** — a concrete, testable target for a thing prompts usually hand-wave:

> Try to make the aliases distinctive, so that a regex using the aliases finds all and only
> references to the entity (if possible).

**On canonical names**:

> the canonical and unambiguous way to refer to it (usually the longest or official form, e.g.
> "United States of America" rather than "America")

**On outside knowledge** — the one to steal outright:

> If you need to draw on knowledge from outside the text, be very explicit about it, e.g.
> "_Although the text doesn't mention it, ..._" or "_As you may know, ..._"

That is hallucination made **visible instead of silent**, and it belongs in
[`src/explain.ts`](../../../src/explain.ts) too: our comments feature already reports whether the
model searched the web ([comments.md § The web-search badge](../comments.md#search-badge)), and this
is the same honesty applied to the model's own memory rather than to its tools.

**On generating more without repeating itself**:

> FORBIDDEN: Do not generate entities that: Have the same name or similar name (case-insensitive) /
> Are synonyms, alternative terms, or translations of existing entities / Are closely related
> concepts that overlap in meaning / Are subcategories or aspects of existing entities / Share any
> aliases with existing entities.

## The entity record

`lib/prompts/templates/glossary.ts`, validated with Zod:

```ts
{
  name: string,
  ontology: 'person'|'place'|'date'|'theme'|'event'|'reference'
          |'object'|'organization'|'concept'|'definition'|'other',
  aliases: string[],
  brief_explanation: string,     // Markdown
  long_explanation?: string,     // Markdown
  datetime?: string,
  url?: string,                  // validated as a real URL
  difficulty?: number,           // 0-1
  centrality?: number            // 0-1
}
```

Two fields worth copying if we build this: **`aliases`**, because that is what makes the term
findable in the prose at all, and **`url`** validated as a URL rather than trusted as a string.

## What we'd do differently

**Make it on-demand, not auto-injected.** The inline dotted-underline-plus-icon treatment is the
part most likely to feel like clutter, and it is a small violation of
[principle 5](../vision.md#principles) — the prose acquires marks the author didn't write, on the
model's initiative rather than the reader's.

We already have the better mechanism: [comments.md](../comments.md). The reader selects a term and
asks; the answer arrives in a dialog and persists. A glossary is then not a second system — it is the
same mechanism with a different prompt, plus a list view of what you've already asked about. One
anchor model, one storage artefact, one set of failure modes.

The one thing worth generating up front is the **list** — which terms this piece uses in a
non-obvious way — because that is a judgment about the article as a whole that the reader can't make
before reading it. Show the list; don't mark up the prose.

**Drop the difficulty and centrality scores**, or at least don't sort by them silently. "Here are the
important terms, ranked by how important we think they are" is the model doing the reader's
prioritising for them, which is the thing [vision.md](../vision.md) is against.

## See also

- [overview.md](overview.md) — the map to that codebase
- [../comments.md](../comments.md) — the mechanism a glossary should reuse rather than duplicate
- [highlighting.md](highlighting.md) — the other feature that marked up the same prose, and why they collided
- [difficulty-and-reading-time.md](difficulty-and-reading-time.md) — the other place they scored things for the reader
- [llm-plumbing.md](llm-plumbing.md) — the output-token ceiling, in general
