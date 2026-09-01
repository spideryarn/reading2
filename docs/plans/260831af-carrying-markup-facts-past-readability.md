# Carrying markup facts past Readability: one scrub, and an axis that is not `kind`

**Status:** built 2026-08-31.

Greg, 2026-08-31, on the sentence documenting the second stage-2 stamp:

> I wonder if there's a long-term-better/cleaner way to do this?

The question went to GPT Sol ([the question](260831af-carrying-markup-facts-past-readability-design-prompt.md),
[the answer](260831af-carrying-markup-facts-past-readability-design-sol.md)), and then:

> Proceed, including tests, with final review from GPT Sol, then commit these changes.

## What is being built, and what is not

Sol's recommendation had three separable pieces. Two are built here; the third is deliberately left.

- **A — one module owns the reserved namespace.** `data-spya-*` attributes are how stage 2 tells
  stage 3 what the author's markup said before Readability deleted it. Three families of them exist
  ([`src/notes.ts`](../../src/notes.ts), [`src/callouts.ts`](../../src/callouts.ts),
  [`src/blocks.ts`](../../src/blocks.ts)), each with its own copy of the same two obligations: scrub
  every copy the page arrived with, `<template>` fragments included, and never carry a value the page
  supplied. [`src/reserved.ts`](../../src/reserved.ts) now owns the namespace and the scrub, and a
  test fails if a `data-spya-` attribute appears anywhere in `src/` without being registered.
- **B — `kind` stops absorbing presentation.** A callout paragraph goes back to `kind: "text"` and
  carries a **context** instead: an authored grouping, with an id, that a run of blocks belongs to.
  This fixes a defect shipped this morning — a heading inside a callout kept `kind: "heading"` and so
  lost the box entirely — and gives a multi-paragraph callout the single identity it did not have.
- **C — the typed sidecar is not built.** Sol's full proposal replaces the per-feature attribute with
  one opaque token plus a `markup-facts.json` beside `article.html`, bound to its hash, carrying the
  fact's type and provenance. It buys debuggability rather than behaviour, and it costs a new artefact
  kind across both stores, import, export and the manifest. Left for the day a misclassification is
  hard to debug. The attribute name still carries the type today, which is why `reserved.ts` maps an
  attribute to a context type rather than assuming there will only ever be one.

## The one rule that keeps A from rotting

> Only [`src/reserved.ts`](../../src/reserved.ts) may name a `data-spya-*` attribute. A recogniser
> registers one and uses the shared scrub; it does not write its own.

`tests/reserved.test.ts` enforces it by scanning `src/` for the literal prefix, which is the only
form of enforcement that catches the fourth family written by somebody who never read this file.

## What a context is

```ts
interface BlockContext {
  /** Stable across re-runs: a hash of the type and the container's text. Never a public anchor. */
  id: string;
  type: "callout";
}
```

Blocks carry `context?: BlockContext`. Three rules, all of them Sol's:

1. **A context groups blocks; it is not copied into `kind`.** `kind` is the block's own form, and the
   granularity tree is built from it — a heading inside a callout is still a heading with its level.
2. **Context ids are never addresses.** Comments, URLs, the ToC and the spine keep addressing block
   ids, which are the only permanent identity ([block-ids.md](../project/block-ids.md)). A context id
   is revision-local implementation detail; it is stable across re-runs only so that diffs stay quiet.
3. **Membership decides nothing on its own.** Whether a block is searched, embedded, gisted or on the
   clock stays with the named predicates in [`src/block-policy.ts`](../../src/block-policy.ts).

### The simpler option passed over, and the more complex one

**Simpler: two columns and no context at all** — keep `kind: "callout"`. That is what shipped this
morning, and the thing that made it wrong is not hypothetical: a heading in a callout cannot be both.

**More complex: a join table.** `revision_block_contexts(revision_id, block_id, context_id, type)`
would let a block belong to several contexts at once — a verse inside a callout — which the two
columns cannot express. It was passed over because *nothing today can produce that*: nested callouts
are collapsed to one at stage 2, so a block has at most one context by construction. Two nullable
columns is also the path `role`, `treatment` and `noteId` cut three days ago, and a second way to say
"this block belongs to an authored group" is exactly what this plan exists to avoid. When a second
context type needs to co-exist with the first, that is a migration from two columns to that table —
with, by then, an actual case to design against.

## Compatibility

`kind: "callout"` **stays in `BlockKind` and in the CHECK constraint**, produced by nothing. Every
revision extracted between this morning and this afternoon has it in Postgres and in `blocks.json`,
and the reading view reads both spellings — `kind-callout` (legacy) and `ctx-callout` (new) — so no
article has to be re-extracted to keep looking right. Re-extracting one moves it to the new
representation, and both look the same on the page.

## Where the work lands

| | |
|---|---|
| `src/reserved.ts` | new: the namespace, the template-aware scrub, `mintContextId` |
| `src/notes.ts`, `src/callouts.ts`, `src/blocks.ts` | use the shared scrub instead of three copies |
| `src/callouts.ts` | stamps `data-spya-callout="<contextId>"` rather than an empty string |
| `src/blocks.ts` | reads the id into `block.context`; `kind` is left alone |
| `src/types.ts`, `src/public-types.ts` | `BlockContext`, `Block.context` |
| `src/db/schema.ts` + migration `0038` | `context_id`, `context_type`, and the CHECK that they agree |
| `src/store/{pg,pg-revisions,artifacts-pg,public-reader,import,export}.ts` | the path `noteId` already cut |
| `src/web/TableView.tsx`, `styles.css` | `ctx-callout` beside `kind-callout`; the mark skips headings |
| `src/vocabulary.ts` | callouts are `kind: "text"` again, so they are prose again by default |
| `src/public/dto.ts`, `src/public-types.ts` | the context crosses to a visitor, for the reason `treatment` does |

## Measured

- The article this came from re-extracts to `text: 90, quote: 4, heading: 1` — the distribution it
  had *before* callouts existed — plus **9 contexts over 9 blocks**, with 94 of 95 ids carried (the
  one is the empty `<p>`, which has no carry-over key at all).
- **A heading inside a callout now gets the box**, which is the whole point: measured in the browser
  at 860px, `td.ctx-callout.kind-heading .prose` computes `padding-inline-start: 38.4px` and
  `::before` `content: none`, beside the paragraph's 67px `“`.
- `tests/store-parity.test.ts` loads every article in `data/` into Postgres and compares the two
  stores field by field — so the article's nine contexts cross the filesystem store, the import, the
  columns and the read on real data rather than on a fixture. 133 assertions, green.
- The new tests were each watched failing first: the namespace scan against a re-spelled attribute,
  the Postgres round-trip against a `writeBlocks` that writes `contextId: null`, the import
  validator against a commented-out `checkContext`.

## Two decisions worth arguing with

**`context` is deliberately *not* in `hashBlocks`.** `role` and `treatment` were folded into the
fingerprint because assigning a role changes no text and no range, and every summary, idea and
vector computed before the split would otherwise have reported itself current
([source-hash.ts](../../src/source-hash.ts)). The same argument does **not** carry here, because
nothing downstream of the fingerprint reads a context: it changes how a paragraph is set and nothing
else. Folding it in would also flip every article with a callout onto the framed canonical form and
re-run the whole paid pipeline for a presentational fact. **The trigger for revisiting is precise:
the day anything derived — a model call, an embedding, the tree — reads `context`, it joins the
fingerprint in that same change.** GPT Sol named this as a one-way door and it is the one place this
plan takes the other road.

**A callout can still flip `gistable`, and that can fail a publish.** The pull-quote rule covers
contexts, so a re-extraction that newly recognises a callout repeating body text sets
`gistable: false` on it — which makes `isStructural` false, which makes an existing `navLabel` on
that leaf invalid, which `validateTree` refuses at publish. That is loud rather than silent, and it
predates this plan (it arrived with the callout kind this morning). Worth knowing before somebody
meets it: the answer is to re-run stage 4, not to relax the gate.
