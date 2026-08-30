# The article with one heading, and the sentence cut into four blocks

**2026-08-30.** A local ingest of `http://www.paulgraham.com/read.html` — 23 blocks, about 900 words
— spent **16 model calls and $0.39** and never produced a table of contents. Stage 4 was attempted
six times. Two of the six succeeded. The other four failed in two different ways:

```
The table of contents is not a valid tree, so it was not written (1 problem):
  n0025: its sourceHeading does not match any heading block in its range

The nav labels for one section failed twice.
  First attempt:  asked for 21 labels, got 17, missing 6, 14, 17, 20. Nothing written.
  Retry with double the reasoning allowance: asked for 21, got 13, missing 6, 10, 11, 14, 16.
```

Both are the same bug wearing two coats, and neither is in stage 4. **Stage 3 gave stage 4 a block
list that does not describe the article**, and stage 4's two contracts — every block gets a nav
label, a claimed heading must exist — are both unsatisfiable against it.

## The confound, resolved first

A peer was refactoring [`src/toc.ts`](../../src/toc.ts) during the run and the dev server restarted
eleven times, so some attempts may have run half-saved code. That is why the first thing done here
was to reproduce on HEAD rather than to read diffs. Both halves reproduce on `93e1cf8`, one of them
deterministically. The refactor is not involved.

## What the block list actually was

`data/read/blocks.json`: 23 blocks — 1 heading, 21 text, 1 media. Nine of the 21 text blocks are one
word or less:

| # | tag | words | text |
|---|---|---|---|
| 6 | `span` | 1 | `[1]` |
| 10 | `a` | 1 | one word, italicised in the source |
| 11 | `p` | 1 | `.` |
| 14 | `span` | 1 | `[2]` |
| 16 | `p` | 1 | `Notes` |
| 17 | `p` | 1 | `[` |
| 18 | `a` | 1 | `1` |
| 20 | `p` | 1 | `[` |
| 21 | `a` | 1 | `2` |

Every one of these is a *piece of a sentence*, not a sentence. `paulgraham.com` is hand-written HTML
from the 1990s: no `<p>` elements at all, `<br /><br />` between paragraphs, `<font>` for styling,
`<b>Notes</b>` where a `<h2>` would go, and footnote markers written as `[<a name="f1n">1</a>]`.
Stage 2 turns the `<br>`s into paragraphs; the inline elements survive as direct children of the
container, and [`collectElements`](../../src/blocks.ts) then does this:

```ts
// Unknown wrapper: descend if it holds block-level children, else treat
// it as a block so no content silently disappears.
```

Which is a good rule with a good reason, and on this page it promotes a footnote marker to a
paragraph. The block then gets `gistable: true`, because it has non-whitespace text — and `gistable`
is defined in [`src/types.ts`](../../src/types.ts) as *"this block has independently describable
prose"*. For `.` that is simply false.

The reproduction runs the real splitter over synthetic HTML of the same shape and gets `[1]`, `[`
and `1` as gistable blocks. It does not need the article.

## Symptom 1: a nav label nobody can write

[`planBatches`](../../src/labels.ts) packs sibling sets until 60 gistable blocks. This article has
21, so it is one batch — which is correct, cheap, and exactly what the design wants. **Batch size is
not what went wrong.** Rebuilding the batch that the failing run sent, and marking the ordinals the
two attempts reported missing:

```
[  ]  1  <h1>   4w    2  <p>   4w    3  <p>   2w    4  <p>  39w    5  <p>  49w
[12]  6  <span> 1w  "[1]"
[  ]  7  <p>   15w    8  <p>  23w    9  <p>  91w
[ 2] 10  <a>    1w  (one italicised word)
[ 2] 11  <p>    1w  "."
[  ] 12  <p>  106w   13  <p>  35w
[12] 14  <span> 1w  "[2]"
[  ] 15  <p>   22w
[ 2] 16  <p>    1w  "["
[1 ] 17  <a>    1w  "1"
[  ] 18  <p>   26w   19  <p>   1w
[1 ] 20  <a>    1w  "2"
[  ] 21  <p>   34w
```

**Every ordinal either attempt dropped is a one-word fragment. Not one of the twelve real paragraphs
was ever dropped, across two attempts and nine dropped labels.** Picking those nine at random from
21 would happen about three times in a hundred thousand.

So the model was not being sloppy. It was asked for a 6–20 word nav label describing a paragraph
whose entire content is `.`, and it did the only sensible thing, which was to leave it out.
[`parseLabels`](../../src/labels.ts) then refused the whole batch — correctly, by its own contract,
which exists because a silently short answer is the failure this stage was built to prevent
([toc-max-tokens.md](toc-max-tokens.md)). It retried at double the reasoning allowance, and more
thinking made the model *more* certain these were not paragraphs: five dropped instead of four.

> A retry that gives the model more room to think will not fix a question that has no answer. It
> will make the model better at declining it.

The two attempts dropped different ordinals — `6, 14, 17, 20` then `6, 10, 11, 14, 16`, overlapping
on two — and it is tempting to read a moving set as the signature of an answer that got too long,
against a fixed set as the signature of a few hard questions. That inference does not hold. There
are **eight** unlabellable blocks here, not four, and nothing requires a model to decline the same
subset of eight twice. What discriminates is not whether the indices move but what sits at them: the
drops move around inside the pool of fragments and never once leave it.

## Symptom 2: a heading that is not a heading block

The article has exactly one `kind: "heading"` block — the `<h1>` title. `Notes` is a `<b>`, so it is
a text block. The structure prompt says:

> Where the author gave the section a heading, use that heading's text UNCHANGED and repeat it in
> `"sourceHeading"`.

To a model reading the rendered article, `Notes` is a heading. **Four structure calls were run on
HEAD against the real blocks. All four claimed `sourceHeading: "Notes"` for a node containing no
heading block, and all four were rejected by `checkTree` with the log's exact message** — twice with
the log's exact node id, `n0025`.

`checkTree` is right and should not be softened. The heading check earned its place the hard way
(eleven false failures on the constitution, all apostrophes — see
[toc-max-tokens.md](toc-max-tokens.md)) and it is the only thing standing between a model that
invents structure and a sidebar that lies. The bug is not that it fires. The bug is *where* it
fires.

## This is not one article

The same survey, run over every article in `data/` — gistable blocks of one word or less:

| article | blocks | headings | fragments | what they are |
|---|---|---|---|---|
| `greatwork` | 330 | 1 | **89** | `[1]` … `[89]`, the same footnote markers |
| `consciousness` | 499 | 23 | 24 | mostly `[edit]` — Wikipedia's own section links |
| `spaced-repetition` | 372 | 27 | 19 | section names that arrived as text |
| `meditations-on-moloch` | 289 | 1 | 8 | `I.` `II.` … `VIII.` — the section numerals |
| `read` | 23 | 1 | 8 | the table above |
| `arxiv-2308` | 669 | 50 | 8 | `Abstract`, `Authors`, `Contents` … |
| `scaling-hypothesis` | 186 | 25 | 6 | `Appendix`, `Backlinks`, `Bibliography` … |
| `constitution`, `revistes-ub-30977`, `source`, `source-2`, `what-if…` | | | 1 each | a section name as text |
| `noema-mythology-of-conscious-ai`, `writes` | | | 0 | clean |

**Thirteen of fifteen carry at least one, and `greatwork` carries 89.** It is another
`paulgraham.com` essay with the same footnote markup and one heading, so it has both halves of this
bug at thirteen times the scale, sitting in the corpus undetected because nobody has re-ingested it.

`meditations-on-moloch` is the other instructive one: one heading, and its eight section numerals are
text blocks. That is `Notes` again — a section header the model can see and `checkTree` cannot.

## A third failure mode, found while testing the headings hypothesis

`writes` is the control that matters: another Paul Graham essay, 19 blocks, one heading, and **zero
fragments** — it has no footnotes, so stage 3 gives it a clean block list. Running the structure call
three times on it:

```
writes  (19 blocks, 1 heading)   run 1: 16 internal nodes    run 2: THREW    run 3: 11 internal nodes
source  (41 blocks, 5 headings)  run 1: THREW    run 2: 16 internal nodes    run 3: 17 internal nodes
```

Both throws are `buildTree`'s tiling check — *"child 3 leaves a gap of 1 block"*, *"child 5 overlaps
the one before it by 1 block"*. **Two of ten structure calls made today returned a tree whose
children do not partition their parent**, and it happened on the well-headed article too. That is a
much higher base failure rate for stage 4 than anything here had assumed, it is independent of
headings and of fragments, and it is its own finding.

## Does the carving move when there are no headings?

It does, and less than the failures do. Measuring the *boundaries* rather than the section count —
two runs can both produce nine sections and cut in nine different places — as the Jaccard similarity
between the sets of block indices at which some internal node begins:

| article | headings | fragments | boundary agreement between runs |
|---|---|---|---|
| `writes` | 1 | 0 | **0.55** |
| `source` | 5 | 1 | **0.91** |

So an article with no headings really is carved differently each time, and one with headings is
carved nearly identically. One pairwise comparison each is a direction, not a measurement, but it
agrees with `read`, whose four runs produced 32, 34, 34 and 36 nodes.

**It is not, however, the mechanism behind either failure here, and it is worth being exact about
why.** The four `read` runs carved the article four different ways and *all four* claimed
`sourceHeading: "Notes"` and were rejected. The failure is invariant to the carving: wherever the
model chooses to start the Notes section, `Notes` is still a `<b>` and still not a heading block. The
same goes for the labels — a fragment is unlabellable in whichever batch it lands in.

Unstable carving is a real property of headingless articles and it is worth designing for. It is not
what cost $0.39 today.

## Why it cost $0.39 rather than $0.11

Three multipliers, in increasing order of how much they are our fault.

**The step is attempted repeatedly and there is no lock.** `beginStep` in
[`src/store/artifacts-fs.ts`](../../src/store/artifacts-fs.ts) writes a marker and says so plainly:

> Deliberately not a lease: a pid and a timestamp invite "it has been an hour, it must be dead", and
> that guess is how two runs end up writing one article.

Each structure call takes ~50 seconds; the first four started at 08:29:00, 08:29:20, 08:29:35 and
08:29:54, so four were in flight before any finished. That is the poller and eleven dev-server
restarts, against a design that deliberately does not exclude them. Worth knowing, not a regression.

**`assertTreeSound` runs after the labels are paid for.** In `generateToc` the order is: structure
call → `buildTree` → `generateLabels` (up to two calls per batch) → `mergeLabels` →
`assertTreeSound`. The comment says the choice was made knowingly:

> It does mean a tree the model got wrong is found after a full label run has been paid for; that is
> the cheaper of the two mistakes.

That reasoning holds for a problem only discoverable after merging. It does not hold for
`sourceHeading`, which is a claim about `blocks.json` — a file we have had in memory since before
the call. Three of the four failures threw away a label run that had already succeeded.

**Six structure calls at `effort: "high"`.** ~4,000 reasoning tokens and ~$0.05 each; $0.30 of the
$0.39. The labels were the cheap half all along.

## Why nothing caught it

Every fixture in the repo is well-formed modern HTML with real headings. The corpus has never
contained a page where a bolded word is the section header, and it has never contained a block with
one word in it — so:

- `tests/labels-batching.test.ts` builds its fixture blocks from
  `Paragraph ${i} says something about the matter at hand.` Nine words each. A batching test whose
  every block is labellable cannot see a block that is not.
- `tests/toc-build.test.ts` and the validate-tree tests give every fixture a heading block for every
  `sourceHeading`, so the one branch that fires here is the one no fixture reaches.
- The structure eval measures tree quality on articles that have headings.

This is [a corpus that cannot exercise its arm](../reusable/silent-success.md) in its purest form:
three separate suites are green about behaviour none of their inputs can produce.

## The red test

Three assertions, all red on `93e1cf8`, from synthetic fixtures shaped like the page:

| test | assertion that fired |
|---|---|
| stage 3 emits no gistable one-word fragment | `expected [ '[1]', '[', '1' ] to deeply equal []` |
| `planBatches` asks for no label it can only be refused | `expected [ '[1]', '.' ] to deeply equal []` |
| `buildTree` emits no unbackable `sourceHeading` | `expected [ 'n0005: its sourceHeading does not match any heading block in its range' ] to deeply equal []` |

## The fix

**Root cause, one sentence:** stage 3 promotes a contentful inline element to a top-level block and
marks it as having prose of its own, and stages 4 and 5 then hold the model to two contracts that
this block list cannot satisfy.

The fix has one part that is the real one and two that are backstops. Each backstop is worth having
on its own, because each closes a class rather than this instance.

1. **Stage 3 should not emit a block that is a fragment of a sentence.** An inline element with no
   block-level children and no sentence in it belongs merged into its neighbour, not standing beside
   it. This is the only part that fixes the article rather than the symptom — the fragments are
   equally wrong for reading time, search, granularity zoom and every block-id consumer; the ToC is
   just where it was loud. It is also the part that has to be handled carefully, because merging
   changes block ids, and ids are [the one contract](../project/block-ids.md).

2. **`buildTree` should check `sourceHeading` where it checks everything else.** It already validates
   the model's ranges and its tiling at parse time, with a comment about exactly this class of
   mistake. `sourceHeading` is the one remaining claim the model makes about our blocks and the only
   one deferred to a check 100 lines and one paid label run later. Checking it there costs
   nanoseconds. A claim the blocks cannot back should be **dropped, with the title kept and the drop
   recorded on the run** — not fatal. `checkTree` keeps the invariant unchanged for trees arriving
   from anywhere else, which is what it is for.

3. **`isStructural` should not promise a nav label for a block with no prose to label.** A block the
   model cannot describe should not be in a batch, and an unlabelled leaf is already only a warning.
   This is the backstop that would have kept the article ingesting even with 1 and 2 unfixed.

## What would have caught it earlier

- **A fixture with a one-word block.** One line in `tests/labels-batching.test.ts`. Nine-word
  fixtures cannot fail a labellability rule — a cap needs a fixture that exceeds it, and a
  labellability rule needs one that falls short of it.
- **A fixture whose only heading is its title.** The whole of symptom 2 is one `if` that no test
  input reaches.
- **Reading the missing ordinals rather than the count.** `missing 6, 14, 17, 20` was in the error
  from the first attempt. Mapping four ordinals back to four blocks takes a minute and says the
  answer outright; "17 of 21" invites you to blame the batch size, which is what happened. The
  message names the ordinals but not what is at them, and the mapping lives in code
  ([`parseLabels`](../../src/labels.ts)) that has the blocks in hand.
- **An old-HTML page in the corpus.** Everything here follows from `<br><br>` and `<b>` where the
  repo has only ever seen `<p>` and `<h2>`.

## The general shape

> A validator that fires correctly on an input the pipeline should never have produced is reporting
> a bug one stage upstream. Fix the stage that made the input, not the check that noticed.

Both failures here are downstream checks doing their job. Softening either — dropping the exact-set
rule for labels, or letting `sourceHeading` pass unverified — would have turned a loud failed ingest
into an article with a sidebar that omits paragraphs and names sections the author never wrote. The
expensive, visible failure was the right outcome from the wrong block list.

And the second half, which is what made it expensive rather than merely wrong:

> Check a model's claims about our own data at the moment we parse them, not at the moment we would
> otherwise have to. Everything needed to reject `sourceHeading: "Notes"` was in memory before the
> call was made.

## What is still open

**Two structure calls in ten returned an untileable tree**, on a well-headed article as readily as on
a headingless one. `buildTree` catches it and throws, so it is loud rather than dangerous, but it
means a stage-4 attempt has a substantial per-call chance of costing ~$0.05 and producing nothing —
before any of the bugs above are involved. It needs its own measurement over more than ten calls, and
it is not this bug.

**Carving instability on headingless articles** is measured above at 0.55 boundary agreement against
0.91. It causes none of the failures here, but it means the sidebar for such an article is a
different sidebar on every regeneration, which matters for anything that stores a node id.

## See also

- [architecture.md § Stage ownership](../project/architecture.md#stage-ownership) — stage 3 owns the
  first fix, stage 4 the other two
- [block-ids.md](../project/block-ids.md) — why merging fragments is not a free change
- [toc-max-tokens.md](toc-max-tokens.md) — the exact-set label contract, and why it exists
- [silent-success.md](../reusable/silent-success.md) — the corpus that cannot exercise its arm
