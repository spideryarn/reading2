# Hierarchy

Pipeline stage 4 — `hierarchy`, `npm run hierarchy`. Builds the nested structure that the Hierarchy
sidebar and the [granularity zoom](granularity-zoom.md) view both render. Read
[architecture.md § Pipeline](architecture.md#pipeline) first — stages 4 and 5 produce
**one** `tree.json`, and it must not become two trees.

Stage 4 builds the *structure* — ranges, hierarchy, titles — and, in a second batched pass, the
`navLabel` on every gistable block ([Two passes](#two-passes)). It also writes the one-sentence
`gist` on each internal node, which [architecture.md](architecture.md#pipeline) draws as stage 5:
they were never split into two model calls, because a tree without gists has nothing to render at
its coarse levels and fails validation, and both would write the same artefact. The live prompt in
[`src/hierarchy.ts`](../../src/hierarchy.ts) is the authority; this line used to say stage 5 filled them, and
had not been true for some time.

**The step was called `toc` until 2026-08-31**, and this file was `table-of-contents.md`. The
reading-view mode gave that name up on 2026-08-29 and the step deliberately kept it, which left one
concept wearing two names across the UI, the code and the database; Greg reversed that half so all
three say the same word —
[260831ak-rename-the-toc-step-to-hierarchy-everywhere.md](../plans/260831ak-rename-the-toc-step-to-hierarchy-everywhere.md).
The rows moved in [`drizzle/0041_rename_toc_step_to_hierarchy.sql`](../../drizzle/0041_rename_toc_step_to_hierarchy.sql)
and the filesystem store's copies in [`scripts/migrate-fs-toc-to-hierarchy.ts`](../../scripts/migrate-fs-toc-to-hierarchy.ts).
"Table of contents" still appears below wherever it means the artefact or the ordinary English idea,
rather than the step.

## Intent

Greg's description of what he wanted (2026-08-24), verbatim:

> I guess the way I was imagining it was we'd have the sidecar JSON containing the table of
> contents, and it would say for each table of contents row, it would say something like, okay,
> **this is an H1, and the title is blah, blah, blah, and it should be positioned before Spidey on
> ID XYZ.**

And on how deep a row should go, which turns out to be the load-bearing question:

> **a list of one-word bullets might only need an entry at the list level, but a list of detailed
> discussion-entries might need a ToC for each item**

Earlier, on the shape of the thing:

> We generate a table of contents that's **quite deeply nested — all the way down to a paragraph
> level.**

## We store a tree and derive the flat rows

Greg's row model got the important thing right: **a row is anchored to a block id**, never to a
character offset, a CSS selector, or a scroll position. That is the whole
[provenance principle](vision.md#principles), and everything below keeps it.

Two things it doesn't carry, both of which we need:

**A row has no extent.** "Positioned before `spya-k3m9qt`" says where a section *starts* and
nothing about where it *ends*. Every consumer has to re-infer the end by scanning forward for the
next row of equal-or-shallower depth. That inference is subtly wrong on ragged heading levels — an
`h2` followed by an `h4`, or a level jumping up two steps at once — and it has to be reimplemented
identically in the sidebar, the zoom view, and the summarizer. One of them will get it wrong.

**The zoom view needs real extents.** To render level L2, it must know exactly which blocks each
section owns so it can replace them with one gist. That's a range query, and a start-only row can't
answer it.

So `tree.json` stores `range: [firstBlockId, lastBlockId]` and explicit `children`. Greg's flat row
list is then *derived* — see [`src/hierarchy-flatten.ts`](../../src/hierarchy-flatten.ts). This direction
matters: **flattening a tree into document-order rows is lossless and trivial; reconstructing a tree
from flat rows is neither.** Store the richer thing, render the simpler one.

### `level: "h1"` became `depth` + `sourceHeading`

The row model used one field for two jobs: how deep the row sits, and what HTML tag produced it.
Those come apart immediately, because on a flat essay **most nodes have no tag behind them at all**.
The test article is 8,275 words under 9 headings; every middle level of its tree is proposed by the
model. So:

- `depth` — a number, position in the tree, always present.
- `sourceHeading` — the author's heading text, verbatim, present only when a real heading is behind
  the node. [`validate-tree.ts`](../../src/validate-tree.ts) fails any node whose `sourceHeading`
  doesn't match a real heading block inside its own range.

## Schema

Canonical definition lives in [`src/types.ts`](../../src/types.ts); this is a copy for reading.
`data/<slug>/tree.json`:

```ts
interface Tree {
  version: string;
  generator: string;
  slug: string;
  rootId: NodeId;
  nodes: Record<NodeId, TreeNode>;   // flat map, NOT nested
}

interface TreeNode {
  id: NodeId;                  // "n0042"
  depth: number;               // 0 = whole article
  parent: NodeId | null;
  children: NodeId[];          // [] for leaves — ids, not nested objects
  range: [BlockId, BlockId];   // inclusive; children exactly partition it
  title: string;               // 2–6 words. Internal nodes.
  gist?: string;               // ONE sentence, stage 5. Never on leaves.
  navLabel?: string;           // leaves only — the Hierarchy row's text
  summary?: string;
  sourceHeading?: string;
}
```

### Why a flat map and not a nested tree

The stored shape is a map keyed by `NodeId`, not nested objects. That looks less natural in JSON,
and it is the right call, because of what the client actually asks it.

The [anchor invariant](granularity-zoom.md#interaction) means that on every zoom change the client
asks *"which node at depth D contains block X?"*, and on every scroll it asks it again. In a keyed
map that is a lookup. In a nested structure it is a walk from the root. The React client
([`src/web/tree.ts`](../../src/web/tree.ts)) was already built against the map, and the map is what
[`src/types.ts`](../../src/types.ts) declares, so the map wins.

The convenience of nesting is recovered where it's actually wanted — see
[the generation prompt](#the-generation-prompt), where the *model* emits nested JSON and stage 4
converts it to the map. Nesting is a good authoring format and a poor query format; the two do not
have to be the same.

### The partition invariant

Inherited from [the tree](granularity-zoom.md#the-tree): **every node covers a contiguous range of
blocks, and a node's children exactly partition its range** — no gaps, no overlaps, no reordering.
Contiguity is in `blocks.json` **array order**, not in the id string; random ids carry no ordering
(see [block-ids.md](block-ids.md#the-cost-we-accepted)). Never write `if (id > start && id < end)`.

[`src/validate-tree.ts`](../../src/validate-tree.ts) enforces all of it. Run it on every generated
tree — it is what stops a model quietly inventing a block id that doesn't exist.

### The partition is derived, not checked <a id="derived-partition"></a>

**Nothing about the tiling can refuse an answer any more.** Since 2026-08-31
[`src/hierarchy.ts`](../../src/hierarchy.ts) does not check whether the model's children tile their parent; it
**derives a tiling from them**. A child's *start* is believed, and every end is computed:

- the first child starts where its parent starts, because nothing else can supply that block;
- every later child starts where the model said it starts, clamped inside the parent and required
  to be strictly after the previous child's start;
- every child ends one block before the next one starts, and the last ends at its parent's end.

That is the whole rule. A gap, an overlap, a last child that stops short and children that run past
their parent were four faults to detect and mend; they are now **not expressible** — a list of
ordered split points tiles its parent by construction. `assertChildrenPartition` still runs
afterwards and should never fire on a planned node. It is the standing proof that the derivation is
total, not a second chance to reject the answer.

**Starts and not ends, and this decides where an orphan lands.** A start is a claim the model has a
reason for: it is where the section begins, where its heading is, and what `sourceHeading` names. An
end is the same boundary stated a second time from the other side — a redundant field, and redundant
fields are where inconsistency lives. So when the two disagree, the start wins, and a gap's orphaned
paragraph joins the section **before** it rather than the one after. The cursor walk this replaced
did the opposite, and on the fixture in `tests/hierarchy-repairs.test.ts` that filed "Body of the first
part" under "Second".

#### What this cost, and how we got here

Three shapes in three days, each one bought by an article somebody lost:

| | what it did | what it cost |
|---|---|---|
| until 2026-08-30 | refused any tiling fault | 4 structure calls in 13 |
| 2026-08-30 | snapped boundaries; bounded by size, then by count | an article with two slips |
| 2026-08-31 | derives the tiling; nothing about it refuses | a dropped section, rarely |

A paid calibration on 2026-08-30 threw on **4 of 13** structure calls, bimodal by kind: two partition
gaps and two `sourceHeading` claims outside their node's range. The structure call takes about 163
seconds and most of the stage's bill, so every refusal cost a reader a whole article after the money
was spent.

The first fix snapped a boundary shut, bounded at one block. That bound was fitted to four
observations that were **all off by one and all from HTML articles with headings** — the half of the
corpus where the model has the author's own structure to agree with. PDF ingest reached production
the same day, PDFs are headingless, and a 9-page arXiv paper lost its ToC to a gap of three. Greg,
2026-08-30:

> I think for now, we should allow gaps. It's not ideal, but it's not the end of the world, and
> better than things failing fatally. Perhaps in future, it should trigger a re-run of the LLM, where
> we feed in the previous output, with information about the gaps and ask it to adjust. But that's
> for later.

So the size bound went, leaving a count: **one distinct boundary per answer**. That was fitted to the
same four observations, and the code comment said in as many words that a headingless PDF with two
independent slips would still lose its whole ToC. On 2026-08-31 one did — a Princeton memory paper,
one gap of a block at depth two and one overlap of two at depth one. Fixing that by raising the
number would have been the third guess at a threshold nobody had evidence for, so instead the
question it answered was removed. See
[260831ai-hierarchy-tiling-normalisation.md](../plans/260831ai-hierarchy-tiling-normalisation.md).

#### The one thing it loses, and what still throws

**A child whose start is not strictly after the previous child's start is dropped**, with its whole
subtree. There is no split point there — the model proposed two sections beginning in the same place,
which is one section — and the alternatives are worse: refusing costs the reader the article, and
squeezing the child into one borrowed block writes a boundary nobody proposed. This is the only way
a tiling fault still costs anything, so it is **counted on its own** rather than as another kind of
repair: a moved boundary keeps every section the model named, and this does not.

Still refused, because it is a fault in what the model *said* rather than in how its sections line
up: **an endpoint that is not a block id**. One unresolvable child leaves its whole sibling set
underived, so the precise error survives instead of being buried by a tree built as though that child
had never been proposed.

#### A child's backwards range is a disagreement, not a lie <a id="backwards-child"></a>

**That list had a second entry — a range that runs backwards — until 2026-09-04.** The refusal was
explicit and tested, so it was a decision rather than an oversight; what was too broad was its
premise. This whole function believes a start and computes every end, so **a child's own end is a
redundant second statement of a boundary the derivation already discards**. A backwards pair whose
ids both resolve is those two statements disagreeing, which is the thing the repairs exist to absorb.

It is not evidence that the node's title and gist describe the wrong prose: the model wrote those
from the whole article, not from its own range, and the repairs already keep a title and gist while
moving that node's boundary by many blocks. ⟨GPT Sol, 2026-09-04⟩

Measured, and it is why this changed: `smart-low` lost `gwern-scaling-long` to exactly this — one
block backwards at `root > child 7 > child 1` — in the run that moved production to `low`
([hierarchy-waves-real-corpus](../../evals/results/hierarchy-waves-real-corpus-2026-09-04.md)).

**What it costs, which is the interesting half.** A backwards end is **ineligible for the fallback**.
When two children claim the same start, `planChildRanges` falls back to the previous child's end as
the only claim left; borrowing an end we have just called wrong would invent a split point from a bad
number and attach *both* neighbours to the wrong prose. So a following child with no usable claim of
its own is dropped, exactly as it always was when neither claim stood up. The raw end is still read
for measurement, which changes nothing about what is built.

**The root is the exception, and it has to be.** It has no parent to derive from, so a backwards root
range is unmendable and still throws — and the [root clamp](#root-clamp) deliberately does not fire
on a pair that does not run forwards, or it would turn an invented id into a silent acceptance.

#### The root was the last node whose range was believed <a id="root-clamp"></a>

**A root that misses the article's ends was on that list until 2026-09-04, and it should never have
been.** Every other node's range is *computed* — `planChildRanges` believes a start and derives every
end, so the first child begins where its parent begins and the last ends where its parent ends. The
root has no parent, so its range came out of the answer and then met a hard equality assertion. It
was the one node in the tree where the ordinary fault was fatal, and the section above reads as
though the derivation covered everything.

It is not a corner. `openai-huggingface` ends on an empty paragraph, a stranded footnote the prompt
renders as `NOT-GISTABLE: (withheld)`, and a blog footer whose entire text is `No posts`; ending the
article before those three is what a careful reader would do, and **three independent arms — Sonnet
at `medium`, Sonnet at `low`, and glm-5.3-flash — each did, and each lost the article to the same
sentence** ([hierarchy-cheap-models](../../evals/results/hierarchy-cheap-models-2026-09-03.md),
recommendation 3).

So the root is clamped to `[blocks[0].id, blocks.at(-1).id]` before anything descends, and the guard
stays behind it as a post-condition rather than being deleted for having nothing left to catch.
Three things about the shape are load-bearing:

- **Widen, never shrink.** The other way to reconcile the two claims is to believe the model and drop
  the blocks it left out. That is worse: every block gets exactly one leaf, so an uncovered block has
  no row anywhere and no resolver in the reading view can find it.
- **Only when both ends resolve and run forwards.** An invented id and a backwards range are faults
  in what the model *said*, and clamping first would turn the first of those into a silent
  acceptance.
- **Counted at the boundary that moved.** At the closing end the coordinate is `blocks.length`, which
  is the same boundary the last child's own stretch names, so `repairedBlockCount` folds the two into
  one rather than charging the article twice for one slip.

#### Measurement is what stands where the bounds stood

Every boundary the model got wrong is recorded with its position, direction and size; dropped
sections and unbacked heading claims are counted beside them. All of it reaches `HierarchyRun`, the CLI's
`Repaired:` line **every run including at zero**, the queue's log, and `evals/hierarchy-structure` per
result — the way `strandedSupplement` already is. A repair nobody is told about is the same shape as
the bug it repaired ([silent-success.md](../reusable/silent-success.md)).

`repairedBlocks` against `blocks` is the fraction of the article that changed hands, and it is the
number to read first. **It is also the trigger the re-ask will use**: Greg's re-run is still the
right long-term answer, and deriving the tiling is the step toward it rather than a detour, because
the re-ask needs both a fallback for when the second call is also wrong and a number to decide when a
second call is worth buying. The plan says what remains.

## The tree the author's headings give us for free <a id="heading-tree"></a>

[`src/heading-tree.ts`](../../src/heading-tree.ts) carves an article on its own `<h2>`/`<h3>`
blocks. No model, no network, milliseconds — against ~163 seconds and a real bill for the model's.

Measured on 2026-08-30 over seven development documents and five held out
([the research](../research/260830a-opening-an-article-before-the-toc.md)):

- **6 of 7** have enough headings to carve at all;
- **4 of 7** reproduce the model's depth-one carving *exactly*;
- and on a headingless article the model is not merely better but **unstable** — identical input
  gave 8, 7, 8 and 3 parts across four runs.

So the free tree is weakest exactly where the paid one is least trustworthy, and strongest where the
paid one agrees with it anyway. That is the finding, and it is why this is a product module rather
than a curiosity.

**It has no gists**, because there is nowhere free to get one, and an internal node without a gist
has nothing to render at its own zoom level. That is a rule
([`src/tree-invariants.ts`](../../src/tree-invariants.ts)), and the exemption for this tree is
`provisional: "headings"` **on the tree**:

- **Tree-level, not per-node**, because a provisional tree is replaced whole and no node of it
  becomes final on its own.
- **Explicit, never inferred from the missing gists.** That is the same decision `treatment`
  embodies: keyed on absence, a pipeline bug that drops a gist becomes indistinguishable from a
  deliberate exception, and the dangerous outcome is acceptance.
- It buys **the gist rule and nothing else**. Every other invariant applies in full, and a
  *finished* tree missing a gist fails exactly as it always did.
- It **crosses the public boundary** ([`src/public/dto.ts`](../../src/public/dto.ts)), because a
  client that cannot tell a provisional tree from a finished one draws empty cells where it should
  say the structure is still arriving.

**One implementation, two jobs.** This file is also arm zero of the structure eval — the free
denominator every paid arm is read against. If the eval measured one carving and the product shipped
another, every number under `evals/results/` would describe something nobody reads.

**What is not built yet.** Nothing in the pipeline produces one of these trees for a reader: the
builder, the marker, the exemption and the public boundary are in place, and the publication
boundary, the tree-replacement seam and the gate on paid work generated *against* a provisional tree
are not. Those are steps 2–4 in
[the research](../research/260830a-opening-an-article-before-the-toc.md).

## Entry length grows with depth <a id="granularity"></a>

The core editorial rule, and the one most likely to be got wrong:

> **A row's only job is to distinguish itself from its siblings.**

At depth 1 a node has perhaps five siblings, all about wildly different things, so three words is
plenty. At leaf depth a node has twenty siblings that are all about the same subtopic, and three
words ("the caching problem") is ambiguous across five of them. Length should track how much
disambiguation the level actually demands.

**This rule is unchanged. Only its mechanism changed.** It used to be one `title` field that grew
with depth. It is now expressed by *which field a node carries*:

| Node | Field | Target | Why |
|---|---|---|---|
| internal (chapters, sections) | `title` | **2–6 words** | Landmarks. Must be scannable at a glance. |
| leaf (paragraph rows) | `navLabel` | **6–20 words** | A paragraph has no name of its own; it needs a claim. |

Splitting the field is better than one field changing size, because the two do genuinely different
jobs — a `title` also names the node in the spine and in the zoom view's collapsed levels, where it
must stay short, while a `navLabel` exists only to be read once and clicked.

A **heading leaf is exempt from the lower bound**: its label is the author's own title, and
`Soul Machine` is exactly right at two words. `validate-tree.ts` skips the band check for leaves
whose block is `kind: "heading"`.

The cost is real and worth stating. 116 labelled leaf rows at ~12 words is about **1,400 words of
ToC against 8,275 words of article — roughly a sixth of the piece**. That is why the sidebar keeps
paragraph rows **collapsed by default**, showing the heading outline until the reader expands a
section. An always-visible flat list of every paragraph is unusable, and it is also the thing
[vision.md](vision.md#anti-goals) warns about: a summary satisfying enough to read *instead of* the
article.

## Every block gets a leaf; not every leaf gets a row

This is the part most likely to be mis-implemented, so it is worth being exact.

**Every block gets exactly one leaf node.** Not one-to-three, not merged with a neighbour — exactly
one. `validate-tree.ts` fails a leaf that spans more than a single block, and fails any block not
covered by some leaf. That is what keeps coverage machine-checkable: if rows could vanish or absorb
each other, a silently dropped paragraph would be undetectable.

**Selectivity lives in `navLabel`, not in the ranges.** A leaf that should not appear in the sidebar
simply carries no `navLabel`. [`hierarchy-flatten.ts`](../../src/hierarchy-flatten.ts) emits a row only for
nodes that have a label, so an unlabelled leaf is tiled by the tree, rendered verbatim in the
reading view, addressable by its id — and invisible in Hierarchy. Nothing is lost; nothing is
duplicated.

**Never labelled:** any block `isStructural` says no to — `src/block-policy.ts`, which is
`gistable` **and** body. Stage 3 decides both halves, not stage 4
([architecture.md § What a block is](architecture.md#what-a-block-is)). In the test article the
`gistable` half is 23 of 139 blocks:

- **Media** — figures, bare images, horizontal rules.
- **Pull-quotes.** All 11 in the test article are word-for-word repeats of body sentences; giving
  them rows would print the same claim in Hierarchy twice.
- **Figure captions** — `kind: "caption"`, matched on an explicit `^(Figure|Fig\.|Table|…)\s*\d*\s*[:.]`
  marker and **never on length**, because `"Given all this, what should we do?"` is seven words of
  real argument. The test article has five.
- **Boilerplate labels** — a block whose entire text is `Credits`, `Sources`, `Notes`, `References`.

**And the apparatus**, since footnotes: a block with `treatment: "supplement"` is prose, so
`gistable` says yes to it and it was being bought a nav label like any other — 41 of gwern's 175 and
121 of wikipedia's 335, a third of the labelling bill spent writing navigation for rows nobody
navigates to. `isStructural` is what refuses them. The tree's **shape** is unchanged: every block
still gets a leaf, notes included, and the supplement node that gives the apparatus one visible row
of its own is a later stage. [260828o-footnotes.md](../plans/260828o-footnotes.md).

`validate-tree.ts` turns this into a hard error: a leaf carrying a `navLabel` while anchoring a
block `isStructural` refuses fails the tree.

> [!NOTE]
> Two of the five captions are substantial — `Figure 2` runs to 94 words and `Figure 4` to 36,
> and both explain a diagram rather than merely name it. We accepted losing them from Hierarchy
> anyway, on the grounds that a caption belongs to its image and not to the argument: a reader who
> wants it descends to the figure. This is a deliberate trade, not an oversight, and it is a
> reasonable thing to revisit if the sidebar feels like it is hiding content.

The inverse case is a warning rather than an error: a **gistable** leaf with no `navLabel` is
flagged as "unreachable in the ToC". That is the escape hatch for a genuinely trivial transition,
and it is deliberately noisy — skipping prose should be a decision someone made, not a default.

## Headings: verbatim unless genuinely uninformative

Greg's call: use the author's heading text, rewriting only when it tells the reader nothing. A row
that says one thing and lands on a heading that says another is disorienting, so the bar for
rewriting is high, and the test is **mechanical, not a judgment call**:

> Rewrite a heading only if it (a) shares no content word with its own section body, **or** (b) is a
> stock label — `Introduction`, `Background`, `Overview`, `Conclusion`, `Part Two`, `Chapter 3`.
> Otherwise pass it through untouched.

Worked example — the test article's four `h3`s:

| Heading | Verdict |
|---|---|
| `1: Brains Are Not Computers` | **verbatim** — a claim, and its content words recur throughout the section |
| `2: Other Games In Town` | **verbatim** — idiomatic, but "games in town" is Seth's own framing and the reader will recognise it on arrival |
| `3: Life Matters` | **verbatim** — short, but "life" is the section's central term |
| `4: Simulation Is Not Instantiation` | **verbatim** — the sharpest claim in the piece |

All four pass. The numeric prefixes stay: they are the author's own enumeration and dropping them
would break the correspondence with the page. This is the expected outcome — **rewriting should be
rare**, and a run that rewrites more than a heading or two is a bug in the rule, not a bad article.

### The apostrophe that failed eleven headings

`sourceHeading` is checked against the real heading blocks, and the check is
[`sameHeading`](../../src/validate-tree.ts) rather than `===`. That matters, and the reason is easy
to get wrong twice:

**`sourceHeading` is the author's heading quoted back by a model, and a model quoting text
reproduces the heading, not the bytes.** Publishers emit `Claude’s Constitution` with a curly U+2019
because their CMS does; ask a model to repeat it and a fair share of the time you get
`Claude's Constitution`. Same heading, typewriter apostrophe.

The first article to reach this check with apostrophes in its headings — the Anthropic constitution,
36 of them — failed on **eleven**, and every one of the eleven was an apostrophe. None was a heading
the model had actually got wrong, which is the only thing the check exists to catch. A validator
whose errors are all false teaches whoever reads it to stop reading it, which is a slower and worse
version of having no validator at all.

So the comparison folds the characters that have both a typographic and a typewriter spelling —
quotes, apostrophes, dashes, the ellipsis — and collapses whitespace. It deliberately does **not**
fold case or drop words: a heading *rewritten* rather than quoted is exactly what should still fail.

> [!WARNING]
> **Rewrites are not currently auditable.** An earlier draft of this design carried a
> `titleSource: "heading" | "rewritten" | "proposed"` field so drift could be found with one grep.
> That field is **not** in [`src/types.ts`](../../src/types.ts) and nothing emits or checks it. Today
> the only signal is `sourceHeading`: a node that has one but whose `title` differs from it has been
> rewritten. That is inferable but not explicit, and it says nothing about *proposed* titles. Worth
> adding the field if rewriting ever turns out to be more common than the rule predicts.

## Building the tree over a flat article

Authored headings are **hard boundaries** — they are ground truth about where the author thought the
seams were, and readers recognise them. Where a run between headings is long and unstructured, the
model proposes boundaries by topic shift. Target branching factor ~5–9 so each level is an even
stride rather than one level doing all the work.

Current stage-3 output for the test article: **139 blocks** — 9 heading, 108 text, 17 media, 5
caption — of which **116 are gistable** and 23 are not.

```
  depth 0  article ......................................... 139 blocks
  depth 1    [proposed] opening ........................... idx   1– 11   (11)
             h2 The Temptations Of Conscious AI ........... idx  12– 33   (22)
             h2 Consciousness & Computation ............... idx  34–111   (78)
             h2 What (Not) To Do? ........................ idx 112–128   (17)
             h2 Soul Machine ............................. idx 129–138   (10)
```

Five children at depth 1 — one proposed, four authored. Note the article *opens* with 11 blocks
before its first heading, so the opening node has no heading to take a title from and must be
proposed.

`Consciousness & Computation` is a container: two blocks of its own preamble, then four `h3`s.

```
  depth 2      [preamble] .............................. idx  35– 36   (2)
               h3 1: Brains Are Not Computers .......... idx  37– 62   (26)
               h3 2: Other Games In Town ............... idx  63– 75   (13)
               h3 3: Life Matters ...................... idx  76– 89   (14)
               h3 4: Simulation Is Not Instantiation ... idx  90–111   (22)
```

Those `h3` runs are still 13–26 blocks each — far above the 5–9 target — so **a proposed level sits
below them**, splitting each into 3–4 topic groups of ~6 blocks. Only then do leaf rows appear.

The shape that falls out is roughly `1 → 5 → 20 → 139 leaves`: branching factors of about 5, 4 and
7. That is the right answer for this piece, and it is only reachable because proposed levels are
allowed to interleave with authored ones. A headings-only tree would give this article **two**
levels and no zoom axis worth having.

Of those 139 leaves, 116 carry a `navLabel` and 23 do not.

## Two passes: the structure, then the labels <a id="two-passes"></a>

Stage 4 used to ask for the whole tree in one model call, and that is what broke it. One `navLabel`
per gistable block means a piece with three times the paragraphs asks for three times the JSON, so
this was the only answer in the pipeline that **grew with the article without a bound** — measured at
**73%** of the answer on a 360-block article, against 27% for the entire tree. One model response
holds 128,000 tokens including the model's own reasoning, and nothing raises that, so past some
length the stage simply could not work.

So it is two passes now, and one pipeline step:

1. **The structure**, in one whole-document call ([`src/hierarchy.ts`](../../src/hierarchy.ts)) — the internal
   nodes, their titles, their gists, their ranges, `sourceHeading`. Roughly 7,000 tokens of answer on
   a 360-block article, and it grows at about one node per seven blocks rather than one per block.
2. **The nav labels**, in parallel batches ([`src/labels.ts`](../../src/labels.ts)), cut along the
   tree's own section boundaries once it exists.

The rule the split turns on:

> **Generate siblings together; generate disjoint sibling groups in parallel.**

A label's job is to tell its paragraph apart from *its neighbours*
([entry length](#granularity)), so every pair a reader compares has to have been written in the same
call. `planBatches` packs whole sibling sets until adding the next one would pass 60 blocks, and
never splits one. Batching on a token window instead would break exactly that and nothing else,
which is why it would be hard to notice.

**There is a floor as well as a cap, and it is derived rather than chosen.** A batch under
`MIN_BATCH` — 13 today — cannot both spend its drop budget and leave `detectShift` the
`MIN_SHIFT_EVIDENCE` labels it needs to vote, so it is a batch nothing could stand behind. Rather
than emit one and refuse it at run time, the packing keeps taking sets, and a short tail is merged
backwards into the batch before it. That breaches the 60 by at most twelve — 71 on the widest real
case here — which is the same give the cap already has for an oversized sibling set. Measured before
it landed: 4 of 31 batches across the fourteen articles on Greg's machine were under the floor, on
three of them; afterwards, 1 of 28, and that one is a ten-block article which has no neighbour to
merge into. The residue is `acceptGap`'s to refuse.

**A heading's label is taken from the block, not asked for.** The prompt says to copy the heading
exactly; the model does not. On the two committed articles, 9 of 36 heading labels and 3 of 9
differed — curly apostrophes flattened to straight, authored numbering ("2: Other Games In Town")
quietly dropped. The apostrophe half is the *same failure* as
[the one that broke `sourceHeading` validation](#the-apostrophe-that-failed-eleven-headings), which
was patched by comparing more loosely. This one is patched by not asking: a heading's label is
knowable without a model, so `parseLabels` overwrites it from `block.text` and a drifting prompt
cannot bring it back. The model is still asked for one, so that a batch skipping its headings still
fails the paragraph-number check.

Two things this bought beyond the ceiling, **and both have since been reversed — read the constants,
not this paragraph.** `effort` went back to `"high"` on the structure call, undoing a concession the
postmortem had forced; a second production truncation (Wolfram, *Towards a Theory of Bugs*) forced it
down again on 2026-08-30 in `fb82dc8`, and
[`src/hierarchy.ts`](../../src/hierarchy.ts) § `EFFORT` is the current value with the reason beside it — including
that `high` has still never been measured against `medium` here. And `COVERAGE_FLOOR` went from 0.95
to 1, so that each batch was asked for an exact set of numbered paragraphs and refused any other;
stage 1 of [260830am](../plans/260830am-faster-ingest-and-concurrency.md) took it back to 0.95 and
renamed its job — the article-level backstop, not the per-batch bound — and
[`src/labels.ts`](../../src/labels.ts) § `COVERAGE_FLOOR` carries that argument.

*(Both lines said the opposite of the code from 2026-08-30 until 2026-08-31, which is the drift
CLAUDE.md warns about: a doc that restates a constant is a second copy that nothing keeps in step.)*

### The path that turned out to exist anyway

`COVERAGE_FLOOR` is **0.95 again** since 2026-08-30, because that last sentence was wrong. A
production ingest of a 244-block Wolfram article died twice on *"this call asked for 58 labels and
got 57, missing paragraph 4"* — one label, on a lead-in fragment whose entire text is the word
"or". Stage 3 had stripped the code cell the fragment pointed at, which leaves "6–20 words that are
a CLAIM or a MOVE" and "never introduce a fact that is not in that paragraph" **jointly
unsatisfiable**: skipping is the compliant answer, and no retry can change it. Third recorded
instance of the shape — [`src/labels.ts`](../../src/labels.ts) documents 41-of-42, twice, before it.

So the stage now does three things instead of dying, in rising order of risk:

- **Says which paragraphs.** The old message read "missing 4" and cost a day, because 58 − 57 = 1
  and the last number looked like a count. It is a paragraph number, and it says so.
- **Re-asks for the gap alone.** The same prompt with one more part appended, naming the ordinals
  that came back absent — so the neighbours a label has to be told apart from are still in view, and
  the cached prefix still matches. What it saves is the answer, not the question: fifty-seven labels
  already paid for are kept. Re-drawing the whole batch has now failed to help three times on record,
  byte-identically, because `batchFingerprint` excludes `max_tokens` so the retry sends the same
  bytes.
- **Accepts the batch with the gap, bounded — and only on all four counts.** `droppedBudget` — 2% of
  a batch, floor of one — after the re-ask has also failed. Three further conditions, all added
  2026-08-31 after GPT Sol's review of the stage found each of them missing: the re-ask must itself
  have come back *short* (a truncation or a 429 says nothing about the paragraph, so it is a
  transient to retry rather than a fragment to forgive); a displacement found on the merged set is
  rethrown rather than re-decided on the smaller partial set, which can sit one label under the
  evidence `detectShift` needs; and a batch too small for that check to run at all is refused rather
  than published unchecked — which is the backstop behind `MIN_BATCH` above, for the articles
  merging cannot reach and for a batch whose labels turn out to carry no lexical signal.
  `COVERAGE_FLOOR` is the article-level backstop behind the per-batch
  bound, not a second copy of it: the batching is invisible from `checkCoverage`, so small sections
  each spending their floor of one would stay inside budget and still cost the article a fifth of its
  rows. It now lives in [`src/labels.ts`](../../src/labels.ts) and is applied at the end of
  `generateLabels`, so `npm run labels` gets it too — it used to be enforced only by `generateHierarchy`,
  which made the backstop depend on which command you typed.

**The risk in the third one is silent success.** An unlabelled leaf renders as *nothing* — the
outline skips the row, the spine draws an empty string, and nothing is red. So every drop is named
and counted: `LabelRun.dropped`, the `dropped` list in `labels.json`, `labelsDropped` on the step's
log line and on the progress card, and `evals/hierarchy-labels.ts` reads the artefact rather than inferring
a fault from a coverage number it can no longer interpret alone. That last one is the *"the eval had
to be told"* lesson from the R2/R3 build, applied in advance rather than afterwards. The upstream fix
is item **F** in [260830a-opening-an-article-before-the-toc.md](../research/260830a-opening-an-article-before-the-toc.md)
— stage 3 promoting sentence fragments to blocks — and it is not this stage's to make.

### Three artefacts, and what survives a failed run

Stage 4 produces the tree, the blocks and the labels, and **hands all three back in one object**
rather than writing them: `generateHierarchy` returns `TocArtefacts`, and its caller stores them together
in a single write ([`src/hierarchy.ts`](../../src/hierarchy.ts),
[260831b-finish-the-database-move.md](../plans/260831b-finish-the-database-move.md) § Stage 2). All three are
required by the type, so a caller cannot store a tree and skip its labels.

It used to write the three files itself, in a fixed order with the tree last. That ordering was
about three *separate* writes: `writeFile` truncates before it has anything to put there, and
*existence* is what [`src/pipeline.ts`](../../src/pipeline.ts) reads as "this step is done", so a
kill mid-write left a present, truncated tree that a retry skipped. One write for all three removes
both halves of that, and the ordering survives only in `npm run hierarchy`'s own `main()`, which really
does write three files into a directory.

`labels.json` carries a **manifest** — `sourceHash`, `structureHash`, `structureVersion` — because a
whole-or-nothing write gives us "whole or not there" and not "still true". A complete set of labels
for an article that has since been re-extracted, or re-structured, looks exactly like a current one.
The structure hash is the one that earns its place: boundaries can move without a single block
changing, so it is taken over every node's range, parent, title and gist rather than over the outline
the prompt shows the model, which is titles alone. **Nothing reads the structure hash yet** — the
`hierarchy` step still has no freshness check — so today it is evidence in the file rather than a guard.

`sourceHash` is not in that category. `STAMP_SOURCE` points stage 4's stamp at `labels.json` rather
than at the tree, which carries no such field, so that hash is what the store compares a declared
stamp against and what `generateHierarchy` reports as the step's input hash. It has to be recorded: the
publish guard compares it with the stored blocks and refuses to publish an article whose tree was
built from something else.

**The structure answer is checkpointed too, since 2026-09-04** — one row under the
`hierarchy-structure` namespace, written only once the answer has parsed, built a tree and passed
`assertTreeSound`, so that a malformed-but-complete answer can never be replayed for ever. This is
the most expensive call in the pipeline (508 seconds and about two dollars on the 142-page paper),
and until then a run that died in the label pass bought it again from nothing. The key is a digest of
**the whole request object the call actually sends**, plus the model address and the routing
`streamMessage` injects and `PROMPT_VERSION` — not a hand-copied list of the fields that seemed to
matter, which is the blind spot `promptFingerprint` in [`src/pdf-read.ts`](../../src/pdf-read.ts) was
written to remove. `HierarchyRun.structureResumed` says whether a run made the call, because a
checkpoint that silently never hits looks exactly like one that works.

While the batches are running, each one's labels are **checkpointed as it lands** — one row in the
`checkpoints` table, under the `hierarchy-labels` namespace, keyed on the batch's fingerprint
([database.md § Checkpoints](database.md#checkpoints-work-a-failed-attempt-already-paid-for)). That
is working state, not an artefact, which is why it is not `labels.json`: a partial `labels.json`
would be a finished-looking article with holes in its navigation. A later run reuses a batch only
when a fingerprint matches over the exact bytes of its prompt **plus the sibling grouping those bytes
never state** — never merely because the same block ids are in the same call, since the crumbs,
gists, outline and boundaries around them may all have moved. The first unrecoverable failure aborts
every other batch rather than letting a doomed run keep buying answers.

It was `labels-progress.json` in the article's directory until 2026-09-01, and one file holding every
batch is what made the `runId`, the serialised rewrite and `clearCheckpoint` necessary — the unit of
deletion was larger than the unit of work. One row per batch removed all three, and nothing is
deleted on success at all. The store is handed down by `StoreSession`; `generateHierarchy` and
`generateLabels` both take a `CheckpointStore` and neither builds one.

The whole design, the alternatives weighed against it, and what it does not yet do are in
[docs/plans/260826h-toc-scaling.md](../plans/260826h-toc-scaling.md).

## The budget <a id="the-budget"></a>

`max_tokens` is still computed from `blocks.json` rather than typed in — the split moved the ceiling,
it did not remove the need to know where it is. [`estimateHierarchyTokens`](../../src/hierarchy.ts) does the
structure call's estimate; [`src/labels.ts`](../../src/labels.ts) does a batch's. The arithmetic on
top of both — and the reason most of the number is not the answer at all — is in
[`src/token-budget.ts`](../../src/token-budget.ts):

> **`max_tokens` is not an output cap. It is an output-plus-reasoning cap.**

The thinking tokens come out of the same allowance as the answer, and how much thinking happens is
not something we set — `budget_tokens` is gone, and `output_config.effort` is the only dial. So the
budget is written as two terms that grow differently: the answer, which the stage can estimate
exactly, and a flat reservation for reasoning, which it cannot.

**And the reservation is not a fix by itself.** A 360-block article failed here on a typed-in
`max_tokens: 32000`, of which roughly 26,000 had gone on thinking. Recomputing the budget as
77,100 and running it again failed *too*, with about 64,000 of thinking that time: adaptive thinking
at `effort: "high"` expands into whatever room it is given, so raising the ceiling raises the
thinking with it and the two never converge. `max_tokens` is a ceiling; `effort` is the leash.
[docs/postmortems/260826a-toc-max-tokens.md](../postmortems/260826a-toc-max-tokens.md) has the whole account.

**The reservation is per call, not per stage.** `THINKING_HEADROOM`'s 40,000 was measured on a call
that reads a whole article and thinks about its structure. A label batch reads one section and writes
a dozen labels, and reserves 16,000. Inheriting the big number onto every small call would cost no
money — an allowance the model does not spend is not billed — but it would hide a batch that had
started thinking far more than it should, which is the failure that took two six-minute runs to find.

**And the structure call reserves more, because it meets the longest inputs.** `STRUCTURE_HEADROOM`
in [`src/hierarchy.ts`](../../src/hierarchy.ts) is a measured figure of its own: on 2026-09-04 a real
call on a 142-page journal paper reported **47,289 thinking tokens** against 365,930 of input, at
`effort: "medium"`, and came back whole. That is over the general reservation — so correcting only
the answer estimate below, and leaving this at 40,000, would have turned a free refusal into an
eight-minute paid truncation. Both halves moved together, and neither is a shrink to force a long
article in: `effort` is untouched, for the reason the postmortem gives.

Two failures, deliberately kept distinct, because they are not the same problem:

- **Too long to attempt.** `budgetFor` throws *before* the call when the estimated answer plus the
  reasoning reservation exceeds what one response can hold. Nothing is spent, and the message says
  so. Clamping to the ceiling instead would be friendlier-looking and wrong: the call would run for
  minutes, cost money, and come back truncated anyway.

  **What that boundary is, and what it is not.** It used to be pinned in the tests at exactly 1,976
  blocks, on the argument that the boundary *is* the feature. The number itself turned out to be
  wrong by a factor: `estimateHierarchyTokens` charged one node per four blocks, which is a rate
  fitted to three trees of 19, 141 and 360 blocks, and re-measured over 32 trees from 10 to 2,025
  blocks it over-predicts monotonically with length — 1.35× → 2.2× → 3.8× → 4.0× → **8.21×**. The
  8.21× is the paper it refused, which a real call then answered in 10,996 tokens of a 128,000
  budget. So the estimate is now built from what the prompt asks for rather than from a rate per
  paragraph — the tree it describes for any article at all (three levels, nine children a node, so 81
  sections) as a **floor**, plus the sections the article's own headings and long runs force on top.
  Measured margin over the whole corpus: 2.46× at the tightest. The boundary that leaves is around
  **2,890 blocks** of headingless prose, roughly 180,000 words — but it is a consequence rather than
  a pin, and it moves with an article's heading count. What `tests/token-budget.test.ts` holds is the
  thing that matters: the paper a real call proved fits is not refused, and the estimate clears what
  that call actually cost. It is deliberately not an asymptotic claim; `buildTree` enforces neither
  the depth nor the fan-out the prompt asks for, so no bound here would be a bound the runtime keeps.
  [260904b](../plans/260904b-a-long-pdf-finishes-without-a-retry-click.md).
- **The estimate was wrong.** `stop_reason: "max_tokens"` still throws, and the message now carries
  the budget and the estimate so the constants can be re-tuned from the failure. It does **not**
  suggest retrying, because the Retry button makes the identical call.

What must never happen is the third option: keeping whatever JSON arrived and building a tree from
it. A table of contents that silently describes two thirds of an article is exactly the failure
[silent-success.md](../reusable/silent-success.md) is about, and it is worse than the bug.

**A third failure used to hide behind the second, and it looked identical.** On 2026-09-03 this step
died on `dhammatalks.org/suttas/MN/MN10.html` saying *"it breaks at position 5409 of 13547
characters"* — which reads like a truncated answer and was not one, since `ranOut` had already ruled
truncation out. The likeliest reading is a whole tree with another 8,138 characters written after it,
though nothing kept the response, so that stays a candidate rather than a fact. The stage assumed a
model's answer *is* its
JSON, and it is not — it now reads the answer with `parseJsonAnswer`
([`src/parse-json.ts`](../../src/parse-json.ts)), which finds the document inside a preamble, a
sign-off or a stray close fence, and `diagnose` names trailing material outright instead of quoting
an offset that could mean either thing.
[260903k](../plans/260903k-model-json-answer-extraction-in-the-shared-parse-seam.md).

## The generation prompt

The structure call sees the whole document in one pass, which is what lets it keep sibling titles
consistent with each other and makes the [partition invariant](#the-partition-invariant) something
the model can satisfy rather than something we have to stitch together. That holds up to about
123,500 words.

Each label batch sees: the whole article's outline, its own sections' crumbs and gists, its
paragraphs numbered, and one block of context either side marked `CONTEXT` so it can feel the flow
without labelling it. Blocks whose tag is a heading are marked `HEADING` — the first live run came
back with `"Title: The Mythology Of Conscious AI"`, because `<h1>` alone was not enough signal that
the rule is *copy this exactly*.

The vocabulary rule earns its example. *"Reuse the author's distinctive vocabulary verbatim"* on its
own let the batch prompt turn the author's `technorati` into `technologists` — a synonym is not
merely as good, it is worse, because the reader is scanning for the word they read. Naming that
substitution in the prompt is what fixed it.

### Longer pieces <a id="long-articles"></a>

**A 142-page journal paper fits in one pass, and that is measured rather than hoped.** On 2026-09-04
a real structure call on Kuhn's *A Landscape of Consciousness* — 2,025 blocks, 254 authored headings,
365,930 input tokens — came back `end_turn` with a valid tree tiling every block, in **10,996 answer
tokens** of a 128,000 budget. The old estimate had refused it at 90,275. So the thing that used to
refuse a book was the arithmetic, not the model, and the fix was to re-rate it: see
[the budget](#the-budget).

Past that, the **structure** call is what no longer fits, and generating it section by section is
**still not built**. The budget refuses those out loud rather than half-doing them. The shape it
should take, from GPT-5.6-sol's review and written up in
[260826h-toc-scaling.md § D](../plans/260826h-toc-scaling.md): build the authored-heading skeleton mechanically;
make bounded, navigational section cards in parallel; run one global pass over the ordered cards to
assign top-level boundaries and sibling titles; then generate each coarse subtree in parallel with
the whole global outline in front of it. Never blind subtree calls with independently invented
sibling roots — that is where four sections all end up meaning "Background".

Note what is *no longer* on that list: the labels. They are already batched, and they are the half
that scaled worst.

**The model emits nested JSON; stage 4 converts it to the flat map** and assigns `NodeId`s, `parent`
pointers and `depth`. Asking a model to emit a self-consistent map of cross-referencing ids is
asking for dangling pointers; nesting makes the partition structurally obvious to whatever is
writing it.

**Leaves are generated mechanically, not by the model.** Since every block gets exactly one leaf,
stage 4 creates them itself from `blocks.json`. The model never chooses leaf ranges — it proposes
the internal grouping and writes the `navLabel` text. That removes an entire class of partition
error from the model's job.

The prompt rules below inherit from
[granularity-zoom.md § Generation](granularity-zoom.md#generation) and
[vision.md § Principles](vision.md#principles).

````text
You are building a nested table of contents for an article. It goes all the way
down to individual paragraphs, and it will be rendered as a navigation sidebar.

You receive the article as a numbered list of blocks. Each block has an id
(e.g. spya-k3m9qt), a tag, its text, and a NOT-GISTABLE marker on some.

STRUCTURE

Produce a tree of INTERNAL nodes only. Every node covers a contiguous range of
blocks, and a node's children exactly partition its range — no gaps, no
overlaps, no reordering. The first child starts where its parent starts; the
last child ends where its parent ends.

- The article's own headings are HARD boundaries. A node must begin at a
  heading block wherever one exists. Never merge across a heading.
- Where a run between headings is longer than ~9 blocks, propose your own
  boundaries inside it at genuine topic shifts, and give those nodes titles.
- Aim for 5–9 children per node so each level is an even stride.
- Do NOT emit leaf nodes for individual blocks. Stop at the level above.

TITLES (internal nodes)

- 2–6 words. A title is a landmark, scanned at a glance.
- Where the author gave the section a heading, use that heading's text
  UNCHANGED and repeat it in `sourceHeading`. Rewrite it ONLY if it shares no
  content word with its section body, or is a stock label ("Introduction",
  "Background", "Part Two"). Rewriting should be rare.
- No trailing punctuation.

OUTPUT

JSON only:

{"root": {"title": "...", "range": ["<firstBlockId>", "<lastBlockId>"],
          "sourceHeading": "...", "children": [ ... ]}}

Use only block ids that appear in the input. Do not invent ids. Do not write a
`gist` field — that is a later stage.
````

**The nav labels are not in this response.** They were, and it is what took the stage over the
128,000-token ceiling — one per gistable block is the only output in the pipeline that grows with the
article without a bound. They are now a second pass with a prompt of its own, in
[`src/labels.ts`](../../src/labels.ts): 6–20 words, a claim or a move rather than a topic label, the
author's distinctive vocabulary verbatim, nothing for a NOT-GISTABLE block, and no meta-narration.
See [Two passes](#two-passes) above; the live prompt is the one in the source, and this block is the
structure half only.

### Verify, always

The prompt asks a model to emit a partition over 139 ids. It will occasionally emit an id that isn't
in the input, or a range with a one-block gap. Never trust a generated tree:

```
npm run validate-tree -- example        # or data/<slug> once stage 4 writes one
```

It takes a *directory* holding both `blocks.json` and `tree.json`, not two file paths.

Structural failures exit non-zero; editorial ones (label lengths, a title ending in a full stop, a
gistable leaf with no label) print as warnings and do not fail the run. The check is cheap and it is
the only thing standing between a plausible-looking sidebar and one that silently drops a paragraph.

## Worked example: the derived sidebar

`example/` holds a 34-block slice of the test article. Its `blocks.json` is **real** stage-3 output;
its `tree.json` is **hand-authored** to this schema as a stand-in until stage 4 exists — it is not
model-generated, and its labels are what we want the prompt to produce, not proof that it does.

Collapsed to the heading outline, which is the sidebar's default state
(`npx tsx src/hierarchy-flatten.ts example/tree.json 2`):

```
▸ The Mythology Of Conscious AI  [spya-tgnssb…spya-gxdsbh]
  ▸ Why the question matters  [spya-tgnssb…spya-sge6a2]
    ▸ Title and credits  [spya-tgnssb…spya-rg493b]
    ▸ When, not if  [spya-u6w37a…spya-epw4h3]
    ▸ What is at stake  [spya-e68t9h…spya-sge6a2]
  ▸ The Temptations Of Conscious AI  [spya-nh8mt7…spya-gxdsbh]
    ▸ Intelligence is about doing  [spya-nh8mt7…spya-qb6xsj]
    ▸ Consciousness is about being  [spya-hk6gha…spya-xm96be]
    ▸ Three baked-in biases  [spya-cvaqgs…spya-nxxnrj]
    ▸ Language pulls the strings  [spya-k6fpme…spya-cqh2pq]
    ▸ The techno-rapture  [spya-cke6sj…spya-gxdsbh]

11 rows
```

Expanded to paragraph level (`npx tsx src/hierarchy-flatten.ts example/tree.json`), the same two sections
become:

```
    ▸ When, not if  [spya-u6w37a…spya-epw4h3]
        Playing God is a dream reinvented with every breaking wave of new technology
        AI is another breaking wave, arguably already intelligent, but are these systems conscious?
        From the Golem to Klara, synthetic minds rarely end well for the humans involved
        Google engineer Blake Lemoine claimed LaMDA was conscious, and was dismissed for breaching confidentiality
        Chalmers, Hinton and AI-welfare researchers: machine consciousness is a question of when, not if
    ▸ What is at stake  [spya-e68t9h…spya-sge6a2]
        If AI systems are conscious, moral status, suffering and perhaps rights follow
        Believing our AI companions feel things leaves our psychological vulnerabilities open to exploitation
        Confusing ourselves with our machine creations makes us overestimate them and underestimate ourselves

40 rows
```

34 blocks produce 34 leaves, but only 40 rows in total across every depth — 11 internal plus 29
labelled leaves. The five unlabelled leaves are `Credits`, two pull-quotes, a bare image and
`Figure 1`, each tiled by the tree and each correctly absent from the sidebar.

Note the length contrast between the two listings: `When, not if` against
`Chalmers, Hinton and AI-welfare researchers: machine consciousness is a question of when, not if`.
That is the entry-length rule doing its job — three words are enough to tell that section from its
four siblings, and would be useless at telling five adjacent paragraphs apart.

## See also

- [block-ids.md](block-ids.md) — the id contract these ranges are built on
- [granularity-zoom.md](granularity-zoom.md) — the same tree, rendered as text instead of navigation
- [architecture.md](architecture.md) — where stage 4 sits in the pipeline
- [`src/types.ts`](../../src/types.ts) — the canonical schema
- [`src/validate-tree.ts`](../../src/validate-tree.ts), [`src/hierarchy-flatten.ts`](../../src/hierarchy-flatten.ts)
