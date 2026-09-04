# The tree goes as deep as each part of the article needs

**Status: planned, reviewed twice, not yet built. Stages 1 and 2 (the measurements and the spikes)
are done; nothing in `src/` has changed.** Started
2026-09-04. Worktree `deepen-fat-sections`. **Supersedes
[260904c-hierarchy-structure-in-waves.md](260904c-hierarchy-structure-in-waves.md)**, whose pure core
this uses and whose framing — latency and the length ceiling — the measurements below have moved on
from.

The top level comes from one call that sees everything. Then every section fans out to its own
scoped call, in parallel, one level deeper — and **each call says whether its own children still need
splitting**. Repeat until nobody says yes.

> My intuition remains that we should do this adaptively […] fan out the sections of it to separate
> agents in parallel to output sub-sections for one level deeper within their section, and so on. The
> subagents should also perhaps provide output on whether they think their section deserves further
> deepening.
>
> — Greg, 2026-09-04

**The first draft of this plan asked for one extra level everywhere it was needed, chosen by a
word-and-block heuristic.** Both halves of that turned out wrong, and the evidence is below: one
extra level is not enough on a book, and a heuristic is a worse instrument than asking the call that
just read the section. What survives from that draft is the reader-facing half — a column is a
frontier, not a depth — which the adaptive version needs more, not less.

## The problem, in the reader's terms

Granularity zoom promises that every level is a compression of the level below it, so a reader can
step down one rung at a time. Today the ladder has a fixed number of rungs: the structure prompt
says *"Go 3 levels deep: root (depth 0), chapters (depth 1), sections (depth 2)"*, and
[`buildTree`](../../src/hierarchy.ts) grows one leaf per block underneath. Root → chapters →
sections → paragraphs, on every article, whatever its length.

Where a section came back holding 26 paragraphs and 1,754 words, the reader's next step down from
one sentence is all 26 paragraphs at once. The rung is missing, and the doc names that failure
itself: *"one level doing all the work"*
([granularity-zoom.md](../project/granularity-zoom.md)).

### How often, measured

The 13 real articles in `data/` with a `tree.json`, on 2026-09-04. A "section" is a node all of
whose children are childless — the deepest thing the model actually proposes. **Supplement subtrees
are excluded**; see the correction below. "Fat" is `words > 800 and blocks ≥ 10`, for reasons two
sections down.

| article | blocks | sections | median blocks | biggest section | fat sections | % of body words inside one |
|---|---|---|---|---|---|---|
| noema-mythology-of-conscious-ai | 141 | 21 | 5 | 26 blocks / 1,754 w | 2 | **32%** |
| towards-a-theory-of-bugs | 244 | 39 | 6 | 12 blocks / 899 w | 1 | **11%** |
| constitution | 360 | 50 | 7 | 23 blocks / 1,302 w | 2 | **10%** |
| the other 10 (10–186 blocks) | — | — | 1–7 | ≤ 12 blocks / ≤ 908 w | 0 | 0% |

**Three of thirteen, and only one of them badly.** That is thinner evidence than it first looked,
and the reason is worth recording.

#### The correction: the fattest "section" in the corpus was a supplement

The first run of this measurement put `scaling-hypothesis` at the top with a 41-block, 4,209-word
section, and reported it as 22% of the article. That node is `treatment: "supplement"` — the essay's
endnotes — and a supplement is a **depth-1 child of the root with a flat run of leaves**, by
invariant ([`tree-invariants.ts`](../../src/tree-invariants.ts) rule 1). It is deliberately not
subdivided and must not be. With supplements excluded, `scaling-hypothesis`'s largest real section is
8 blocks and 908 words and the article drops off the list entirely.

Anything that walks "nodes whose children are all leaves" and does not exclude supplements will find
the same phantom. **The deepening pass must exclude them too**, or it will spend a call subdividing a
bibliography and then fail `checkTree`.

### Blocks measure divisibility; words measure the reader's burden

The obvious instrument is the block count, and on its own it is the wrong one. Across all 296
sections, words-per-block runs from 14 at the 10th percentile to 127 at the 90th and 502 at the
worst, and the two rankings barely agree: of the **10 fattest sections by block count, only 4 are
also in the 10 fattest by words**. Both ends of that disagreement are real, and each one breaks a
single-instrument rule:

- `constitution` has a section of **15 blocks and 109 words** — seven words a block, a list of
  one-line clauses. Fat by blocks, nothing to a reader. Another rung there is pure overhead.
- `fowler-phrenology` has a section of **3 blocks and 874 words**. Fat by words, and **impossible to
  subdivide**: the block is the atom, so three blocks cannot make a useful child set.

So the test is a conjunction:

> **Deepen a section when it is heavy enough to be worth another rung (words) *and* divisible enough
> for that rung to exist (blocks).**

⟨Fable, 2026-09-04, who reached the same conjunction independently and set the trigger higher.⟩ How
often each candidate fires, body sections only:

| rule | sections | articles |
|---|---|---|
| `w > 600 & b ≥ 8` | 17 | 5 |
| `w > 800 & b ≥ 8` | 8 | 4 |
| **`w > 800 & b ≥ 10`** | **5** | **3** |
| `w > 1000 & b ≥ 10` | 2 | 2 |
| `w > 1500 & b ≥ 10` (Fable's) | 1 | 1 |

`w > 800 & b ≥ 10` is the starting point: it fires on every section a reader would call fat and on
nothing else, and 5 sections is roughly **two calls**, because `planExpansionBatches` packs up to
four parents into one request. Fable's 1,500 was picked from reading time before this table existed
and fires once in the whole corpus. The number is a starting point to be tuned against the eval, and
the *shape* — a conjunction, words triggering and blocks gating — is the part that should not move.

### The depth cap is only half the cause

Fable's hypothesis was that the fat sections would all carry `sourceHeading`: on an article with two
levels of authored headings, depths 1 and 2 are both consumed and the model has no room left to
split a long run, so no prompt tweak could fix it. **The data says half.** Three of the five fat
sections carry the author's own heading, two are boundaries the model invented and then did not
subdivide.

So a prompt tweak is worth one cheap experiment before any of this is built (stage 1), and it cannot
be the whole answer.

## What we are going to do

**Wave 1** is one whole-document call, as today: it sees every boundary and every sibling title at
once, and its answer is the global outline that every later call is shown. That much of
[260826h § D](260826h-toc-scaling.md#d-coarse-to-fine-a-global-outline-first-then-subtrees-in-parallel)'s
argument stands and is not being traded away:

> Below ~125,000 words a single structure call sees every boundary and every sibling title at once,
> which is strictly better than any decomposition and much simpler.

**Wave 2 onwards** fans out. Every node that says it needs splitting gets a scoped call carrying its
own blocks, its ancestor chain, and the global outline; disjoint calls run in parallel; each returns
a complete child set for its parent, **and a judgment per child about whether that child is finished
or still needs a level of its own**. The next wave is whatever came back unfinished. It stops when
nothing does, or at a depth cap.

### The self-assessment is the instrument, not a heuristic

The first draft chose targets with `words > 800 and blocks ≥ 10`. That conjunction is still the right
*shape* for a cheap pre-filter, and it is still wrong as the decision: a section that is one sustained
argument and a section that is five loosely-joined ones have identical counts, and only one of them
has anything to divide. The call that just read the prose knows which; the counter never can.

So the answer format grows one field per child — finished, or wants a level of its own, with a
reason — and the counters become a **bound** rather than a decision: a node under the divisibility
floor is never expanded however loudly it asks, and a node past the depth cap is recorded as
`capReached` rather than quietly accepted.

This has a failure mode worth naming before it happens: a model that always says "yes, deeper" turns
a bounded cascade into a bill. The floor and the cap are what make that merely expensive rather than
unbounded, and the eval has to report **how often the self-assessment says yes** as a first-class
number, not just the tree it produced.

### The four bounds, and which of them can overrule the verdict

⟨Fable, 2026-09-04, on the two questions the spike raised.⟩ Three bounds are mechanical and one is
the cap; the verdict decides everything they leave open.

**They are ordered, and the order is the part that must be written down.** The first draft listed
them as a set, and two of them contradict: an eight-block node holding two authored headings is under
the floor *and* over the heading rule. ⟨GPT Sol, finding 4.⟩ `hierarchy-cascade.ts` had already
settled it — *"a size rule alone can break the hard-heading rule […] its leaves would then span a
heading, which the prompt calls a hard boundary"* — and its test expands an eight-block node for
exactly this reason. So the plan adopts the code's precedence rather than inventing a second one:

| | bound | rule | effect |
|---|---|---|---|
| 1 | **depth cap** | past it, nothing expands | refuses; records `capReached` |
| 2 | **two-headings rule** | a node whose range holds **two or more authored heading blocks is never finished**, whatever it says — and this **beats the floor** | forces open |
| 3 | **divisibility floor** | never expand a node under ~10 structural blocks | refuses |
| 4 | **forced-open ceiling** | a node over ~2,000 words, above the floor, marked finished, is opened anyway and counted as `forcedOpen` | forces open |
| 5 | **the model's verdict** | decides everything the four leave open | — |

**The two-headings rule is the most valuable line in this plan.** It is purely mechanical, costs
nothing, and on Moby-Dick's current tree it fires on **22 of 54 sections holding 69% of the body
words** — which is the hundred lost chapter headings, caught by arithmetic rather than by judgment.
On Darwin, which has 24 headings in 1,326 blocks, it fires on 3 sections and 1% of the words. It
cannot be left to the model: the whole finding above is that the model resolves the
headings-versus-stride collision differently on different runs.

### Where the author's headings and the fan-out target collide, the author wins

The prompt's *"headings are HARD boundaries"* and *"aim for 5-9 children"* have no stated order, so
the model picks one at random — that is run A versus run B, and it is a precedence bug rather than a
product choice. ⟨Fable.⟩ The order is:

> An authored heading always begins a child, and no child may contain more than one authored
> heading. Aim for 5-9 children **only where you are inventing the boundaries yourself**; if the
> headings give you more, return more.

So run B's shape, deterministically. What that trades away is an even stride at that level — twenty
siblings under one node is over the target — and the argument for paying it is that the invented
grouping is content-free: *"Quarter-Deck, Sunset, Dusk"* is a list of its children's names, which is
the tell that the model had nothing to say about the group, and the *"four sections all end up
meaning 'Background'"* failure by another name. If twenty under one L1 node is genuinely too flat,
the fault is at wave 1 — a 382-block, 20-heading L1 node was too big an L1 node — and it should be
fixed there rather than by inventing a layer below it.

### Where I checked Fable and it was wrong

Fable's answer to the word-burden question rested on the claim that the "46% of Darwin's words sit in
a fat section" figure counts words alone, and that the children in question are under the
divisibility floor, so *"the model and the plan agree; only the metric disagrees"*. **The first half
is not true.** That figure already applies `blocks ≥ 10`; words alone would have been 94%. Measured
again on 2026-09-04:

| Origin of Species, 4-level tree, 126 sections | sections | % of body words |
|---|---|---|
| words alone, `w > 800` | 70 | 94% |
| `w > 800 & b ≥ 10` — the 46% figure | 25 | **46%** |
| `w > 2000 & b ≥ 10` — over the forced-open ceiling | 20 | **41%** |
| below the floor but heavy: `b < 10 & w > 1200` | 39 | 45% |

So the residual is real: **41% of Darwin's words are in sections that are both divisible and past the
ceiling**, and the forced-open rule is doing substantial work rather than tidying an artefact.

But the last row is the more interesting one, and it makes Fable's *conclusion* right for a reason
its argument did not give. Thirty-nine of Darwin's sections are **nine paragraphs of 300 words
each** — heavy, and genuinely indivisible, because the block is the atom. No tree can offer a rung
finer than the paragraph there. The rung the reader gets is the one that already exists: the
`navLabel` on each paragraph, which
[hierarchy.md § Entry length grows with depth](../project/hierarchy.md#granularity) says is 6–20
words and exists precisely to tell same-topic siblings apart. **If Darwin reads badly it is a
question about when the Para column opens, not about how deep the tree goes** — and that is a much
cheaper thing to fix than a model call.

### What this is, honestly: 260904c with a better argument

This is the breadth-first cascade that
[260904c](260904c-hierarchy-structure-in-waves.md) planned and paused, plus the self-assessment. The
pure core — `shouldExpand`, `planExpansionBatches`, `normaliseExpansion`, `assertCascadeComplete`,
`finaliseCascade` — is already written, tested and reviewed in
[`src/hierarchy-cascade.ts`](../../src/hierarchy-cascade.ts), and until now called by nothing.

What changed is the argument for it. 260904c argued latency and the length ceiling, and both of those
weakened: the ceiling moved to 2,889 blocks when the estimator was re-rated, and a book's structure
call turns out to take 102 s, not the 508 s that made the case. **The argument that replaces them is
reliability**, and it is stronger:

> A call shown thirty blocks cannot emit a range that is wrong by 1,289 of them.

That is not a slogan — it is the measured failure of the alternative, four runs out of four, in
[the free experiment](#the-free-experiment-a-conditional-fourth-level-in-the-one-whole-document-call)
below.

### It costs about eight times more on a book, and that is the trade

Costed against the real gateway prices and the measured Moby-Dick figures, for a ~296-call, 4-wave
cascade:

| | input | output | total | vs today |
|---|---|---|---|---|
| **slices only** (each call sees its own range) | $4.42 | ~$4.0 | **~$8.4** | 8.4× |
| whole article as a cached prefix on every call | $31.96 | ~$4.0 | ~$36 | 36× |
| today, one call | $0.91 | $0.10 | $1.00 | 1× |

**Per node produced the cascade is cheaper** — about 0.7¢ against 1.6¢ — because today's $1.00 buys
64 nodes and the cascade's $8.40 buys around 1,300. An ordinary article is a fraction of this: two
waves and a couple of dozen small calls.

**And the obvious use of prompt caching is the expensive one.** Sending the whole article as a cached
prefix to every scoped call loses by 4×, because a cache read costs exactly what sending 10% of the
article costs and a Moby-Dick section is 0.93% of the book. The break-even is a slice of **257
blocks**: only wave 2's chapter-sized calls come near it. What caching should hold is the small
shared prefix — the rules plus the frozen global outline — which is worth about 8%, and **may be
worth nothing at all**: Sonnet 5 will not cache a prefix under 1,024 tokens, and the estimate lands
at 1,150–1,400. `src/labels.ts` spent months writing a cache marker that did nothing for exactly this
reason, so the cascade reports `estimatedCacheable` and `cacheReadTokens` the way labels now does, or
the saving is invisible whether or not it happened.

Two constraints that follow, both from the same source: `output_config.effort` is part of the cache
key, so a wave that varies effort loses its cohort's prefix; and the breakpoint is a **position** —
rules, then the frozen outline, then the per-call targets and slices.

### Concurrency is the thing that decides whether this ships

`src/messages-stream.ts` imposes no limit; `src/labels.ts` uses `CONCURRENCY = 4` with the stated
reason "politeness to the rate limiter" and no measurement behind it; `src/pdf-read.ts` runs 16
against the same account and doubled it from 8 without incident.

At 4, a 296-call cascade is about **1,450 s** — roughly twice the 740 s at which the job self-aborts
(`LEASE_MS = 760_000` less `DEADLINE_MARGIN_MS`). At 16 it is about **480 s**, inside
`STEP_BUDGET_MS.hierarchy = 700_000` with margin. So this needs a measured concurrency, and a book
needs the checkpoints to survive being resumed across attempts, because a single attempt is not
guaranteed to be enough.

### What it does to the wait, which is not what 260904c assumed

Not a saving, and not the disaster the arithmetic first suggested either. Wave 1 is the same call it
is today (102 s on Moby-Dick), and the waves after it are parallel. At a concurrency of 16 the whole
cascade is around 480 s against today's 102 s on a book — **slower**, and inside the budget.

The 508 s figure that made latency 260904c's headline was the 142-page journal paper, not length as
such: a book two and a half times larger answers in a fifth of the time. Whatever is slow about that
document, this plan does not claim to fix it, and neither did the measurement.

## The idea that makes ragged depth work: a column is a frontier, not a depth

After deepening, one chapter is four levels deep and its neighbour is three. The reading view is a
literal `<table>` — one row per block, one column per depth, every level on screen at once — so the
obvious question is what the fourth column holds for a branch that has no fourth level.

⟨Fable, 2026-09-04⟩, and it reframes the question:

> What makes the zoom work is frontiers, not depths. The invariant the doc leans on is "any level of
> the tree read left-to-right is a valid rendering of the article". That property belongs to any
> **frontier** — any set of nodes that covers the article without overlap. Every depth is a frontier;
> not every useful frontier is a depth. […] What ragged depth breaks is "each column is a uniform
> depth". What fat sections break *today* is "each column is a uniform stride". Stride is what the
> reader feels; depth is what the code found convenient. Choose stride.

Three things follow, and the first two are already true of the code:

1. **Ragged depth is already in the tree.** A supplement is depth 1 with leaves at depth 2, beside a
   body that goes to 3. `buildGeometry` already handles it: a block whose chain is shorter than the
   column reuses its deepest node, flagged `continuation`, drawn blank rather than repeated.
2. **Every printed table of contents is ragged.** Some chapters have sub-sections and some do not,
   and a reader reads that as information about the chapter, not as a broken model.
3. **So keep one global control, and change what the second column shows.** `L1` stays depth 1 — the
   spine, the arc, the step marker and the keyboard ladder all hang off it. The column now called
   `L2`/"Sections" becomes **the frontier**: for each block, the finest *titled* node containing it.
   On an undeepened article that is bit-for-bit what it shows today, so nothing changes for ten of
   thirteen articles; on a deepened one it shows sections where sections were fine and sub-sections
   where they were fat.

#### "Each leaf's parent" is the wrong definition, and the right one is a projection

The first draft defined the frontier as *each leaf's parent*, and that is not always an antichain.
⟨GPT Sol, finding 2, who found the fixture and ran it.⟩ `checkTree` permits an internal node to have
both leaf and internal children — it only requires the children to tile — and `appendSupplement`
produces exactly that shape on a shallow tree:

```
root
 ├── body leaf
 ├── body leaf
 └── supplement          ← internal, beside the root's own leaves
       └── note leaf
```

The leaf parents are then `{root, supplement}`, and the root contains the supplement. They overlap,
so they are not a partition, and anything computing a column from them renders the article twice.
`tests/supplement.test.ts` already accepts this tree as valid.

So the frontier is **a projection with stated rules**, not a property claimed of the tree:

- For each block, walk its chain and take the **deepest node that is not a leaf**. On an ordinary
  branch that is the leaf's parent; on the shallow-plus-apparatus shape above it is the root for a
  body block and the supplement for a note, which do not overlap because no block is in both.
- A supplement has no `gist` **deliberately**, so the column shows its title alone, exactly as the
  sections column shows "Notes" today.

That is a handful of lines and a test per shape — ordinary, deepened, shallow, provisional,
supplement — and the tests are the deliverable, because the failure is silent.

The one thing the frontier column hides is the skipped rung — on a deep branch, chapter →
sub-section is two steps and the section between them is off screen. The proposal is an eyebrow line
carrying the parent's title above the sub-section cell, the way `§` already marks an authored
heading. **Flagged as the one piece of new visual design in this plan**, and the first thing to cut
if it does not look right.

Rejected alternatives for the ragged cell, all of them Fable's calls and all of them agreed:
repeating the parent's sentence in the deeper column (the arc already learned that a repeated
sentence reads as a second opinion, and `buildGeometry`'s own comment says the continuation exists
"so the text isn't repeated"); a per-branch zoom control (right in the tree, wrong as a control —
`column-context.ts`'s `opened` set is already the per-branch mechanism, and a second one would
compete with it); and padding shallow branches to a uniform depth, which spends a call to produce a
duplicate gist.

## The bug this would hit on day one, verified

`buildGeometry` decides whether a cell is a continuation with
[`src/web/tree.ts:119-120`](../../src/web/tree.ts):

```ts
const id = chain[Math.min(depth, chain.length - 1)]!;
return { node: tree.nodes[id], continuation: depth > chain.length - 1 };
```

A block in an *un*-deepened branch has a chain of length 4 — root, chapter, section, leaf. In a tree
where some other branch was deepened, `maxDepth` is 4 and the columns are 0–4. At column 3,
`chain.length - 1` is also 3, so `continuation` is **false** and `chain[3]` is the **leaf**. The leaf
lands in a gist column marked as real content, and `TableView`'s `node.gist ? … : navLabel` branch
then renders a paragraph's nav label inside a gist column.

⟨Fable found it by reading; confirmed here against the source.⟩ The fix is one rule: **leaves project
only into the leaf column, and any gist column past a branch's last internal node is a
continuation.** With the frontier column above, the ordinary reader never sees those columns anyway
— they appear only when someone asks for every column via `?cols=` — but the rule has to exist
before the tree can be ragged at all.

## What else the tree's depth is wired into

Surveyed 2026-09-04. The good news first: **`buildGeometry`, `checkTree`, `navPlan`, `fitView`,
`columnLabel`/`columnPill`/`columnHint` and `flattenTree` are already depth-generic**, and the tree is
stored as opaque `jsonb` with no depth column and no CHECK, so persistence is unbounded.
`tests/column-names.test.ts` already asserts `columnPill(5, 5) === "Para"` — the naming layer was
written for this.

**Would show wrong data:**

- [`src/web/position.ts:60`](../../src/web/position.ts) — `sectionDepth = max(1, leafDepth - 1)`.
  With a ragged tree that becomes 3, and in un-deepened branches column 3 holds per-block
  continuation cells. `navigableItems` does not collapse continuations, so `buildSections` yields one
  nameless section per paragraph, and `?at=` becomes paragraph-granular and churns the URL. **The
  subtlest item on the list**; wants an explicit "deepest titled depth", not `leafDepth - 1`.
- [`src/web/outline.ts:227-267`](../../src/web/outline.ts) — the outline band walks exactly three
  rungs (`part → section → para`, `level` pushed as the literals 1, 2, 3), with `PARAGRAPH_CAP = 8`
  and `Rung = 1|2|3|4|5` tuned to it. On a four-level tree rung 3 lists sub-section titles where it
  promised paragraph labels, and the paragraphs become unreachable in that panel. The file says the
  explicit walk is deliberate, so this is a rewrite of the ladder, not a constant. **The hardest
  single item.**
- Summary mode is capped at 2 in three places that must move together —
  `App.tsx` `buildSummaryTree(...)` at the default `depthLimit = 2`, `params.ts`
  `MAX_SUMMARY_DEPTH = 2`, and `SummaryPanel.tsx` `DEPTH_LABELS = ["article", "parts", "sections"]`.
  Deeper nodes are not built, not listed and not reachable by `?deep=3`.

**Would look wrong:** `App.tsx`'s hardcoded `buildOutline(tree, blocks, 3)` and the spine's L1/L2
derivation; `styles.css`, which defines `--depth-0…3`, `.ctx-panel.depth-0…2` and `.outln-row.lvl-1…3`
and nothing below; auto-fit in `layout.ts`, which would open a third gist column by default on a wide
window; and the two independent "Sections means depth 2" counters in `library-scalars.ts` and
`web/stats.ts`, held together by `tests/block-policy.test.ts`.

**Deliberately left alone:** `diagram.ts` `MAX_DRAWN_DEPTH = 2`, whose docstring says the layouts and
the stylesheet assume it. A deeper tree gets a truncated picture, which is the existing intended
behaviour.

**On the generation side:** the prompt string is pinned verbatim by
`tests/hierarchy-structure-request-parity.test.ts`, so touching it is a deliberate act with a test to
update. And `tree-invariants.ts` requires **every internal node to carry a gist** and a title of 1–8
words — so a subdivision pass that returns titled-but-gistless nodes hard-fails publish. The
subdivision prompt must ask for gists.

## The machinery already exists

[`src/hierarchy-cascade.ts`](../../src/hierarchy-cascade.ts) — 1,275 lines, pure, 38 tests, reviewed
twice, and until now **called by nothing**. It was built for 260904c to cascade from the root down.
Deepening is the same machinery seeded one layer lower:

| what deepening needs | what the cascade core already has |
|---|---|
| "is this section fat?" | `shouldExpand` against `CASCADE_RECIPE.terminalBlocks` |
| how many children to ask for | `predictedChildren` |
| several fat sections in one call | `planExpansionBatches` — packs parents until the child count, the evidence estimate or the hard request bound says stop |
| a section too big for one call | `OversizedTarget`, returned rather than sent |
| turning an answer into ranges | `normaliseExpansion` (starts-only; every end derived) |
| "did we actually finish?" | `assertCascadeComplete` |
| a buildable result | `finaliseCascade` → `ModelNode`, exactly what `buildTree` takes |
| a depth stop | `CASCADE_RECIPE.maxDepth` and `CapReached` |

The one thing it does not have is the **words** half of the fatness test: `shouldExpand` counts
structural blocks only. That is a small, additive change to `CascadeRecipe` and its predicate.

So what is missing is the impure half — render a request, make the call, attach the answer,
checkpoint it. Much smaller than 260904c's stage 2, and it makes 1,275 lines of tested code
load-bearing instead of dead.

### Where it goes in `generateHierarchy`

Today:

```
raw answer ──parseJson──▶ ModelNode ──buildTree──▶ Tree ──appendSupplement──▶ assertTreeSound
```

The first draft of this plan said "deepen the `ModelNode` between `parseJson` and `buildTree`", and
**that is unsafe**. ⟨GPT Sol, on the plan, 2026-09-04, finding 1; confirmed here against the
source.⟩ `buildTree` does not accept the model's ranges, it **derives** them: `planChildRanges` pins
the first child to its parent's start, clamps later starts back inside, snaps a section onto its own
heading and computes every end, and `visit` then passes the *derived* range down to the child rather
than the child's own ([`src/hierarchy.ts:1570`](../../src/hierarchy.ts)). So a deepening call handed
the raw proposal could be shown section `[20…40]` while the finished tree gives that node `[18…47]`.
The tree tiles, covers every block and passes every invariant — and its new titles and gists describe
**prose the call never saw**. Not theoretical: Moby-Dick's structure answer needed 55 boundary
repairs. `hierarchy-cascade.ts` states the assumption it was built on outright — every range handed
to it "was derived by this file".

So the derived ranges have to exist before any scoped call is made:

```
raw answer ──parseJson──▶ ModelNode ──buildTree──▶ Tree
                                                    │
                                    proposalFromTree │  (internal nodes only, derived ranges)
                                                    ▼
                                                ModelNode ──DEEPEN──▶ ModelNode
                                                                          │
                                                              buildTree ──┴──▶ Tree ──appendSupplement──▶ …
```

`buildTree` runs twice over the same article, which is free — it is pure, takes milliseconds, and
the second run over already-derived ranges derives the same ones again. What that buys:

1. Every scoped call is shown the range the finished tree will actually give the node.
2. Every check `buildTree` makes — tiling, coverage, repairs, the root clamp — still runs **once**
   over the finished proposal, unchanged. There is no second validation path to keep in step.
3. The leaf layer is grown once, under whatever the deepest node on each branch turns out to be. No
   leaf is minted and then re-parented.
4. Supplements are appended *after* `buildTree`, so deepening never sees one and cannot break the
   depth-1 rule — which is also the phantom the measurement above tripped over.

`proposalFromTree` is the one genuinely new pure function this needs, and it is small: walk the
internal nodes, emit `{title, gist, range, sourceHeading, children}`, stop where the children are
leaves. It wants a round-trip test — `buildTree(proposalFromTree(buildTree(p)))` and `buildTree(p)`
agree on every range — which is also the test that says the second build is idempotent.

**Before `generateLabels`, necessarily.** `labels.json` stamps `structureHash(tree)`, so a tree
deepened after the labels were written would be stale at birth and nothing would say so
([hierarchy.md § Two passes](../project/hierarchy.md#two-passes)).

### What a deepening call is shown

The rule from [260826h § 2](260826h-toc-scaling.md), which the label pass already follows and which
this pass inherits rather than reinvents:

> Generate siblings together; generate disjoint sibling groups in parallel.

One call returns a complete child set for each parent it carries — never half of one. Each call gets
the parent's own blocks, its ancestor titles and gists, and the global outline, because of the
failure the same doc names:

> Never blind subtree calls with independently invented sibling roots — that is where four sections
> all end up meaning "Background".

And it is told the same targets the main prompt uses (5–9 children, and the fatness rule), so that
its own output is not itself fat on the next pass.

## What the second review changed, and what is still open

⟨GPT Sol, on the rewritten plan, 2026-09-04. Verdict: *"the scoped-wave architecture is directionally
right, but the rewrite does not completely close either original blocker."*⟩ Both were checked here.

### Still blocking 1 — waves 2 and beyond do not see the ranges the final tree will use either

`proposalFromTree` fixes the seed layer, and that half is right. But `planChildRanges` calls
`snapStartsToHeadings` before deriving its ranges ([`src/hierarchy.ts:1205`](../../src/hierarchy.ts))
and `normaliseExpansion` **has no such call** — confirmed by grep, and Sol reproduced the divergence:
normalisation produced `[0–1], [2–4]`, and rebuilding moved them to `[0–0], [1–4]` because the second
child named the heading at block 1. So a wave-3 call reads a slice the finished tree will not give
its parent. The fix is that the scoped normaliser and `planChildRanges` share one start-derivation
rule, heading snap included — and the differential test between them gains a heading-snap case,
because it currently has none and passes anyway.

### And the plan's own slogan is false as written

> A call shown thirty blocks cannot emit a range that is wrong by 1,289 of them.

It can. `normaliseExpansion` **clamps** a start that names a block outside the parent rather than
refusing it: Sol reproduced a parent `[2–7]` whose second child claimed block 9 becoming
`[2–6], [7–7]`, recorded as a repair. The scoped call's advantage is real — it cannot *lose track* of
a book it was never shown — but the guarantee has to be enforced by the validator, not assumed from
the prompt. **A start outside its parent is refused, not clamped**, and that is a change to
`normaliseExpansion`.

### Still blocking 2 — the frontier projection is still not a frontier

"Deepest non-leaf node per block" does not fix it. `checkTree` permits a body node with leaf,
internal, leaf children, and the projection then reads `root | internal child | root` — and
`buildGeometry` groups only *contiguous* runs of the same node, so the root becomes **two cells and
its whole-article gist appears twice** as though it described two small sections. A flat provisional
tree is worse: every block projects to the root, and the Sections column becomes a copy of the
article column. Both shapes are explicitly valid and have tests.

So stage 4 must pick one and say so:

1. forbid mixed leaf/internal siblings in the body, as a new tree invariant; or
2. define the column as *contiguous projected segments*, and state how a repeated node and a flat
   root render; or
3. use a true recursive antichain and accept that some deeper nodes are hidden.

### The concurrency arithmetic was wrong in two ways

- **The worker runs three jobs at once** ([`src/jobs.ts`](../../src/jobs.ts)), so a cascade-local
  limit of 16 is up to **48 concurrent hierarchy calls**, before any request-path traffic.
- **`streamMessage` sets `maxRetries: 0`**, and there is no 429 path on this call path at all. The
  16 that `src/pdf-read.ts` runs is not transferable evidence: it has counted transport attempts and
  rate-limit backoff, and this does not.
- **480 s was the cascade, not the step.** `generateHierarchy` then runs the label pass over what is
  now a 1,300-node tree, and the spike explicitly excluded labels. The number that matters is the
  whole step, measured under three concurrent jobs.

### Wave 2 has no seed

Wave 1 is unchanged, so none of its children carries a verdict — yet the plan defines wave 2 as "the
nodes that said they need splitting". **Mechanical eligibility selects the first wave's targets; only
the returned verdicts govern the waves after it.** Termination is proven for accepted expansions
(two strictly increasing starts, and the depth cap), but not for refusals: `ExpansionRefused` is
retryable and nothing bounds the attempts. A fixed attempt budget per batch, and completed siblings
preserved when it runs out.

## Stages

### Stage 1 — find out whether this is worth building, before building it

The evidence above is three articles out of thirteen, one of them badly. Fable's reframe is that the
real case is a **book**, where 2,500 blocks at 5–9 per node needs depth 4–5 on every branch — and no
book has ever been measured, because until 2026-09-04 the structure call refused one.

Two experiments, both cheap, and this stage is a **decision gate**:

1. **Build a tree for a book.** `output/2701-h.html` (Moby-Dick, 2,569 blocks) and
   `output/1228-h.html` (1,326) are preserved in the primary checkout; `blocks` is deterministic and
   free to rebuild. One paid structure call each. Then run the section measurement on the result.
2. **The free prompt experiment.** Two of the five fat sections have no authored heading, so the
   model invented that boundary and declined to split further. Re-run those two articles with the
   "~9 blocks" instruction sharpened, and see whether the fat sections survive. If a prompt tweak
   fixes half the corpus cases for nothing, that changes what stage 2 is for.

**Done:** a table of section sizes for a real book, next to the article table above; a verdict on the
prompt experiment; and the plan's own recommendation updated to match — including "stop here" if the
book turns out to be fine, which is a real possible outcome and the reason this stage exists.

#### Result: build it. On a book the zoom barely works at all.

Two books, structure call only, 2026-09-04. `scripts/spike-book-structure.ts`.

| | Moby-Dick (`2701-h`) | Origin of Species (`1228-h`) |
|---|---|---|
| blocks / words | 2,569 / 209,219 | 1,326 / 155,478 |
| the call | 102 s, 453,832 in, 9,587 out, `end_turn` | 126 s, 298,741 in, 12,095 out, `end_turn` |
| tree | 10 chapters, **54 sections** | 10 chapters, **51 sections** |
| median section | **24 blocks / 1,676 words** | **17 blocks / 2,768 words** |
| p90 section | 82 blocks / 5,509 words | 35 blocks / 6,419 words |
| biggest section | **382 blocks / 34,884 words** | 131 blocks / 7,390 words |
| body words inside a fat section | **96%** | **92%** |
| boundaries mended by `buildTree` | 55 | 30 |

The article table above says three of thirteen and one of them badly. The book table says **the
zoom is not working at all**: a reader steps from 10 chapter gists to 54 section gists to 2,569
paragraphs, and the largest single step is one sentence covering **34,884 words** — about two and a
half hours of reading. That is [granularity-zoom.md](../project/granularity-zoom.md)'s own named
failure, *"one level doing all the work"*, at full size.

Two things worth having noticed:

- **Latency is not the problem here.** 102 s and 126 s, against the 508 s recorded for the 142-page
  journal paper. Whatever made that call slow, it was not simply length.
- **The book's own table of contents does not survive.** Melville wrote 144 headings; **44 of them
  start a node**. A hundred chapter titles are invisible in a table of contents that the prompt
  says must treat them as hard boundaries.

#### And the last one is a collision between two instructions, not a model failure

The prompt asks for two things that pull against each other on a book:

- *"The article's own headings are HARD boundaries. A node must begin at a heading block wherever
  one exists."*
- *"Aim for 5-9 children per node"* and *"Go 3 levels deep"*.

Three levels at a fan-out of nine is 81 sections; Moby-Dick has 144 authored headings, and the model
produced 54 sections and dropped a hundred of the headings. So it kept the stride and gave up the
boundaries — which is one of the two things it was told to do, and the prompt never said which wins.

**An earlier draft of this section called that arithmetic, and said a fixed depth of three
*cannot* represent a book's structure. That is overstated, and GPT Sol was right to catch it.**
"Aim for 5-9" is a target, not a bound: run B of the expansion spike below returned **twenty**
children when the headings called for twenty. So nothing forbids a 3-level tree with 144 sections;
the model simply does not produce one, and produced 54.

What survives is the measurement rather than the proof, and it is still the strongest thing here:
**at a fixed depth of three, on two real books, the model reliably keeps the stride and throws away
the author's own structure** — 44 of 144 headings on Moby-Dick. The fix is to say which rule wins,
and to give the boundaries somewhere to go.

#### The free experiment: a conditional fourth level in the one whole-document call

If the depth cap is what binds, lifting it costs one line of prompt and no extra calls. This is the
simplest version, so it is the one that has to be ruled out before anything is built — and GPT Sol's
review named it independently as the experiment the plan was missing. `system-deeper.txt` replaces
"Go 3 levels deep" with:

> Go as deep as the article needs, up to 4 levels […] Add a fourth level ONLY inside a section that
> would otherwise hold more than 9 blocks or more than about 800 words. Most sections need no fourth
> level; a tree where every branch is four deep is wrong.

**On an article it works, and it is free.** The worst article in the corpus:

| noema (141 blocks) | incumbent | conditional 4 levels |
|---|---|---|
| biggest section | 26 blocks / **1,754 words** | 15 blocks / **919 words** |
| sections over 1,000 words | 1 | **0** |
| body words inside a fat section | 32% | 22% |
| the call | — | 32 s, 2,934 out |

The tree came back genuinely ragged — a fourth level in a few branches and not in the rest — which
is also the first real evidence that the model will *use* a conditional instruction rather than
applying it everywhere.

**On the bigger book it fails outright. Four runs, four failures.** Same prompt, same blocks,
Moby-Dick (2,569 blocks):

| run | output | elapsed | what `buildTree` said |
|---|---|---|---|
| 1 | 23,352 | 219 s | a range naming two ids that are not in the article |
| 2 | 7,618 | 89 s | a range running **backwards by 1,289 blocks**, plus `spya-avr7mwa` — a real id with one extra character |
| 3 | 7,365 | 82 s | a range whose end is a 10-character string that is not an id |
| 4 | 18,239 | 180 s | a range running backwards by 6 blocks |

Every call returned `end_turn` — none was truncated or refused. Output sizes span **threefold**, and
runs 2 and 3 ignored the fourth-level instruction altogether while 1 and 4 obeyed it. Not one
produced a tree. The faults are mechanical rather than editorial, and `buildTree` discards a
100–200 second answer for a single one of them.

**On the smaller book it works, and one extra level is still not enough.** Origin of Species (1,326
blocks) succeeded — and halved the problem rather than solving it:

| Origin of Species | 3 levels | conditional 4 |
|---|---|---|
| sections | 51 | 126 |
| median section | 17 blocks / **2,768 words** | 9 blocks / **1,056 words** |
| body words inside a fat section | 92% | **46%** |
| biggest section | 131 blocks / 7,390 w | 54 blocks / **10,520 w** |
| the call | 126 s, 12,095 out | **470 s, 46,587 out** |

Darwin's paragraphs average 117 words, so nine of them is still a thousand words. **How many levels
a section needs is a property of that section**, and no constant in a prompt can express it. That is
the whole argument for doing it adaptively.

**That asymmetry is the argument for scoped calls**, and it is a better one than "fat sections
exist": a call shown thirty blocks cannot emit a range that is wrong by 1,289 of them, and it cannot
run out of attention two-thirds of the way through a book. Whatever is failing here is failing
*because* the call is being asked to hold the whole article and a much denser tree at once.

### Stage 2 — one scoped expansion call, and the answer format

**A spike before an architecture.** Take Moby-Dick's fattest section — 382 blocks, 34,884 words — and
Darwin's, and make one real scoped call each: the section's blocks, its ancestor chain, the frozen
global outline, and an answer format carrying the per-child verdict. Then read the children.

This is the cheapest thing that can kill the plan, and it asks the questions no amount of design
settles:

- Are the boundaries and titles as good as the global call's, given only the slice plus the outline?
  [260826h § 2](260826h-toc-scaling.md) names the failure to watch for — *"never blind subtree calls
  with independently invented sibling roots — that is where four sections all end up meaning
  'Background'"* — and the outline in the prefix is the defence against it.
- **Does the self-assessment discriminate?** A call that marks every child "needs deeper" is a bill,
  not a signal. Run each section twice and see whether the verdicts agree with each other and with
  what a reader would say.
- What does a scoped call actually cost and how long does it take, so the cascade's arithmetic rests
  on a measurement rather than on the extrapolation in § What we are going to do.

**Done:** two real expansions, their children read and judged, the verdict distribution recorded, and
a decision written into this plan about whether the self-assessment earns its place or the
word-and-block conjunction stays the governor. Nothing in `src/` has changed.

#### Result: scoped calls are mechanically clean, and the verdict discriminates

`scripts/spike-expand-section.ts`, 2026-09-04. Three calls, one prompt.

| | Moby-Dick "The Whale's Head and Whiteness" | Origin of Species "Principles of Classification" |
|---|---|---|
| the section | 382 blocks, 34,884 words | 30 blocks, 7,390 words |
| the call | 22 s, 76,558 in, 1,938 out | 16 s, 14,889 in, 1,361 out |
| children | 10 | 10 |
| invented ids / out of order / outside the range | **0 / 0 / 0** | **0 / 0 / 0** |
| marked `needsDeeper` | 6 | **0** |

**Nothing mechanical went wrong.** Three scoped calls, no invented id, no reversed range, no child
outside its parent — against four whole-document runs out of four that failed on exactly those
things. This is the plan's central claim, and it now has evidence on both sides of it rather than
one.

**The verdicts discriminate, and they are reasoning about content rather than size.** Melville's
children got *"Three distinct scenes: oath, Ahab's soliloquy, Starbuck's reaction"* against *"One
continuous reflective essay."* Darwin's got *"One sustained argument across several examples"* — for
a child of **1,381 words** — and every one of the ten was declared finished.

**And the headings come back.** Counted properly — *"how many of the authored headings in range begin
a child"*, not *"how many children carry a `sourceHeading`"*, which is a different and flattering
question ⟨GPT Sol, finding 5⟩:

| | authored headings in range | headings that begin a child |
|---|---|---|
| the whole-document call, over the whole book | 144 | 44 — **31%** |
| expansion run A, over this section | 20 | 9 — **45%** |
| expansion run B, over this section | 20 | **20 — 100%** |

An earlier version of this line said "ten of ten", which conflated the two questions: run A returned
ten children, all bearing a heading, while merging across eleven others. Scoped calls do much better
than the whole-document call and **run A is still not good enough** — which is the argument for the
mechanical two-headings rule below rather than for trusting the prompt.

#### Two things the spike found that no amount of design would have

**1. The verdict disagrees with the word count, and it may be right.** Darwin's section was declared
finished at children of 1,381 and 1,696 words — six minutes of reading under one sentence, and
exactly the case the word bound was written to catch. The model's argument is that these are single
sustained arguments, and splitting one argument into three implies seams the author did not write.
**A product call, not a technical one**; it is with Fable.

**2. The same call, run twice, gave two defensible and completely different answers.**

| | children | marked deeper | shape |
|---|---|---|---|
| run A | 10 | 6 | grouped Melville's chapters — "Quarter-Deck, Sunset, Dusk" as one child |
| run B | 20 | 1 | one child per authored chapter, flat |

The prompt asks for two things that collide: *"the article's own headings are HARD boundaries"* and
*"aim for 5-9 children"*. With twenty headings in range you cannot do both, and the model chose
differently each time. **This is the book-level arithmetic contradiction again, one level down** —
and it decides both the tree's shape and the cascade's bill, because run A costs six more calls than
run B.

So the expansion prompt has to say which rule wins when they collide, rather than leaving the model
to pick. That decision is with Fable too, and it lands in stage 3's prompt.

### Stage 3 — the pure half: conversion, precedence, and the shared derivation rule

No network, no flag, nothing wired into `generateHierarchy`.

`proposalFromTree` and a round-trip assertion stronger than ranges — internal shape, `title`, `gist`
and `sourceHeading` all survive, with **zero repairs and zero drops on the second build**. One
start-derivation rule shared by `planChildRanges` and `normaliseExpansion`, heading snap included,
with heading-snap and outside-parent cases added to the differential test. A start outside its parent
refused rather than clamped. The five-way precedence above, as code, with the eight-block
two-heading node as its test. Origin-aware cascade state, so `assertCascadeComplete` can say
something true about nodes this machinery did not produce — and a decision on whether its rejection
of unary internal nodes, which `buildTree` accepts (35 across 133 saved eval trees), is a bug in the
assertion or in `buildTree`.

**Done:** `npm test` green, and a test that fails on today's `normaliseExpansion` before it passes.

### Stage 4 — the protocol: request, response, checkpoint — against a fake executor

The scoped prompt with the heading precedence written into it; a **strict** response schema where the
verdict is required rather than optional, because a missing field silently reading as "finished" is
the shape of this plan's whole failure mode; the checkpoint fingerprint covering the exact wire
request — model, effort, prompts, frozen outline, ancestor chain, target ranges and ordinals, body
hash, and the governor's values — and a hit that must pass schema validation, exact-target coverage,
scoped-id checks and normalisation against the *current* parent before it is used. An invalid hit is
a miss, and the fresh answer overwrites it.

And the instrumentation, **before the live pilot rather than after it**: per candidate, the raw
verdict and the effective one, which bound overrode it, wave, blocks, words, heading count, retries,
normalised fan-out, model, effort and prompt version.

**Done:** the whole protocol exercised end to end with a fake executor, including a poisoned row, a
resumption against a different wave-1 answer, and an exhausted attempt budget.

### Stage 5 — one live wave, bounded, measured

Sol's recommendation, and it is the right shape: **one additional scoped wave over mechanically
selected targets, recording `needsDeeper` but not yet obeying it recursively.** A shared concurrency
budget derived from the worker's own job concurrency, counted 429 retries honouring `Retry-After`
with jitter, and the end-to-end measurement that matters: the whole hierarchy step including labels,
under three concurrent jobs, with total cost.

That run is what calibrates the verdict — its stability across repeats, the raw and effective yes
rates by wave and size, and the real bill — before anything recursive is built on it.

**Done:** Moby-Dick and Origin of Species each produce a valid depth-4 tree through the real pipeline;
the corpus's articles are untouched where nothing is eligible; the step fits its budget under load,
or the plan records that it does not and what that costs.

### Stage 6 — recursion, once the verdict has earned it

Waves 3 and beyond, governed by the verdict, with the depth cap and the yes-rate gate. Only if stage
5's numbers say the verdict is stable enough to obey.

### Stage 7 — the reading view learns that a column is a frontier

The `buildGeometry` continuation fix; the projection decision from § "Still blocking 2", with a test
per tree shape — ordinary, deep, shallow, provisional, supplement, and mixed leaf/internal siblings;
`sectionDepth`; the outline band's rung ladder; summary mode's caps; the CSS tokens; auto-fit's
starting set; and the two section counters.

**Done:** the browser check, on the box, on a real book and a real article — an undeepened article
renders identically to today, a deepened one shows sub-sections in the frontier column with no blank
or duplicated cells, `?at=` stays section-granular, and `?cols=` shows a ragged table of contents that
reads like one.

### Stage 8 — turn it on, or stop

**The plan as first written could finish with every gate green and the feature still switched off**,
because it lands behind a flag and no later stage enables it. ⟨GPT Sol, first review, finding 9.⟩ So
the enable is its own stage with its own evidence: the same book and the same article read both ways,
side by side. The cost is several times today's on a book, so this is a real decision.

If the answer is no, the honest outcome is the conditional-depth prompt from stage 1 — which works on
articles and on the smaller book — plus a frontier column that renders it.

**Docs move with the stage that changes the behaviour**, not in a batch at the end: `hierarchy.md`
and `prompt-caching.md` with stage 5, `granularity-zoom.md` with stage 7, `url-state.md`,
`keyboard.md`, `tooltips.md` and `summaries.md` with whichever stage touches them.

## Alternatives considered

- **The full breadth-first cascade** ([260904c](260904c-hierarchy-structure-in-waves.md)). Replaces
  the global call instead of following it, so it also attacks latency and removes the length ceiling
  rather than raising it — but it gives up the one thing 260826h § D says is strictly better, a
  single call that sees every boundary at once. Paused, and this plan is the cheaper half of it.
- **Just sharpen the prompt.** Free, and it is stage 1's second experiment. It cannot be the whole
  answer, because three of the five fat sections are the author's own headings and the depth cap is
  what stops the model going under them.
- **Raise the cap to four levels for everyone.** One line in the prompt, no new calls. Rejected
  because it makes every ordinary article pay a rung it does not need — the median section is 2–7
  blocks, and a fourth level there is one paragraph per node, which is the leaf layer with extra
  steps.
- **Leave it.** Named because it is a real option and stage 1 might choose it: a 26-paragraph section
  under a good gist is a door, and the reader was always going to read the prose.

## Where the advice came from

- **Fable 5**, 2026-09-04 — the frontier reframe, which is the load-bearing idea here; the
  words-trigger/blocks-gate conjunction; recursion with a depth cap; and the `buildChains` trap,
  found by reading and confirmed against the source.
- **A repo-wide survey**, 2026-09-04 — the depth-consumer map above.
- **GPT Sol** — pending, on this plan.
