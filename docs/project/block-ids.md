# Block ids

The spine. Every other artefact in Spideryarn addresses text by block id, so this is the one
decision that is expensive to revisit — see
[AGENTS.md § The one contract that matters](../../AGENTS.md#the-one-contract-that-matters).

Assigned by [`src/blocks.ts`](../../src/blocks.ts) (pipeline stage 3,
[architecture.md § Pipeline](architecture.md#pipeline)); the id itself is minted by
[`src/ids.ts`](../../src/ids.ts).

## Intent

Greg's framing (2026-08-24):

> We give each paragraph a unique ID. We generate a table of contents that's quite deeply nested —
> all the way down to a paragraph level.

and on the format specifically:

> Maybe that's a six-character random ID composed of letters and numbers […] skip L and O because
> they're easy to confuse, lowercase only.

## The format

```
  spya-k3m9qt
  ────┬ ──┬───
      │   └── 6 characters, first is always a letter
      └────── fixed prefix: this id is ours
```

- **Alphabet, 32 characters:** `a`–`z` minus `l`, `o`, `i`, plus digits minus `1`. Greg named `l`
  and `o`; `i` and `1` are dropped for the same reason, and dropping `o` is precisely what makes
  keeping `0` safe. These are the pairs someone misreads when copying an id out of a URL by hand.
- **First character is a letter.** `#spya-k3m9qt` must be a valid CSS selector without escaping;
  `#spya-3m9qtk` is not, even though HTML5 permits the id.
- **Lives on the native HTML `id` attribute**, so `article.html#spya-k3m9qt` works in a browser with
  no JavaScript at all. That is why we did not invent a `data-` attribute: an anchor that the
  platform already understands is worth more than a tidier namespace.
- **Roughly 771 million** ids (23 × 32⁵). For an article of a few hundred blocks an internal
  collision is vanishingly unlikely, but stage 3 checks anyway — a silent duplicate would corrupt
  every downstream artefact, and a set lookup is free.

## Why random and not sequential

`p0001`, `p0002`, … in document order is the obvious design, and it was the contract here until
2026-08-24. It is readable, it sorts, and it makes a range check a string comparison. We gave all of
that up deliberately.

**Sequential ids do not survive re-extraction.** Re-fetch an article after the site re-renders it,
gain one paragraph near the top, and every id below that point shifts by one. Nothing errors. Every
note, highlight, and cached gist now points confidently at the wrong paragraph — the failure is
silent, and it corrupts exactly the reader state we most want to keep.

[vision.md](vision.md#where-this-goes-after-granularity-zoom) asks for
**"notes and highlights anchored to block ids, surviving re-extraction"**. Sequential ids cannot
deliver that sentence. Random ids, minted once and preserved on every subsequent run, can: a
paragraph keeps its id for as long as it exists, regardless of what is inserted above it.

Re-running stage 3 is therefore **idempotent by design** — ids already present are kept, and only
genuinely new blocks are minted. The `spya-` prefix is what makes that decidable: it distinguishes
our ids from an author's own `id="main-content"` without a manifest. On the test article, a second
run reuses all 139 ids and mints none.

### Surviving stage 2, which is the case that actually matters

Reusing ids found in the HTML is not enough on its own, and it is worth being precise about why.
**Stage 2 writes a fresh document.** Readability re-parses the fetched page and emits new markup, so
after a re-extraction there are no ids in the file to preserve — the first version of this stage
re-minted all 139 and would have orphaned every note, which is the exact failure random ids were
chosen to prevent.

So stage 3 also **carries ids over from the previous run's blocks** when there are any, matching a
new block to an old one by its text. A paragraph keeps its id as long as its words are unchanged, no
matter how far it has moved. Blocks with no text — images, figures — match on their `src` instead,
so a Hierarchy row aimed at a diagram doesn't go stale. Each previous id is consumed once, so a page with
several identical short paragraphs cannot hand the same id to two blocks.

#### Where the previous run comes from, and the three answers it can give

**From the `ArtifactStore`, not from a path** — `previousBlocksFrom` in
[`src/blocks.ts`](../../src/blocks.ts). In Postgres — the only store since 2026-09-05 — it is the
block rows `beginDraftIn` copies into a new draft from the published revision before any stage runs,
so the baseline is already sitting there when stage 3 starts. Reading the draft's own carried rows is
not matching against itself: before stage 3's first write those rows *are* the previous published
blocks. (On the filesystem, until then, that was `output/<slug>.blocks.json`.)

Until 2026-08-28 the read was a `readFile` inside a `try/catch` whose `catch` said *"first run for
this article"*. That is one branch doing two jobs, and the moment the pipeline's artefacts leave the
filesystem it takes the second one for every article at once: the read fails, every article looks
new, every id is re-minted, and the step reports success
([260827aa-delete-the-importer.md](../plans/260827aa-delete-the-importer.md)). So the three cases are now separate and
only one of them mints:

| | what it means | what happens |
|---|---|---|
| no earlier blocks for this article | a genuine first ingest | mint, quietly |
| earlier blocks exist, no readable baseline | the carry-forward did not happen | **the stage fails** |
| the store read throws | an infrastructure fault | **propagates; the stage fails** |

`ArtifactStore.hasEarlierBlocks` is the second question, and Postgres answers it with the thing it
actually knows: whether `articles.current_revision_id` points at a published revision (one cannot
exist without blocks). Until 2026-09-05 the filesystem store answered the same question by asking
whether stage 4's `data/<slug>/blocks.json` was there — **there, not readable**. A half-written or
over-sized copy of that file answered *yes*, so it landed in the middle row of the table and stopped
the stage. That distinction was missing until 2026-08-28: the store read the file the way every other
caller does, where absent and corrupt are one answer, so a truncated stage-4 copy said *first ingest*
and every paragraph got a new id.
Whether those ids are still recoverable is a different question from whether to proceed — somebody
with a backup can put the file back, and minting takes that away without saying so.

**Warning and minting is not an option** — it turns a database hiccup into permanent, silent reader
data loss, and the reader finds out by scrolling.

There is a second guard behind that one, because a baseline that is present is not a baseline that
was used. `assertIdsCarried` compares the baseline's ids against the ones this run produced: a
non-empty baseline and an output that shares **nothing** with it stops the stage, before either
artefact is written. An output with no blocks at all is that case and not an exception to it — a
paywall, an error page or an empty shell all extract to nothing, and until 2026-08-28 they were let
through and written over the article. Ids and not counts — two runs of three paragraphs sharing none of their ids
would pass a count. A *partial* loss is deliberately not an error; any threshold would be a guess.
There is no exemption for a deliberate whole-article replacement because no such operation exists:
`force` on a step means *run it again*, which is the ordinary idempotent path and must keep its ids.

And a third behind that, because comparing two sets of ids needs two sets. `assertIdsCarried` returns
early when there is no baseline, and no baseline is exactly the state of a **first ingest** — so the
paywall and the error page above were still let through on the one run that mints every id in the
article. `assertSomethingWasProduced` is that case: a run that produced no blocks at all stops,
before either artefact is written, whether or not there was anything to compare against. Every later
stage is built from the blocks, so `{"blocks":[]}` is not a short article, it is a failed fetch or a
failed extraction wearing a finished run's clothes — and the store's shape check takes any array, so
nothing downstream would have said a word. Added 2026-08-29.

The `blocks` step turns that one into a `blocked` stage failure, so the job card offers no Retry
([job-failure.ts](../../src/job-failure.ts)). Retry skips every step that finished, so it would hand
stage 3 the same prose-free HTML and stop in the same place — which is what the error already tells
the reader, and for a while it said so above a button that contradicted it.

The read side keeps its own copy of that question — `blocksMatchTheirHtml` in
[`src/pipeline.ts`](../../src/pipeline.ts) refuses to call the step done when `blocks.json` lists
nothing. Belt and braces on purpose: the write-time guard stops new empties being created, and the
read-time one still has work to do, because `blocks.json` files already on disk can be empty and
nothing will rewrite them.

### The freshness guard, and the two ways it was wrong

`blocksMatchTheirHtml` in [`src/pipeline.ts`](../../src/pipeline.ts) asks two things.

1. **Every id in the blocks artefact is in the stamped HTML.** Cheap, and it settles the commonest
   failure — stage 2 re-ran and wiped the ids — before anything is parsed.
2. **Re-derive the blocks from the extracted HTML and compare**, through `splitIntoBlocks`: the same
   splitter, the same sanitiser, the same everything except which ids were handed out.
   `blockIdentityFree` is the projection that takes the ids out — every field of a `Block` except
   `id`, with `spya-` id attributes and `#spya-…` fragments normalised out of the stored `html`.

Question 1 alone was enough **by accident** until 2026-08-31. On disk `extract.extractedHtml` and
`blocks.stampedHtml` were the same path (`PATHS` in
`src/store/artifacts-fs.ts`, deleted 2026-09-05), so a re-extraction overwrote the
very file question 1 read and the missing ids gave it away. Split into the two Postgres columns the
alias goes, question 1 compares stage 3's own output against stage 3's own blocks, and it returns
**true always**.

**Question 2 was a comparison of the two documents' parsed text first, and that was wrong in both
directions.** Worth keeping, because it looked well-measured and was not:

- **It under-fires.** `<p>Alpha</p><p>Beta</p>` re-extracted as `<p>AlphaBeta</p>` has identical text
  and genuinely different blocks — and so does a heading demoted to a paragraph, a repointed `href`,
  a changed `src` or `alt`, and whitespace inside a `<pre>`.
- **It over-fires, and that half cannot cure.** Stage 3 sanitises what it is handed, and `FORBID_TAGS`
  in [`src/sanitize-policy.ts`](../../src/sanitize-policy.ts) removes `style` and friends, so a
  healthy stamped HTML legitimately says less than the extraction it came from. Under Postgres
  `extracted_html` stays unsanitised while `stamped_html` stays sanitised, so stage 3 would re-run for
  ever and never report itself done.

The comparison had been measured against one real article and found sound. **One healthy pair says
nothing about the unhealthy ones, and nothing at all about the pairs that ought to be healthy and are
not** — [silent-success.md](../reusable/silent-success.md). Deriving the candidates through the same
code the stage uses removes both halves at once: both sides are sanitised, so there is nothing to
over-fire on, and both keep their boundaries, tags and attributes, so there is nothing left to
under-fire through. GPT Sol found both, 2026-08-31.

**What it costs.** A full jsdom parse, a DOMPurify pass and a document walk, on every skip check for
this one step: 16 ms for a 19 KB article, 169 ms for 77 KB, 687 ms for the 676 KB `consciousness`,
which is the worst case in `output/`. It is not short-circuited on the filesystem, where the two
reads return the same string — a guard that knows which store it is in is a guard with an untested
half.

**What it rests on.** On the filesystem the candidates come from stage 3's *own* output, because
there is only one document; that is sound only if the splitter is idempotent. Measured across ten
real articles, twice over each (94 to 669 blocks): identical every time. If it ever stops being true,
every filesystem article reports this step not-done at once rather than quietly — the right way round
for it to break.

**What it still does not prove.** Question 1 is membership, not binding: two ids swapped between
elements, or one parked on an unrelated wrapper, both pass. Question 2 says stage 3 would produce the
same blocks, not that these blocks carry the ids a reader's comments name — `assertIdsCarried` is
what holds that, at write time. The end state is a generation token stage 3 writes into both
artefacts, and it has nowhere to live yet: in Postgres the blocks artefact is rows, and
`STAMP_SOURCE` in [`src/store/artifacts.ts`](../../src/store/artifacts.ts) lists no entry for
`blocks`, so a `stamp` for this step reads back `null`. **That absence is a reason to do the storage
work before the flip, not a reason to keep a cheaper heuristic.**

Stage 3's input is **stage 2's HTML** (`extractedHtml`), never its own previous output
(`stampedHtml`) — `BLOCKS_INPUT_HTML` in [`src/blocks.ts`](../../src/blocks.ts). On disk the two are
the same file and nobody could choose; Postgres holds them in separate columns, and reading the
stamped one would hand stage 3 last week's paragraphs already carrying this week's ids: identity
"preserved" onto the wrong text, with a clean-looking run to show for it.

### Two passes, and the second one refuses to guess

```
  pass 1   the tag + the text exactly as written (or, with no text, the src; or, with nothing
           in it, the tag, attributes and inner text, matched in document order) → keep the id
  pass 2   the tag + the same words, case and punctuation folded away,
           and only where one old block and one new block claim it            → keep the id
  else                                                                        → mint a fresh one
```

**Pass one asks the least of us**, which is why it goes first: two runs that produced the same
paragraph agree on it exactly. It is also what stops two paragraphs trading ids when a re-render
merely reorders them.

**The tag is part of both keys.** Text alone is not enough: `<h2>Same words</h2>` and
`<p>Same words</p>` keyed identically, so swapping them swapped their ids while reporting a clean
carry-over. Two blocks with the *same* tag that really do read alike still share a key and still
take their ids in order — that is right, because they are alike, and minting instead would drop the
id of every repeated `<li>Yes</li>` on the page.

**Pass two is the drift allowance** — a curly apostrophe going straight, an entity decoding
differently, a ligature composing. The fold is Unicode-aware: NFKC, then everything that isn't a
letter, number, mark or space removed. A folded key with no letter or number in it is thrown away
rather than used, because `❤️` and `☀️` both fold to the same invisible variation selector.

**The ambiguity rule is the part with design in it.** Folding creates equivalence classes the raw
text does not have — `Ⅳ` and `IV` both become `iv`, `①` and `1` both become `1` — so one bucket can
hold two genuinely different paragraphs. When it does, stage 3 **mints rather than choosing**. That
follows the rule this page states everywhere else: a lost anchor is safer than one silently attached
to a different claim.

**What this still does not promise.** NFKC folds compatibility characters, so an edit from `x²` to
`x2` carries the old id onto changed text. That is the trade for folding `ﬁ` to `fi`, which is real
extraction drift and about to be much more common — see
[260826c-pdf-ingestion.md](../plans/260826c-pdf-ingestion.md). And an id already in the document is trusted, except
that a *duplicate* of one is not: the second element carrying it mints, because two blocks with one
id corrupts every artefact keyed on it.

Until 2026-08-26 there was one pass, the fold deleted every character outside `a-z0-9`, and an
ambiguous bucket was handed out first-come. In English that stripped punctuation; in Cyrillic, Greek,
Chinese, Arabic or Devanagari it stripped the paragraph, and two of its five failure modes dropped
paragraphs from the article outright while reporting success. The cause, the measured blast radius
and the fix are in [the postmortem](../postmortems/260826d-block-id-matching-non-latin.md).

Measured on the test article, re-extracted *and* with a new paragraph inserted above everything:
**138 of 139 ids survive.** The one casualty was an `<hr>`, which has neither text nor a `src` to
match on and which nobody annotates — and that was a bug, fixed on 2026-09-05.

> **That last sentence understated it, and the understatement mattered. Fixed 2026-09-05; kept here
> because the shape of the mistake is worth more than the line that was wrong.** Every text-less
> block with no `src` anywhere in its html keyed as `null` in all three passes, so it was in no
> bucket on either side and **re-minted on every run over byte-identical input** — not one `<hr>` on
> one article, but 218 blocks across 17 of the 35 corpus fixtures (122 `<p>`, 59 `<hr>`, 30 `<li>`,
> 7 `<figure>`). No reader had anchored anything to one, but that is luck rather than design — a chat
> can be anchored to any block by its id alone. What moved on every article was the *fingerprint*:
> `hashBlocks` includes the block id, so half the corpus reported a changed article
> after a re-extraction that changed no words — and under Postgres those same articles could never
> satisfy `blocksMatchTheirHtml`, so the `blocks` step never reported itself done. Pre-existing since
> `84ce16bf` (2026-08-24).
>
> A block with **nothing in it at all** — no text, no `src`, and no child element — now takes the
> pass-one key `` `e:${tag}:${attributes and inner text}` `` and matches positionally among the empty
> blocks identical to it, so all three numbers are **0** and no stored id moved on rollout. Two
> guards keep that from becoming a wrong anchor: **position is trusted only where the two sides hold
> the same number of them**, so inserting one rule re-mints them all rather than sliding each id onto
> its neighbour; and a text-less block that *does* have markup in it —
> `<figure><svg>…</svg></figure>`, an inline diagram — goes on minting, because two of those are not
> interchangeable and keying them by tag alone moved one diagram's id onto the other. The attributes
> and the inner text are in the key for the same reason, one step less visible: a rule with a
> `class` on it is not a plain `<hr>`, and `<p>&#160;</p>` is not `<p></p>`. The
> write-up, the class it belongs to, and the alternatives refused are in
> [260905a](../postmortems/260905a-empty-blocks-remint-their-ids-on-every-extraction.md); the
> original investigation is in
> [260904e § A](../plans/260904e-extraction-repair-evals-and-llm-post-processing.md).

**A PDF re-read costs more than a web page re-extraction, and it is measured.** Re-running stage 2 on
the *same PDF with the same model and the same prompt*, then stage 3, keeps **32 of 43 ids and mints
11**. Readability run twice over the same HTML produces the same paragraphs; a model run twice over
the same page produces one more record than last time and a comma in a different place. The matcher
is doing exactly what it says here — refusing to guess when the words have changed — and the cost is
real. What to do about it is being decided in
[260826c-pdf-ingestion.md § What a re-read costs](../plans/260826c-pdf-ingestion.md#what-a-re-read-costs-measured-11-block-ids-of-43),
and it wants deciding before anything a reader owns is anchored to an id.

Two honest limits:

- **An edited paragraph gets a new id** and loses whatever was anchored to it. We cannot distinguish
  a heavily rewritten paragraph from a new one, and guessing with fuzzy matching would silently
  attach a reader's note to a sentence that no longer says what they annotated. Losing the anchor is
  the safer failure.
- **Carry-over needs the previous run's blocks.** Delete them and the ids are gone for good. They
  are a source artefact, not a cache; `data/<slug>/blocks.json` and the `revision_blocks` rows
  should both be treated as precious. Since 2026-08-28 losing them **fails the stage** rather than
  quietly minting a new set — see the three cases above.

### The cost we accepted

**Order is no longer derivable from the id.** `spya-w8z40d` tells you nothing about whether it comes
before or after `spya-gp3g6s`. Document order lives in one place only: the array index in
`blocks.json`.

> [!WARNING]
> Testing range membership by comparing ids — `id > start && id < end` — is now a **silent bug**. It
> compiles, it runs, it returns a plausible boolean, and it is meaningless. Resolve both endpoints to
> their `blocks.json` index and compare those.

The contiguous-range invariant that
[granularity zoom](granularity-zoom.md#the-tree) depends on is unaffected; it is simply grounded in
the index rather than in the id string.

## What gets an id

Blocks are the **finest** unit a reader takes in as one thing — so an `<li>` is a block and the
`<ul>` around it is not; the list becomes a *node* in the tree instead. See
[architecture.md § What a block is](architecture.md#what-a-block-is) for that decision and why it
matters to the hierarchy.

Some blocks get an id but never get a gist (`gistable: false`): images, horizontal rules, and
pull-quotes that repeat body text verbatim. They stay addressable — Hierarchy may well want to point
at a diagram — they simply must not generate a row of their own. On the test article all 11
pull-quotes are word-for-word repeats of body sentences, so without this Hierarchy would grow eleven
phantom rows quoting text it had already listed.

### A bare `<svg>` gets no id, and Hierarchy cannot point at a diagram

**Known hole, found 2026-08-28** while measuring extraction
([260827ab-readability-repair-pass.md](../plans/260827ab-readability-repair-pass.md)). The sentence above says Hierarchy
may well want to point at a diagram. For a `<figure>`-wrapped one it can. For a bare inline `<svg>`
it cannot, and nothing says so:

```
<p id="spya-vrkayh">Before the diagram…</p>
<svg viewBox="0 0 10 10">…</svg>                          ← no id, no block, no row
<figure id="spya-vqsgvn"><svg>…</svg><figcaption>…</figcaption></figure>
```

Two things combine. [`src/blocks.ts`](../../src/blocks.ts) matches tag names in **upper case**,
because that is what `tagName` gives for an HTML element — but `svg` and `math` are *foreign*
elements and keep their case, so `svg` matches neither `LEAF_BLOCKS` nor `CONTAINERS`. It falls to
the unknown-wrapper branch, which keeps an element only if it has text; a diagram usually has none.
The element survives into the page, with no id on it and no block behind it. A `<math>` block
escapes by accident — a formula has text.

That matters because keeping inline diagrams was a deliberate choice — Greg, 2026-08-25, recorded in
[`src/sanitize-policy.ts`](../../src/sanitize-policy.ts), knowingly accepting that foreign content is
where most historical mXSS bypasses live. We take that risk to keep the diagram and then cannot
address it: no Hierarchy row, no note anchored to it, nothing for zoom to fold.

The fix is small — a lower-case leaf set — and is **not** made here, because widening what gets an id
is this document's decision and not an extraction eval's. Note if it is taken: adding `"SVG"` to
`LEAF_BLOCKS` would look right and do nothing, for the casing reason above.

## The article's own links

Stage 3 does not only *add* an id. Where the author already put one on a paragraph or a heading, it
**overwrites** it — a block can only have one id, and everything here addresses text by ours.

That quietly broke a link the reader can see. A published page often points at its own sections, and
the Anthropic constitution has five, "see the section on how we think about corrigibility for more
on this" among them. Those are `<a href="#how-we-think-about-corrigibility">`, aimed at an `id` the
author put on a heading. The sanitiser has no reason to touch the link, so it arrived in the reading
view intact and pointing at a fragment that existed nowhere in the document. Clicking it put the
fragment in the address bar and moved the page not at all — the shape of failure this project keeps
meeting ([silent-success.md](../reusable/silent-success.md)), since nothing throws and nothing looks
wrong until somebody follows one.

The id is not really destroyed, it is **renamed**, so `retargetAnchors` in
[`src/blocks.ts`](../../src/blocks.ts) renames the references with it: every same-document
`href="#author-id"` becomes `href="#spya-…"`. It has to happen there, because that is the only
moment both names are known at once — one stage-3 run later the author's id is gone from the HTML
for good. `stats.retargeted` counts them, and the pipeline logs the number.

**Every anchor resolves to a block, because a block is all the reading view draws.** Four cases, and
the order they are tried in is the whole content of the rule:

1. The anchor names a block. Itself.
2. The anchor names something that **contains** blocks — `<section id="methods">`, or the nested
   `<ul>` inside an `<li>`. Its first one, because that is where the thing being pointed at begins.
   Wrappers are the case that most looks like it needs no work: their ids survive stage 3 untouched,
   so the link looks healthy in the document — and a wrapper is in nobody's `block.html`, so it is
   not in the rendered page at all and the link is dead on screen.
3. The anchor names something **inside** a block — a footnote span, an emphasised phrase. The block
   containing it, which is the finest thing this view can put under the reader's eye. This has to be
   tried *after* case 2, because a nested list is both inside a block and around one, and the answer
   the link meant is the inner one.
4. The anchor sits **between** blocks — a standalone `<a name="note"></a>`, which is also what a
   named anchor inside a table collapses to once the parser has foster-parented it out. The next
   block after it, which is where a browser would have landed.

Cases 2 and 4 both came out of GPT Sol's review, 2026-08-26.

Two ordering rules on top of that. A document that uses the same name twice — invalid, and ordinary
in CMS output — resolves to the first in document order. And **an `id` always beats an `<a name>`
that claims the same word**, which is the order the HTML spec resolves a fragment in: every id in
the document first, named anchors only after.

**The author's name is read before the sanitiser, not after.** DOMPurify's `SANITIZE_DOM` deletes
any `id` or `name` whose value happens to name a property of `document` or of a form element:
`target`, `title`, `name`, `method`, `action`, `links`, `images`, `forms` and a long tail. Ids like
that are common in real headings, and they are gone before stage 3 has ever seen the element. So
every anchor name is stamped onto its element *before* `sanitizeInPlace` runs, read back
immediately after, and taken off again — the sanitiser re-parses the document, so an attribute is
the only thing that can cross it.

Three details of that, each of which was wrong first:

- **The name goes on the element's first child as well.** The sanitiser deletes an element it does
  not know while keeping the contents, so `<x-section id="methods"><h2>Methods</h2>` loses the
  wrapper — and a name living only there dies with it. When the wrapper survives, both stamps say
  the same thing and the outer one is read first, so the copy changes no answer.
- **The scrub reaches inside `<template>`.** A DOM query does not enter template content: its
  children are a separate fragment, so `querySelectorAll` walks past them while `outerHTML`
  serialises them in full. A stamp the *article itself* shipped in there survived both scrubs and
  reached `blocks.json` — inert, but the invariant said it could not happen, and an invariant that
  is false is worse than one nobody claimed.
- **`<html>` and `<body>` are cleared and never stamped.** They sit outside the subtree the
  sanitiser rewrites, so an attribute there crosses it untouched, which is exactly what a forged one
  would need. The stamps are also read from inside the body rather than from the document.

Two things it deliberately leaves alone, and one it cannot reach:

- **A link that leaves the document.** `#` has to be the first character, so
  `https://example.test/page#section` stays a link to somebody else's page.
- **A fragment nothing answers to.** A dead link stays dead rather than being pointed somewhere
  plausible.
- And the one it cannot: **a page that links to itself the long way round**,
  `href="https://this.article/#section"` or `/article#section`. Those still point at the overwritten
  name. Stage 3 is not told the article's own address, and no page we have ingested does this — see
  [260826af-internal-anchor-links.md](../plans/260826af-internal-anchor-links.md).

On a re-run there is nothing to do: every href already says `#spya-…`, no stamp is written for an id
of ours, and the map comes out empty. It survives a re-extraction too, where the author's ids come
back and ours are carried over by matching text (above).

**The click is then ours, not the browser's.** Left alone, a hash jump puts the target's top edge at
the top of the viewport — behind two sticky bars — and leaves `?at=` claiming the reader never
moved. Every other way of moving through this article goes through `scrollToBlock` and records where
it went, so [`internal-links.ts`](../../src/web/internal-links.ts) resolves the click to a block and
hands it to the same jump a gist, a spine segment and an arrow key use. Anything it cannot resolve
is handed back to the browser untouched. Three kinds of click are deliberately *not* taken over: a
modified one, one on a link asking for its own tab (`target`, compared case-insensitively, because
the keywords are), and one on a link the mouse-up handler has already turned into a question. A
fourth is *stopped* rather than handed back — a click that ends a text selection inside the link.
Merely declining to jump there would leave the browser to follow the fragment natively and throw the
reader away from the passage they had just chosen. ⌘-click lands correctly because an arriving `#spya-…` is rewritten to `?at=` before
React mounts, **overriding any `?at=` that came with it** — a link opened in a new tab carries both,
one saying where you were and one saying where you asked to go ([url-state.md](url-state.md)).

### A gap that predates all of this

An article that ships an `id` in **our** format — `<h2 id="spya-k3m9qt">` — is believed. Stage 3
treats it as an id it minted on a previous run and reuses it, which means a page can name a block id
belonging to somebody else's paragraph and take every comment, search hit and Hierarchy row anchored to
it. Nothing about that is hard to do once you know an id — and ids are printed beside every
paragraph and pasted into links, so **knowing one is not a barrier**. What keeps it narrow today is
that articles are fetched once from addresses a reader chose. It stops being narrow the moment an
article can be refreshed from a source that has changed since, which is a thing we will want. Raised
by GPT Sol's review, 2026-08-26; written down here because the fix is not obvious and nobody should
discover this by accident.

## Showing an id

Ids are on screen in four places: both ends of the block range under a gist, in a table cell and in
a column panel; the same range under each entry of the summary panel; and the ids the model cites
inside a chat answer or a summary. All of them draw
[`BlockRef`](../../src/web/BlockRef.tsx), so they cannot drift apart, and the two that come out of
model prose share [`Cited.tsx`](../../src/web/Cited.tsx) on top of it.

**The fifth place was the gutter beside every paragraph, and since 2026-08-31 it is not text.** The
id there is now a permalink icon, with the id itself in the `title` and in the `aria-label` — so
beside the prose the id is a thing you copy rather than a thing you read
([prose-gutter-icons.md](../plans/prose-gutter-icons.md)). Everything below about *what a shown id
is* still holds; what changed is that one of the five stopped showing characters.

A cited id is drawn as a **chip with a hover card carrying the paragraph itself**, which is the one
thing that makes a model's claim checkable without leaving the sentence you are reading — see
[summaries.md § A summary is a door](summaries.md#a-summary-is-a-door). An id the article does not
have is rendered as plain text rather than a link that goes nowhere: a dead chip is worse than
visible noise, because pressing it does nothing and nothing distinguishes that from a bug in the
scrolling.

**The `spya-` prefix is not shown.** Every id on screen has it, so it costs five characters and
carries nothing. It is still in the `title` attribute and still in the link's address, which is
where anything anybody pastes comes from. The prefix earns its keep in the *data* — it is what makes
"is this id ours?" decidable when stage 3 re-reads a page (above) — not in the reading view.

**An id is a link.** Greg, 2026-08-25:

> make them clickable/right-clickable (e.g. to update the url, open in a new window, copy url, etc)

So it renders a real `<a href>` pointing at this article with `?at=` set to that block, and every
other view parameter carried along — see [url-state.md](url-state.md). The browser then supplies the
rest for free: the status bar shows the destination, right-click offers "copy link address",
⌘-click opens the block in its own tab. A plain left-click is intercepted and handed to the same
jump the gist cells use, because a page load to move down the page you are already on is a waste.

Two things this costs, both deliberate:

- The gutter id used to be `user-select: all`, so one click selected the whole id for pasting into
  a conversation. That cannot coexist with a click that navigates. The context menu now yields the
  *URL* instead, which is the more useful thing, and the id is still selectable by dragging.
- Both ends of a range sit inside a cell whose own handler jumps to the range's **start**, so
  `BlockRef` stops the click from bubbling. Without that, clicking the far end of a range would
  quietly take you to the near end — the click would work, and go to the wrong place.

**The gutter's permalink splits that plain left-click by how it was made**
([`BlockGutter.tsx`](../../src/web/BlockGutter.tsx)): a pointer click copies the absolute URL, and
keyboard activation jumps. It is still an `<a href>`, and it has to be — the element announces itself
as a link, so pressing Enter on it must do what a link does, and every modified click still belongs
to the browser. It jumps through App's `onJump` rather than by navigation, because **this app
intercepts no anchor clicks globally**: an unprevented one would reload the reading view to arrive at
the paragraph already on screen.

Where an id is still drawn as characters, the type is small, faint and Courier (`--font-id` in
[`styles/tokens.css`](../../styles/tokens.css)), at Greg's asking: an id is machine text sitting
beside prose and should read as a footnote to the block, not as part of it. That was also the
argument for taking it out of the gutter — beside a paragraph, a footnote to the block is still a
column of machine text running the length of the article.

## If this ever changes

Changing how ids are assigned invalidates every cached artefact downstream. Bump the pipeline
version and let stale caches be *detectable* rather than silently wrong — never re-number in place.

## See also

- [architecture.md](architecture.md) — where stage 3 sits, and the `blocks.json` shape
- [granularity-zoom.md § The tree](granularity-zoom.md#the-tree) — what is built on top of these ids
- [hierarchy.md](hierarchy.md) — stage 4's tree, whose rows address blocks by id
- [url-state.md](url-state.md) — the `?at=` an id links to, and what else rides in the URL
- [web-client.md](web-client.md) — the reading view these ids are drawn in
- [open-questions.md](open-questions.md) — what is still undecided
