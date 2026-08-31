# Callouts: the boxes an author sets apart from the prose

**Status:** built 2026-08-31.

Greg, 2026-08-31, on [`/read/openai-huggingface`](https://www.spideryarn.com/read/openai-huggingface):

> that original article had lots of quotes (e.g. "Whoa! Shared Artifactory cache is a covert mailbox
> among agents. And there are messages specifically to us?") which were shown as nice quotes in the
> original html, but just get converted to plain blocks in the Spideryarn text. Let's add a new kind
> of block-type for quotes/callouts that display a little differently

## What was actually wrong

Not the styling. `.prose blockquote` has been styled since the type work — 58ch, italic, a left rule
— and a real `<blockquote>` in an article gets it today.

The nine "quotes" in that article are not blockquotes. Substack writes a callout as

```html
<div data-callout="true" class="callout-block"><p><span>Whoa! Shared Artifactory cache …</span></p></div>
```

and **Readability unwraps the `<div>`**, taking `data-callout` and `class` with it. Measured on the
stored `raw.html`: the extracted article contains `0` occurrences of `data-callout`, `0` of
`callout`, and the paragraph arrives as a bare `<p><span>Whoa! …</span></p>` — indistinguishable
from body prose. By stage 3 there is nothing left to recognise.

This is the same shape of problem as footnotes, and it has the same answer
([`src/notes.ts`](../../src/notes.ts), [content-extraction.md](../project/content-extraction.md)):
**stage 2, before Readability**, is the only place that can still see what the author wrote.
`canonicaliseNotes` already sits there for exactly this reason.

## What gets built

### 1. `src/callouts.ts` — a stage-2 pass that stamps, and moves nothing

`canonicaliseCallouts(doc)` runs in `runExtract`, beside `canonicaliseNotes` and after it, before
Readability. For every container it recognises it writes `data-spya-callout=""` onto the container
**and onto every block-level element inside it** — because the container is precisely the thing
Readability is about to delete. The paragraphs survive; the stamp survives on them.

Nothing is moved, rebuilt or re-worded, which is what keeps block ids stable across the change: ids
are carried over by tag + text (`exactKey`, [`src/blocks.ts`](../../src/blocks.ts)), and a stamped
`<p>` has the same tag and the same words as an unstamped one.

**Recognised, and nothing else** — the shapes that are actually in the corpus:

| signal | who writes it |
|---|---|
| `[data-callout]`, `class~="callout"`, `class~="callout-block"` | Substack |
| `class~="admonition"` | gwern, MkDocs, Sphinx |
| `class~="pullquote"`, `class~="pull-quote"` | WordPress themes |
| `class~="theme-admonition"` | Docusaurus, which uses its own token |
| `<aside>` | RFCs (32 editorial notes in rfc9110), and every CMS's sidebar |

Epigraphs are deliberately **not** in that list. gwern's `.epigraph` already wraps a `<blockquote>`,
so it is a quote today and looks like one.

`<aside>` is the one that needs a guard, because half the corpus uses it for a sidebar — and it is
the **only** signal the guard runs on, because a heuristic must not overrule a publisher saying so.
Two tests, both cheap and both measured below: a container whose links account for **more than half
its text** is not a callout, and neither is one that contains a `<nav>`. A same-page fragment link
counts for 0.3 of its length, which is Readability's own weighting — a citation is how an editorial
aside is written. Beyond that we let it through: a sidebar that survives Readability is being
rendered as body prose *today*, and rendering it as a callout is not worse.

### 2. `kind: "callout"`, a seventh block kind

`BlockKind` gains `"callout"`; the CHECK constraint on `revision_blocks.kind` gains it too
(migration `0033`). `describeBlock` sets it **only where the block would otherwise be `"text"`** — a
heading inside a callout stays a heading with its level, a `<blockquote>` inside one stays a quote,
a figure stays media. The tree depends on those and none of them is this feature's business.

Callouts are `gistable: true` — they are the author's own words about the argument — except where
the existing pull-quote rule already fires, which now covers callouts as well as quotes: a callout
repeating a sentence that is in the body verbatim is a pull-quote whatever the class said.

No policy predicate in [`src/block-policy.ts`](../../src/block-policy.ts) reads `kind`, so nothing
about search, embedding, the ToC or the reading clock changes. One other place does read it, and the
review had to find it: `proseOf` in [`src/vocabulary.ts`](../../src/vocabulary.ts) — see below.

### 3. The look: an indented block under a big faint quote mark

Greg picked it from three sketches, 2026-08-31: *"big faint mark in the gutter, indented text, no
bar"*. So a callout is **not** a second thing with a left rule, which is what a quotation already
is.

`TableView` already writes `kind-${block.kind}` onto the `<td>` for every block, so this is
stylesheet-only.

A multi-paragraph callout gets the mark on each of its paragraphs. That is the printer's convention
for a quotation running over several paragraphs — open on each, close on the last — and it is also
the only thing available: each paragraph is its own block, on its own row, and CSS cannot ask
whether the row above belongs to the same callout.

### 4. Captions, while we are here

`kind: "caption"` has existed since the splitter was written — a `Figure 3: …` paragraph sitting
*beside* a figure rather than inside it — and **nothing has ever styled it**. `.prose figcaption`
covers only real `<figcaption>` elements. So a caption block renders as ordinary prose at the body
measure. Same treatment as a figcaption: 48ch, smaller, fainter.

## Measured

Run over the stored `raw.html` of `openai-huggingface`, stage 2 then stage 3:

| | |
|---|---|
| callout containers recognised | **9** (all Substack's `callout-block`), 18 elements stamped, 0 skipped by the nav guard |
| blocks | 95 — `text: 81`, `callout: 9`, `quote: 4`, `heading: 1` (was `text: 90`) |
| ids | **94 carried over, 1 minted** — and the one is an **empty `<p>`**, which has no carry-over key at all (no text, nothing to point at) and is therefore re-minted on every stage-3 run, with or without this change. Worth knowing separately: `tree.json` had that id in a range, so a stage-3 re-run without the stage-4 re-run that normally follows it leaves the tree pointing at a block that no longer exists. |
| gistable | 94 of 95 |

**Over the sixteen extraction fixtures, nothing changes at all, and that is not a
result — it is a limit.** rfc9110 has 32 editorial `<aside>`s and gwern 3 admonitions; stage 2
stamps all 35 and **Readability discards every one of them before stage 3 runs**, so not a single
fixture produces a callout block. The nav guard rejects all four sidebars in the corpus — MDN's two layout rails,
Cornell's sponsor panel, the constitution site's — which is the only thing the corpus does prove,
and it took a fix to make true (below). What is proved end to
end is Substack's shape, on the article above and in tests/callouts.test.ts.

### Three things found by measuring rather than by reading

**The navigation guard did not work, and the corpus is what said so.** cornell.html's
`<aside id="supersizeme">` — four links, two ad slots, a `<h2>` — went through it and got all 21 of
its elements stamped. `textContent` counts the source of every `<script>` inside an element, and
that sidebar carries about 1,200 characters of `googletag` and `addthis` configuration, which put
its measured link density well under a half. `linkDensity` now strips `script`, `style`, `noscript`
and `template` before measuring. After the fix the four sidebars in the corpus (MDN's two, Cornell's,
the constitution site's) are all rejected and rfc9110's 32 editorial asides and gwern's 3
admonitions are all still recognised. tests/callouts.test.ts holds it, and it was watched going red.


**Every callout came back `gistable: false` on the first run** — nine of nine — because the
pull-quote rule compares a block's first sixty characters against "the prose", and the prose corpus
is *every `<p>` outside a figure or blockquote*, which includes the callout itself. It was finding
each callout in itself. `[data-spya-callout]` is now in that selector's exclusion list
([`src/blocks.ts`](../../src/blocks.ts) § `proseText`). Nothing would have thrown: the callouts
would simply never have had a gist or a ToC row.

**The caption rule had to move below `td.text.opaque`.** A caption is `gistable: false`, so it
already carries `.opaque`, which sets `.prose { font-size: 0.95rem }` — exactly the same specificity
as `td.text.kind-caption .prose`, which leaves source order silently deciding the size. Confirmed in
the browser afterwards: 13.6px, which is the caption rule's 0.85rem and not `.opaque`'s 0.95.

### Seen in a browser

`preview-callout.html` (+ `src/web/preview-callout.tsx`, `src/web/preview-callout-fixture.json`)
mounts the real `TableView` on twenty real blocks from that article — prose, single callouts, a run
of four, two real quotations and one synthetic caption — outside the auth gate, at 860px and 390px.
It is throwaway; delete all three when the check is done.

Computed at 860px: body prose 17px `--ink` on a 65ch measure; a callout 17px `--ink-soft`, 58ch,
indented 38.4px, with a 67px mark at 34% opacity; a caption 13.6px `--ink-faint` on 48ch. Three
treatments, told apart at a glance, and the quotation keeps the only left rule in the column.

## What the review changed

[GPT Sol's review of the built code](callout-blocks-review-sol.md), 2026-08-31, found one
high-severity silent failure and four smaller ones. All six are fixed, and each fix was watched going
red against the code as it stood.

1. **High — a callout of loose text was silently ordinary prose.**
   `<div class="callout">Loose words.</div>` has no element to stamp but the `<div>`, and Readability
   deletes the `<div>` and then builds a *fresh* `<p>` from the text — with none of our attributes on
   it. Same for a container whose only child is a `<span>`, since stage 3 asks `closest` and never
   looks *inside* a block. `wrapLooseRuns` now wraps each contiguous run of loose content in a `<p>`
   of our own before stamping, which is what Readability would have done a step later, so it costs no
   ids.
2. **Medium — the guard was overruling publishers.** `isNavigation` ran on every match, so
   `<div data-callout><p><a href="/warning">Read this warning</a></p></div>` — link density 1 — was
   thrown away. It now runs on `<aside>` alone, the one signal that does not mean what it says. And
   link density now weights a same-page fragment link at 0.3, which is Readability's own coefficient
   and not a number of ours: `See <a href="#section-4">Section 4</a>` is how an RFC's editorial aside
   is written, and counting it in full rejected exactly the asides this pass is for.
3. **Medium — the new kind fell out of the dictation vocabulary.** `proseOf` in
   [`src/vocabulary.ts`](../../src/vocabulary.ts) takes `kind === "text"` and says in its own comment
   that a kind invented later has to be let in on purpose. It was not. On the article this was built
   for, "PHASEONE10841" and "Persistent-Astra" are said almost entirely inside callouts, so dictation
   would have lost those words on exactly the articles where they matter. **This also falsifies what
   this plan said earlier** — that nothing downstream reads `kind`. `src/block-policy.ts` does not;
   `src/vocabulary.ts` does.
4. **Medium — Docusaurus writes `theme-admonition`**, not `admonition`, and `~=` matches whole
   tokens. Added.
5. **Low — the indent and the mark were physically left-sided.** Now `padding-inline-start` and
   `inset-inline-start`, so an RTL article keeps them on the side its text starts from.
6. **Minor — the migration comment said a late migration fails "row by row".** It does not: blocks
   are written in one batched statement inside a transaction, so the failure is loud and total and
   `npm run deploy` migrates before it pushes code anyway.

### And one the review's own fix uncovered

Once the guard stopped applying to declared signals, **`[role="note"]` started letting Wikipedia's
hatnotes through** — `<div role="note" class="hatnote">Main article: Seq2seq § History</div>`, seven
of them on the *Transformer* fixture, every one of them navigation. The density guard catches six and
keeps "Further information: Word embedding", whose link is 41% of its text. So the **signal was
dropped rather than the guard bent**: `role="note"` looks like the one piece of hand-written ARIA
that would mean this, and the corpus says its biggest real user means the opposite. A test holds it,
so putting it back is a decision rather than an oversight.

**After all of that: 0 false positives across the sixteen fixtures** — four sidebars rejected,
rfc9110's 32 asides and gwern's 3 admonitions still recognised (and still discarded by Readability),
the article's 9 callouts unchanged, 94 of 95 ids carried.

### What the review argued and did not win

- **A separate `presentation?: "callout"` field rather than a seventh `kind`.** Sol's point is fair —
  a heading inside a callout keeps `kind: "heading"` and therefore loses the callout's setting
  entirely. For the shape this exists for (a paragraph in a box) `kind` is adequate, and it is the
  axis Greg asked for. Revisit it if a real article turns up with a heading inside a callout.
- **`open-quote` instead of a literal `“`.** It would give locale-specific marks, and it would also
  make the glyph depend on a `quotes` property nothing else in this app sets. Left alone.

## What this does not do

**Existing articles do not change until they are re-extracted.** The stamp is written at stage 2, so
every article already in the library carries `kind: "text"` on its callouts until stage 2 runs over
its stored `raw.html` again. Ids survive that (see above), so it is safe — but it is Greg's to run
against production, and the migration has to land first.

Footnote and supplement blocks are left alone: `treatment: "supplement"` is the in-flight footnotes
work ([footnotes.md](footnotes.md)) and styling it belongs with that.

## The shape this is the second instance of

Greg, seeing the sentence that documents the stamp: *"I wonder if there's a long-term-better/cleaner
way to do this?"* The answer is in
[stage2-stamps-design-sol.md](stage2-stamps-design-sol.md) (the question is
[stage2-stamps-design-prompt.md](stage2-stamps-design-prompt.md)), and nothing here has been rewritten
off the back of it. Two things from it are worth having in front of you before the *third* feature
needs to carry evidence past Readability:

- **`"callout"` should be the last contextual `kind`.** `kind` is the block's own form and the tree
  is built from it; a box drawn *around* blocks is a different axis, which is why a heading inside a
  callout has to keep `kind: "heading"` and therefore silently loses the box. The next one of these
  wants a **context**: a group with an id and members, over blocks, addressed by block id and never
  by its own.
- **Most of the features that look like they will need a stamp do not.** Tables, definition lists,
  figures, `lang`, `dir`, `<mark>`, `<ins>`/`<del>` all survive Readability as native markup; they
  need the sanitiser and the splitter taught, not a new reserved attribute. The bridge is only for
  evidence Readability demonstrably destroys, which is a much shorter list than it looked.
