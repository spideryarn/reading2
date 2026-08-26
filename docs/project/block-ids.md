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

So stage 3 also **carries ids over from the previous `blocks.json`** when one exists, matching a new
block to an old one by its text. A paragraph keeps its id as long as its words are unchanged, no
matter how far it has moved. Blocks with no text — images, figures — match on their `src` instead,
so a ToC row aimed at a diagram doesn't go stale. Each previous id is consumed once, so a page with
several identical short paragraphs cannot hand the same id to two blocks.

### Two passes, and the second one refuses to guess

```
  pass 1   the tag + the text exactly as written (or, with no text, the src)  → keep the id
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
[pdf-ingestion.md](../plans/pdf-ingestion.md). And an id already in the document is trusted, except
that a *duplicate* of one is not: the second element carrying it mints, because two blocks with one
id corrupts every artefact keyed on it.

Until 2026-08-26 there was one pass, the fold deleted every character outside `a-z0-9`, and an
ambiguous bucket was handed out first-come. In English that stripped punctuation; in Cyrillic, Greek,
Chinese, Arabic or Devanagari it stripped the paragraph, and two of its five failure modes dropped
paragraphs from the article outright while reporting success. The cause, the measured blast radius
and the fix are in [the postmortem](../postmortems/block-id-matching-non-latin.md).

Measured on the test article, re-extracted *and* with a new paragraph inserted above everything:
**138 of 139 ids survive.** The one casualty is an `<hr>`, which has neither text nor a `src` to
match on and which nobody annotates.

**A PDF re-read costs more than a web page re-extraction, and it is measured.** Re-running stage 2 on
the *same PDF with the same model and the same prompt*, then stage 3, keeps **32 of 43 ids and mints
11**. Readability run twice over the same HTML produces the same paragraphs; a model run twice over
the same page produces one more record than last time and a comma in a different place. The matcher
is doing exactly what it says here — refusing to guess when the words have changed — and the cost is
real. What to do about it is being decided in
[pdf-ingestion.md § What a re-read costs](../plans/pdf-ingestion.md#what-a-re-read-costs-measured-11-block-ids-of-43),
and it wants deciding before anything a reader owns is anchored to an id.

Two honest limits:

- **An edited paragraph gets a new id** and loses whatever was anchored to it. We cannot distinguish
  a heavily rewritten paragraph from a new one, and guessing with fuzzy matching would silently
  attach a reader's note to a sentence that no longer says what they annotated. Losing the anchor is
  the safer failure.
- **Carry-over needs the previous `blocks.json`.** Delete it and the ids are gone for good. It is a
  source artefact, not a cache; `data/<slug>/blocks.json` should be treated as precious.

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
matters to the ToC.

Some blocks get an id but never get a gist (`gistable: false`): images, horizontal rules, and
pull-quotes that repeat body text verbatim. They stay addressable — the ToC may well want to point
at a diagram — they simply must not generate a row of their own. On the test article all 11
pull-quotes are word-for-word repeats of body sentences, so without this the ToC would grow eleven
phantom rows quoting text it had already listed.

## The article's own links

Stage 3 does not only *add* an id. Where the author already put one on a paragraph or a heading, it
**overwrites** it — a block can only have one id, and everything here addresses text by ours.

That quietly broke a link the reader can see. A published page often points at its own sections, and
the Anthropic constitution has five, "see the section on
[how we think about corrigibility](https://www.anthropic.com/constitution) for more on this" among
them. Those are `<a href="#how-we-think-about-corrigibility">`, aimed at an `id` the author put on a
heading. The sanitiser has no reason to touch the link, so it arrived in the reading view intact and
pointing at a fragment that existed nowhere in the document. Clicking it put the fragment in the
address bar and moved the page not at all — the shape of failure this project keeps meeting
([silent-success.md](../reusable/silent-success.md)), since nothing throws and nothing looks wrong
until somebody follows one.

The id is not really destroyed, it is **renamed**, so `retargetAnchors` in
[`src/blocks.ts`](../../src/blocks.ts) renames the references with it: every `href="#author-id"` in
the document becomes `href="#spya-…"`. It has to happen there, because that is the only moment both
names are known at once — one stage-3 run later the author's id is gone from the HTML for good.
`stats.retargeted` counts them, and the pipeline logs it.

Four things it deliberately leaves alone, and one it cannot reach:

- **A link out to the web** that happens to carry a fragment. `#` has to be the first character.
- **A fragment that was never a block's id** — a footnote span, a `<section>` wrapper. Only block
  elements are restamped, so those ids are still in the document and those links still resolve.
- **A fragment nothing answers to.** A dead link stays dead rather than being pointed somewhere
  plausible.
- **Anything on a re-run**, where every href already says `#spya-…` and there is nothing left to
  rename. Idempotent, like the rest of the stage — including across a re-extraction, where the
  author's ids come back and ours are carried over by matching text (above).
- And the one it cannot: **an id DOMPurify deleted before we ever saw it.** Its `SANITIZE_DOM` drops
  any `id` naming a property of `document` or of a form element — `target`, `title`, `name`,
  `method`, `action`, `links`, `images`, `forms`. A link to `#target` therefore stays dead, as it
  would have in a browser, for want of anything left to rename it to.

**The click is then ours, not the browser's.** Left alone, a hash jump puts the target's top edge at
the top of the viewport — behind two sticky bars — and leaves `?at=` claiming the reader never
moved. Every other way of moving through this article goes through `scrollToBlock` and records where
it went, so [`internal-links.ts`](../../src/web/internal-links.ts) resolves the click to a block and
hands it to the same jump a gist, a spine segment and an arrow key use. A fragment smaller than a
block resolves to the row containing it, which is the finest thing this view can put under the
reader's eye; anything it cannot resolve is handed back to the browser untouched. ⌘-click still
opens a tab, and lands correctly, because an arriving `#spya-…` is rewritten to `?at=` before React
mounts ([url-state.md](url-state.md)).

## Showing an id

Ids are on screen in five places: the gutter beside every paragraph; both ends of the block range
under a gist, in a table cell and in a column panel; and — since 2026-08-26 — the same range under
each entry of the summary panel, plus the ids the model cites inside a chat answer or a summary. All
of them draw [`BlockRef`](../../src/web/BlockRef.tsx), so they cannot drift apart, and the two that
come out of model prose share [`Cited.tsx`](../../src/web/Cited.tsx) on top of it.

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

The type is small, faint and Courier (`--font-id` in
[`styles/tokens.css`](../../styles/tokens.css)), at Greg's asking: an id is machine text sitting
beside prose and should read as a footnote to the block, not as part of it.

## If this ever changes

Changing how ids are assigned invalidates every cached artefact downstream. Bump the pipeline
version and let stale caches be *detectable* rather than silently wrong — never re-number in place.

## See also

- [architecture.md](architecture.md) — where stage 3 sits, and the `blocks.json` shape
- [granularity-zoom.md § The tree](granularity-zoom.md#the-tree) — what is built on top of these ids
- [table-of-contents.md](table-of-contents.md) — the ToC that addresses blocks by id
- [url-state.md](url-state.md) — the `?at=` an id links to, and what else rides in the URL
- [web-client.md](web-client.md) — the reading view these ids are drawn in
- [open-questions.md](open-questions.md) — what is still undecided
