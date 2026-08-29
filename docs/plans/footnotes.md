# Footnotes and bibliographies

**Status: built and seen working, 2026-08-29 — stages 2 to 5a and 3b, less stage 6 (PDFs), which
Greg cut from v1.** Ten rounds of GPT Sol review, every one of which found something real. The
feature has been run end to end through the real pipeline on a live article
(`data/scaling-hypothesis`) and looked at in a browser through the real public DTO. The one thing
nobody has seen is **diagram mode**, which is owners-only by design and needs a signed-in session.
Five rounds of GPT Sol review after it was built; every one found something real, and the last
of them is the closed inventory of consumers in
[footnotes-finish-review-5-sol.md](footnotes-finish-review-5-sol.md). **Stage 3b — the block-id
carry-over key — landed 2026-08-29**, after *three* GPT Sol reviews returned BLOCKED
([round 1](footnotes-stage3b-review-sol.md), [round 2](footnotes-stage3b-review-2-sol.md),
[round 3](footnotes-stage3b-review-3-sol.md)) with five reproduced data-integrity failures between
them. Four were real and fixed; the fifth turned out to be behaviour older than the stage, and the
measurement that settled it is below. What it fixes, the limitation it deliberately keeps —
**editing a footnote's words re-mints the block ids of the passages citing it** — and the mechanism
that was built to avoid that and then removed, are in
[Stage 3b, as it actually landed](#stage-3b-as-it-actually-landed-2026-08-29).

The plan below is kept as it was written. Written 2026-08-28 after a GPT Sol design consultation
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
| `ar5iv.html` | 18 `<sup>` | survives — LaTeXML, **a fifth shape**, inline and never linking back | none | out of scope for v1 |
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

**`gutenberg` is not a footnote system** — its three superscripts are abbreviation marks in "Mr." —
and it nonetheless reports a healthy `stats.retargeted` of 162, from chapter and table-of-contents
links. `ar5iv` reports 85, from figure and section cross-references. **`retargeted > 0` is therefore
not evidence that footnotes work**, and it is exactly the shape of check that would have been
believed.

**`ar5iv` is a correction.** An earlier version of this plan called it "not a footnote system", on
the strength of its shared author note ("equal contribution"), which is rendered fully inline with no
id/href pair. That generalised from one case: the fixture carries **nine `ltx_role_footnote*`
occurrences**, and two of them are genuine footnotes with substantive prose
(`evals/extraction/fixtures/ar5iv.html:256` and `:617`). GPT Sol found this while reviewing stage 2.

So LaTeXML is a **fifth shape**, and an instructive one: its notes are inline and never link back, so
a round-trip test cannot see them. It is out of scope for v1 — but it must be described as an
unsupported shape deliberately left alone, never as a fixture with no footnotes in it. A test that
pins a known omission as correctness is worse than no test.

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
| `pg-shelf.ts:222` | hard-codes `gistable = true` **in SQL**, outside any TypeScript predicate — but see Sol's input below: it is *library search*, so the right change is **none**, plus a test proving a note still comes back |
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

## Stage 3's input, measured before building it — 2026-08-28

Three facts, each from running the real pipeline over the real fixtures (`output/stamp-survival.mts`,
`output/note-ranges.mts`, `output/clock.mts`) rather than from reading the code.

**The stamps survive.** `data-spya-note`, `-ref`, `-back` and the container all come through
Readability *and* the sanitiser intact — DOMPurify keeps `data-*`, as
[`blocks.ts:456`](../../src/blocks.ts) claims, and now measured: gwern 34/34, wikipedia 121 notes
with 170 markers, acx 18/18, tufte 5/5, and **zero** on ar5iv, gutenberg and the constitution. So
stage 3 has an input, which was not certain.

**A note really is a range, and the range is most of the words.** Gwern has 34 notes and *118*
block-level elements inside the notes container. Had stage 3 classified only the elements carrying
`data-spya-note`, **84 blocks of footnote prose would have stayed body** — summarised, embedded and
on the clock, with every count looking plausible. The rule that avoids it is an ancestor lookup, and
it is exact on all four shapes: `closest("[data-spya-notes]")` gives `treatment`,
`closest("[data-spya-note]")` gives `noteId`. Measured: every stamped element is inside the
container, and every block-level element inside the container is under exactly one note. No orphans,
no strays.

**What the clock is wrong by**, which is the visible change stage 3 promises:

| fixture | today | as argument | apparatus |
|---|---|---|---|
| gwern | 16846 words · **73 min** | 12637 · **55 min** | 4209 words, 41 of 184 blocks, 34 notes |
| wiki_transformer | 11436 · **50 min** | 8053 · **35 min** | 3383 words, 121 of 356 blocks, 121 notes |
| acx_footnotes | 6415 · **28 min** | 5366 · **23 min** | 1049 words, 18 of 96 blocks, 18 notes |
| tufte | 2198 · 10 min | 2141 · 9 min | 57 words, 5 notes |
| ar5iv | 5491 · 24 min | 5491 · 24 min | **0 — the control, and it stays put** |

An eighteen-minute error on the piece a reader is deciding whether to start.

**And the labels are being bought for them.** [`labels.ts`](../../src/labels.ts) writes one nav
label per *gistable* block and says of itself that it is "the one output in the whole pipeline"
whose cost is linear in block count. A footnote body is an `<li>` full of prose, so it is
`gistable: true` and it gets one:

| fixture | nav labels bought | of which footnote |
|---|---|---|
| gwern | 175 | 41 — **23%** |
| wiki_transformer | 335 | 121 — **36%** |
| acx_footnotes | 96 | 18 — 19% |
| tufte | 63 | 5 — 8% |

So `isStructural` is not only about a truthful "parts · 7"; on a heavily cited piece it is a third of
the labelling bill, spent writing navigation for rows nobody navigates to.

**And the automatic/asked split does not follow the obvious seam.** `article-prompt.ts` has two
builders and it is tempting to read them as the policy — ids for the stages that cite, bare text for
the stages that do not. They are not:

| builder | call site | automatic or asked | may it see notes? |
|---|---|---|---|
| `articleText` | `glossary.ts:1190`, `arc.ts:300`, `tweets.ts:484` | automatic | no |
| `articleWithIds` | **`ideas.ts:815`** | **automatic** | **no** |
| `articleWithIds` | `explain.ts:410`, `search.ts:248`, `converse.ts:946` | asked | **yes** |

Filtering inside the two builders is right for three stages and silently leaves `ideas.ts` reading
the bibliography — and `ideas.ts:795` has a comment explaining exactly why it needs ids, so the next
person would not think to look. **The filter belongs at the call site**, and `isBodyEvidence` has to
be applied seven times rather than twice.

## GPT Sol's input before stages 3–5 — 2026-08-28

Asked before writing any code
([prompt](footnotes-stage345-upfront-prompt.md), [answer](footnotes-stage345-upfront-sol.md)):
eleven concrete decisions, attacked against the code. One was **wrong**, six needed adjustment. Every
claim below I checked in the file myself before writing it down.

**Decision 4 was wrong, and so was this plan.** The plan said `pg-shelf.ts:222` hard-codes
`gistable = true` in SQL "outside any TypeScript predicate, so a predicate refactor cannot reach
it", and listed it as work. It is **library full-text search**, not a shelf scalar — and the policy
says a note *is* searchable. Adding `treatment <> 'supplement'` there would contradict the policy the
predicate exists to state. **Leave that SQL alone**, and add a parity test proving a
`gistable: true, treatment: "supplement"` note still comes back from library search.

**The five predicates are not five spellings of one formula.** Defining each as
`gistable && treatment !== "supplement"` is the obvious move and is wrong in two of five:

| predicate | rule |
|---|---|
| `isSearchable` | `gistable` alone — **supplements included** |
| `isBodyEvidence` | body only, and do not quietly change what code and media blocks feed |
| `isEmbeddable`, `isStructural` | `gistable && body` |
| `countsTowardReadingTime` | **body only, regardless of `gistable`** |

And `gistable`'s own doc comment ([`types.ts:39`](../../src/types.ts)) says it decides whether the
ToC writes a row — which stops being true the moment a prose footnote is `gistable: true` and
`isStructural: false`. It stays as the splitter's intrinsic "this block has independently describable
prose" fact, `block-policy.ts` becomes its only policy-reading consumer, and the comment gets
rewritten in the same commit.

**The hash compatibility trick needs a branch, not an omission.** `hashBlocks` is not JSON — it
builds `id \t text` by hand ([`source-hash.ts:47`](../../src/source-hash.ts)), so "omit absent
fields" has nothing to omit *from*. It needs an explicit legacy branch: every block nullish ⇒ run
the old algorithm byte-for-byte; otherwise a versioned framed representation. Postgres `null` and
filesystem `undefined` must normalise identically. `structureHash` needs the same branch keyed on
"no supplement node".

And the fingerprint has **three narrow queries** that select only `id` and `text`
([`pg.ts:636`](../../src/store/pg.ts), [`pg-searches.ts:139`](../../src/store/pg-searches.ts),
[`import.ts:453`](../../src/store/import.ts)). Miss one and a second import compares a full new hash
against an old two-column hash and creates a revision every time, forever.

**The thing most likely to be found late, and it is not the hash.** A perfect fingerprint does not
make a stage re-run. `toc` deliberately has **no** freshness stamp and
[`pipeline.ts:1083`](../../src/pipeline.ts) explains why at length — one was written, tested, and
*reverted* on 2026-08-27, because arc and summary entries are joined to the tree by **exact block-range
pair**, so a rebuilt tree drops them "from the reading view without a word". `arc` has no stamp at
all. So: correct hashes, plausible output, green tests, and stale artefacts.

That comment is aimed at stage 3, but **it is really about stage 4**: appending a supplement node
changes the root's range, and the root's range is half of a join key. Stage 4 must either preserve
the ranges arc and summary were written against, or regenerate them, and it must prove which —
this is the one place in the whole feature where the failure is invisible in every test and visible
to a reader as a missing sentence.

**Six more seams the plan did not have:**

- **Append the supplement before `generateLabels`, not after.** `labels.json` records
  `structureHash(opts.tree)` ([`labels.ts:1475`](../../src/labels.ts)); appending afterwards makes
  the labels stale at birth. There is no later gist-composition pass to worry about — composition
  is an instruction to the ToC model ([`toc.ts:105`](../../src/toc.ts)) and `buildTree` merely copies
  what comes back ([`toc.ts:442`](../../src/toc.ts)) — so the plan's ordering worry was misplaced
  and a different one takes its place.
- **The fisheye fix cannot live in `itemsFromCells`.** Three other consumers read the raw cells:
  keyboard navigation ([`keynav.ts:152`](../../src/web/keynav.ts)), saved reading position
  ([`position.ts:68`](../../src/web/position.ts)), and the arc's numbering
  ([`web/tree.ts:222`](../../src/web/tree.ts)). Fixing only the visible list is what *breaks* the
  anchor invariant. One shared "navigable items at depth" projection, collapsing every cell under a
  supplement to a single item anchored at its first block, used by all four.
- **Three more word-count numerators**, none of them a displayed statistic and all of them policy:
  `tweets.ts:448`, `ideas.ts:766` and `glossary.ts:1114` each sum *every* block's words and choose
  how much output to ask for from it. Prompts that exclude notes while output sizes include them is
  the same braiding one layer down. Plus a fourth reading-time formula at
  [`extract.ts:121`](../../src/extract.ts) — characters ÷ 5 ÷ **200**, its own WPM — which is
  either deliberately debug-only or wrong, and nobody has decided which.
- **The shelf is not separate.** Its Postgres fallback already refuses to sum in SQL and calls
  `deriveLibraryScalars` instead ([`pg.ts:1029`](../../src/store/pg.ts)). Extend `scalarInputsQuery`
  to aggregate treatment alongside words and it uses the shared seam like everything else.
- **The carry-over key has to come in two families.** `Candidate` keeps only tag, text and html
  ([`blocks.ts:365`](../../src/blocks.ts)) — the DOM element is gone by then, and a *previous* block
  has only serialised HTML. So the note-aware key is computed from HTML on both sides. And the first
  run after stage 2 compares canonical-new against pre-stage-2-previous, which needs a one-time
  legacy bridge; without it either target replacement keeps the old id, or the whole corpus is
  re-minted once.
- **Name the tree field `treatment`, not `role`.** Otherwise `role` means semantic content on a block
  and structural exclusion on a node. And `publicTree` **silently drops** optional `TreeNode` fields
  by design ([`dto.ts:124`](../../src/public/dto.ts)), so the supplement marker must be added there
  by hand or the client never sees it.

**A stage-5 trap, named now because it changes what stage 3 must expose.** The hover preview cannot
render a note's range by injecting the stored block HTML: that duplicates block ids into the
document, and the preview's links sit outside `TableView`'s delegated click handler
([`TableView.tsx:470`](../../src/web/TableView.tsx)). The preview needs its own fragment, with ids
stripped or namespaced, owning its own internal-link delegation. Which means stage 3 must persist and
project **`noteId`** — not just `role` and `treatment` — and add all three to `PublicBlock`, its
query and its DTO, all three of which are explicit allow-lists.

### The invisible stage-4 failure, narrowed to one entry — 2026-08-28

Sol named the range-join hazard as the thing most likely to be found late. Chased into the code, it
is **much smaller and much more specific** than the warning, and the difference matters because the
general version has no cheap fix and the specific one does.

Both joins key on a **pair of block ids**, not on indices or node ids
([`web/tree.ts:218`](../../src/web/tree.ts), [`web/tree.ts:373`](../../src/web/tree.ts)). Appending a
supplement node **changes no body part's range** — part 3 still runs from the same first block id to
the same last block id. Exactly one range changes: **the root's**, whose end moves from the last body
block to the last note. So:

- **The arc is safe by construction.** `buildArcColumn` reads `geometry.cells[1]` — depth-1 only,
  where no range moved. Every body part still matches its sentence. The supplement cell matches
  nothing and draws empty, which is exactly what the plan asks for ("show the title, never a hole").
  There is no root arc entry to lose, because `partsOf` is the root's *children*.
- **One summary entry breaks: the whole-article one.** `targetsOf` includes `node.depth === 0`
  ([`summarise.ts:239`](../../src/summarise.ts)), so a summary is written for the root, and
  `buildSummaryTree` looks it up by the root's range. After stage 4 that key misses, and the entry is
  *dropped without a word* — the article-level summary simply stops appearing, on every article
  summarised before stage 4, with `sourceHash` still current because **no block changed**.

**The fix is two lines and it is better than what is there.** `SummaryEntry` already carries `depth`
([`types.ts:503`](../../src/types.ts)). The root is unique, so keying it by range is precision it
does not need: match the root's entry by `depth === 0`, and keep range-matching for everything below,
where the ambiguity that rule exists to prevent is real.

**What must be true before stage 4 can be called done:** a test that builds a tree, writes summaries
against it, appends a supplement, and asserts the whole-article summary is *still there*. Without
that test this is invisible — green suites, plausible output, and a reader who notices a missing
paragraph months later.

### Stage 3 splits in two

It was one stage and it is now too big to end anywhere safe. **3a** is the field, the persistence,
the predicates and the policy — ending with the clock telling the truth. **3b** is the carry-over
key, its two families and its four tests, which is a correctness fix for a bug that predates this
work and does not block the reader-visible arc through 4 and 5.

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

## What is in v1

> Proceed, use your judgment, get the v1 out first, and we can add complexity later.
>
> — Greg, 2026-08-28

So v1 is **the four web shapes, end to end**: recognised, marked, out of the argument, present in the
structure, and readable from the prose. Two things are cut, and both are cuts rather than decisions —
neither is foreclosed:

- **The substantive-versus-citation distinction at the marker.** This is the one question left open
  above, and shipping without it means a marker looks the same whether it hides a mini-essay or
  "Ibid., 43." Deferred rather than settled: the reconciliation stands whenever we want it.
- **PDFs** (stage 6). The approach is decided — native blocks carrying `role`, per Greg above — but
  it is additive, and the web path has to exist for it to converge on.

Kept in v1 despite costing something, because both are painful to retrofit and cheap while we are
already rewriting the DOM: **`noteId`**, so a note has an identity rather than being wherever its
number happens to point, and **plural back-links**, because Wikipedia marks one note thirteen times
and the singular version reads as working.

## The stages

Six, each ending somewhere the tests are green and the tree is safe to commit
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
every consumer in the table above, `pg-shelf`'s SQL **excluded**, which is the correction; `articleWordCounts` becomes the one
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
canonical shape and reuses all of the above — footnotes and references become native blocks carrying
`role`, exactly as a web article's do, with the unverified-pages wording on the References supplement.

**Why the order changed.** As first written, stage 2 gave notes a role while the tree still contained
them, and stage 3 built the tree from body blocks only — which fails the coverage invariant until the
supplement exists. Neither was independently shippable. Recognition now comes first because
everything else depends on the shapes being alike, and because it is the only stage that fixes
something already broken for readers.

## Stage 2, as it actually landed — 2026-08-28

[`src/notes.ts`](../../src/notes.ts), called from `runExtract` beside `unhideCollapsedSections`, plus
[`tests/notes-canonical.test.ts`](../../tests/notes-canonical.test.ts) (50 tests).

Measured with a harness independent of those tests — asking not "did an anchor resolve" but **"does
the reader land on prose or on a stub"**, because `retargeted` reported 36 of 36 on a shape where
half the links were useless:

| fixture | before | after |
|---|---|---|
| substack | 18 → prose, **18 → a bare digit** | **36 → prose, 0 → stub**; 120 blocks → 98 |
| gwern | 87 / 17 (the 17 are section headings) | unchanged |
| wikipedia | 338 / 5 | unchanged |
| tufte | sidenote text arriving as body prose | 5 notes recognised |
| ar5iv, gutenberg | no notes, healthy retarget counts of 85 and 162 | **0 notes** — untouched |

**Four explicit adapters, not one generic inference.** The first version recognised a note by
*round-tripping* alone — the note links back to where it was cited — which is elegant and too broad.
GPT Sol reproduced two cases where it was **worse than doing nothing**: a numbered link into a
reciprocal `<td>` made the table disappear and moved its cell into Notes, and one into reciprocal
`<nav>` prose hoisted that prose out and dressed it as apparatus. A hostile page needs no forged
attribute for that, only the topology. So recognition now requires explicit shape evidence — Gwern's
`doc-noteref`, Wikipedia's `cite_ref`/`cite_note`, Substack's component attributes, Tufte's classes —
with round-tripping kept as validation on top.

### The lesson worth keeping: change the text of as few blocks as possible

The first version discarded every author back-link and wrote its own `↩`. Gwern writes `↩︎` — the
same arrow **plus U+FE0E**, an invisible variation selector. One codepoint, and:

- `exactKey` is `tag + text` ([`blocks.ts:317`](../../src/blocks.ts)), so it misses;
- the folded fallback key deliberately **keeps** combining marks, for Devanagari's sake, so it misses
  too;
- therefore **0 of 34 Gwern note blocks and 31 of 121 Wikipedia note blocks were re-minted** on
  re-extraction, orphaning every comment and saved scroll position on them.

All 34 tests were green. The stable-id test compared `noteId` across two fresh DOMs and never ran
block carry-over, which is precisely the mechanism that broke.

The fix is to **annotate the author's own back-link in place** — same node, same text — and synthesise
one only where the source has none (Tufte, and Substack). Verified after the fix, against a true
"before" pipeline: gwern **34 kept / 0 re-minted**, wikipedia **121 / 0**, with 2 minted blocks per
article for the notes container.

The general rule, and it applies to every stage after this one: *every block whose text this pipeline
changes is a block that loses its id at the next re-extraction.*

### Two more the tests did not catch

- **Fragment resolution disagreed with the browser.** `indexTargets` overwrote on each `[id]`, so the
  **last** duplicate won, while [`blocks.ts:784`](../../src/blocks.ts) takes the **first** in document
  order and says so — the comment above the code claimed spec order while the code did the opposite.
  A correct link could be rewritten to point at a different element. Duplicate ids are ordinary CMS
  output.
- **A note's identity was hashed from text including hidden `<script>`/`<style>`/form content**, so
  changing something invisible changed a note's identity while its visible prose stood still. Now
  hashed after those are stripped.

### Known limit, accepted for v1

Notes with **identical text** ("Ibid.") get order-dependent suffixes, so inserting a new identical
note ahead of them shifts every later one's identity. Real, niche, and the same family as the marker
renumbering trap that stage 3 fixes; revisit it there rather than inventing a second mechanism here.

## Stage 3a-i, as it actually landed — 2026-08-28

`Block` gains `role`, `treatment` and `noteId`; `revision_blocks` gains three nullable columns
(`drizzle/0027_block_roles.sql`) with `is null or in (…)` CHECKs; the ten hand-written projections,
the public allow-lists and the DTO all carry them. Nothing reads them yet — that is 3a-ii.

**Classification is an ancestor lookup**, `noteFieldsFor` in [`blocks.ts`](../../src/blocks.ts):
inside `[data-spya-notes]` ⇒ supplement, and the nearest `[data-spya-note]` ancestor names the note.
Measured through the real pipeline, by me rather than by the agent's own tests
(`output/verify3ai.mts`):

| fixture | supplement blocks | distinct notes | supplement with no noteId | body block carrying a role |
|---|---|---|---|---|
| gwern | 41 | **34** | 0 | 0 |
| wiki_transformer | 121 | 121 | 0 | 0 |
| acx_footnotes | 18 | 18 | 0 | 0 |
| tufte | 5 | 5 | 0 | 0 |
| ar5iv, gutenberg, constitution | **0** | 0 | 0 | 0 |

Gwern's 41-against-34 is the whole reason the field exists: had this classified the stamped
elements instead of their range, 84 blocks of footnote prose would have stayed argument.

**Three mutations, each run and reverted, none of which the agent reported:**

| mutation | tests reddened |
|---|---|
| classify the stamp rather than its range | 4 |
| every block becomes a supplement | 17 |
| the `noteId` pattern gate never matches | 13 |

The third was the one worth checking. `NOTE_ID_PATTERN` gates what may become a `noteId`, and a
pattern that failed to match what `mintNoteId` produces would drop every id while `role` and
`treatment` still landed and every count still read correctly — a guard going quiet when defeated
([a-guard-that-goes-quiet-when-defeated](../reusable/silent-success.md)). It does not.

**The forgery defence is stage 2's, and stage 3 has none of its own.** Proved rather than read: a
page shipping our own `data-spya-note` stamps, one of them inside a `<template>`, yields **0 roles
and 0 surviving stamps** through the real pipeline. The same HTML fed straight into
`splitIntoBlocks`, bypassing stage 2, yields **1 role** — which is what makes the first number
evidence instead of a vacuous pass. So the rule stage 3 rests on is that its input has been through
`canonicaliseNotes`; `runExtract` is the only production caller, and that is now the thing to keep
true.

**An import is rejected, not repaired.** `checkNoteFields` ([`import.ts`](../../src/store/import.ts))
throws on an unrecognised `role` or `treatment` rather than dropping it, because a block that
arrives claiming to be apparatus and is stored as body is silently reclassified as *argument* —
the exact failure the feature exists to prevent. The CHECK constraint is the backstop, not the guard.

### Committed out of a tree two agents were writing in

`src/blocks.ts` and `src/store/artifacts-pg.ts` each held this work **and** a peer's in-progress
"landing D" work ([transactional-stage-runner.md](transactional-stage-runner.md)) — in
`artifacts-pg.ts` the two are adjacent inside a single diff hunk. `git add <file>` would have
committed their half-finished code under this message
([the-pathspec-cannot-fence-a-shared-file](../reusable/silent-success.md)). Both were rebuilt as
HEAD plus this stage's lines only, anchored on exact strings, parse-checked, and checked for the
absence of every peer symbol; then committed through a private `GIT_INDEX_FILE` so the shared index
was never touched.

## Stage 3a-ii, as it actually landed — 2026-08-28

[`src/block-policy.ts`](../../src/block-policy.ts) is the whole of it: five named predicates and
one word count, importing a type and nothing else. `gistable` is unchanged and its doc comment now
says what it is rather than what it decides ([`types.ts`](../../src/types.ts)).

**The clock, measured through the real pipeline** (`output/clock3aii.mts` — canonicalise,
Readability, sanitise, split, then `articleWordCounts`), and it reproduces the estimate above
exactly:

| fixture | today | as argument | apparatus |
|---|---|---|---|
| gwern | 16846 words · **73 min** | 12637 · **55 min** | 4209 words, 41 blocks |
| wiki_transformer | 11436 · **50 min** | 8053 · **35 min** | 3383 words, 121 blocks |
| acx_footnotes | 6415 · **28 min** | 5366 · **23 min** | 1049 words, 18 blocks |
| tufte | 2198 · 10 min | 2141 · 9 min | 57 words, 5 blocks |
| ar5iv, gutenberg, constitution | unchanged | unchanged | **0 — the controls** |

**Where each predicate went**, and the two that are not the conjunction are the two worth checking:

| predicate | call sites |
|---|---|
| `isSearchable` | `library-search.ts`, `chat-tools.ts` — and `pg-shelf.ts`'s SQL keeps its bare `gistable = true`, with a comment saying why |
| `isBodyEvidence` | at the **call site** in `glossary.ts`, `arc.ts`, `tweets.ts`, `ideas.ts`; inside `summarise.ts`'s `textOf`; **not** in `explain.ts`, `search.ts`, `converse.ts` |
| `isEmbeddable` | `article-vectors.ts`, `similar.ts` — both recipes bumped, since `hashBlocks` cannot see an eligibility change |
| `isStructural` | `labels.ts` (batching, the batch marker, `assertEveryBlockLabelled`), `toc.ts` (`checkCoverage`, `buildTree`'s label, the run stat), `tree-invariants.ts` |
| `countsTowardReadingTime` | through `articleWordCounts` in `library-scalars.ts`, `web/stats.ts`, `tweets.ts`, `ideas.ts`, `glossary.ts`, and `pg.ts`'s `scalarInputsQuery` |

`scalarInputsQuery` gained a second ordered `array_agg` for `treatment` rather than a `sum(...)
where`, so the shelf reaches the same derivation as everything else. Both aggregates carry the same
`order by`; two ordered independently would pair one block's words with another's treatment, which
is a mis-count that is stable, plausible and invisible.

**The diagram excludes note edges rather than capping them.** `MAX_ANCHOR_EDGES` was written for
exactly the endnote starburst before any article here had footnotes, and a cap turns forty
meaningless lines into twelve meaningless lines. `collectAnchorLinks` now refuses an `<a>` carrying
`data-spya-note-ref` or `data-spya-note-back`, **and** any link starting or landing in a supplement
block — two clauses, because a hand-written "see note 4" carries neither attribute and a page whose
stamps did not survive would be back to relying on the cap. The cap stays as a general bound.

**`hashBlocks` got a branch, not an omission.** Every block nullish on both axes ⇒ the legacy
`id \t text` algorithm byte for byte, pinned in the test against a hex string computed before any of
this was written (`21189fa4eb0bceca` over `example/blocks.json`). Otherwise `spya-blocks/2` with
`\u0000` between fields and `\u0001` between blocks. Postgres `null` and filesystem `undefined`
normalise identically, and all three narrow fingerprint queries — `pg.ts`, `pg-searches.ts`,
`import.ts` — now select four columns. `structureHash` is untouched; its supplement branch belongs
with the node.

### The stale cached word count: a repair is possible, and we are letting it heal instead

`article_revisions.word_count` is written at publish and the shelf prefers it when non-null, so
every already-published article keeps its inflated number until it is re-extracted.

**An earlier version of this section said "nothing cheaper can fix it", and that was wrong.** The
reasoning was that those revisions' block rows carry no `treatment`, so a backfill over the *rows*
would recompute the identical figure — which is true, and is not the whole picture, because the
rows are not the only thing stored. `stamped_html` is a column
([`artifacts-pg.ts`](../../src/store/artifacts-pg.ts)), carried forward on every new revision, and
it is stage 3's serialisation *after* `canonicaliseNotes` — so it still contains
`data-spya-notes`, `data-spya-note` and the block ids. A one-off repair can therefore parse it, do
the same ancestor lookup `noteFieldsFor` does, match by block id, and recompute the scalar from the
`words` already in the rows. **No refetch, no model call, no paid stage.** GPT Sol found this;
it is a real option and it was described as impossible.

**We are not building it**, and the reasons are cost rather than impossibility:

- It is a script that parses every published article's HTML — not free, and it is a second
  implementation of stage 3's classification rule, which is the sort of second copy this repo keeps
  paying for.
- It only reaches revisions whose `stamped_html` predates *stage 3* and postdates *stage 2*. Rows
  published before canonical stamps existed carry no stamps to read, and repairing those means
  running stage 2 over the stored source — at which point it is re-extraction with extra steps.
- The number becomes true on re-extraction anyway, which is also the only moment the underlying
  facts change.

So: the choice is to let it heal, made with the alternative understood rather than in ignorance of
it. `LibraryScalars.wordCount`'s doc comment says the same, in one sentence.

### What GPT Sol's review of the built code changed — 2026-08-28

[Review](footnotes-stage3-review-sol.md). The blocker was in the ToC and labels prompts and belongs
to stage 4. Four findings landed here, and two of them are about tests proving nothing.

**A mutation that survived 293 tests.** Writing `treatment: null` unconditionally in `writeBlocks`
([`artifacts-pg.ts`](../../src/store/artifacts-pg.ts)) left `store-roundtrip`,
`store-artefacts-pg`, `block-roles`, `store-parity` and `store-block-reads` all green — the Postgres
path could have dropped the column on every write for ever. The cause was a missing **input**, not a
missing assertion: every article in the committed corpus predates classification, so all five suites
round-trip blocks whose three fields are already absent, and "absent went in, absent came out" is
satisfied by a store that throws them away.
[`tests/store-block-roles-pg.test.ts`](../../tests/store-block-roles-pg.test.ts) writes a
*classified* article through the real path — `storeRawSource`, a fenced job, `beginStep`/`write`/
`finishStep`, `publishRevision` with its guards run — and reads the columns back directly. All three
mutations now redden it: `role` 3 of 3, `treatment` 3 of 3, `noteId` 2 of 3 (the fingerprint case
stays green, correctly — `hashBlocks` does not carry `noteId`).

**And the publish gate refused the first fixture, which is the part worth keeping.** Classifying
three blocks without unlabelling their leaves and restamping `labels.json` describes an article
stage 4 would never produce, and `validateTree` and `reasonsNotToPublish` both said so by name. The
fixture now does what stage 3 followed by stage 4 does. A fixture waved through would have been
testing a shape the pipeline cannot reach.

**`checkNoteFields` validated each field in isolation**, so the silent-reclassification failure it
exists to prevent walked in through the door that left open: `role: "footnote"` with **no
`treatment`** passes every single-field check, and `isBody` reads an absent treatment as body — a
block declaring itself apparatus in the one column nothing reads. Same for an arbitrary string as
`noteId`, which stage 5 will resolve a marker through. Both are now cross-checked, with
`NOTE_ID_PATTERN` imported from [`notes.ts`](../../src/notes.ts) rather than restated.
`role: "appendix"` without a treatment stays legal — that is the case one closed set could not
express and the reason there are two axes.

A third rule — `noteId` implies `treatment: "supplement"` — was tried and **left out**. It has the
same shape and `noteFieldsFor` cannot produce a counterexample, but it rejects the five-role fixture
in `block-roles.test.ts` (whose appendix block carries a `noteId`), and stage 5 may want a `noteId`
on a *marker's* block, which is body. Foreclosing that from the import validator before the stage
that needs it exists is the wrong order.

**Should a CHECK back the cross-field rules?** All three are columns of one row, so
`check (role <> 'footnote' or treatment = 'supplement')` is expressible. **Not added**: it needs a
migration this stage is not applying, and a constraint is the *backstop* while this is the *guard* —
it would fail as a violation naming `revision_blocks_role`, inside a transaction, with no block id
in it. The recommendation is that it ride along with the next migration this feature needs.

**`ProfilePage` said "words in all" over a body-only number.** Newly false and reader-visible. Now
`"12,345 words, not counting notes"`, and `LibraryEntry.words` says what it is so the next caller to
sum it does not repeat the claim. Showing both halves is not available here — the shelf reads stored
scalars and only the body figure is stored.

### Two mutations, and the interesting one is the small number

| mutation | tests reddened |
|---|---|
| `isSearchable` inverted (`!gistable`) | **26**, across `block-policy`, `library-search`, `chat-tools`, `chat-library-exclusion` |
| `isSearchable` made to agree with the other four (`gistable && body`) | **2** — and both are the tests written for exactly this |
| `countsTowardReadingTime` always true | **8**, all in `block-policy.test.ts` |
| `writeBlocks` writes `treatment: null` | **0** before the Postgres fixture existed, **3** after |

The middle row is the one worth keeping. It is not the crude inversion; it is *the refactor somebody
will actually make* — five names looking like five spellings of one formula, tidied into one — and
the entire defence against it is two assertions. That is thin on purpose rather than by accident:
there is nowhere else in the codebase where "a footnote is searchable" is stated.

The third row was **7** before a gap it exposed was closed. Nothing outside `block-policy.test.ts`
moved, which meant the shelf card and the masthead — the two numbers a reader is actually shown —
had no database-free test between them and a wrong figure; their own suites are Postgres-gated and
skip themselves silently. A case pinning `deriveLibraryScalars().wordCount` and
`articleStats().words` to the body, with a control that goes red if either returns zero, now lives
beside the predicates.

## GPT Sol's review of stage 3 — 2026-08-28

[prompt](footnotes-stage3-review-prompt.md), [answer](footnotes-stage3-review-sol.md). **Verdict:
blocker**, and it is the fourth round of this feature where a real defect sat under an entirely green
suite. Every claim below I reproduced myself before acting on it.

### The blocker: two automatic model calls still read the footnotes

The stage's own commit message says notes are out of automatic model work. **That was false for the
two largest calls in the pipeline.**

- [`toc.ts` `renderBlocks`](../../src/toc.ts) sends every block's text, marking a block
  `NOT-GISTABLE` only when `!b.gistable` — and a prose footnote *is* gistable, so a note was not even
  marked. The model could invent sections and gists over the apparatus, and `buildTree` copies them
  through. That contaminates arc, tweets, glossary, ideas and summaries *indirectly*, because all of
  them consume tree titles and gists even though their own article evidence is now filtered.
- [`labels.ts` `renderBatch`](../../src/labels.ts) prints a supplement's full text as context. The
  `why` marker had been moved to `isStructural`, which is right and is not enough: marking apparatus
  is not hiding it.

**The test that should have caught this exists and omits exactly these two.**
`tests/block-policy-prompts.test.ts` plants a token in a note and checks the automatic prompts — arc,
tweets, glossary, ideas, summarise — and not the ToC, and not labels. A list of consumers written by
hand is a list of the ones you thought of.

The fix is stage 4's supplement subtree, which Sol arrived at independently: build the model's ToC
over body blocks, append the deterministic supplement, and skip `!isBodyEvidence` in `renderBatch`
outright.

### The fingerprint was a rarer delimiter, not a framing

`spya-blocks/2` separated fields with U+0000 and blocks with U+0001, on the reasoning that control
codepoints do not occur in prose. Sol built **two different classified articles with one
fingerprint** by putting those delimiters into a block's own text; reproduced here at
`69c5527dd4b70843` from both. A block's text is whatever the page said — none of it is ours — so any
unescaped separator is a collision waiting for a page that contains one, and a fingerprint collision
means two different articles both reporting that nothing has changed.

Now `spya-blocks/3` over `JSON.stringify` of fixed-position arrays, which escapes. Three tests, one
of which was **run against the old version and goes red**.

### A mutation that survives 293 tests

Write `treatment: null` unconditionally in [`artifacts-pg.ts`](../../src/store/artifacts-pg.ts) and
`store-roundtrip`, `store-artefacts-pg`, `block-roles`, `store-parity` and `store-block-reads` are
all still green. The Postgres path could drop the column on every write for ever. The cause is the
one this plan already names twice: **the committed corpus has no classified blocks**, so the only
role-bearing round trip is the synthetic one, and it runs against the filesystem store alone.

### Three smaller ones, all correct

- `checkNoteFields` validates each field in isolation, so `role: "footnote"` with no `treatment`
  imports cleanly — something declaring itself apparatus that every predicate treats as body, which
  is the silent reclassification the guard exists to stop, coming through the door it left open.
- `ProfilePage.tsx` now says **"words in all"** over a body-only number. Newly false, and
  reader-visible.
- **"Nothing cheaper can fix the stale `word_count`" is too strong, and this plan recorded it as
  settled.** `article_revisions.stamped_html` is stored and carries the note stamps, so a one-off
  repair can derive treatment and note ids from it plus the existing block ids and recompute the
  scalar, with no refetch and no paid stage. We are still choosing to let it heal on re-extraction —
  but that is now a choice rather than a necessity, which is a different sentence.

### What the review cleared

Worth recording, because a review is evidence in both directions: no asked call was wrongly filtered;
the two `array_agg`s in `scalarInputsQuery` are genuinely aligned (`ORDER BY ordinal`, with
`(revision_id, ordinal)` unique); the pinned legacy hash literals are real pre-change values; there
is no fourth two-column feed into `hashBlocks`; and every remaining direct `gistable` read —
`TableView.tsx:674`, `blocks.ts`, `pg-shelf.ts` — is correct where it stands.

## Stage 3b, as it actually landed — 2026-08-29

**GPT Sol reviewed this twice and returned BLOCKED twice, with two reproduced data-integrity
failures each time** ([round 1](footnotes-stage3b-review-sol.md),
[round 2](footnotes-stage3b-review-2-sol.md)). All four are fixed below; the shape of the key and
the definition of a note's identity both changed because of them, and one whole mechanism was built
and then removed. Read both review files before this one.

The key, in one line ([`keyOf`](../../src/blocks.ts), used by `exactKey` and `foldedKey` alike):

```ts
`x:${tag}:${stamped ? 1 : 0}:${ids.length}:${ids.join(",")}:${written}`
```

`withoutNoteControls` parses the block's **html**, removes every element carrying a *valid*
`REF_ATTR` or `BACK_ATTR`, and names the notes it found: the ones it belongs to (its own
`NOTE_ATTR`, plus any note whose back-link sits in it) as a sorted set, then the ones it cites in
document order with repeats. A block with no stamp returns its own text untouched, so its key is the
one it always had.

**`data-spya-note-ref` does survive into the stored `Block.html` — measured, not assumed.** The note
stamps are `data-*`, which DOMPurify keeps, and `scrubStamps` only takes `WAS_ID`/`WAS_NAME` off.
Blocks whose stored html carries a stamp: gwern 21 citing / 34 notes, wiki_transformer 85 / 121,
acx_footnotes 17 / 18, tufte 5 / 5. Had they been scrubbed the key would have degraded to the old
behaviour on one side and the new one on the other, which is the catastrophic case.

**A no-op re-ingest carries everything**: 356 of 356 on wiki_transformer, 96 of 96, 184 of 184, 68
of 68. That test is the safety case for the whole change, and it goes red — 85, 17 and 21 blocks
re-minted — the moment the key reads anything the two sides disagree about, such as an `href`.

### What a note's identity is, and the two ways it was got wrong

A note is named in the key by **the content digest of its prose, and nothing else**. Both bugs here
came from the same place: `noteId` is that digest plus a positional counter, and neither half is
straightforwardly an identity.

**1 — The counter is a position.** `mintNoteId` appends `-2`, `-3` to whichever *duplicates* come
later in the document, so two notes reading "Ibid." are `h` and `h-2` and inserting a third above
them rotates all three. The first version of this key named the note by its whole id, so the
renumbering this stage exists to fix simply moved from the marker's digits into the note id and
re-minted every citing passage again — Sol's first blocker. The key names the digest and drops the
counter.

**And "drop the counter" is not `replace(/-\d+$/, "")`,** which was Sol's blocker in the second
round. A digest that happens to be all digits *is* what that pattern matches, so
`spya-note-9417977611` came back as `spya-note` and every such note shared one identity — about one
note in a hundred, and Sol found two in the corpus within minutes (`note-12` and `note-58`).
Repointing an unchanged paragraph between them carried its old id: the wrong-attachment failure the
fingerprint exists to prevent. The ten-hex field is now **captured** rather than the tail chopped,
and the fixture asserts its own digests are numeric so it cannot quietly stop being the hard case.

*What remains, and it is older than this stage.* Three notes whose prose is identical cannot be told
apart by a key built from content, so their block ids go out in document order and an inserted note
takes the first old note's id — `exactKey`'s documented behaviour for any two blocks that read alike.
Run the same fixture with the whole of stage 3b switched off and the rotation is identical; the only
difference is that the citing passages re-mint as well. Neither introduced nor fixed here, and pinned
as a limit in [`tests/note-carry-over.test.ts`](../../tests/note-carry-over.test.ts).

### The limitation we are choosing: editing a note re-mints the passages citing it

**Correct a typo in note 7 and every passage citing note 7 gets a fresh block id**, though not one
word of their own prose changed. Comments on them are orphaned. This is known, it is asserted rather
than left to be discovered, and it is deliberate.

It was fixed once, and the fix was withdrawn. Since `noteId` is a hash of the note's words, telling
"the author reworded note 7" from "note 7 is a different note now" needs a second signal, and the
only one available is the author's own anchor — `fn7`, `cite_note-14`. Stage 2 was changed to carry
it (`SRC_ATTR`) and stage 3 to reconcile on it. Sol then reproduced a mixed insert-edit-renumber
revision — a new note at `fn1`, edited note A moved to `fn2`, unchanged note B at `fn3` — in which a
passage's block id moved onto a **different passage**. Two rounds, two wrong-attachment bugs, from
the cure rather than the disease.

[block-ids.md](../project/block-ids.md) is explicit that **a lost anchor is the safer failure than a
moved one**: re-minting loses a comment's anchor, mis-continuing moves the comment onto something
else. The anchor machinery traded the safe failure for the unsafe one to buy a convenience, so all of
it came out — `SRC_ATTR`, `authorName`, `reconcileNotes`, and the `src/notes.ts` change with them.
**Stage 2 is untouched by stage 3b**; the only edit to `src/notes.ts` is two `const`s becoming
`export const`.

Three further reasons it was not worth keeping, beyond the reproduced bug:

- It would have fixed nothing retroactively. The anchor only exists for articles ingested *after* it
  lands, so every article already stored keeps this behaviour regardless.
- Editing a note re-mints **the note's own block** whatever we do, since its words changed. A comment
  on the note itself is lost either way; the machinery only ever saved the citing passages.
- It put 128 characters of page-controlled text into every reader's `block.html` and the public DTO.
  Sol confirmed it inert — no execution path, no selector, no reflection — but it is still source
  metadata shipped for a convenience.

The renumbering bug this stage exists for is untouched by any of that: it is about a marker's digits,
not a note's words.


### The migration bridge, and why it needed three fixes rather than one

An article ingested **before** stage 2 existed has no stamps in its stored html, so its blocks key
the old way while this run's candidates key the new way. Before the bridge, measured — previous =
Readability with the notes pass off, current = the same page with it on:

| fixture | re-minted, no bridge | with the old key |
|---|---|---|
| wiki_transformer | 206 of 356 (85 citing, 121 notes) | 0 |
| gwern | 55 of 184 (21 citing, 34 notes) | 0 |
| acx_footnotes | 35 of 96 (17 citing, 18 notes) | 18 |
| tufte | 10 of 68 (5 citing, 5 notes) | 10 |

Every footnote paragraph and every note block in the database, orphaned on one re-ingest — and
already forbidden by a committed test written for stage 2, *"turning the pass on keeps every note's
block id"* ([`tests/notes-canonical.test.ts`](../../tests/notes-canonical.test.ts)), which this
change broke. So a candidate that finds nothing under the new key tries `legacyKey`, the key an
**unstamped** block gets. With the bridge the cost is 0, 0, 18 and 10 — identical to the old key.

**Sol's blocker 2 was that one-way was a claim rather than a construction.** The old encoding
`x:p:n[<id>]prose` could be spelled by an unstamped block whose prose literally began `n[<id>]`, so
the fallback could reach a *stamped* previous block and take the id of a passage that had not
changed. Reproduced. Three things now keep it one-way:

1. The key's **encoding**: the fields are counted and delimited, so a legacy key is always `0:0:` and
   no prose can spell a stamped block's key.
2. The legacy bucket is built only from previous blocks that **parse** with no stamp in them, rather
   than from the whole document.
3. It runs only after **every** candidate has had its exact match, so an earlier candidate's fallback
   cannot consume an id a later one would have claimed outright.

**Which of the three is actually holding the line, measured rather than asserted.** Probed singly and
in pairs against the focused suite:

| kept | reddens |
|---|---|
| the bucket filter alone | nothing |
| the encoding alone | 3 tests |
| the ordering alone | 3 tests |

So (2) is the guard; (1) and (3) are defence in depth against a future edit to this function, and
saying all three were load-bearing would have been a guess dressed as a safeguard. The stamped flag
inside the encoding is redundant a second time over — `stamped` is true exactly when the id count is
non-zero — and is kept only so that changing *what contributes an id* cannot silently re-merge the
two namespaces.

### The blocker that was not ours

Sol's third review blocked on the bridge again, from a different direction: its bucket accepts every
**unstamped** previous block, and an ordinary paragraph is unstamped forever — so the fallback is not
migration-only. Reproduced: a previous ordinary `<p>Alpha1</p>` is removed, a new
`<p>Alpha<marker>1</p>` appears, and the new passage takes the old paragraph's id.

Real, and **not introduced here**. Measured three ways before believing it was ours
(`output/bridge-probe.mts`):

| code | Sol's fixture |
|---|---|
| HEAD, with none of stage 3b | **carried** |
| stage 3b, bridge on | **carried** |
| stage 3b, bridge off | minted |

The cause is older than this stage and is the same sentence this whole file starts from:
`extractText` walks `textContent`, so a marker's digits are part of `Block.text`, and `Alpha1` and
`Alpha` + marker `1` **genuinely read alike**. `exactKey` has always given two blocks that read
alike their ids in document order — that is its documented behaviour, and it is why a page of
repeated `<li>Yes</li>` keeps its ids at all.

So the bridge *restores* the old behaviour rather than inventing it, and turning the bridge off would
be the change: it would mint where the code has always carried, and re-mint 206 of 356 blocks on a
pre-canonicaliser article. Pinned in the tests with a control asserting the two blocks really do read
alike, so it cannot pass for the wrong reason. **What would actually fix it** is stopping marker
digits from reaching `Block.text` at all, which changes what every consumer reads and is not this
stage.

Sol's proposed remedy — revision metadata saying the previous blocks predate canonicalisation — is
the right shape for the problem it was aimed at, and is not needed for this one.

### The gate is a gate, not an answer

Three smaller findings, all taken. `MIGHT_BE_STAMPED` is built from the attribute constants and is
case-insensitive, since an HTML attribute name is; when the parse then finds no stamp, the caller's
**own text** goes back rather than a re-derivation, so prose that merely writes an attribute name out
keys exactly as before; and a stamp whose value is not one stage 2 could have minted is **left in
place** rather than removed, because deleting a control while contributing no identity collapses two
blocks that differ only in what was deleted.

### Cost

`splitIntoBlocks` with carry-over goes from 350ms to 519ms on wiki_transformer (356 blocks, 206
stamped) — one parse and one `extractText` per stamped block per lookup. A batch stage nobody is
waiting on. Unstamped blocks skip the parse, which is most of every page and all of a page without
footnotes.


## Stage 4, as it actually landed — 2026-08-28

[`src/supplement.ts`](../../src/supplement.ts) is the whole of the new machinery: split the blocks,
append the node. `TreeNode` gains `treatment?: "supplement"` and nothing else.

**Measured through the real extraction pipeline over the committed fixtures** (`output/verify4.mts`
— canonicalise, Readability, sanitise, split, then the stage-4 split and append over a mechanical
body tree), because a green test written by the person who wrote the code is the weakest evidence
available:

| fixture | blocks | body | apparatus | node | `checkTree` | parts before/after | sections | summary targets | fisheye at mid-notes | arc marker | spine bands | structureHash |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gwern | 184 | 143 | 41 | "Notes" | clean | 12 / 12 | 36 / 36 | 49 → 49 | "Notes" | 12 numbered + 1 | 1 | moved |
| wiki_transformer | 356 | 235 | 121 | "Notes" | clean | 20 / 20 | 59 / 59 | 80 → 80 | "Notes" | 20 numbered + 1 | 1 | moved |
| acx_footnotes | 96 | 78 | 18 | "Notes" | clean | 7 / 7 | 20 / 20 | 27 → 27 | "Notes" | 7 numbered + 1 | 1 | moved |
| tufte | 68 | 63 | 5 | "Notes" | clean | 6 / 6 | 16 / 16 | 23 → 23 | "Notes" | 6 numbered + 1 | 1 | moved |
| ar5iv, gutenberg, constitution | — | all | **0** | none | clean | unchanged | unchanged | unchanged | — | — | — | **unchanged** |

The last row is the control, and the last column of it is the one that would have cost the most: a
`structureHash` that moved on a supplement-free tree would have invalidated every `labels.json`,
`ideas.json` and similarity artefact on disk at once.

**The apparatus is one trailing run on all four**, measured before anything was built
(`output/supp-contig.mts`): gwern 143–183, wiki_transformer 235–355, acx_footnotes 78–95, tufte
63–67 — each a single run ending at the last block. So `splitBlocks` takes the maximal trailing run
and **refuses the whole split** if any supplement block sits outside it: no node, the tree exactly as
it would have been before this stage, and the count reported in `TocRun.strandedSupplement` rather
than swallowed. Partial coverage was the alternative and it is worse — a node covering only some of
the apparatus breaks invariant 4 the moment it exists.

### The nine guards, each watched go red on its own

"Delete the supplement and watch validation fail" mostly re-tests the old coverage invariant, so each
guard in `checkSupplements` was deleted separately (`output/mutate-invariants.mts`) and the suite
re-run. Every one reddens its own case and only its own:

| guard removed | tests reddened |
|---|---|
| 1 — depth-one child of the root | 1 |
| 2 — supplements overlap | 1 |
| 2 — range runs backwards | 1 |
| 3 — contains only supplement blocks | 2 (its own, and the disguised-body-node case) |
| 4 — contains every supplement block | 1 |
| 5 — only leaves beneath it | 1 |
| 6 — carries no gist | 1 |
| 6 — never nested | 1 |
| 6 — never the root | 1 |
| the *other* direction: an internal body node must have a gist | 1 |

The last row is the one the design turns on. A gistless body node must not be able to buy the
exception by calling itself apparatus, and it cannot: the test that renames a gistless part
`treatment: "supplement"` is caught by invariant 3, because a part is full of body blocks.

### The invisible failure, and the plan's fix was half a fix

The whole-article summary breaks exactly as predicted — the root's range end moves and
`buildSummaryTree` drops the entry without a word. The test that builds a tree, writes summaries
against it, appends a supplement and asserts the article-level summary is still there **fails on the
old join** and passes on the new one.

**But `depth === 0` alone, as the plan specified it, quietly gives up a guarantee that was already
there and already tested.** `tests/summarise.test.ts` has had a case since summaries shipped —
"drops an entry whose range matches no node, rather than moving it" — feeding a **depth-0** entry
whose range matches nothing and asserting it is dropped. Matching the root by depth alone attaches
it, and that test goes red. Which is the right answer: a stale root summary shown as current is the
lie the drop rule exists to prevent.

The fix is `depth === 0` **and the start block id**. Only the root's *end* moves when a supplement is
appended; its start is still the article's first block. So the supplement case is fixed and the stale
case stays dropped, which is strictly better than either rule alone, and no existing test had to be
changed.

### Four consumers, one projection

`navigableItems` ([`web/tree.ts`](../../src/web/tree.ts)) collapses every cell under a supplement to
one item anchored at its first block, and the fisheye ([`context.ts`](../../src/web/context.ts)),
keyboard navigation ([`keynav.ts`](../../src/web/keynav.ts)), the saved reading position
([`position.ts`](../../src/web/position.ts)) and the arc's numbering all read it. Each was reverted
to the raw cells in turn, and each reddens **its own** assertion and no other — which is the shape of
the bug this guards against, one panel disagreeing with the other three while everything still
renders.

`navPlan` now takes the `Geometry` rather than its cells and leaf depth, because it needs the
supplement index that lives on it; that is the only signature that changed.

### What else it touched, and one thing it did not

- `partsOf` ([`arc.ts`](../../src/arc.ts)) is where "the parts of the argument" is defined, so
  excluding the supplement there fixes the arc's `buildArc` throw and the glossary, ideas and tweet
  skeletons in one edit. The client's numbering is a *separate* copy of the rule — it numbers the
  cells it is drawing, not the tree — and both are held by tests.
- `targetsOf` ([`summarise.ts`](../../src/summarise.ts)) returns before descending into a supplement.
  Forty endnotes sail past `MIN_BLOCKS`, and `textOf` filters by `isBodyEvidence`, so the call would
  have gone out with an empty scope and come back with a plausible paragraph about nothing.
- `deriveLibraryScalars` excludes the node and its leaves from the part and section counts.
- `publicTree` ([`dto.ts`](../../src/public/dto.ts)) **silently drops optional `TreeNode` fields by
  design**, so `treatment` is named there by hand. Without that line a visitor's copy numbers the
  apparatus as a part.
- The spine band is dimmed and keeps its true proportional height; the spine never descends into it,
  because one hairline per endnote is the phantom-row failure arriving by a different door.
- **`planBatches` needed nothing.** Its per-section filter is `isStructural`, which is false for
  every supplement block, so the node contributes no sibling set and costs no label call.

### The two prompts that were still sending footnote prose

GPT Sol's review of stage 3 landed mid-build and both fixes belong here, because both are the
ordering this stage was already introducing. The claim "automatic model calls do not read footnotes"
was **false**, and it was false for the two largest calls the pipeline makes.

**The ToC prompt, which is the big one.** `renderBlocks` sends every block's text and marks a block
`NOT-GISTABLE` from `!b.gistable` — and a prose footnote *is* gistable, so a note was not even
marked. The model could invent sections and gists over the apparatus and `buildTree` copies those
gists straight through, into the arc, the tweets, the glossary and the ideas, all of whose own
evidence is filtered. Stage 4's ordering fixes it outright: the model is handed
`splitBlocks().body`.

**But the fallback left a hole, and it is the one this stage created.** When the apparatus is not one
trailing run, `splitBlocks` gives up and `body` is every block again — so the fix withholds the notes
only from articles it already understood. `renderBlocks` therefore withholds a supplement's **prose**
itself and keeps its **id**, because the model's ranges have to tile the whole article and a block it
cannot name is a block no node can cover. Zero of the seven fixtures are that shape, so only a
synthetic stranded-note input exercises that line, and one exists.

**The labels prompt, where marking is not hiding.** `renderBatch` prints a context window of
`CONTEXT_BLOCKS` — one — either side of a batch, in full. Moving the marker to `isStructural` was
right and was not enough: `body.push(...: ${block.text})` still sent the prose. Now
`!isBodyEvidence(block)` skips the block entirely.

**Measured over the real fixtures** (`output/prompt-leak.mts`), because the size of this mattered and
the review's wording implies more than is there:

| fixture | supplement blocks | in the ToC prompt | labels batches | note prose leaked | supplements the guard skipped |
|---|---|---|---|---|---|
| gwern | 41 | 0 | 3 | 0 (**1** without the guard) | 1 |
| wiki_transformer | 121 | 0 | 4 | 0 (**1** without) | 1 |
| acx_footnotes | 18 | 0 | 2 | 0 (**1** without) | 1 |
| tufte | 5 | 0 | 1 | 0 | 1 |
| ar5iv, gutenberg, constitution | 0 | 0 | 3 / 38 / 6 | 0 | **0** |

The last column is the control — how many supplement blocks actually fell inside a window, i.e. how
many the guard had to skip. It is **1**, not 41: `CONTEXT_BLOCKS` is one, so the exposure was the
first note after the body and not the whole bibliography. Real, and an order of magnitude smaller
than the review's wording suggests. The zeroes on the three control fixtures are what make the other
rows evidence rather than arithmetic.

Two things the measurement itself got wrong first, and both are worth keeping:

- **Tufte reported a leak that was not one.** Its page shows the HTML source of a margin note as a
  `<pre>` code sample, so the same sentence is legitimately in the argument. A detector that greps
  the prompt for a note's words has to subtract the body's own text, or it reports the mirror of the
  failure it exists to catch.
- **The obvious fixture cannot exercise the labels path at all.** Planting one note in the *last*
  block of `example/` — which is what the existing prompt test does — puts it **two** blocks past the
  last labellable block, and the window reaches one. The assertion passes on code that sends the
  whole apparatus. `tests/block-policy-prompts.test.ts` now plants a two-block note run, measured
  with the guard removed before the line was written
  ([a-corpus-that-cannot-exercise-its-arm](../reusable/silent-success.md)).

All three guards were removed one at a time and each reddens exactly its own case: the ToC body
split, the ToC withhold on the stranded path, and the labels skip.

### What the brief got wrong

- **`structureHash` needing a legacy branch was right, but not because of the supplement node.**
  `structureHash` never hashed `treatment` at all, so the corpus was safe without a branch — the
  branch is what makes the hash *sensitive* to a node becoming apparatus, which it has to be, since
  `labels.json` stamps it. Written as: no node carrying `treatment` ⇒ the old five fields byte for
  byte (`5bb2ef0284bce2cd` over `example/tree.json`, pinned before anything was changed).
- **The plan's summary fix was half a fix** — see above.

## Stage 5a, as it actually landed — 2026-08-28

The prose side: the marker, the preview, the jump, and the back-links. One new file,
[`src/web/notes-view.ts`](../../src/web/notes-view.ts), plus a note card in
[`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx), a marker branch in `TableView`'s delegated
click handler, and one section of `styles.css`. The tree, the spine dimming and the exclusion
tooltips are stage 4's and are not here.

**What actually arrives at the client**, measured through the real pipeline rather than read off the
stage-2 header, because everything below depends on it:

```html
<sup><a href="#spya-a3maqu" id="fnref1" data-spya-note-ref="spya-note-71f9008f33">1</a></sup>
```

The stamp survives Readability and the sanitiser, and the `href` has already been repointed at the
note's **block** id. Every marker in all four fixtures — 34 gwern, 170 wikipedia, 18 acx, 5 tufte —
resolves, and every one lands on the **first** block of its note, which is what makes "gather the
range from the block it landed on" correct rather than lucky.

**The marker is recognised twice.** The attribute is ours and cannot be forged by a page, but a buggy
pipeline could write one, so the resolved block's `role` is checked too — and all three note fields
together, since stage 3 writes them in one ancestor lookup and a block carrying one without the
others is a fault rather than a shape to be tolerant of. Never by being inside a `<sup>`.

**The preview strips ids rather than namespacing them**, which was the one question the brief asked
to have answered out loud. A namespaced id is still an id, and nothing links *into* a floating copy
of a note — so namespacing keeps a second naming scheme unique for no reader's sake, while stripping
removes the hazard outright. The hazard is real and not theoretical: a note's stored html carries its
own block id, and Wikipedia's carries about a hundred of Parsoid's `mw…` ids, all of which are
already in the document once. `internalTarget`'s `[id="…"]` fallback takes the first in document
order, so a duplicated id in a portal can capture the article's own links.

The note's own back-links are dropped from the preview with them. On Wikipedia they are the run of
`1 2 3 …` that *opens* the note — thirteen links to where the reader already is, ahead of the first
word of the thing they asked to see.

**Plural back-links, and the number that is not thirteen.** The most-cited note in `wiki_transformer`
has 13 markers in **12** passages: one paragraph cites it twice. So "markers" and "places this is
cited" are a third pair of numbers that a naive implementation conflates, in the same family as
notes-versus-blocks. The card says *cited in 12 passages*; the note carries 13 back-links, one per
use, each pointing at its own block.

Landing among thirteen identical arrows with no way to tell which is yours is the failure the plan
named, so the jump remembers where it came from: `onFollowNote(from, to)` in App, and
`markReturnPath` puts `data-came-from` on the back-link whose href is the passage the reader left.
Written straight onto the injected html rather than through `annotateHtml` — the annotation path
would re-parse and re-serialise every marked block for one attribute — and re-applied whenever the
prose is re-annotated, because React replaces those nodes wholesale.

**Touch is deliberate, and it is the exception to the card's own rule.** `tapSelector` used to be
`mark.term` alone, on the stated grounds that a link already does something under a finger and
replacing that with a preview would take a working affordance away. A marker is the case where that
reasoning inverts: navigating is exactly what it should not do, because the jump recentres all three
panels on "Notes" for a citation the reader has not read yet. So a marker gets the spine's
`bandPress` rule — first tap shows the note, second tap goes there. A **back-link** keeps the
ordinary behaviour: going back is what the reader wants from it, and it is one tap.

One touch bug was fixed on the way: `useHoverCard`'s scroll dismissal fired for scrolls *inside* the
card, so the first thing a finger does with a note preview — scroll it — would have closed it.

**Six mutations, each run and reverted:**

| mutation | tests reddened |
|---|---|
| recognise a marker by its attribute alone, skipping the role check | **1** |
| preview only the note's first block | 3 |
| stop stripping ids out of the fragment | 3 |
| leave the note's own back-links in the preview | 3 |
| mark every back-link as the way the reader came | 1 |
| count a citing passage once per marker | 2 |

The first row is the one worth keeping, because it reddened **nothing** on the first run. The
negative fixture named a note id the index had never heard of, so the assertion passed for any
implementation — including one that never looks at the target at all, which is the mutation. Putting
a real note in the index beside the mis-aimed marker is what made it a test of the rule rather than
of an unknown id. Same shape as [a-corpus-that-cannot-exercise-its-arm](../reusable/silent-success.md).

A second, smaller version of the same thing: the first draft of these tests used ids like
`spya-body01`, which are **not valid spideryarn ids** — `o` and `1` are not in the alphabet — so
every resolution went through `internalTarget`'s legacy `[id="…"]` fallback instead of the
`tr[data-block]` path production uses. Green, and about the wrong code path.

**What is not verified.** Everything above is vitest, and vitest cannot see a reader. Nothing here
has been through a browser: not the marker's dress, not whether a long note scrolls inside the card,
not focus order, not a real finger, and not the `data-came-from` highlight, which needs a real jump
to a real notes section. And the shelf still has no footnote-bearing article on it, so a browser pass
needs one ingested first.

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

**Decided, 2026-08-28: show the transcription as ordinary blocks.**

> We definitely want the HTML-ified transcription, so that footnotes/bibliography are native block
> objects (perhaps with metadata so they get treated slightly differently) not an image or anything
> weird like that.
>
> — Greg, 2026-08-28

The review had proposed a third option — rasterise the unverified bibliography page and show the
original pixels, authoritative and ungated. It was rejected, and the reasoning is worth keeping
because the same idea will occur to somebody again:

- **A page image is a foreign object in this app.** Everything here is a block of text with a stable
  id; that is the one contract ([block-ids.md](../project/block-ids.md)). Pixels carry no ids, so a
  reader could not select a sentence and comment on it, search could not reach it, chat could not
  cite it, granularity zoom would have nothing to compress and reading position nothing to land on.
  It would be the only thing in the article that none of the features work on.
- **"Cropped" is not available.** A `PdfRecord` is `{page, type, text, continues, uncertain}` — no
  coordinates. The model returns text, not boxes. So it would be the whole page, body prose
  included, and the reader would meet the last paragraph twice: once as words, once as pixels.
- **It is not cheap either.** There is no render path today — pdf.js is used only for
  `getTextContent`, to build the scoring baseline. Rasterising needs `@napi-rs/canvas`, the exact
  package Vercel's tracer leaves out of the function bundle, which already produced
  `DOMMatrix is not defined` on every route with a green build
  ([`pdf.ts:30`](../../src/pdf.ts), [pdfjs-dommatrix-serverless.md](../postmortems/pdfjs-dommatrix-serverless.md)).

**What the gate exemption actually means, restated**, because the plan overstated it. The gate exists
so that a paper does not *fail ingestion* over a bibliography whose recall is poor, and because a
lost paragraph of body prose is invisible and serious. A garbled author name in a citation is
neither — it is visible on the page and checkable against the source. So the exemption is a decision
about failing, not a prohibition on showing.

What remains is to **say so rather than imply it**. The gate is per page, and reference blocks come
from pages, so we already know which ones went unchecked. That belongs at the supplement, not on
each of sixty-four entries — a reader does not care which page an entry came from:

> **64 references — transcribed from the PDF and not checked line by line.**

replacing the ordinary "shown as written, never summarised" wording on a References supplement whose
pages were exempt. Same shape as the app already saying "a scan cannot be checked" out loud rather
than pretending.

**We still cannot tell "no footnotes" from "detector broken."** The known positive is confirmed:
`data/Nagel_Bat.pdf` has numbered footnotes on PDF pages 3, 4 and 5 (the article's own pages
435–437; notes 1, 2, 3 and 5 directly confirmed in the text layer). One detail for whoever writes
the assertion, and it would have cost an afternoon otherwise: `pdftotext` renders the *in-text
marker* as an apostrophe-ish scan artefact rather than a clean digit, so the test must key off the
**note body** at the foot of the page (`1 Examples are…`, `2 Perhaps there could not…`) and must not
expect a superscript digit to survive text-layer extraction.

## The last four findings, as they actually landed — 2026-08-29

GPT Sol's review of stage 4 returned BLOCK with eight findings. Four were fixed in `d385ce4`
and named in its message; these are the other four. Sol gave upfront input before they were
built (`footnotes-finish-upfront-sol.md`) and reviewed the code afterwards
(`footnotes-finish-review-sol.md`).

**A supplement must have at least one leaf** — `checkSupplements`, src/tree-invariants.ts.
Invariant 5 said "no child of mine has children", which a childless supplement satisfies
vacuously; the two projections then disagree about an article that renders, because
`navigableItems` finds no cell to collapse and drops the apparatus while the `?at=` tracker
walks blocks and keeps it.

The hole turned out to be **narrower than either review described**, and finding that out is
the reason the fixture is the shape it is. Stripping the children from a supplement covering
six blocks does *not* reproduce it: the generic tiling rule catches it as `leaf spans 6
blocks, expected 1`. The one case that escapes is the **one-note article**, where the range
is a single block and `leaf spans 1 block` is exactly right. So the test builds a one-note
article, and asserts `range[0] === range[1]` as a precondition — a later simplification back
to six notes would go on passing while testing nothing.

**The invariants now run where the tree is written** — `assertTreeSound`, called from
`generateToc`. They had run in a CLI a human invokes (src/validate-tree.ts) and in the
publish guard, which collects reasons rather than throwing (src/store/pg-revisions.ts), and
on neither path that writes `tree.json`. It throws rather than warns: an invalid tree is not
a recoverable representation of an article, and publishing one turns a visible pipeline
failure into a silent reader-facing one.

Two things fell out of building it. The `sourceHeading` problem message **quoted the
author's own heading back**, and a thrown step error is written to the log by src/jobs.ts
with `errorFields` — so wiring this guard in would have put a line of the article into the
logs. The heading is gone from the message; the node id is enough to find it
([logging.md](../project/logging.md)). And the integration test's **control earned its
keep**: with empty labels the sound case threw too, because `checkCoverage` runs immediately
after the guard, so "nothing was written" would have held for both tests with the guard
deleted.

**The return path marks the note the reader followed, not every note in the passage** —
`markReturnPath`, src/web/notes-view.ts. Matching on the passage alone asks "which
back-links lead where I came from", and when one passage cites *two* notes the answer is one
back-link in each. The case that had been tested was one note cited thirteen times, which is
the mirror image and works.

The passage and the note now travel as one `NoteReturn` off a single `NoteMarker`, so a
caller cannot pair the passage it left with a note it did not follow. Three call sites, not
one — `TableView.tsx` and **both** of `ProseHoverCard.tsx`, which the first pass missed. And
the match is an attribute comparison rather than a built selector, which removes the
interpolation and the regex guarding it rather than adding a second of each.

**Neither fingerprint can be made ambiguous by prose** — `hashBlocks` and `structureHash`,
src/source-hash.ts. Both legacy forms are delimiters rather than framings: `structureHash`
joins fields with U+0000 and rows with a newline, `hashBlocks` joins `id \t text` with a
newline. `title` and `gist` are model prose and `text` is the article's own, so neither
delimiter is under our control, and a collision means two different articles each reporting
that nothing has changed. Both were reproduced — `1eff068c824dec8b` and `88b65f848068e592`,
each from two different inputs.

The fix routes only the **ambiguous** input to the framed form, so no artefact on disk
changes hash. That is measured rather than assumed: across `data/`, 890 blocks in 8 articles,
not one `text` carrying a tab or a newline and not one title or gist carrying a NUL. Sol
found the `structureHash` half; the `hashBlocks` half was not in the eight findings and is
the more reachable of the two, since ordinary extraction collapses whitespace but imported
blocks never go through it.

Sol also caught that the compatibility test was **tautological** — it compared a hash against
a hash of a copy of its own input, and would have held just as well if the change had
invalidated the whole corpus. Both pins are literal hex now. And the two pins had been in one
`it`, where the first masked the second: a probe forcing every field down the framed branch
reddened one and never ran the other. Two clauses need two probes.

### The blocker the first review of the fixes found — 2026-08-29

Sol's review of the four fixes above returned BLOCK on one finding, and it is the most
interesting thing in this whole stage because **the tree it breaks is completely valid**.

A supplement is always depth 1 with its leaves at depth 2, so a note's chain is three nodes
long however deep the body tree goes. The moment the body is deeper than that — leaf depth 4,
sections column at depth 3 — every supplement cell at the sections column is a
*continuation*. `itemsFromCells` (src/web/context.ts) drops continuations; `buildSections`
and `keynav` never filtered them. So the apparatus vanished from the fisheye and stayed in
`?at=` and the keyboard, and a reader standing in the notes was told they were in the last
section of the argument.

Reproduced before fixing, on `example/tree.json` deepened by one level with one note appended:

```
checkTree problems: []          <- nothing is wrong with this tree
leafDepth: 4  sectionDepth: 3
navigableItems supplements: 1   [{ row: 34, continuation: true }]
fisheye supplements:        0
?at= sections named Notes:  1
```

Nothing forbids that shape: `buildTree` accepts arbitrary depth, the invariants impose no
maximum, and the prompt asking for three levels is not a contract the model is held to.

The fix is one condition — a supplement is never dropped as a continuation — and it is safe
rather than merely effective because the rule exists to stop a node *already listed at a
coarser column* being listed twice, and a supplement item is not that: `navigableItems` has
already replaced the cell's node with the supplement node itself, which appears nowhere else
in that column.

**The test that missed it is the part worth remembering.** It compared `navigableItems`
against `buildSections` — and `buildSections` is a thin wrapper over `navigableItems`, so the
two agreed by construction and it would have passed with the bug fully present. That is the
same tautology Sol had caught hours earlier in the hash compatibility test, which compared a
hash against a hash of a copy of its own input. Twice in one change, both times a comparison
between a thing and a restatement of itself. The rewritten test compares the **fisheye**
against the saved position, which is the seam they can actually part at, and varies the
topology as well as the note count.

Checked afterwards, against the same deep shape: the spine keeps its supplement row, the arc
keeps its supplement cell, the summary tree still lists "Notes", and the fisheye's anchor rows
are strictly increasing, so no two items share one.

### The second blocker: summary mode was still summarising the notes — 2026-08-29

Sol's second pass confirmed the continuation fix and found one more, in the last panel nobody
had looked at. `buildSummaryTree` descended into the supplement, so `SummaryPanel` numbered
"Notes" as **part 3** of a two-part argument, gave it children **3.1 … 3.6** — one row per
endnote, each with no title and no gist — and printed *"No summary for this section"* under
every one of them.

That last part is the sharpest version of the mistake this whole stage exists to avoid: a
supplement node has no gist **on purpose**, because the notes are shown as written and never
summarised — so the panel was reporting our own promise as a fault, on the one row where it
was working correctly.

The fix is in two halves and each needed its own probe. `buildSummaryTree` marks the node
`supplement`, stops descending, and does not advance the part counter over it (so appending an
apparatus cannot renumber part 1 or invent a part 3). `SummaryPanel` then draws no number, no
missing-summary line, and dims the row into the same key the spine and the arc already use.

**The evidence was on my own screen and I read straight past it.** A probe I ran before the
review printed `Notes | | | | | |` — the six empty titles after "Notes" *are* the phantom
rows — and I recorded it as "the summary tree includes Notes, good". A check whose output you
skim is not a check.

And the four new panel assertions started life as one test, where the first failing assertion
ended it: a probe that reverted **both** halves of the fix reddened only the numbering and
never ran the missing-summary check at all. Split into one test each. That is the third time
in this one change that two clauses shared a single probe — the same trap as the two hash
pins.

### The seventh projection: diagram mode — 2026-08-29

Sol's third pass confirmed the summary fix and found the last one. Six projections had been
dealt with one at a time — the fisheye, `?at=`, keynav, the arc, the spine, summary mode — and
**diagram mode was the seventh**, absorbing the apparatus into the argument in three ways.

`buildGraph` walked the supplement as an ordinary node: it was drawn, chained into reading
order, and — the part that actually corrupts the picture — its prose was counted into the term
vectors. And because the root's range spans the whole article, dropping the node alone would
not have been enough; the root went on counting every note.

The measurement is the reason this is worth a paragraph. On a fixture whose notes contain one
rare word and the body does not:

```
root top terms: zibbleflux, back, front, note, number, reads, nobody, artificial
```

A word occurring **only in the footnotes** was the top term for the whole article. The
diagram was describing the piece by its endnotes.

Two lines fix it: skip supplement entries after `walk` (not inside it — `walk` is shared with
the outline, which genuinely wants the supplement), and skip non-body blocks when counting
terms, using the same `isBody` the anchor edges in that file already use.

The third was in Drift and Trail. They plot embedded body paragraphs and correctly receive no
point for a note, but the dot ranges are made to **tile** — the last dot answers for everything
below it — and "everything below" swallowed the apparatus. A reader three endnotes deep was
shown standing on the final paragraph of the argument, with Trail lighting that paragraph's
stretch of chain as the brightest thing in the picture. The tiling exists for a body paragraph
too short to embed, where a blinking mark is worse than an approximate one; the apparatus is
not that case, so the last dot's range now stops at the last body block and a reader inside
the notes gets no dot, which the caller already handles.

### The eighth consumer, and the fourteenth — 2026-08-29

Sol's fourth pass gave the closed inventory of consumers I had asked for and named an eighth:
`articleStats` counted the supplement as a part and its endnotes as sections, so the masthead,
the metadata page and the public page each advertised a seven-part article with endnotes as
having eight parts. The shelf card already did not, with the reasoning written beside it —
two implementations of one derivation and only one of them right. Diagram scale went the same
way: the notes were out of the nodes and out of the terms but still in the denominators, which
squeezed the argument into the top of the panel, stopped the last paragraph reaching the final
progress step, and made a screen reader say "paragraph 2 of 4" about the last body paragraph
of two.

**And the fifth pass found the one that mattered most, which no amount of owner-side testing
could have caught: `publicTree` dropped `treatment`.** Every fix above reads the apparatus off
the node, so a visitor got all of it back exactly as it was — footnotes numbered as a part of
the piece, a blank row per endnote in summary mode with "No summary for this section" on each,
the spine and the outline descending into individual notes, the diagram drawing them as
argument. Measured through the real DTO: 1 part and 1 section for the owner, 2 and 2 for a
visitor of the same article.

The test that guarded it had said, in as many words, *"whoever lands the footnotes lane's
`TreeNode.treatment` meets this test and decides"*. That was me, and the decision is that it
crosses: it says a node is apparatus, which is structure exactly as `depth` and `title` are,
derived from the article's own markup rather than from anything the owner did. The
exactly-these-keys guard in the same file caught the change on the way through, which is what
it is for.

Two smaller ones from the same pass. `buildGeometry` took `leafDepth` from every node, so an
article whose body tree is only parts-deep gained a granularity column containing nothing but
a note leaf with no gist — while the "Levels" stat beside it said one. The ladder comes from
the body now; the apparatus still projects into the columns that do exist. And the spoken
paragraph count is a *count* rather than a coordinate: `bodyRows` must stay monotonic in row
number for the axis, so a stranded note sits inside it, and the label had to stop reading from
it.

### The sixth review: the idiom, and one more seam — 2026-08-29

Six rounds now, and **every one found something real**, which is itself the finding worth keeping:
the stopping rule "the last review confirmed it" would have been wrong five times running.
[Prompt](footnotes-finish-review-6-prompt.md) -> [answer](footnotes-finish-review-6-sol.md).

**The blocker was a seam, again, and the same shape as the DTO one.** `dots()`
([`src/web/scatter.ts`](../../src/web/scatter.ts)) drops a point whose block id it does not
recognise -- a deliberate rule, on the grounds that a dot in the wrong place is worse than a dot
missing. But it accepted any id that *did* resolve, including one that is now apparatus. The article
and the projection are two separate reads of the current revision, so a re-ingest in the gap hands
the browser a recognised id that no longer means what it meant, and the page then said two things at
once: the you-are-here line withheld because the reader is not in the argument, and a note drawn as
one of the argument's paragraphs. With a trailing note, *"paragraph 3 of 2"*.

**Recognising an id is not the same as the block behind it still being argument.** Every existing
test missed it for one reason, and Sol named it: each of them builds its points from the body alone,
so none could construct the state.

**The probe is the part to remember.** The fix has two halves, and they are not equally testable.
Removing the `isBody` guard alone reddens two of the three new tests. Restoring the invented
`?? d.row + 1` label fallback alone reddens **nothing** -- with the guard in place nothing can reach
it. So that half has no test of its own and cannot have one; it is there so that a later change to
the guard cannot bring the lie back quietly, and the third test is the tripwire for the pair. It is
written into the test rather than counted as evidence.

### The idiom the compiler could not check

The question put to Sol was whether `...(node.treatment === undefined ? {} : { treatment: ... })`
protects the key name. It does not, and this was then measured both ways rather than believed:
spelling it `treatmnt` **compiled clean**, and after the fix the same typo is
`error TS2345: Argument of type '"treatmnt"' is not assignable to parameter of type 'keyof TreeNode'`.
TypeScript's excess-property check does not inspect keys contributed through a spread, and an outer
`satisfies` does not repair it.

[`src/public/dto.ts`](../../src/public/dto.ts) had twenty-two of them. Its whole design is that every
key a stranger receives is named here, once, on purpose -- so the one mistake it cannot afford, a
field that silently fails to cross, was the one mistake the compiler was blind to. `publicTree`
dropping `treatment` was an *omission* rather than a typo; a typo would have looked identical and
been harder to see. One `opt<T, K extends keyof T>(source, key)` closes the class, and the call site
still reads as this file naming the field deliberately, which is the property the design rests on.
Recorded in [security-map.md](../project/security-map.md), because it is a defence rather than a
helper.

### The seam inventory, closed -- and one premise of mine was wrong

Sol enumerated every place a `TreeNode` or a `Block` is rebuilt, selected, or serialised, and found
**no second field-by-field transport boundary**. Two things are worth carrying forward from it:

- **Postgres blocks are not one JSON document.** They are explicit columns in `revision_blocks`
  ([`src/db/schema.ts`](../../src/db/schema.ts)), which is the opposite of what the prompt asserted.
  They are safe today because every full-block path carries `role`, `treatment` and `noteId` -- but
  the reason is "somebody named them", not "the shape cannot lose a field". Anything new on `Block`
  has to be added there by hand.
- The narrow reads -- hashes selecting `id/text/role/treatment`, scalars selecting
  `words/treatment`, search deliberately ignoring `treatment` -- are each correct *and* each a place
  a future field will be silently absent.

Two smaller things: `0` is the right floor for an empty `bodyDepths` (no consumer divides by it, and
`1` would invent a rung that does not exist), and the two comments in `tests/public-dto.test.ts` that
still described `treatment` as deliberately dropped now say what was decided and why.

### Somebody finally looked at it — 2026-08-29

Seven rounds of review and 5700 green tests, and until this point **nobody had seen the feature with
their eyes**. No local article had footnotes, which is why. One now does: `data/fn-wikipedia/`,
Wikipedia's "Transformer (deep learning)" — 358 blocks, 121 of them notes, 20 real section headings.
Its tree was built deterministically from those headings because the AI gateway had run out of
credit, so it has no gists; that costs nothing here, because everything under test branches on
`treatment` rather than on gist text.

The route in matters for reading the evidence. The real `App` was mounted at `/read/fn-wikipedia`
with `useSession()` signed out, which takes the **visitor** branch, and `window.fetch` was stubbed
for `/api/public/article/fn-wikipedia` only, from the artefacts on disk.

| check | result |
|---|---|
| spine | **one** "Notes" band, last of 21, `opacity: 0.1` against 0.75, tooltip "Notes · 3,383 words · 71% in", and clicking it from the part before jumps `?at=` to the notes' first block |
| masthead | **"20 parts · 237 sections"** — not 21, not 358; 237 is exactly the body count |
| marker → note → back | hover gives a sidenote-grade card with the citation's own links live and "cited in 2 passages"; the note carries **plural** back-links "1 2"; the round trip lands on the exact citing paragraph |
| granularity zoom | scrolling through the whole notes range keeps both the current tier and the ancestor highlight on "Notes", and both return to the body on the way out |
| summary mode | not testable on this fixture (no `summary.json`) — **since checked in full** on a real article, below |
| diagram | not reachable signed out, and deliberately so — **measured directly instead**, below |

**What this is and is not evidence for.** The payload was built from the artefacts directly, not
through `publicArticle()`, so this shows the *visitor-side client* renders the apparatus correctly
**given** a payload carrying `treatment`. That the DTO now emits it is a separate piece of evidence
(`tests/public-dto.test.ts`, and the 1-part/2-part measurement recorded in
[the fifth review](footnotes-finish-review-5-sol.md)). Two halves, two kinds of
evidence, and neither substitutes for the other. Summary mode was unseen by anyone at this point; it has since been
checked in full, and diagram mode measured another way — both below.

**The two fixtures are gone, and this is how to rebuild one.** They were scaffolding for a single
browser pass and they could not stay: `tests/store-roundtrip.test.ts` and `tests/store-parity.test.ts`
scan `data/` for any directory holding both `blocks.json` and `tree.json`, and a half-built article —
a tree with no `labels.json` — is one the publication gate rightly refuses, so both suites went red
for **every agent in this tree**. Their `README.md` files had to go for the same kind of reason:
`tests/store-artefact-manifest.test.ts` asks the *filesystem* what sits beside an article and holds
the answer against a written list, and a README has no home in Postgres and should not be given one.

So this is the durable copy of what those files said. Rebuilding takes no model call: run
`npm run blocks -- output/fn-wikipedia.html`, then drive the real `splitBlocks`, `buildTree` and
`appendSupplement` from a throwaway script. **Do not leave the result in `data/` afterwards.**

- **fn-wikipedia** — "Transformer (deep learning)", from `output/fn-wikipedia.html`. 358 blocks: 237 body, 121 footnotes in
  one contiguous trailing run. The tree was built by the **real** `splitBlocks`, `buildTree` and
  `appendSupplement`, driven by a throwaway script rather than `generateToc`, which is the only
  thing that calls the model. One flat tier of 20 parts, one per heading block, every title the
  article's own heading text quoted verbatim; then `appendSupplement` added "Notes" from the 121
  trailing blocks. **No gists and no nav labels**, deliberately, because inventing them would have
  made the browser pass evidence about an agent's prose. `meta.json` was hand-written from the debug
  page, since no fetch record existed. Consequence: `validate-tree` reports **21 problems, one per
  internal non-supplement node** — `internal node has no gist` — and that is unavoidable for any
  tree built this way, since `checkTree` requires a gist on every internal node with no exception
  for the root. Structurally it is sound: no partition gaps, no range errors, no supplement-shape
  violations. Do not "fix" the gists by writing prose into them.
- **your-book-review-the-pale-king** — do not bother: its tree was a **degenerate placeholder**, 80
  depth-one leaves under the root, because the article has exactly one heading block and there is no
  hierarchy to derive. Its `raw.html` is kept in `data/` because it is a genuine fetch of the live
  Substack page and nobody need re-fetch it. Use fn-wikipedia for anything to do with footnotes.

**Summary mode, seen at last — and through the real DTO.** This was the one reader-facing check
nobody had ever made, because until 2026-08-29 no article existed with both real footnotes and real
model-written summaries. `data/scaling-hypothesis` is that article: Gwern's piece, fetched live and
put through the whole pipeline, 186 blocks with 41 footnotes, 8 parts, 35 summary entries.

The route matters more than usual here. The preview page imported **`publicArticle()` from
[`src/public/dto.ts`](../../src/public/dto.ts)** and called it in the browser on the real artefacts,
stubbing only `window.fetch` for the one public path. So this is the **visitor boundary itself**,
not a hand-assembled payload — which makes it the end-to-end confirmation of the fifth review's
finding, the one no owner-side test could see.

| | |
|---|---|
| rows the apparatus produces | **1**, not 41 — `.summ-title-row` returns 9: eight numbered parts, then `Notes 41¶` |
| is "Notes" numbered? | **no** — part 8's title is `[<span class="summ-number">8</span>, "Site Footer"]`; the Notes title is a bare text node with no `.summ-number` element at all |
| "No summary for this section" | **0** matches page-wide |
| the eight real parts | numbered 1–8, in order, unshifted, each with its own generated gist |
| is Notes distinguished? | `oklch(0.63 0 0)` grey, weight 500, uppercase — against `oklch(0.97 0 0)`, weight 600, normal for a part |
| can it be descended into? | no: its toggle carries `leaf` and is `disabled` |
| can a reader still get there? | **yes** — clicking it sets `?at=spya-cbz06n` and highlights the row |

That last pair is the whole design in two rows, and it is exactly what Greg asked for: *"a way to see
it in the structure of the doc … but we don't necessarily need to summarise and include it in the
argument"*. Present in the structure, absent from the argument, and reachable.

**Diagram mode, measured on the real article instead.** Diagram mode is owners-only by design
(`src/web/visitor.ts` § `COSTS`, and `/api/similar` and `/api/projection` sit behind `requireUser`),
so a signed-out browser cannot reach it and no browser evidence for it exists. The graph half of the
fix was instead measured directly against `data/scaling-hypothesis`, which is a stronger test than
the synthetic fixture the unit tests use (`output/graph-real.mts`):

| | |
|---|---|
| vocabulary appearing **only** in the footnotes | 505 terms |
| distinct terms across all 43 drawn nodes | 292 |
| of those, footnote-only | **0** |
| apparatus nodes drawn | **0** of 43 |
| `totalWords` | 12,646 — the body exactly, not 16,855 |

The apparatus is 4,209 words, a **quarter** of this article, so the word count is not a rounding
difference: Force divides each node's position by that total, and counting the notes in the
denominator squeezed the whole argument into the top three-quarters of the panel.

**The first version of that probe was vacuous and said so by accident.** `GraphNode.terms` is an
*array*, and reading it with `Object.keys()` collected the indices `"0"`–`"9"`, so it reported a
graph vocabulary of ten terms and no leak — a clean result from a check that could not have found
one. Ten terms across forty-three nodes is what gave it away. The probe now asserts the opposite
direction too: that every one of the 292 terms it does see is a body term, so the extraction is
working and a footnote term would be visible to it. **A count that looks too small is the tell.**

**A false trail worth keeping.** The first fisheye reading looked exactly like the bug the plan
warns about — the current tier moved to "Notes" while a separate ancestor highlight stayed stuck on
an earlier part, which is "the panel claims the reader is still in the argument while they stand in
the bibliography". It was an artefact of the test: position had been driven by `history.replaceState`
plus a dispatched `popstate` rather than by scrolling. A real wheel scroll through the same range
behaved correctly throughout. **A synthetic navigation is not a navigation**, in the same way a
scripted click is not a focus, and it manufactures the failure it is looking for.

## Still open

- Whether the marker carries the substantive-versus-citation distinction in v1, or stays
  undifferentiated — the Sol/Fable reconciliation is written down, but the call is Greg's.

*(The bibliography question is settled — see [The PDF path](#the-pdf-path).)*
