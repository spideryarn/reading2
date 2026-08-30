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

**The step is attempted repeatedly and there is no lock.** See
[the section below](#a-class-rather-than-a-bug-the-lease-that-is-not-one).

**~~`assertTreeSound` runs after the labels are paid for.~~ Fixed, 2026-08-30 (`835b3f5`).** In
`generateToc` the order was: structure call → `buildTree` → `generateLabels` (up to two calls per
batch) → `mergeLabels` → `assertTreeSound`. The comment says the choice was made knowingly:

> It does mean a tree the model got wrong is found after a full label run has been paid for; that is
> the cheaper of the two mistakes.

That reasoning holds for a problem only discoverable after merging. It does not hold for
`sourceHeading`, which is a claim about `blocks.json` — a file we have had in memory since before the
call. **Three of the six attempts threw away a label run that had already succeeded.**

`checkTree` now also runs on `structure`, before a label is asked for. Everything it can fail on is
fixed by the structure call — the ranges, the tiling, the coverage, the gists, the titles,
`sourceHeading`, the supplement rules — and none of it can move in `generateLabels`, because
`mergeLabels` touches leaves only and only sets or deletes `navLabel`.

**It is an addition, not a reorder, and that distinction is the whole of it.** One `fail` in
`checkTree` reads `navLabel`: the phantom-row rule at
[`src/tree-invariants.ts`](../../src/tree-invariants.ts), a leaf carrying a label for a block
`isStructural` says may never have one. There are no labels yet at the early call, so that rule is
vacuous there and only the call after the merge can make it. **Moving the check would have silently
gutted it** — which is what this file is otherwise entirely about, so it would have been a poor way
to end. Two calls: the early one is a cost guard, the late one is the guarantee about the file.
`checkTree` is pure and costs 0.111 ms on the `example/` fixture, measured.

**Six structure calls at `effort: "high"`.** ~4,000 reasoning tokens and ~$0.05 each; $0.30 of the
$0.39. The labels were the cheap half all along.

## A class rather than a bug: the lease that is not one

`beginStep` in [`src/store/artifacts-fs.ts`](../../src/store/artifacts-fs.ts) writes a marker and
says plainly what it is not:

> Deliberately not a lease: a pid and a timestamp invite "it has been an hour, it must be dead", and
> that guess is how two runs end up writing one article.

Each structure call takes ~50 seconds; the first four started at 08:29:00, 08:29:20, 08:29:35 and
08:29:54, so four were in flight before any finished — the poller and eleven dev-server restarts,
against a design that deliberately does not exclude them.

> A step that can fail non-deterministically, behind a poller with no lease, multiplies the cost of
> every failure by however many attempts overlap. Neither half is a bug. Nobody chose the product.

That is worth the space because it generalises past this incident. The marker's reasoning is good and
the model call's variance is legitimate; the interaction between them is what nobody costed, and it
will do this again to any expensive step that learns to fail intermittently.

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

### And the waste was invisible to every test that could have seen it

`tests/toc-write-guard.test.ts` already ran the whole stage against a tree the model got wrong. It
asserted the right things — it throws, it writes nothing — and it passed, every time, on the order
that paid for a full label run first.

It could not have failed, and the reason is worth stating on its own:

> **The outcome was identical under both orders — throws, writes nothing. Only the cost differed.**

An outcome-based test cannot see that, however well written it is, because the thing that changed was
not in the outcome. The fix was to stop asserting what happened and start **counting the calls**: the
new test tracks how many times `generateLabels` was invoked, which is the only place the difference
was ever visible.

That generalises far past this bug. Any wasted call, redundant fetch, duplicated write or
recomputed cache lands in exactly this blind spot — the result is right, so every assertion about the
result agrees, and the only witness is a counter nobody thought to keep. It is the sibling of
[silent-success](../reusable/silent-success.md): there the check agrees with the bug, here the check
is simply looking at the wrong quantity.

## The red test

Three assertions, all red on `93e1cf8`, from synthetic fixtures shaped like the page:

| test | assertion that fired |
|---|---|
| stage 3 emits no gistable one-word fragment | `expected [ '[1]', '[', '1' ] to deeply equal []` |
| `planBatches` asks for no label it can only be refused | `expected [ '[1]', '.' ] to deeply equal []` |
| `buildTree` emits no unbackable `sourceHeading` | `expected [ 'n0005: its sourceHeading does not match any heading block in its range' ] to deeply equal []` |

The fourth — that a structurally invalid tree must not reach `generateLabels` — is not in this file.
It went into `tests/toc-write-guard.test.ts` with the fix it belongs to (`835b3f5`) and is green.

### The source, kept here because it has nowhere else to live yet

**This is the reproduction for R2, R3 and R4, and all three are red on purpose** — their fixes are
deliberately unapplied, so committing it to `tests/` would leave the gate permanently red, and a
permanently-red test is one everybody learns to ignore. It is written down here instead of left in a
scratch directory, which is not a place work survives.

**Each assertion lands in `tests/` with the proposal it belongs to**: `1b` when the labellability
predicate tightens — alongside whichever migration is chosen for the stored trees — `2` when
`buildTree` starts dropping an unbacked `sourceHeading`, and `1a` with the stage 3 change, where it
belongs to that stage's owner rather than to stage 4.

Fixtures are synthetic. Nothing here is a line of anybody's article: `SENTENCE` is invented, and the
markup is the *shape* of an old hand-written HTML page — no `<p>`, `<br><br>` between paragraphs, a
bolded word where a heading would go, a footnote marker as its own inline element.

```ts
/**
 * The red test for job spya-v2f7b3.
 *
 * Three assertions, each naming one link in the chain that cost $0.39 and 16
 * model calls on a 23-block article. All three are red on HEAD (93e1cf8).
 */
import { describe, expect, it } from "vitest";
import { splitIntoBlocks } from "../src/blocks.js";
import { planBatches } from "../src/labels.js";
import { buildTree, type ModelNode } from "../src/toc.js";
import { checkTree } from "../src/tree-invariants.js";
import type { Block, Tree } from "../src/types.js";

/** A block as stage 3 emits one. */
function block(i: number, text: string, tag = "p", gistable = true): Block {
  const id = `spya-${String(i).padStart(6, "0")}`;
  return {
    id,
    tag,
    kind: tag.startsWith("h") ? "heading" : "text",
    text,
    words: text.trim().split(/\s+/).filter(Boolean).length,
    html: `<${tag} id="${id}">${text}</${tag}>`,
    gistable,
  };
}

const SENTENCE = "This paragraph makes a claim and then supports it with an example.";

describe("an article whose only heading is its title", () => {
  it("1a. does not turn an inline fragment into a block with prose to describe", () => {
    // <br>-separated prose with a footnote marker and an emphasised word, which
    // is the shape of every essay on paulgraham.com.
    const { blocks } = splitIntoBlocks(
      `<div>${SENTENCE}<span>[1]</span><br /><br />${SENTENCE}<br /><br />` +
        `<b>Notes</b><br /><br />[<a name="f1n">1</a>] ${SENTENCE}</div>`,
    );
    const fragments = blocks.filter((b) => b.gistable && b.words <= 1);
    expect(
      fragments.map((b) => b.text),
      "a one-word fragment is not a paragraph, and gistable means it has prose of its own",
    ).toEqual([]);
  });

  it("1b. does not ask the model for a nav label it can only refuse", () => {
    // Blocks 3 and 4 are the real ones: a footnote marker and a stranded full
    // stop, both `gistable: true` out of stage 3 today.
    const blocks = [
      block(1, "The Need to Read", "h1"),
      block(2, SENTENCE),
      block(3, "[1]", "span"),
      block(4, "."),
      block(5, SENTENCE),
    ];
    const tree: Tree = {
      version: 1,
      generator: "test",
      slug: "read",
      rootId: "n1",
      nodes: {
        n1: { id: "n1", depth: 0, parent: null, children: ["n2", "n3", "n4", "n5", "n6"],
              range: [blocks[0]!.id, blocks[4]!.id], title: "Root", gist: "A gist." },
        ...Object.fromEntries(blocks.map((b, i) => [`n${i + 2}`, {
          id: `n${i + 2}`, depth: 1, parent: "n1", children: [],
          range: [b.id, b.id], title: "",
        }])),
      },
    } as unknown as Tree;

    const asked = planBatches(tree, blocks).flatMap((b) => b.blocks);
    expect(
      asked.filter((b) => b.words <= 1).map((b) => b.text),
      "every block in a batch is asked for a 6-20 word nav label; a one-word " +
        "fragment cannot ground one, so the model omits it and the whole batch is refused",
    ).toEqual([]);
  });

  it("2. does not build a tree carrying a sourceHeading the blocks cannot back", () => {
    // "Notes" is a <b> on the page, so stage 3 gives it kind "text". The
    // structure model quotes it as a heading anyway — 4 times out of 4 on HEAD.
    const blocks = [
      block(1, "The Need to Read", "h1"),
      block(2, SENTENCE),
      block(3, "Notes", "p", false),
      block(4, SENTENCE),
    ];
    const root: ModelNode = {
      title: "The Need to Read",
      gist: "The piece argues that reading and writing cannot be separated.",
      range: [blocks[0]!.id, blocks[3]!.id],
      sourceHeading: "The Need to Read",
      children: [
        { title: "The Argument", gist: "It opens with the claim.",
          range: [blocks[0]!.id, blocks[1]!.id] },
        { title: "Notes", gist: "The footnotes qualify the argument.",
          range: [blocks[2]!.id, blocks[3]!.id], sourceHeading: "Notes" },
      ],
    };

    const tree = buildTree(root, {}, blocks, "read");
    expect(
      checkTree(blocks, tree).problems,
      "buildTree checks the model's ranges and its tiling at parse time; it does " +
        "not check the one other claim the model makes about our blocks, so an " +
        "unbackable sourceHeading survives until assertTreeSound — after a full " +
        "paid label run — and throws the whole step away",
    ).toEqual([]);
  });
});
```

## The fix

**Root cause, one sentence:** stage 3 promotes a contentful inline element to a top-level block and
marks it as having prose of its own, and stages 4 and 5 then hold the model to two contracts that
this block list cannot satisfy.

Four parts. One is applied; one is the real fix and is not ours to make.

### 1. Check the structure before paying for the labels — **applied, `835b3f5`**

Written up under [Why it cost $0.39](#why-it-cost-039-rather-than-011). It fixes no bug: the article
still fails. It stops each failure costing a wasted label run, which on this ingest happened three
times.

### 2. `buildTree` should validate `sourceHeading` where it validates the rest — **drop, never throw**

`buildTree` already checks the model's ranges and its tiling at parse time, with a comment about
exactly this class of mistake. `sourceHeading` is the one remaining claim the model makes about our
blocks and the only one deferred.

When it fires, **strip the field, keep the tree, log it.** Not a throw, and the evidence is the
reason: four calls out of four made this same mistake on this article, so a throw is not "retry and
it will pass" — it is a guaranteed loop at ~$0.05 a turn on an article that can never import.

`sourceHeading` is **provenance, not structure**: it records that a title is the author's own rather
than ours. Every consumer was checked rather than assumed, and none is a correctness consumer:

| consumer | what it does with it |
|---|---|
| `TableView.tsx`, `ContextList.tsx`, `Spine.tsx` | render a `§` marker beside the title |
| `public/dto.ts` | passes it across the boundary, optional |
| `tree-invariants.ts` | exempts the title from the trailing-punctuation **warning** |

There is no `sourceHeadingShare` in `evals/` — that measure does not currently exist, so nothing is
scored on it. So the cost of dropping is: a `§` glyph disappears and one warning re-arms. A tree
whose title is ours rather than the author's is a slightly worse tree; a tree that does not exist is
not a tree.

### 3. `isStructural` should not promise a nav label for a block with no prose

A block the model cannot describe should not be in a batch, and an unlabelled leaf is already only a
`warn` — the machinery for "this leaf has no label" exists and is deliberately non-fatal, so the tree
stays valid and the article ingests. This is the backstop that would have kept the article ingesting
with 2 and 4 unfixed.

**It has a migration cost, and it is not small.** The predicate is read by `checkTree`'s phantom-row
rule, which is a `fail`: a leaf carrying a `navLabel` for a block `isStructural` calls non-structural
is a *problem*, and the publish guard refuses a tree with problems. Counting labelled fragments in
the trees on disk today:

| `read` | `scaling-hypothesis` | `fowler-phrenology` | `constitution` | `revistes-ub-30977` | `source` | `source-2` | `what-if…` |
|---|---|---|---|---|---|---|---|
| 8 | 6 | 3 | 1 | 1 | 1 | 1 | 1 |

**Eight of the ten stored trees would become invalid the moment the predicate tightens**, and
`noema-mythology-of-conscious-ai` and `writes` are the only two that would not.

Two ways out, and **this file deliberately does not choose between them** — the decision has the same
shape as the stage 3 one below, and belongs with it:

- **Ship it with a sweep.** A migration walks every stored tree and strips the `navLabel` from any
  leaf whose block the new predicate calls non-structural. Trees become valid again, the affected
  rows disappear from the sidebar, and nothing else moves. Costs a migration and a re-publish of
  eight articles.
- **Give the phantom-row rule a migration story.** Line 234 fails on a tree written under the *old*
  predicate, which is not a tree anybody got wrong — it is a tree from before the rule changed.
  Making the rule tolerate that (a tree version, a grandfather clause) keeps stored trees valid but
  puts a permanent exception into an invariant, which is the kind of thing this repo pays for later.

**The threshold is fitted to English and has no data behind the number.** "One word or less" is what
the evidence showed and nothing more: nine dropped labels and a corpus survey, all of them English.
There is nothing separating a 1-word block from a 3-word one.

**And a word count is not a measure of prose in Chinese, Japanese or Thai**, which do not put spaces
between words. `wordsIn` splits on `/\s+/`, so a full Japanese paragraph counts as one "word" and the
predicate as drafted would classify it as a fragment and refuse to label it — silently, since the
result is a missing sidebar row rather than an error. **No article in the corpus could ever reveal
this**, because every one of them is in English. That is exactly the class this repo keeps writing
up: a check that cannot fail on any input we own. Whatever the rule ends up being, it must be
measured on something other than whitespace.

**Where the predicate lives.** [`block-policy.ts`](../../src/block-policy.ts) is explicit that its
five predicates are five policies that happen to agree rather than one formula wearing five names.
This wants a sixth question — *may we ask a model to describe this block on its own?* — not a widened
`isStructural`. Widening it is how five policies that happen to agree become one policy that quietly
does not, and it would drag search, reading time and embedding along with it.

### 4. Stage 3 should not emit a fragment of a sentence as a block — **not on this evidence, and not by us**

The real fix, and [the argument is below](#the-argument-for-stage-3-for-the-stages-owner-and-for-greg).

## The quiet one, which is worse

While reproducing the above, the same block list turned out to have broken something that never
failed at all.

**Not one of the 23 blocks carries `treatment` or `role`** — the field is simply absent. `isBody` is
`block.treatment !== "supplement"`, so it is true for all 23; `splitBlocks`
([`src/supplement.ts`](../../src/supplement.ts)) looks for a trailing run of non-body blocks, finds
none, and returns `body = the whole article`. Stage 3 stamps `role: "footnote"` off markers that
stage 2 leaves behind, and this page's `[<a name="f1n">1</a>]` is not recognised as footnote
structure. Old HTML, again.

So the footnotes went to the structure model as ordinary body, and the tree that eventually landed in
`data/read/tree.json` carries a node titled `Notes` with a **gist summarising the footnotes**.
[`docs/plans/footnotes.md`](../plans/footnotes.md) says that must never happen — the apparatus is
shown as written, never summarised — and `checkTree` enforces it, but only for nodes actually marked
as supplements. This node is not marked, so nothing objected.

> A silent wrong artefact outranks a loud failed ingest.

The ToC failure cost $0.39 and shipped nothing, which is the good kind of bad. This one shipped a
finished, plausible, wrong artefact past every check in the pipeline, and it is on disk now. It gets
its own fix and its own test, and it should be tracked above the failure this file was opened for.

Whether the right place is stage 2's marker stamping or stage 3's role assignment is a question for
the stage's owner. But note what it does to the argument below: **the fragments and the supplement
miss are two consequences of one gap.** Fixing them in stages 4 and 5 means patching the same cause
twice, in two places, neither of which is where it is.

## The argument for stage 3, for the stage's owner and for Greg

**What changes.** `collectElements` ([`src/blocks.ts`](../../src/blocks.ts)) descends into an unknown
wrapper if it has block-level children, and otherwise emits it as a block *"so no content silently
disappears"*. The rule is sound and the fallback is the right instinct. On markup where inline
elements sit as direct children of the container — no `<p>`, `<br><br>` between paragraphs — it
promotes fragments of a sentence to paragraphs. The fix is for such an element to be **merged into
the adjacent block instead of standing beside it**, which keeps the "nothing disappears" guarantee
the current rule exists to give.

**Which ids move, and it is not only the fragments.** This is the part that decides whether the
change is cheap or expensive, and it is easy to read past. Ids are re-attached across a
re-extraction by matching `(tag, collapsed text)` against the previous run's blocks, first-come, each
consumed once ([`src/blocks.ts`](../../src/blocks.ts), and
[block-ids.md](../project/block-ids.md)). So:

- the fragments' own ids **vanish**; and
- **every paragraph that absorbs a fragment has its collapsed text changed, so it does not re-match
  either, and is minted a fresh id.**

The second bullet is the one that matters and it is invisible in the phrase "it moves block ids".
Concretely:

| article | fragments | paragraphs that absorb one | ids at risk |
|---|---|---|---|
| `read` | 8 | ~5 | ~13 of 23 |
| `greatwork` | **89** | up to **89** | **up to ~178 of 330** |

On `greatwork` that is better than half the article's ids, from a change whose one-line description
is "stop emitting fragments".

**What breaks for an article that already has comments in it.** Everything anchors on block id:
comments, notes, highlights, saved scroll position, search deep links (`/read/<slug>?at=<blockId>`),
and `block_identities`, whose primary key is `(articleId, blockId)`. The existing behaviour for an id
that no longer exists is the orphan sweep in [`src/routes.ts`](../../src/routes.ts), which flips
affected comments to `error`. So the damage is **loud rather than silent** — a reader sees a comment
has come unstuck rather than finding it quietly attached to the wrong paragraph — and that machinery
is already built. It is still real loss on re-extraction, and it lands on exactly the paragraphs a
reader was most likely to annotate, because a paragraph with a footnote marker in it is a paragraph
making a claim.

**Why it is still the right fix.** These blocks are wrong for far more than the table of contents.
Reading time counts them, search indexes them, similarity embeds them, and granularity zoom offers
the reader a paragraph whose entire content is `.`. The ToC is only where it got loud enough to cost
$0.39 in one sitting. And, per the section above, it is one gap producing two defects — the
fragments and the supplement miss — so fixing it here fixes both, while fixing it downstream fixes
neither properly.

**What needs deciding before anyone writes it**, and it is not a technical question: whether
re-extraction of an already-annotated article is gated on this, or whether the merge applies only to
newly-ingested articles until there is a migration that can carry an annotation from a dying id to
the block that absorbs it. The second is more work and is probably the honest answer. That is Greg's
call.

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
means a stage-4 attempt has a substantial per-call chance of costing ~$0.05 and producing nothing,
before any of the bugs above are involved.

**Ten calls is not an estimate of that rate**, and this file should not pretend otherwise. It is
properly measured by the structure eval's calibration run, which has more calls across more
documents and now records a throw as an outcome rather than retrying past it — the change that makes
the measurement possible, since retrying past a throw is what had kept the rate at zero.

**And those throws may be repairable rather than fatal.** The check is `child[0] !== cursor`, and
both throws seen here were off by exactly one block — so `child[0] = cursor` would close a gap and an
overlap identically, in about twenty lines. Whether that is a fix or a disguise depends entirely on
the size distribution of the failures, which is the thing being measured:

- **If the failures are small** — a block or two, as both of these were — repairing them recovers
  roughly a fifth of all structure calls for almost nothing, and it is the cheapest candidate fix
  anyone found today.
- **If some are large**, snapping a boundary silently rewrites the model's answer into a different
  one and calls it correct. That is the tree equivalent of salvaging a truncated response, which
  [toc-max-tokens.md](toc-max-tokens.md) deliberately refused to do, and it must not be built.

Not investigated here on purpose; the calibration run answers it.

**Carving instability on headingless articles** is measured above at 0.55 boundary agreement against
0.91. It causes none of the failures here, but it means the sidebar for such an article is a
different sidebar on every regeneration, which matters for anything that stores a node id.

Both of those numbers carry the same caveat, and it is the reason the eval is the right instrument
rather than this investigation: **0.55 and 0.91 are computed only over the runs that survived
`buildTree`.** A run that threw contributed no boundaries to compare, so the agreement figures are
conditioned on the tree being valid and understate the real spread. Measuring variance over the
successes alone is a selection effect, and it would understate the noise floor of any bakeoff built
on top of it.

## See also

- [architecture.md § Stage ownership](../project/architecture.md#stage-ownership) — stage 3 owns the
  first fix, stage 4 the other two
- [block-ids.md](../project/block-ids.md) — why merging fragments is not a free change
- [toc-max-tokens.md](toc-max-tokens.md) — the exact-set label contract, and why it exists
- [silent-success.md](../reusable/silent-success.md) — the corpus that cannot exercise its arm
