# Review: callout blocks, as built

You are reviewing **built code**, not a plan. Be adversarial and concrete. For each finding, name the
file and the line, say what input or sequence produces the wrong behaviour, and say what the fix is.
Rank by severity. Say plainly if something is fine.

## What was asked for

Greg, 2026-08-31, looking at `/read/openai-huggingface`:

> that original article had lots of quotes (e.g. "Whoa! Shared Artifactory cache is a covert mailbox
> among agents…") which were shown as nice quotes in the original html, but just get converted to
> plain blocks in the Spideryarn text. Let's add a new kind of block-type for quotes/callouts that
> display a little differently … And also consider whether there any other block-types that we might
> want to allow & display slightly differently.

He then picked the look from three sketches: *"big faint mark in the gutter, indented text, no bar"*,
and left the scope of "other block types" to my judgment.

## The diagnosis, which the fix depends on

The styling was never the problem: `.prose blockquote` has been italic-at-58ch-with-a-left-rule for
weeks and a real `<blockquote>` gets it. Those nine "quotes" are **not** blockquotes. Substack writes

```html
<div data-callout="true" class="callout-block"><p><span>Whoa! …</span></p></div>
```

and Readability **unwraps the `<div>`**, taking `data-callout` and `class` with it (it also runs
`keepClasses: false`). Measured on the stored `raw.html`: 0 occurrences of `data-callout` or
`callout` in Readability's output. By stage 3 there is nothing left to recognise.

So the fix is a **stage-2 pass, before Readability**, exactly like the existing footnote pass
(`src/notes.ts`): recognise the container while the page is still as the author wrote it, and stamp
`data-spya-callout=""` on the container **and on every block-level element inside it**, because the
container is the thing Readability is about to delete. Stage 3 reads the stamp with `closest()` and
sets `kind: "callout"`.

## Architecture you need to know

- Seven pipeline stages. **Stage 2** = Readability (`src/extract.ts` → `runExtract`), which also
  calls `unhideCollapsedSections` and `canonicaliseNotes` before Readability for the same reason.
  **Stage 3** = `splitIntoBlocks` (`src/blocks.ts`): sanitises, splits into blocks, mints/carries
  stable ids, writes `blocks.json`.
- **Block ids are the contract everything else addresses text through** (comments, chat anchors,
  scroll position, the ToC). On a re-run stage 3 **carries ids over by matching a block's tag and its
  text** (`exactKey`). So a pass that re-words or re-wraps a block re-mints its id and orphans every
  comment on it. This is why the new pass stamps and moves nothing — the tempting version, rewriting
  a callout into a `<blockquote>`, was rejected for this.
- **A block is the finest unit a reader takes in as one thing**: an `<li>` is a block, the `<ul>` is
  not; `<blockquote>` is a leaf and is never descended into. So a three-paragraph callout is three
  blocks, not one.
- `kind` is stored in Postgres under a CHECK constraint, so a new kind is a migration (0033,
  attached). No predicate in `src/block-policy.ts` reads `kind` — they read `gistable` and
  `treatment` — so search, embedding, ToC rows and the reading clock are untouched by the new value.
- **Stage 2 is a trust boundary.** The page is a stranger's, and our own `data-spya-*` attributes are
  forgeable, so every copy the document arrived with is scrubbed before we write ours — `<template>`
  contents included, because a DOM query does not enter a template's fragment (that exact hole was
  found here once before).
- Rendering: `TableView` already writes `kind-${block.kind}` onto each `<td>`, so the visual half is
  stylesheet-only.

## What was measured

- The article: 9 containers recognised, 18 elements stamped, 0 rejected by the guard; blocks go from
  `text: 90` to `text: 81, callout: 9`; **94 of 95 ids carried over** (the one re-minted is the
  empty-text media block, whose carry-over key is its `src`).
- **The 16 extraction fixtures produce zero callout blocks.** rfc9110's 32 editorial `<aside>`s and
  gwern's 3 admonitions are all stamped and then **all discarded by Readability** before stage 3
  runs. The navigation guard fires on MDN's two layout rails and the constitution site's sidebar.
  So `aside` and `admonition` are, today, dead weight on the corpus; Substack's shape is the only one
  proved end to end.
- A first run made **all nine callouts `gistable: false`**: the pull-quote rule compares a block's
  first 60 characters against "the prose", and the prose corpus is every `<p>` outside a figure or
  blockquote — so it found each callout inside itself. Fixed by excluding `[data-spya-callout]` from
  that corpus.

## The specific questions

1. **The stamp, and whether it survives the right things.** `data-spya-callout` is written before
   Readability and read after Readability *and after DOMPurify* (stage 3 sanitises before
   `describeBlock` runs). Is there a path where the stamp is lost while the text survives (the
   feature silently does nothing), or — worse — where a stamp ends up on prose that was never in a
   callout? Consider Readability's `_setNodeTag` div→p rewriting, its paragraph-building from loose
   text nodes, and the fact that we stamp *both* container and descendants.
2. **The scrub, and forgery.** `scrubReserved` runs first and recurses into `<template>`. Is that
   enough? `canonicaliseCallouts` is called only from `runExtract`; the PDF path builds HTML in code
   with escaped text and a fixed tag vocabulary, so I believe it cannot carry an attribute — check
   that reasoning. What is the worst a hostile page achieves if it *does* get a stamp through?
   (My answer: its paragraphs render indented with a quote mark. Is there more?)
3. **`isNavigation`.** Link density > 0.5, or contains a `<nav>`. Too loose (a real sidebar becomes a
   box) or too strict (rfc9110's "Note:" asides carry a citation link each)? Note the argument I am
   leaning on: a sidebar that survives Readability is *already* being rendered to the reader as body
   prose, so classifying it as a callout is not a worse outcome. Is that argument sound?
4. **`CONTAINER_SELECTOR`.** `[data-callout]`, `class~="callout"`, `callout-block`, `admonition`,
   `pullquote`, `pull-quote`, `aside`, `[role="note"]`. `~=` rather than `*=` on purpose. What real
   publisher shape is missing, and what in that list will produce false positives on a real page?
   Epigraphs are deliberately absent because gwern's already wrap a `<blockquote>`.
5. **`describeBlock`.** `kind === "text" && el.closest("[data-spya-callout]")` → `"callout"`, so a
   heading inside a callout stays a heading with its level (the tree depends on that), a blockquote
   stays a quote, a figure stays media. Right call? And the pull-quote rule now covers `callout` as
   well as `quote` — should a callout that repeats body text verbatim really be `gistable: false`?
6. **The `proseText` exclusion.** Is `figure, blockquote, [data-spya-callout]` now right, or does
   excluding callouts from the prose corpus weaken pull-quote detection somewhere else?
7. **The migration.** 0033 drops and re-adds the CHECK. Widening is the safe direction, but: what
   happens on production between the code deploying and the migration running, or the other way
   round? Is there an import path that would fail row-by-row rather than loudly?
8. **Nested and repeated stamps.** A callout inside a callout is skipped by
   `container.parentElement?.closest("[data-spya-callout]")`, relying on `querySelectorAll` being in
   document order. Correct? What about a stamped element that is *also* a container match itself?
9. **The CSS.** `td.text.kind-callout .prose` gets `position: relative`, a 2.4rem left pad, 58ch, and
   `--ink-soft`; the mark is a 4.2rem `“` at 34% opacity, `content: "\201C" / ""` so it stays out of
   the accessibility tree, `user-select: none`. The caption rule had to be placed **after**
   `td.text.opaque` because they have identical specificity and a caption carries both. Any rule here
   that will surprise someone — overlap on a one-line callout, the mark's box eating a click, RTL,
   print, the enlarge wrapper, or a callout that also carries comment marks?
10. **The tests.** Would a plausible wrong implementation pass them? They run the real
    `runExtract` + `splitIntoBlocks` over synthetic pages; the `<aside>` guard is tested against the
    DOM instead, because through the pipeline those assertions are vacuous (Readability drops asides,
    so the guard could be deleted and the pipeline test would stay green). What is missing?
11. **Anything wrong, dangerous or over-built.** Including: is a new `BlockKind` the right axis at
    all, or should this have been a second field like `treatment`? And is it honest that existing
    articles keep `kind: "text"` on their callouts until somebody re-runs stage 2 over their stored
    `raw.html`?

## The code

Everything below is the built code: the new stage-2 module, the new test file, the migration, and
the diff of what changed in the existing files. The stylesheet's own diff is trimmed to the rules
added — the rest of that file's working-tree diff belongs to another agent's unrelated work.
