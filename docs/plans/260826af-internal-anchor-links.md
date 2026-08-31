# The article's own links

**Status: built, 2026-08-26.** Greg found it in the reading view:

> There's a link to "how we think about corrigibility" that doesn't seem to go anywhere when I
> click it. Why?
>
> — Greg, 2026-08-26

## What was wrong

The Anthropic constitution links to its own sections. One of them reads "see the section on how we
think about corrigibility for more on this", and in the published page that is
`<a href="#how-we-think-about-corrigibility">`, aimed at an `id` the author put on the heading.

Stage 3 gives every block a spideryarn id and **writes it into the element's `id` attribute**,
overwriting whatever was there — it keeps an existing id only when that id is already one of ours
([`src/blocks.ts`](../../src/blocks.ts)):

```ts
const existing = el.getAttribute("id");
if (!isSpideryarnId(existing) || assigned.has(existing!)) return undefined;  // → mint, then setAttribute
```

So the heading became `<h3 id="spya-k5an3b">`, and nothing in the document answered to
`how-we-think-about-corrigibility` any more. The link itself survived untouched — the sanitiser has
no reason to drop it — so a click set the fragment in the address bar and scrolled nowhere, because
that is what a browser does with a hash it cannot find.

Five links in this article, all broken the same way:

```
#being-broadly-ethical  #being-broadly-safe  #hard-constraints
#how-we-think-about-corrigibility  #safe-behaviors
```

and every `id` in `data/constitution/blocks.json` was a `spya-` one. No other article in `data/` has
an internal anchor at all, which is why it had not shown up before.

A second thing sits behind it. Even with the target intact, a native hash jump lands the row's top
edge at the top of the viewport — behind the two sticky bars — and leaves `?at=` claiming the reader
never moved. That is the same reason [`main.tsx`](../../src/web/main.tsx) rewrites an arriving
`/#spya-…` into `?at=` before React mounts.

## What was built

**Stage 3 renames the references along with the id.** `retargetAnchors` in
[`src/blocks.ts`](../../src/blocks.ts) pairs every anchor name the article uses — an `id` or an
`<a name>` — with the block a reader following it would end up looking at, and rewrites each
`href="#that-name"` accordingly. Hrefs starting with `#` only; a link that leaves the document is
left alone. It runs after the last id is settled and before any block's html is read.
`stats.retargeted` counts them and the pipeline logs the number.

It has to be there, because that is the only moment both names are known at once: one stage-3 run
later the author's id is gone from the HTML for good. It is idempotent — on a re-run every href
already says `#spya-…` and the map is empty — and it survives a re-extraction, where the author's
ids come back and ours are carried over by matching text.

Resolving to a *block* rather than to an element is what makes it work in the reading view, which
draws blocks and nothing else. An anchor on a wrapper resolves to the first block inside it, one on
a span to the block containing it, and a duplicated id to the first in document order. The full
account is in [block-ids.md](../project/block-ids.md#the-articles-own-links), including why the
author's name has to be read *before* the sanitiser.

One repair on the way: `block.html` is now taken from a fresh `ownContent(el)` rather than from the
clone made before the ids existed. That clone was already being patched with the id after the fact;
it would have kept the old href as well.

**The click is handled rather than left to the browser.**
[`src/web/internal-links.ts`](../../src/web/internal-links.ts) resolves a click in the prose to a
block — the fragment itself if it is a block id, otherwise the row containing whatever the fragment
names — and `TableView`'s delegated handler hands it to the same `onJump` a gist, a spine segment
and an arrow key use. Delegated because the prose is injected HTML, so those `<a>` elements are not
React's. Four kinds of click are deliberately not taken over: a modified one, one on a link asking
for its own tab, one that ends a text selection, and one on a link the mouse-up handler has already
turned into a question. Anything it cannot resolve is handed back to the browser untouched: a dead
link stays dead rather than being pointed somewhere plausible.

## What the review changed

The code went to GPT Sol (`gpt-5.6-sol`, high effort, read-only) after it was built. Its verdict on
the approach was "sound, but the change is incomplete", and it was right about five things:

- **Wrapper ids.** `<section id="methods">` keeps its id through stage 3, so the link looked fine —
  but a wrapper is in nobody's `block.html`, so it is not in the rendered page at all and the link
  was dead on screen. The first version resolved only block elements. Anchors now resolve to a
  block in all three cases: the element itself, the block containing it, or the first block inside
  it.
- **Duplicate ids** now resolve to the first in document order, which is what a browser does. The
  first version considered only block ids, so `<span id="x">` earlier in the page lost to
  `<h2 id="x">` later.
- **Legacy `<a name="note">`** is read as an anchor name alongside `id`.
- **⌘-click opened the wrong block.** `#spya-new` on a page that already had `?at=old` produced
  `?at=old#spya-new`, and `main.tsx` deliberately kept the existing `at`. A fragment is where the
  reader asked to go and `?at=` is where they happened to be, so the fragment now wins.
- **`target="_blank"`** on an internal link was being intercepted and navigated in the current tab.

And it was right that the DOMPurify limitation this plan first described as a security tradeoff was
"principally complexity versus coverage". `SANITIZE_DOM` deletes any `id` naming a property of
`document` or a form element — `target`, `title`, `name`, `method`, `action`, `links`, `images`,
`forms` — before stage 3 sees the element, and headings called `title` are not exotic. Sol confirmed
that DOMPurify keeps a `data-` attribute in exactly those cases, and that a fixed private attribute
whose value is only ever a `Map` key is not a clobbering risk. So the author's anchor name is now
stamped onto its element before the sanitiser runs, read back immediately after, and removed —
scrubbed twice, since any copy the article shipped is cleared before ours is written.

Two findings were noted rather than acted on:

- **A page that links to itself the long way round** — `href="https://this.article/#section"` —
  still points at the overwritten name. Repairing it means telling stage 3 the article's own
  address, which it currently has no reason to know. No page we have ingested does this. A question
  for Greg rather than a decision made quietly.
- **An article that ships an id in our own format is believed**, and can therefore claim a block id
  that already belongs to somebody's comment. This predates the change and is written up in
  [block-ids.md](../project/block-ids.md#a-gap-that-predates-all-of-this).

Sol also flagged a link inside a comment mark firing both the comment and the jump. That one had
already been fixed before the review landed; a selection ending on a link had not, and now is.

## What the second review changed

The rebuilt version went back to Sol. Verdict: "not complete", and nine findings, of which it had
reproduced six. Seven were real and are fixed:

- **A standalone `<a name="note"></a>` between blocks** resolved to nothing — it is in no block and
  contains none, so the first three rules had nothing to say. It now resolves to the next block,
  which is where a browser lands. This is also the shape a named anchor inside a table collapses to
  once the parser has foster-parented it out.
- **A nested list resolved to the wrong row.** `<ul id="inner">` is both inside a block and around
  one; climbing to the ancestor first answered "the outer `<li>`", when the link named the inner
  list. Contained beats containing now.
- **The sanitiser unwrapping an element took its name with it.** `<x-section id="methods">` is
  deleted while its contents are kept, and realistic CMS markup. The name is written onto the first
  child too, which survives the unwrap.
- **A stamp inside a `<template>` reached `blocks.json`.** A DOM query does not enter template
  content, so neither scrub could see it while `outerHTML` serialised it in full. Only an article's
  own forged stamp could get in there (the stamping query cannot reach it either), and it was inert
  — but this plan claimed the attribute never reaches storage, and it did.
- **A stamp forged on `<html>`** was read: those elements are outside the subtree the sanitiser
  rewrites, so an attribute there crosses untouched. Now cleared, and the read is body-scoped.
- **An `<a name>` could beat an `id`** claiming the same word. The HTML spec resolves a fragment
  against every id in the document first and only then against named anchors; both stage 3 and the
  client now do the same.
- **`target="_SELF"`** slipped past the check. Target keywords are ASCII case-insensitive.

And two more:

- **A selection ending inside a link still navigated.** Declining to jump was not enough — the
  browser then followed the fragment natively, which is worse than jumping, because it throws the
  reader away from the passage they had just selected. The click is now stopped.
- **Resolution was quadratic** on nested markup: Sol measured 1.54s against a 188ms baseline for a
  synthetic page with 750 nested ids, because each anchor descended its own subtree. Document order
  is now computed once for the whole document. On the same shape of page the ids cost 878ms against
  an 825ms baseline — 6%, where it had been eight-fold. The constitution takes 210ms end to end.

Sol was also right to push back on the note above about author-supplied `spya-` ids: "those ids are
visible and shareable, so knowing one is not a meaningful security barrier". The write-up in
block-ids.md now says what actually keeps it narrow, and what would stop keeping it narrow.

## Evidence

Stage 2 and stage 3 re-run over `data/constitution/raw.html`, since the author's ids only survive in
the raw page:

```
blocks stats: { total: 360, reused: 0, carried: 360, minted: 0, retargeted: 5, gistable: 360 }
ids identical, in order: true
blocks whose text changed: 0
hashBlocks before/after: b520d796c43fbf6c → b520d796c43fbf6c
```

Every id carried, so no comment, search or glossary entry lost its anchor, and the source hash is
unchanged, so nothing downstream reports itself stale. All five hrefs now name an id the document
actually has.

Tests: nineteen cases in `tests/blocks.test.ts` and twelve in `tests/internal-links.test.ts`. Five
of the first batch were watched go red before the fix, and so were the five that came out of the
second review round — including the two that pin the scrubbing, which pass for a *different* reason
than they look like they do unless you check (the read is body-scoped, so the root-clearing is a
second line of defence rather than the one doing the work).

## See also

- [block-ids.md § The article's own links](../project/block-ids.md#the-articles-own-links) — the
  same story as a project doc, which is where it belongs long-term
- [url-state.md](../project/url-state.md) — `?at=`, and why position is not in the hash
- [security.md](../project/security.md) — the sanitiser this runs after
