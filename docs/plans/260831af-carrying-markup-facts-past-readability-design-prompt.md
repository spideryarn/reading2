# Design question: is there a cleaner long-term way to carry markup facts past Readability?

This is **not** a code review. The code below works, is tested and is committed. Greg's question,
2026-08-31, on being shown the sentence that documents it:

> I wonder if there's a long-term-better/cleaner way to do this?

I want your view on the *shape*, not the bugs. Concretely: **should this repo keep adding reserved
`data-spya-*` attributes to a stranger's DOM at stage 2 so that stage 3 can read them back, or is
there a design that ages better?** Answer with a recommendation and its cost, not a menu. If the
answer is "keep it, and here is the one rule that keeps it from rotting", say that — I would rather
hear that than a rewrite nobody will do.

## The pipeline, as it is

Seven stages, each writing JSON to disk (or Postgres), each runnable on its own.

```
1 fetch     → raw.html (the page as the publisher served it, stored)
2 extract   → article.html + meta.json   — jsdom, then Mozilla Readability
3 blocks    → blocks.json                — DOMPurify, split into blocks, mint/carry stable ids
4 toc       → tree.json (structure)
5 summarize → tree.json (gists per node)
6 serve     → Node + React reading view
```

**The contract everything rests on**: every block has a stable random id (`spya-k3m9qt`), and every
feature — table of contents, summaries, scroll position, highlights, comments, chat anchors —
addresses text by that id, never by offset or selector. Ids are minted once and preserved on every
later run. Stage 3 carries an id over by matching a block's **tag and its text** (`exactKey`), so
**any pass that re-words or re-wraps a block re-mints its id and orphans every comment on it.**

A block is the *finest* unit a reader takes in as one thing: an `<li>` is a block, the `<ul>` is not;
`<blockquote>` is a leaf and is never descended into. `blocks.json` is a flat array in document
order, each entry `{id, tag, kind, level?, text, words, html, gistable, role?, treatment?, noteId?}`.
`kind` is `heading | text | quote | callout | code | media | caption | other`, stored in Postgres
under a CHECK constraint.

## The problem this shape exists to solve

**Readability destroys the evidence.** It runs with `keepClasses: false`, it unwraps containers, and
it drops whole elements. So by stage 3 the document no longer says what the author's markup said:

- **Footnotes.** Four publishers write them four incompatible ways (gwern, Wikipedia, Substack,
  Tufte). Tufte's mechanism is a `<label>` and an `<input>`, both of which our sanitiser correctly
  deletes. By stage 3 a sidenote's text is sitting mid-sentence, unmarked, indistinguishable from
  the author's own prose — not lost, *reclassified as argument*, silently.
- **Callouts** (the new one). Substack writes `<div data-callout class="callout-block"><p>…</p></div>`.
  Readability unwraps the `<div>` and takes both attributes with it. Measured: 0 occurrences of
  `data-callout` or `callout` in Readability's output for an article with nine of them; nine
  paragraphs reach the reader as body prose.
- **Author anchors.** DOMPurify's `SANITIZE_DOM` deletes any `id` or `name` that collides with a
  property of `document` (`target`, `title`, `name`, `links`, …), which is common in real headings —
  and every link to them dies with it.

## What is there today: three families of reserved attributes

**Family A — footnotes** (`src/notes.ts`, ~880 lines, stage 2, before Readability).
`data-spya-notes` on one container, `data-spya-note="<noteId>"` per note, `data-spya-note-ref` on
each marker, `data-spya-note-back` on each back-link. This one **rewrites structure**: it moves note
prose into a canonical `<section><ol><li>` at the end, mints a `noteId` from a hash of the note's
text, and keeps the author's own marker and back-link elements wherever it can, precisely because
re-writing them would re-mint ids. Stage 3 reads the container and writes `role`, `treatment` and
`noteId` onto blocks by **ancestor lookup** — a note is a *range* of blocks, not one block.

**Family B — callouts** (`src/callouts.ts`, ~250 lines, stage 2, after the notes pass). One
attribute, `data-spya-callout=""`, valueless. It **stamps and moves nothing**, on the container and
on every block-level element inside it, because the container is the element about to be deleted. It
also wraps loose phrasing content in a `<p>` first, because Readability builds a *fresh* paragraph
from loose text and our stamp would not be on it. Stage 3 reads it with `closest()` and sets
`kind: "callout"`.

**Family C — author anchors** (`src/blocks.ts`, stage 3, before the sanitiser).
`data-spya-was-id` / `data-spya-was-name`, written and then **removed again** the moment they are
read, before any block html is serialised. Unlike A and B these never reach an artefact.

All three carry the same two obligations, written out three times: **scrub every copy the document
arrived with first** (`<template>` contents included, because a DOM query does not enter a template's
fragment — a stamp survived two scrubs that way once), and **never carry a value the page supplied**
(A validates its ids against a regex; B writes only the empty string; C is erased).

## The specific things that feel wrong

1. **The count is going up, and each addition is a whole file.** Two features have needed this in a
   fortnight. The next ones are visible from here: definition lists, tables with headers, `<figure>`
   groupings, poetry/verse line breaks, `<time>`, `lang` switches mid-article, RTL runs, `<mark>`,
   `<ins>`/`<del>`, MathML that Readability keeps but our sanitiser mangles. Each currently implies:
   a new reserved attribute, a new scrub, a new stage-3 read, possibly a new `BlockKind`, and — if it
   is a kind — a Postgres migration.
2. **`kind` is doing two jobs.** It is the block's *structural* type (heading/text/table) and now
   also its *presentation* (callout). A heading inside a callout has to keep `kind: "heading"`,
   because the whole tree is built from heading levels — so it silently loses the callout's setting.
   `role`/`treatment` were added for footnotes as a second, orthogonal axis. A third axis may be
   coming.
3. **We are writing into a document we do not trust, in the one window where we cannot yet sanitise
   it** (the pass must run *before* Readability, and the sanitiser runs after it). The defence is a
   scrub, repeated per family, and it depends on every future author of a fourth family remembering
   the template trap.
4. **Nothing that reaches the reading view is addressable by anything but a block.** A callout that
   spans three paragraphs is three blocks with no group identity; footnotes needed `noteId` invented
   for exactly that, and callouts will want the same the first time we draw a box round one.
5. **It is invisible in the artefact.** `blocks.json` says `kind: "callout"`; it does not say *why*,
   or which container, or what the class was. Debugging a misclassification means re-running stage 2
   with a debugger.

## Options I can see (argue against these too)

- **(a) Keep it, formalised.** One shared module — `reserved.ts` — owning the attribute namespace,
  the scrub (template-aware), the value validation, and a registration API, so a new family is a
  registration rather than a new set of habits. Cheap, honest, does nothing about `kind` or grouping.
- **(b) One stamp, one vocabulary.** A single `data-spya-mark="callout note:abc123 verse"`
  token-list attribute instead of a family per feature, scrubbed once, read once at stage 3 into a
  `marks: string[]` on the block. Blocks gain an open axis; `kind` stops absorbing presentation.
- **(c) A sidecar rather than the DOM.** Stage 2 emits `markup-facts.json` alongside `article.html`,
  keyed by something durable, and never touches the document. Sounds cleaner; I cannot see what the
  key would be that survives Readability rewriting the tree — element paths do not, and we have no
  ids yet at that point. Tell me if there is one.
- **(d) Move the recognition into stage 3 and stop needing stamps** — by not letting Readability be
  the only path. E.g. run our own structural pass over the *original* `raw.html` (which we store) and
  align it with Readability's output by text matching, the way id carry-over already aligns two runs
  by tag and text. Expensive, but it would give stage 3 the author's markup for everything at once
  rather than one feature at a time.
- **(e) Stop using Readability for structure** and use it only to *choose* the article subtree, then
  sanitise and split the original nodes ourselves. The biggest change; possibly the one that makes
  five future features free. What breaks?

## What I want from you

1. Which of (a)–(e), or what else, and **why that one for this repo** — a two-person project that
   values "prefer boring", "prefer simple over easy", and reuses machinery rather than adding a
   second way to do the same thing.
2. The **one-way doors**: what would we regret in six months, given that block ids are permanent, the
   `kind` values are in a CHECK constraint, and stored artefacts are cheap to regenerate but comments
   anchored to ids are not.
3. Whether `kind` should keep absorbing presentation, or whether the block wants a separate open axis
   (and if so, what it is called and what its rules are).
4. A migration path that is worth doing **incrementally** — what the next feature should be built on
   even if nothing is rewritten today.
5. Anything in the framing above that is wrong.
