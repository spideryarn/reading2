# Footnotes and bibliographies

**Status: plan, unbuilt, revised once.** Written 2026-08-28 after a GPT Sol design consultation
([footnotes-prompt.md](footnotes-prompt.md) → [footnotes-sol.md](footnotes-sol.md)), then reviewed
and revised ([footnotes-review-prompt.md](footnotes-review-prompt.md) →
[footnotes-review-sol.md](footnotes-review-sol.md), verdict **REVISE BEFORE IMPLEMENTATION**).

What the review changed, so the reasoning survives:

- **A note is a *range* of blocks, not a block.** Measured: Substack gives two blocks per note. So
  "40 notes" and "40 note blocks" are different numbers, and previews, back-links and counts all
  need a note identity. This was missing entirely.
- **Role must be two closed axes, not one closed set**, or Acknowledgments and Appendices have
  nowhere to go.
- **Reclassification does not invalidate a single cached artefact.** `hashBlocks` fingerprints
  `id` and `text` only; `structureHash` omits any new node field. Assigning roles changes no text,
  so summaries, ideas, glossary, tweets, vectors and similarity would all go on reporting themselves
  current. This is the worst finding in the review and neither earlier reviewer saw it.
- **Tufte must be canonicalised before Readability**, not at stage 4 — by stage 3 the mechanism is
  already gone.
- **Fable's fisheye claim was wrong**; see [The fisheye](#the-fisheye) for what actually happens.
- **Stages 2 and 3 were not independently shippable.** Restructured.

The shape in one line: **a footnote is a normal block with a stable id, in a section at the end,
present in the structure and absent from the argument.**

## What Greg asked for

> Let's think about footnotes. How should we represent them? Include them in their own section at
> the end, with anchor links in the doc to them (with nice tool-tip previews), and some kind of
> special annotation to indicate that they're footnotes?
>
> — Greg, 2026-08-28

And on the question this plan turns on, once the options were on the table — whether a notes section
belongs in the table of contents and the granularity-zoom tree at all:

> This all sounds sensible. But add tooltips to indicate when things are being excluded. I've said
> to keep it in the ToC, but I'm not certain about that. I feel there should be a way to see it in
> the structure of the doc (e.g. in the Spine, so that I could jump to the Footnotes), but we don't
> necessarily need to summarise and include it in the argument etc. Try and get the best of both
> worlds.
>
> — Greg, 2026-08-28

And on PDFs, where footnotes and bibliographies are transcribed today and then deliberately thrown
away:

> In an ideal world, we'd treat footnotes and bibliography pretty similarly (e.g. hover/panel, with
> anchor link to take you to the section, visible in the Spine etc, but skipped by some of the LLM
> processing where it makes sense to do so). So probably we should keep them as part of the PDF
> import process, but annotate them so that by the time everything's imported (whether from PDF or
> HTML) it ends up reusing the same machinery.
>
> — Greg, 2026-08-28

That last sentence is the design brief for the whole plan: **one representation, reached by two
extractors**, exactly as `article.html` already is ([content-extraction.md](../project/content-extraction.md#two-extractors-one-artefact)).

## What is actually there

Measured 2026-08-28, before designing anything, because "how much does this feature matter" is a
question with an answer — the same discipline [links.md](../project/links.md#what-is-actually-in-an-article)
applied to hyperlinks.

**The shelf has no footnotes at all.** The three web articles in `data/` contain zero `<sup>`
elements and no footnote markup. The PDF transcriptions contain zero records typed `footnote`:

| slug | records | words | `footnote` | `reference` |
|---|---|---|---|---|
| ball-lightning | 174 | 11,440 | **0** | 64 records / 1,329 words (12%) |
| coolabah-memory | 60 | 3,392 | **0** | 13 / 252 |
| fowler-phrenology | 87 | 8,782 | **0** | 0 |
| revistes-ub-30977 | 121 | 6,784 | **0** | 26 / 504 |
| source, source-2 | 60, 61 | 3,392 | **0** | 13, 14 / 252 |

Two cautions about that table, both from GPT Sol and both checked:

- **There are three distinct PDFs, not six.** `coolabah-memory`, `revistes-ub-30977`, `source` and
  `source-2` are the same file — one sha256 across all four. So the sample is ball-lightning,
  fowler-phrenology and the Coolabah paper.
- **Six zeroes cannot distinguish "no footnotes present" from "detector broken."** The check that
  can is a known positive: `data/Nagel_Bat.pdf` has numbered footnotes, and running only those pages
  through the current transcription prompt and asserting the records come back typed `footnote`
  tests the detector rather than the corpus.

**But the fixtures for this feature are already in the repo**, captured this morning for the
Readability work ([readability-repair-pass.md](readability-repair-pass.md)). Raw markup, before
extraction:

| fixture | `<sup>` | footnote-ish class | `href="#cite_note…"` etc. |
|---|---|---|---|
| `wiki_transformer.html` | 173 | 343 | 170 |
| `gwern.html` | 70 | 69 | 68 |
| `ar5iv.html` | 18 | 9 | 0 |
| `tufte.html` | 0 | 7 | 0 |
| `gutenberg.html` | 3 | 1 | 0 |
| the other ten | 0 | 0 | 0 |

So the corpus this feature is *for* exists as eval fixtures — and the question of what survives
Readability has now been **measured** rather than assumed, by running the real `runExtract` and
`splitIntoBlocks` over them:

| fixture | markers | survives stage 2 | notes container | marker → note |
|---|---|---|---|---|
| `gwern.html` | 34 footnote refs | 100%, structure intact | `<ol>` of `<li id="fnN">` | **34/34 resolve to the right block** |
| `wiki_transformer.html` | 170 real markers (3 `<sup>` are not footnotes) | 100% | Parsoid reference list, intact | **170/170 resolve** |
| `ar5iv.html` | 18 `<sup>` | survives — but it is **not a footnote system** | none | n/a |
| `tufte.html` | 0 `<sup>`; `<label>` + `<input>` + `<span class="sidenote">` | **numbering deleted, note text survives as unmarked body prose** | none | n/a |
| `gutenberg.html` | 3 `<sup>` are "Mr." abbreviations | n/a | n/a | n/a |

**The headline is that the chain already works** for the two shapes that matter. The reading of the
code in the next section is confirmed by measurement: markers resolve to the correct note block,
end-to-end, with no new plumbing. A Wikipedia citation reused thirteen times resolves from all
thirteen points of use.

**But the two shapes are structurally opposite**, which is the trap for a naive marker detector:

```html
<!-- gwern: the anchor wraps the sup -->
<a href="#fn1" id="fnref1" role="doc-noteref"><sup>1</sup></a>

<!-- wikipedia: the sup wraps the anchor -->
<sup id="cite_ref-…-1"><a href="#cite_note-…-1"><span>[<span>1</span>]</span></a></sup>
```

A rule of "an `<a>` inside a `<sup>`" gets Wikipedia right and Gwern wrong, and vice versa — which is
a second, independent reason to key the marker off **what it targets** (a block with
`role: "footnote"`) rather than off its own tag.

**Wikipedia's back-links are plural, and by a lot.** A note item opens with a run of numbered
back-links, one per place the citation is used — up to thirteen on a single note in this fixture.
Fable's "back-links plural, not singular" is not a hypothetical.

**Two fixtures are not footnote systems and must not be treated as tests of one.** `ar5iv` is
LaTeXML's shared author note ("equal contribution"), rendered fully inline with no id/href pair at
all; `gutenberg`'s three superscripts are abbreviation marks. Both nonetheless report a healthy
`stats.retargeted` — 85 and 162 — from figure, section and chapter cross-references that have nothing
to do with footnotes. **`retargeted > 0` is therefore not evidence that footnotes work**, and it is
exactly the shape of check that would have been believed.

### Tufte's sidenotes are broken by our own sanitiser, today

Worth separating out, because it is a live content-integrity bug rather than a footnote-design
question. Tufte CSS builds a sidenote from `<label>` + `<input type="checkbox">` +
`<span class="sidenote">`. Both `label` and `input` are in `ARTICLE_CONFIG.FORBID_TAGS`
([`sanitize-policy.ts:168`](../../src/sanitize-policy.ts)), so the numbering mechanism is deleted;
Readability's `keepClasses: false` then takes the `sidenote` class off the span.

What reaches the reader is the note's text sitting **mid-sentence, unmarked, indistinguishable from
the author's body prose**. Not lost — worse than lost, in the sense that matters here: silently
reclassified as argument. Nothing reports it. A sidenote-bearing article on the shelf today would
read as though the author had written asides into the middle of their own sentences.

Removing `label`/`input` from the forbidden list is not the fix — they are forbidden for good reason
([security.md](../project/security.md)).

**And the fix cannot live in stage 3 either**, which the first version of this plan got wrong.
`runExtract` runs Readability *and sanitises its output* before `splitIntoBlocks` ever sees the
document ([`extract.ts`](../../src/extract.ts)), so by stage 3 the `<input>`, the `<label>` and the
identifying class are all already gone. The analogy to `stampAuthorAnchors` running before stage 3's
sanitiser does not hold: that one is early enough, this one would not be.

So Tufte has to be **recognised and canonicalised before Readability**, and rewritten into the
ordinary marker-and-note structure, which then passes through sanitisation like anything else.

**The security rule for doing that**, because reading the raw DOM before sanitising is exactly where
care is owed. Reading is not the danger; *carrying* is. A hostile article could forge any reserved
`data-*` stamp and so get arbitrary body prose hidden from summaries, or dressed up as trusted
apparatus — a content-integrity failure, and a worse one if any UI later treats a stamp as trusted
markup. Therefore: scrub reserved attributes on the way in, mint only fixed enum values and fresh
ids, build with DOM APIs rather than string concatenation, never copy a raw attribute or raw HTML
across, and pass the rewritten subtree through the normal sanitiser. `<label>` and `<input>` are
never admitted.

## The representation

**Two orthogonal closed axes, not a new `BlockKind` and not one closed set.**

```ts
interface Block {
  // …existing fields
  /** What this text is. Absent means ordinary article content. */
  role?: "footnote" | "reference" | "acknowledgment" | "credit" | "appendix";
  /** How the argument machinery must treat it. Absent means "body". */
  treatment?: "supplement";
  /** Which note this block belongs to — see "A note is a range" below. */
  noteId?: string;
}
```

One closed set cannot express the plan's own position that Acknowledgments and image credits are
supplements while an **Appendix may be real prose worth gisting**. Two axes can: the appendix gets
`role: "appendix"` and is then classified `body` or `supplement` **from its content**, never from its
heading. An open string is the wrong fix — an unrecognised value would silently receive inconsistent
policy at each of the consumers below, which is the failure mode this whole section exists to avoid.

### A note is a range of blocks, not a block

The measurement above is the proof: Substack yields **two blocks per note** — the digit and the
prose. Gwern can yield more, because `ownContent` ([`blocks.ts:136`](../../src/blocks.ts))
deliberately removes nested list content when building a parent block, so a note containing a list is
split across blocks too.

Three quantities that a naive implementation would conflate, and which give three different numbers:

- how many **markers** are in the prose (Wikipedia: one note is marked thirteen times)
- how many **role-bearing blocks** exist
- how many **notes** there actually are

"Notes · 40" must be the third. A marker must resolve to a note's **first** block and a preview must
show the note's **whole** range — today's hover resolves one block and clips it
([`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx)). Without a note identity, the
count is wrong, the preview is truncated mid-note, and plural back-links have nothing to hang off.

GPT Sol's correction, and it is right: `kind` is structural presentation — a Notes heading is still a
heading, a note containing a quotation is still a quote. Overloading `kind` would force every
existing `kind === "heading"` test to learn about footnotes.

**Not a `notes[]` sidecar.** Comments, search hits, chat citations, deep links, scroll position and
sanitisation all already work on blocks addressed by id. A second kind of text means a second code
path through every one of them, and the second path is the one that rots.

**The cost, stated up front:** 22 source files and one migration mention `gistable`, its nearest
sibling — schema, insert column lists, and hand-written select projections in `pg.ts`,
`pg-revisions.ts`, `artifacts-pg.ts`, `public-reader.ts`, `export.ts`, `import.ts`, `public/dto.ts`.
A new block field is spelled out by hand in each. Any one of them omitting `role` gives a filesystem
store that carries it and a Postgres store that quietly does not — which `tests/store-parity.test.ts`
is the existing defence against, and which must be extended in the same stage.

## `gistable: false` is not the switch

The candidate design assumed `gistable: false` means "in the document, out of the machinery". It does
not, and it is closer to the opposite of the intended policy. Verified today:

| consumer | what `gistable: false` does |
|---|---|
| `library-search.ts:217`, `chat-tools.ts:537` | **skips the block** — a note would be unsearchable |
| `article-prompt.ts:99` | **includes every block regardless** — so summaries, arc, glossary, ideas and chat all read notes anyway |
| `labels.ts`, `toc.ts` | no nav label, no gist |
| `article-vectors.ts:210` | not embedded |
| `library-scalars.ts:87`, `web/stats.ts:33` | **counted in words and reading time regardless** |

So setting `gistable: false` on notes gives exactly what Greg did *not* ask for: notes hidden from
search, present in every model prompt, and still inflating the clock.

**The fix is named predicates over `role`, not one Boolean asked to mean four things:**

```
isSearchable(block)             yes  — a note is often the best sentence in a piece
isBodyEvidence(block)           no   — summaries, arc, ideas, glossary, tweets
isEmbeddable(block)             no   — similarity and the diagram
countsTowardReadingTime(block)  no   — word count, reading time, reading progress
isStructural(block)             no   — tree rows, nav labels, part/section counts
```

Five, not four. The fifth axis — **structural and navigational treatment** — was missing, and
`isBodyProse` was the wrong name for the fourth: notes *are* prose, and the policy being stated is
about the clock.

**The consumer list is longer than it looks**, and every one of these was found by reading the code
rather than by reasoning about it:

| consumer | why it needs saying separately |
|---|---|
| `summarise.ts` `textOf` | builds text by **slicing `blocks` over a node's range**, filtering only on `b.text` — so a root extended over supplements includes every note, whatever `article-prompt` does |
| `tweets.ts` | consumes whole-article text; was not on the original list at all |
| `similar.ts:198` | has its **own** `gistable` filter, separate from `article-vectors.ts` |
| `pg-shelf.ts:222` | hard-codes `gistable = true` **in SQL** — outside any TypeScript predicate, so a predicate refactor cannot reach it |
| `graph.ts:322` | reads structural blocks for diagram terms even once anchor edges are excluded |
| `library-scalars.ts:73`, `web/stats.ts:33` | count every shallow tree child, so supplements would be reported as "parts" and "sections" |
| `article-prompt.ts` `articleWithIds` | shared by search, explain and conversation — **must not** filter, or notes vanish from questions a reader explicitly asks |

That last row is the one to be careful about: the right policy is not "notes are hidden from models",
it is "notes are hidden from **automatic** model work and visible to **asked** model work".

Each predicate needs a **negative sentinel** in its tests — a fixture where it must return false —
or a predicate that returns true for everything passes every test written the obvious way.

### Reclassification must invalidate the caches

The finding that would have cost the most, and the one no earlier review caught.

`hashBlocks` fingerprints `Pick<Block, "id" | "text">`
([`source-hash.ts:47`](../../src/source-hash.ts)); `structureHash` walks each node's id, parent,
range, title and gist ([`source-hash.ts:81`](../../src/source-hash.ts)). **Assigning a role changes
no text and no range.** So the day roles land, every summary, idea, glossary entry, tweet thread,
vector set and similarity artefact computed *before* the split keeps reporting itself current — the
article's summary still silently written over its own bibliography, and every freshness check
agreeing that nothing needs redoing.

So `role` and `treatment` must participate in `hashBlocks`, and the node's role in `structureHash`,
or every affected artefact needs an explicit recipe-version bump. This belongs in the same stage as
the field, not after it.

## The tree: present in the structure, absent from the argument

This is Greg's "best of both worlds", and the tree's invariants decide most of it. Verified in
[`src/tree-invariants.ts`](../../src/tree-invariants.ts):

- the root's range must span the complete `blocks` array, index 0 to `length - 1`
- every block must be covered by exactly one leaf
- a leaf spans exactly one block and carries no gist
- every internal node must carry a gist

So **"notes live outside the tree" is not available**, and neither is one leaf covering forty notes.
Which is fortunate, because Greg's instinct — that there should be a way to see the notes in the
structure and jump to them — is the thing the invariants were already going to force.

The design is a **supplement node**: one internal node covering the whole notes range, with an
authored title rather than a generated gist, and ordinary one-block leaves beneath it.

```
   root  ─────────────────────────────────────────────────────
     ├── part 1   (gist: generated)
     ├── part 2   (gist: generated)
     ├── part 3   (gist: generated)
     └── Notes    ← supplement: authored title, NO generated gist
           ├── leaf: note 1
           ├── leaf: note 2
           └── …
```

`TreeNode` gains an explicit `role: "supplement"`.

**The validator's exception must be stated in both directions**, and this is Fable's amendment
rather than a tidy-up: *an internal node must carry a gist unless its role is supplement, and a
supplement must not carry one.* Keyed on the absence of a gist alone, a pipeline bug that drops a
gist becomes indistinguishable from a deliberate supplement — the precise silent-acceptance shape
[`tree-invariants.ts`](../../src/tree-invariants.ts) already warns about, where the dangerous
outcome is acceptance rather than rejection. Never infer the role from a missing gist.

**But two directions is not enough**, and the review is right about why: as stated, a malformed body
node could escape the every-internal-node-needs-a-gist rule simply by calling itself a supplement.
The exception has to be paid for with six checks, not one. A supplement node must:

1. be a depth-one child of the root
2. cover exactly one contiguous range
3. contain **only** blocks whose `treatment` is `supplement`
4. contain **every** such block exactly once
5. have only leaves beneath it
6. carry no gist, and never be nested or be the root

Each of those is a separate mutation test. "Delete the supplement and watch the tree validator fail"
mostly re-tests the old coverage invariant and proves nothing about any of these.

**The body tree is generated from body blocks only, and the supplement node is appended
mechanically afterwards, extending the root's range.** That ordering is load-bearing: it is what
makes it impossible for a part gist or the root gist to accidentally summarise a footnote. Today the
ToC model is shown every block's text regardless of `gistable` ([`toc.ts:75`](../../src/toc.ts)). The
gist-composition pass is the one that matters — parents are written from their children's gists, so
the root's must never see "Notes".

**Two supplement nodes, not one**, where the source has both. Partly because it is not really a
choice — authored headings are hard boundaries and the structure prompt already refuses to merge
across them — and partly because they answer different reader errands: *what is behind this claim*
versus *what do I read next*. A merged "Apparatus · 104" answers neither.

And the role is **assigned by what the section is, not by matching its title**. Notes, References,
Acknowledgments and image credits are all supplements; an Appendix can be real prose worth gisting.
Citation-shaped versus essay-shaped is a stage 3/4 judgement, and a title regex would get the
Appendix wrong in the direction that silently deletes an argument from the tree.

### What the reader sees

Fable's call, and it is the answer to "present in the structure, absent from the argument": **the
supplement row is dressed as chrome, not as prose.** The view already encodes what-kind-of-thing-is-this
in type — a gist is set in the reading face because it stands *in place of* prose, a nav label is
chrome. "Notes · 40" is a label *about* the article rather than a compression *of* it, so it must not
dress as a gist. A reader who has learned the column's grammar reads the difference without being
told, which is most of what the tooltips would otherwise have to say.

The spine is where this earns its keep, because it fixes a real reading complaint: **on a heavily
noted piece the scrollbar lies.** You are "60% through" and the piece ends there, because the rest is
apparatus. Dim the supplement bands while keeping their true proportional height — the rail must not
lie about pixels either — and the spine starts answering *how much argument is left*.

```
 spine        coarse columns
┌────┐   ┌──────────┬──────────────────────────────┐
│████│   │ arc      │ parts (L1)                   │
│████│   │ "Brains  │ "Leaving Turing world drags  │
│▓▓▓▓│   │  are not │  the substrate back…"        │
│▓▓▓▓│   │  Turing  ├──────────────────────────────┤
│────│◄──│  machines│  …                           │
│░░░░│   │  …"      ├──────────────────────────────┤
│░░░░│   │ (blank,  │ NOTES · 40         ← chrome  │
│░░░░│   │  titled) │ REFERENCES · 64      type    │
└────┘   └──────────┴──────────────────────────────┘
 ░ dimmed: the argument ends at the line
```

Search lanes still paint into the dimmed region. A hit inside the notes is a real hit, and the
dimming makes those marks more legible rather than less.

**The arc's step marker has to stop counting apparatus.** If Notes and References are two of nine
depth-1 children, "3 / 9" tells the reader there are six parts of argument left when there are four.
Supplements sit outside the numbering — "3 / 7" — and appear in the panel unnumbered and dimmed. It
is a small thing, and it is the one place the structure states a count out loud.

### The fisheye

**Fable's read of this was wrong, and the review caught it — checked, and the review is right.**
The claim was that a reader standing mid-Notes falls into the existing `currentIndex: -1` branch, so
the panel behaves correctly for free. It does not.

A shallow branch is **expanded into cells at deeper columns**
([`tree.ts:72`](../../src/web/tree.ts)), and `itemsFromCells` skips *continuation* cells, not *leaf*
cells ([`context.ts:90`](../../src/web/context.ts)). A note block's chain is root → supplement →
leaf, so at the sections column the note rows carry a real leaf node — one with no nav label, because
it is not gistable. The result is a run of **blank section entries**, one of which can become
current. And if leaves are later filtered out to fix that, `currentIndex` selects the last preceding
body item ([`context.ts:108`](../../src/web/context.ts)) rather than returning `-1`, so the panel
claims the reader is still in the last part of the argument while they stand in the bibliography.

So this is work, not a freebie: the fisheye needs supplement-aware item construction.

The arc has **two** separate dependencies, not one. Generation includes every root child
([`arc.ts:106`](../../src/arc.ts)), and the UI assigns every depth-1 cell an index and a total
([`tree.ts:222`](../../src/web/tree.ts)). Both need to know about supplements, or "3 / 9" persists in
one of them. And the arc panel's rule that a landmark keeps at least one line because "its sentence
is the only content it has" needs adjusting: for a supplement the **title** is the content — show
"Notes", never a hole.

**The real fisheye-shaped problem is elsewhere**, and it is worth naming because the obvious fix is
the wrong one. Click a marker and the anchor invariant dutifully recentres all three panels on
"Notes" — so the reader's place in the argument vanishes from every column for the duration of a
visit to one citation. Do not fight that with cleverness in the panels. Fix it upstream: make the
hover preview good enough that most visits never jump at all, and let the back-link restore
everything for the ones that do.

### The exclusion tooltips

Greg asked for tooltips saying when something is being excluded. The move that keeps the reading view
from becoming a page of asterisks explaining itself is to **state the exclusion as a promise of
fidelity, not an apology for an omission**. Three placements, one line each:

- the "Notes · 40" cell and its spine band, on hover —
  **"40 notes — shown as written, never summarised."**
  and **"64 references — shown as written, never summarised."**
- summaries mode, one footer line —
  **"This covers the piece itself. The 40 notes and 64 references are not summarised — they're
  quoted as written."**
- nowhere else. Review mode, ideas and glossary need nothing, because a reader does not feel an
  absence there.

**Nothing on the markers themselves.** A marker's hover is the note's own text, which is the best
possible answer to the gesture, and meta-commentary there would displace it.

## Word count and reading time

Two independent sums today, and neither knows about the other:

- `library-scalars.ts:87` — the shelf card
- `web/stats.ts:33` — the masthead over the article you are reading

They agree only because they happen to compute the same thing.
[`reading-time.ts`](../../src/reading-time.ts) exists precisely because two places say the duration
out loud and nothing would ever have told us they had drifted — but it shares only the
words-per-minute formula, not the numerator.

So: **keep `Block.words` literal and honest**, and introduce one shared derivation both callers use:

```ts
articleWordCounts(blocks) => { body, footnotes, references, total }
```

The card and the masthead display `body`. Where the apparatus is substantial, say so rather than
hiding it — `10,100 words · plus 1,300 words of references`. A bibliography quietly becoming four
minutes of reading time is the failure; a bibliography the reader is not told about is a smaller one.

## What jump-and-return does not give a reader

Four things, from Fable, drawn from actually reading Gwern, Wikipedia and papers rather than from
listing possibilities. The first is the one worth building early.

**Which notes are worth the trip.** Gwern's footnotes are mini-essays; a paper's are "Ibid., 43." A
superscript that tells you whether anything is behind it changes how you read the whole piece, and it
needs no model call — word count and citation shape are enough.

*This is where GPT Sol and Fable appear to disagree, and they do not.* Sol's advice was **do not
classify in v1**, on the grounds that an invented threshold would be driving downstream policy —
whether a note feeds summaries or embeddings — with no corpus to calibrate against and no way to
tell when it was wrong. Fable's use is different: a **visible affordance at the marker**, where being
wrong is cheap, immediately apparent to the reader, and fixable by adjusting one number. So: classify
for the marker's dress, and do **not** let that classification decide what any model sees. Those stay
`role`-driven and uniform.

**Read it in place.** The hover preview must be sidenote-grade — the note's full text with its links
live, not a title card. If the preview is complete, the jump becomes the rare gesture and the panel
problem above mostly dissolves. It is also the down-payment on floating substantive notes into the
margin on a wide screen, which is not for now.

**The reverse direction.** Standing in the notes: which passages cite *this* note? Wikipedia's
`^ a b c` is one note with three markers, so back-links are **plural, not singular**. Cheap to build
now and painful to retrofit, because the singular version reads as working.

## The trap that would cost the most

**Renumbering destroys stable block ids.** This is the finding to design around, and it is not
obvious.

`extractText` ([`blocks.ts:150`](../../src/blocks.ts)) walks `textContent`, so the superscript
marker's own digits are part of `Block.text`. The id carry-over key is
`x:${tag}:${text}` ([`exactKey`, blocks.ts:328](../../src/blocks.ts)).

Therefore: an author inserts one new footnote near the top of the piece, every later marker shifts
`7 → 8`, and **the containing body paragraph's match key changes even though its prose did not**.
The paragraph gets a fresh id on re-ingest. Comments anchored to it are orphaned; a reader's saved
scroll position points at nothing. Same for the note blocks themselves, whose leading number is in
their text.

The first version of this fix — *the carry-over key ignores marker text and leading note numbers* —
is too permissive, and the review is right about the four ways it goes wrong:

- two otherwise identical paragraphs citing **different** notes collapse to one key
- replacing or reordering citations keeps the old paragraph id, so the id now points at a paragraph
  that means something else
- a leading number can be genuine note content
- markers are not always digits — letters, stars and Roman numerals all occur

So: **strip the recognised marker and control DOM nodes, not text patterns**, and fold a fingerprint
of the *targeted note* into the key. If only the numbering changed, carry the id; if the target or
the note's content changed, mint a new one. The current exact-text key is
[`blocks.ts:317`](../../src/blocks.ts), with order-based carry-over at
[`blocks.ts:402`](../../src/blocks.ts).

Four tests, not one: insertion (ids survive), target replacement (id is minted), two paragraphs whose
stripped text collides (ids stay distinct), and a legitimate leading number (not stripped).

## Why both directions may already work

Read out of [`src/blocks.ts`](../../src/blocks.ts) rather than assumed, and it matters because it
decides how much of stage 4 is new code. Take Wikipedia's shape, which is the commonest on the web:

```
  body:   <sup id="cite_ref-1"><a href="#cite_note-1">[1]</a></sup>
  notes:  <li  id="cite_note-1">… <a href="#cite_ref-1">^</a></li>
```

- The **note body is an `<li>`, and `LI` is a leaf block.** So it gets a spideryarn id, the rename is
  recorded, and `retargetAnchors` repoints the marker's `href="#cite_note-1"` at it. The
  marker → note direction is the path that already exists.
- The **marker is a `<sup>`, which is not a block**, so the author's `id="cite_ref-1"` is never
  overwritten and survives into the stored HTML. The back-link's `href="#cite_ref-1"` therefore is
  *not* retargeted — and it does not need to be: `internalTarget` falls back to
  `[id="…"]` → `closest("tr[data-block]")`, which resolves to the body paragraph containing the
  marker. That is the documented "an id on something smaller than a block — a footnote span"
  case in [`internal-links.ts`](../../src/web/internal-links.ts), written before any of this.

So the plumbing for jump and return is plausibly already there, and stage 4 is mostly *dress*:
recognising which anchors are note markers, styling them, and making the hover card say "Footnote 7"
instead of "elsewhere in this article".

**Two cautions, and neither is idle.** A marker must be recognised by *what it targets* — a block
with `role: "footnote"` — and never by being inside a `<sup>`, because superscripts are also powers,
ordinals and trademarks. And all of the above is a reading of the code, not a measurement: stage 1
exists to confirm it against the real fixtures, because the whole chain is downstream of Readability
keeping the notes container at all.

## The stages

Five, each ending somewhere the tests are green and the tree is safe to commit
([engineering-manager.md](../reusable/engineering-manager.md)). If the job were abandoned at the end
of any one of them, what landed would still make sense.

**1 — Find out what survives. Mostly done, 2026-08-28** — the measurement above, and it is why
stages 2–4 are about dress rather than a repair pass. What is left in it: run the new Substack
fixture end-to-end, and turn the whole measurement into committed assertions rather than a table in
a plan, including the `Nagel_Bat.pdf` known positive keyed off note-body text. A number in a document
does not re-run.

**2 — Recognition, at the right end of the pipeline.** Canonicalise every shape into one
marker-and-note structure **before Readability** — Substack's split note joined so a marker lands on
prose, Tufte's sidenotes rescued before the sanitiser deletes the mechanism, Gwern's and Wikipedia's
left alone because they already work. Mint `noteId` so a note is a range rather than a block. Nothing
downstream knows about roles yet; the deliverable is that all four shapes arrive at stage 3 looking
alike, with assertions on note prose and ranges rather than on retarget counts. **This stage on its
own already fixes a live bug** — Substack markers stop landing on a digit.

**3 — `role`, `treatment`, and the policy.** The five predicates replace the `gistable` overload at
every consumer in the table above, `pg-shelf`'s SQL included; `articleWordCounts` becomes the one
seam the card and the masthead read; **the fingerprints learn about roles** so reclassification
invalidates what it should; the migration, every hand-written projection and the public DTO carry
both fields, proved by a synthetic role-bearing article rather than by today's zero-role corpus. The
carry-over key fix lands here with its four tests. Visible change: the clock stops counting the
bibliography.

**4 — The supplement node.** Node role, the body-tree-first ordering as an explicit post-build step,
the six supplement invariants, the fisheye's supplement-aware items, and **both** arc dependencies.
The notes are now in the structure.

**5 — The prose side.** Marker dress, with the substantive-versus-citation distinction driving *only*
the marker; the sidenote-grade preview over a note's whole range; the jump; plural back-links; the
spine dimming; the exclusion tooltips in the two places they belong. This is the stage a reader would
notice, and it needs a browser pass ([browser-testing.md](../project/browser-testing.md)) — tests
going green is not evidence that a reader can see it, and nothing so far has tested hover, focus,
touch or a modified click.

**6 — PDFs converge.** `renderHtml` partitions body, notes and references, emits marked containers
and supplies headings where the document has none, so a transcribed paper reaches stage 2's
canonical shape and reuses all of the above. Includes the bibliography-gate decision below.

**Why the order changed.** As first written, stage 2 gave notes a role while the tree still contained
them, and stage 3 built the tree from body blocks only — which fails the coverage invariant until the
supplement exists. Neither was independently shippable. Recognition now comes first because
everything else depends on the shapes being alike, and because it is the only stage that fixes
something already broken for readers.

## What this is deliberately not doing

- **Parsing `(Smith, 2001)` into a link to its bibliography entry.** That is citation parsing, not
  footnote rendering — a different feature with a different failure mode, and ball-lightning's 38
  inline citations are not a reason to smuggle it in here.
- **A model call to classify notes.** See the reconciliation above: mechanical, for the marker only.
- **Floating substantive notes into the margin on a wide screen.** The sidenote-grade preview in
  stage 4 is the down-payment on it; the feature itself is not in this plan.
- **Setting `gistable: false` on note blocks as the mechanism.** It stays as a consequence of the
  predicates, never as the switch — see above for why it would produce the opposite policy.

## The tests that have to be able to fail

**Remove the supplement node, or stop propagating `role`, and prove that the validation, search,
word-count and UI tests go red.** A feature tested only against today's zero-footnote corpus will
report perfect success while doing nothing ([silent-success.md](../reusable/silent-success.md)).

**Three items on the first draft of this list were theatre**, and the review was right to say so:

- *"Delete the supplement and watch tree validation fail"* mostly re-tests the old coverage
  invariant. Mutate each of the six supplement semantics separately.
- *"Store parity proves `role` survives Postgres"* proves nothing over a corpus where every `role` is
  absent — and those suites **skip themselves silently** when the database is down. It needs a
  synthetic role-bearing article and a projection/DTO test that cannot skip.
- *Fixture hashes* prove fixture bytes. They say nothing about footnote behaviour.

The tests that would actually have caught things:

- Real Gwern, Wikipedia and ACX extractions asserting **exact note prose and ranges** — never
  retarget counts, which reported 36 of 36 on a shape where half the links were useless.
- Multi-block note grouping, a reused marker resolving from every point of use, a truthful distinct-note
  count, and a preview covering a note's whole range.
- **Negative fixtures**: an ordinary superscript that is a power or an ordinal, and ordinary numbered
  prose. Both must be classified as body.
- A unique token planted in a note: absent from ToC, arc, summary, ideas, glossary and tweets;
  present in explicit search and in chat's answer when asked.
- A role-only change invalidating every affected cached artefact.
- Pre-Readability Tufte canonicalisation, plus a forged-stamp attack fixture.
- Browser tests for plural back-links, focus restoration, touch and modified clicks.

Named, because each is a way this could pass while broken:

- Readability strips the notes container before stage 3, and every direct `splitIntoBlocks` test
  stays green because it was written against invented post-Readability HTML.
- A marker is "successfully" retargeted onto the wrong containing block; `stats.retargeted` still
  increments.
- `role` survives the filesystem store and is dropped by one Postgres projection out of ten.
- One synthesised back-link where the note had three markers — the singular version reads as working.
- Footnote links and back-links become diagram structure. `graph.ts` already caps this anticipated
  starburst (`MAX_ANCHOR_EDGES`, written for exactly this case before any footnotes existed); once
  `role` exists, exclude those edges explicitly rather than relying on the cap.
- A predicate that returns true for everything passes every test written the obvious way.

## The third shape: Substack

Added as a fixture on 2026-08-28 — `evals/extraction/fixtures/acx_footnotes.html`, ACX's review of
*The Pale King*, because Substack is the commonest footnote shape on the modern web and the corpus
had none (`acx.html` is a Substack post, but that particular one has no footnotes).

```html
<a data-component-name="FootnoteAnchorToDOM" id="footnote-anchor-1"
   href="#footnote-1" class="footnote-anchor">1</a>
…
<div data-component-name="FootnoteToDOM" class="footnote">
  <a id="footnote-1" href="#footnote-anchor-1" class="footnote-number">1</a>
  <div class="footnote-content"><p>Yes, in a work of fiction…</p></div>
</div>
```

Note the third orientation: **no `<sup>` at all**, and the note body is a `<div>`, which stage 3
descends into rather than emitting.

**Run end-to-end 2026-08-28, and it is broken today — while reporting success.** All three fixtures
through the same harness, counting not whether an anchor *resolved* but whether the reader lands on
**prose or on a stub**:

| fixture | blocks | `retargeted` | lands on prose | lands on a stub | dangles |
|---|---|---|---|---|---|
| `gwern.html` | 187 | 104 | 87 | 17 (all section headings — correct) | 0 |
| `wiki_transformer.html` | 358 | 343 | 338 | 5 (short list items — fine) | 2 |
| `acx_footnotes.html` | 120 | 36 | **18** | **18** | 0 |

Substack splits each note into **two blocks** — one whose entire text is the digit, one with the
note:

```
[79] <p> 26w  If Wallace had lived, his vision wouldn't have reached any ultimate closure…
[80] <p>  1w  1                          ← the marker retargets HERE
[81] <p> 31w  Yes, in a work of fiction. Many footnotes spawn their own footnotes…
[82] <p>  1w  2
```

So exactly half the anchors work: the note→body back-links land on prose, and **every one of the
eighteen body→note markers — the direction a reader actually uses — lands on a block containing a
single digit.** `stats.retargeted` says 36 of 36.

Two further consequences, both live on the shelf today for any Substack article:

- Those eighteen digit blocks are `gistable: true`, so they go to the nav-labeller as one-word
  paragraphs, get ToC rows, get embedded, and count toward reading time.
- **The `footnote` class does not survive.** Readability's `keepClasses: false` strips it, so nothing
  downstream can recognise a note by class. Recognition has to happen at stage 2 or be reconstructed
  from the anchor topology.

This is Sol's predicted failure — *"an anchor is successfully rewritten but lands on the wrong
containing block; `stats.retargeted` still increments"* — found in the wild within a day of being
predicted, and it is the reason stage 1's measurement has to become committed assertions rather than
a table in a plan.

**A note on how this was measured, because it nearly went the other way.** The first harness wrapped
each block in a `<tr>` inside a `<div>`, and the HTML parser drops a `<tr>` outside a `<table>` — so
the first run reported *0 of 36 resolve*, a far more dramatic result than the truth. A harness that
manufactures its own catastrophic finding is the same bug class in the other direction.

## Fixed along the way

`verify.mts` walked `CORPUS` alone, so the new fixture — hashed, committed, sitting in the same
directory — was **skipped in silence** while the last line read "15 fixtures, all matching". Worse,
`--write-hashes` rebuilds the manifest from what it walked, so it would have quietly deleted that
fixture's committed hash.

Now fixed: an `EXTRA` list for fixtures hashed here but deliberately outside the extraction corpus,
plus a directory sweep that fails on any `.html` covered by neither, so the next person to add one
cannot repeat it by forgetting. Watched fail on the broken state (`acx_footnotes.html UNCHECKED`,
exit 1) before being trusted to pass — 16 fixtures, all matching.

## The PDF path

Greg's brief is that footnotes and bibliographies should be kept and annotated at import, so that by
the time anything reaches stage 3 it does not matter which extractor produced it. That is the right
target, and three things stand between here and there. All three are real; none is a reason not to
do it.

**The renderer erases the classification at the moment of rendering.** `ELEMENT` maps `footnote`,
`reference` and `cover` all to `"p"` ([`pdf-read.ts:580`](../../src/pdf-read.ts)), and `renderHtml`
emits each record at its position in the page sequence. So merely adding `footnote` to `RENDERED`
would scatter unmarked notes through the body prose — the PDF version of the Tufte bug. The renderer
has to partition body / notes / references, emit marked containers, and supply the headings a PDF
often does not print.

**Bibliography pages are deliberately exempt from the transcription gate.** Recall on them is poor
— 0.291 measured on the `harder` fixture's pages 13–14, where every word of body text was correct —
so they are excused rather than allowed to fail the paper
([`pdf-read.ts:1040`](../../src/pdf-read.ts)). Showing a PDF bibliography therefore publishes text
the pipeline explicitly permits to be incomplete.

**This is Greg's call, and there is a third option** that the review supplied and that is better than
either of the two the plan started with. Rather than loosening the gate or printing unverified text
with a caveat: show **the original page itself**. Verified references render as text where the gate
passes; for a bibliography page that failed it, show the cropped, rasterised **PDF page** in the
supplement, with the uncertain transcription attached for search and clearly marked as such. The
pixels are authoritative, the gate is untouched, and nothing incomplete is passed off as a
transcription. The cheaper variant of the same idea is a "References could not be verified"
supplement that links to the original pages.

That fits what this app already does elsewhere — it says "a scan cannot be checked" out loud rather
than pretending. What is not available is showing an unverified bibliography silently.

**We still cannot tell "no footnotes" from "detector broken."** The known positive is confirmed:
`data/Nagel_Bat.pdf` has numbered footnotes on PDF pages 3, 4 and 5 (the article's own pages
435–437; notes 1, 2, 3 and 5 directly confirmed in the text layer). One detail for whoever writes
the assertion, and it would have cost an afternoon otherwise: `pdftotext` renders the *in-text
marker* as an apostrophe-ish scan artefact rather than a clean digit, so the test must key off the
**note body** at the foot of the page (`1 Examples are…`, `2 Perhaps there could not…`) and must not
expect a superscript digit to survive text-layer extraction.

## Still open

- **The bibliography gate decision** above — Greg's.
- Whether the marker carries the substantive-versus-citation distinction in v1, or stays
  undifferentiated — the Sol/Fable reconciliation is written down, but the call is Greg's.
