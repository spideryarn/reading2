# The tree goes as deep as each part of the article needs

**Status: stages 1–4 and 5a done; 5b — the first live call — is the next thing, and it is a decision rather than a task.** The measurements and the spikes
are in `evals/results/hierarchy-waves-2026-09-04/`, and **stages 3 and 4 have landed in `src/`**, each
reviewed across families. There is still no network call, no flag, and nothing wired into
`generateHierarchy`: the cascade is called by nothing. What changed is that it now derives the same
tiling the incumbent does, refuses what it should refuse, can be planned from a tree that already
exists, and carries a prompt, a strict schema, a checkpoint and its instrumentation.
Started 2026-09-04. Worktree `deepen-fat-sections`. **Supersedes
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
| 2 | **the heading rule** | a node holding an authored **body** heading that no boundary starts on is **never finished**, whatever it says — and this **beats the floor** | forces open |
| 3 | **divisibility floor** | never expand a node under ~10 structural blocks | refuses |
| 4 | **forced-open ceiling** | a node over ~2,000 words, above the floor, marked finished, is opened anyway and counted as `forcedOpen` | forces open |
| 5 | **the model's verdict** | decides everything the four leave open | — |

**The heading rule is the most valuable line in this plan.** It is purely mechanical, costs nothing,
and counted as *"two or more authored headings"* it fires on **22 of Moby-Dick's 54 sections, holding
69% of the body words** — which is the hundred lost chapter headings, caught by arithmetic rather
than by judgment. On Darwin, which has 24 headings in 1,326 blocks, it fires on 3 sections and 1% of
the words. It cannot be left to the model: the whole finding above is that the model resolves the
headings-versus-stride collision differently on different runs.

**Two headings is how it was measured, and not the rule.** The rule already existed, in
[`shouldExpand`](../../src/hierarchy-cascade.ts) as `hasUnresolvedHeading`, and it is strictly
broader: *any* authored body heading in the node's range that no boundary already starts on. It
subsumes the two-heading case and also settles three things the count does not mention — the node's
own first block counts as resolved (a node created *from* a heading begins on one, and calling that
unresolved would expand for ever), a **supplement** heading is excluded because `renderBlocks`
withholds its text so the model cannot honour a boundary it is shown as `NOT-GISTABLE: (withheld)`,
and a `gistable: false` **body** heading is included because its text *is* rendered. The plan's
earlier table said "two or more"; the code's rule is the one that ships, and the 22-of-54 figure
above is a lower bound on how often it fires. ⟨2026-09-05.⟩

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
reason "politeness to the rate limiter" and no measurement behind it; `src/pdf-read.ts` runs
**`CHUNK_CONCURRENCY = 100`** against the same account, with `WidthGate` (`src/concurrency.ts`)
halving it on a 429.

⟨Corrected 2026-09-05: this paragraph said 16, raised from 8. The code says 100, raised from 16 on
2026-09-04. That materially loosens the arithmetic below — there is far more headroom than the
figures here assume — but the number that should decide the cascade's width is the gate's own
measured limit under three concurrent jobs, which is stage 5's measurement, not the PDF stage's
constant borrowed a second time.⟩

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
twice, and until now **called by nothing**. It was built for 260904c and this plan is what finally
calls it, seeded from wave 1 rather than from the root:

| what the cascade needs | what the core already has |
|---|---|
| "does this node still need splitting?" | `shouldExpand` against `CASCADE_RECIPE.terminalBlocks`, plus its heading clause |
| how many children to ask for | `predictedChildren` |
| several fat sections in one call | `planExpansionBatches` — packs parents until the child count, the evidence estimate or the hard request bound says stop |
| a section too big for one call | `OversizedTarget`, returned rather than sent |
| turning an answer into ranges | `normaliseExpansion` (starts-only; every end derived) |
| "did we actually finish?" | `assertCascadeComplete` |
| a buildable result | `finaliseCascade` → `ModelNode`, exactly what `buildTree` takes |
| a depth stop | `CASCADE_RECIPE.maxDepth` and `CapReached` |

**What it does not have, and stage 3 adds** — three things, in the order they matter:

1. **The heading snap.** `planChildRanges` calls `snapStartsToHeadings`
   ([`src/hierarchy.ts:1205`](../../src/hierarchy.ts)); `normaliseExpansion` does not. Until they
   share one rule, a scoped call reads a slice the finished tree will not give its parent — the
   blocker in [§ What the second review changed](#blocker-derived-ranges).
2. **A refusal instead of a clamp** for a start naming a block outside its parent.
3. **The words half of the governor.** `shouldExpand` counts structural blocks only; the word bound
   and the forced-open ceiling are additive changes to `CascadeRecipe` and its predicate. Note the
   heading clause is already there and already overrides the size rule — the code settled the
   precedence before this plan restated it.

Past those, what is missing is the impure half: render a request, make the call, attach the answer,
checkpoint it. It makes 1,275 lines of tested code load-bearing instead of dead.

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

### Still blocking 1 — waves 2 and beyond do not see the ranges the final tree will use either <a id="blocker-derived-ranges"></a>

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
mechanical heading rule below rather than for trusting the prompt.

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

### Stage 3 — the pure half: conversion, precedence, and the shared derivation rule <a id="stage-3"></a>

No network, no flag, nothing wired into `generateHierarchy`.

`proposalFromTree` and a round-trip assertion stronger than ranges — internal shape, `title`, `gist`
and `sourceHeading` all survive, with **zero repairs and zero drops on the second build**. One
start-derivation rule shared by `planChildRanges` and `normaliseExpansion`, heading snap included,
with heading-snap and outside-parent cases added to the differential test. A start outside its parent
refused rather than clamped. The five-way precedence above, as code, with the eight-block
two-heading node as its test.

#### The unary internal node was a bug in `buildTree`, and the corpus is unanimous <a id="unary"></a>

The plan left this open — is `assertCascadeComplete`'s rejection of a one-child internal node a bug
in the assertion or in `buildTree`? Measured on 2026-09-05 across every saved tree under `evals/`
and `data/`:

| | count | child covers the parent's whole range | child covers only part |
|---|---|---|---|
| unary internal, sole child internal — **the 35** | 35 | **35** | **0** |
| unary internal, sole child a grown leaf | 208 | 208 | 0 |
| unary supplements | 0 | — | — |

**Not one partial case**, so the "there may be a legitimate reason a unary node survives" branch is
empty and the assertion is right. Two further facts decide the shape of the fix: all 35 parents span
1–8 blocks, which `shouldExpand` would call terminal, so **the cascade would never have asked about
any of them** — they are artefacts of the un-floored whole-document call; and the parent's title is
identical to its child's in 26 of 35.

What the reader gets is not a blank cell or a lost column but **two adjacent gist columns of
identical extent, neither marked `continuation`**, so both render in full and both are fisheye items.
One rung finer buys a restatement of the same two paragraphs, against
[granularity-zoom.md](../project/granularity-zoom.md)'s promise that level N is a compression of
level N+1. Collapsing all 35 changes `maxDepth` in none of the ten trees that hold them, so it is a
duplicated cell rather than a wasted column — real, and smaller than this plan first framed it.

So: **the incumbent build collapses, `normaliseExpansion` goes on refusing**, and the disposition
differs because the recourse does. A scoped call can be retried and a better answer is worth asking
for; a whole-document answer cannot be retried mid-build, and refusing there is what cost four of
thirteen articles the day that file learned to derive rather than reject.

The collapse sits in `buildTree`'s `visit`, **not** in `planChildRanges` as this plan first said. That
function derives *ranges*, one plan per proposed child of one node, and the splice needs the
discarded rung's **own children** — which it is never shown. `visit` is the only place holding both.

The rule is phrased as a **range** statement rather than a count — *no child may cover its parent's
whole range, unless that child is a leaf* — and the exemption is the load-bearing half. In a built
tree a leaf is always *grown*, minted by `buildTree` from a range and never proposed, so a leaf child
covering the whole of its parent means the parent spans exactly one block: the ordinary shape of a
one-block section (all 208 of those) and of a supplement holding one note
([260829a § F6](260829a-footnotes-finish-upfront-sol.md)). The exemption this plan first proposed —
*a node whose range is a single block* — would have been **wrong**, and the corpus says so: the
`waves.fowler-phrenology.r1` rung `n0053` has a one-block range and an *internal* child, so it is one
of the 35 and that exemption would have let it through.

The collapse keeps the **parent's** title and gist and splices the grandchildren up. That is a
product call and the evidence is one-sided: in the nine cases where the two titles differ, the parent
is the coarser name every time — *"Writing at Work"* over *"The Pressure to Write"*, *"The
Disappearing Writers"* over *"Few People Who Can Write"* — which is what that rung is for, and the
child's name is a sub-section's. It adopts the child's `sourceHeading` where the parent has none:
both nodes hold the same range, so a claim backed for one is backed for the other, and `buildTree`
drops it anyway if nothing backs it.

It is **counted** in `BuildReport` rather than done quietly — as its own `collapsedRungs`, not as a
`PartitionRepair`, and that is arithmetic rather than taste. A repair is a boundary that *moved*,
`size` is how many blocks changed hands, and `repairedBlockCount` sums them. A collapse moves **no**
blocks: the two ranges are identical, which is the definition of the shape. It could only enter as a
repair of size 0, inflating `repairedRanges` while contributing nothing to the two figures that say
what a repair cost.

`checkTree` ([`src/tree-invariants.ts`](../../src/tree-invariants.ts)) gains the rule, which it has
never had — a pickaxe search of the history finds nobody ever adding, removing or arguing about one,
so the silence is a gap rather than a decision. Over the 103 saved trees the new rule finds **exactly
35 restated rungs across 10 trees and nothing else**: no false positive on any of the 208 benign
one-block sections and none on any supplement. Rebuilt through the new `buildTree`, all 35 collapse,
none survives, and no tree's leaf layer changes. ⟨Re-run independently, 2026-09-05.⟩

**And it moves a baseline this plan leans on.** Faults recorded against a rung that is then discarded
go with it, so `repairedRanges` and `repairedBlocks` now read materially lower: on the 3,000-case
fuzz in [`tests/hierarchy-repairs.test.ts`](../../tests/hierarchy-repairs.test.ts) the repaired rate
fell from ~37% to ~17%, with ~29% now reporting a collapse instead. `silent` stayed at 0, so nothing
is derived unreported. But the plan names `repairedBlocks` as the trigger for a future re-ask, and
**that trigger's numbers are not comparable across this change** — whoever calibrates it must take
its baseline after 2026-09-05, not from an earlier run.

**And this makes origin-aware cascade state unnecessary**, which is a moving part the plan can drop.
It was only ever needed so `assertCascadeComplete` could say something true about nodes the cascade
did not produce; with the collapse in `planChildRanges` and `proposalFromTree` fed the **built** tree
rather than the raw wave-1 answer, a unary rung cannot reach the cascade at all, and stage 3's own
round-trip assertion becomes true rather than accidentally true. That ordering is now load-bearing
and is written here so nobody wires it the other way: **the cascade is seeded from the built tree.**
⟨Investigated 2026-09-05; the terminal clause of `assertCascadeComplete` may still want
origin-awareness one day, and that is a separate question.⟩

**Done:** `npm test` green, and a test that fails on today's `normaliseExpansion` before it passes.

#### What stage 3 landed <a id="stage-3-landed"></a>

Five things, in `src/heading-snap.ts` (new), `src/hierarchy.ts`, `src/hierarchy-cascade.ts`,
`src/tree-invariants.ts` and `src/pipeline.ts`:

1. **The heading snap runs in exactly one place.** Its own module, because `hierarchy.ts` and
   `hierarchy-cascade.ts` cannot import each other — the cascade already takes `BuildReport` and
   `ModelNode` from the incumbent, and `npm run cycles` is a gate at zero. It returns its repairs
   rather than pushing into a caller's array, so it needs nothing back from either. The two
   *start-collision* rules stay separate, honouring the earlier ruling against threading an optional
   `ends` parameter through one merged helper: the snap was the whole of the divergence, so the snap
   is what is shared.
2. **`ExpansionRefused("outside-parent")`**, replacing a clamp. The first kept child keeps its
   **pin** to the parent's start, which is a rule and not a clamp of a claim — how far out its claim
   was is the head repair, and that is still measured.
3. **`decideExpansion`**, returning `{decision, because}` rather than a boolean, because every number
   the eval is asked to report is a tally of `because` and none of them survives a boolean. An
   absent verdict is a third state: it stops as `"no-verdict"`, and where the ceiling opens it anyway
   it says `"unassessed-ceiling"` rather than `"forced-open"`.
4. **`proposalFromTree`**, dropping the leaf layer — which is what makes it lossless, since
   `buildTree` grows leaves from the range alone and regrows exactly the same ones.
5. **`collapseRestatedRungs`** and the matching `checkTree` rule, above.

**The cross-family review found two, and both were taken.** ⟨GPT Sol, 2026-09-05, first review of
code rather than plan.⟩

- **F1, P1 — the collapse counter never reached the eval.** `evals/hierarchy-structure`'s result
  schema and its "NOT valid as written" line both omitted `collapsedRungs`, so an arm whose every
  boundary was believed, whose sections were all stored and whose heading claims all held up, and
  which still handed the reader a rung that compressed nothing, scored `ok` with an empty `repaired`
  block and no warning. That is the silent-success class the counter was added to prevent, and
  `hierarchy.md` already claimed the number reached the eval. Fixed in `run.ts` and `floor.ts`, both
  reading the field as optional so a run file written before 2026-09-05 still parses.
- **F2, P2 — the ceiling's number counted two different events.** Confirmed a doubt of my own:
  `because: "forced-open"` fired whether or not there was a verdict to overrule, which would have
  made "how often the ceiling overrode a model that said finished" read high on precisely the wave
  where no verdict exists for any node. Split into `"unassessed-ceiling"`.

Sol found nothing able to defeat the differential property — *"once `normaliseExpansion` emits
canonical ranges, `buildTree` sees strictly increasing starts, computed adjacent ends, and
already-snapped heading boundaries, so its second derivation is stable"* — and ran
`tests/hierarchy-cascade.test.ts` itself, 55/55.

**Checks at the end of the stage:** `npm test` 661 files passed, 0 failed, 1 skipped; 11,856 tests
passed. `npm run typecheck` green over 1,279 files. `npm run cycles` clean. An earlier red on the
`check` gate's test step was the box at load average 74 with `REQUIRE_POSTGRES=1` turning ~70
normally-skipping suites live, and it went away at load 9 — worth writing down, because it looks
exactly like a real regression.

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

#### What the checkpoint has to hash, and the three calls that were open <a id="stage-4-checkpoint"></a>

Surveyed on 2026-09-05 before writing any of it, because the rule here is to reuse the machinery
rather than add a second way to do the same thing. **Almost all of it already exists.** The cascade
takes the same bound `CheckpointStore` `generateHierarchy` already has, mints its key with the same
`structureKey`, and copies the incumbent's read/write shape verbatim: read → cheap gate → *expensive*
gate that asks whether the stored answer still builds → a failure treated as a miss → the call → and
the write only after every check the answer can fail on its own. What is genuinely new is **one
namespace, one canonical-request builder, one entry type and one entry gate**, and nothing else.

The fingerprint is `messagesWireBody` — the bytes that actually go on the wire, so model address,
effort, `thinking`, system prompt and every block of prose are covered by *being in the request*
rather than by a hand-copied field list that goes stale silently — plus four things a scoped call no
longer carries implicitly:

| field | why it is not implicit |
|---|---|
| `bodyHash` = `hashBlocks(body)` | The whole-article call has every block id in its prose, so its key moves when a lost draft re-mints them. **A scoped call's does not.** This is the field whose omission lets a stale answer be reused against changed input. |
| `seedHash` = `structureHash(the wave-1 tree)`, frozen | What makes "resumed against a different wave-1 answer" read as a miss. Not `renderOutline`'s text — two different cuts of an article can print identically. |
| `recipe` — all of it | `terminalBlocks`, `forcedOpenWords` and `maxDepth` change what we do with a verdict without changing a byte of the prompt. Picking three of six fields costs a silent hole the day a seventh arrives; over-invalidating costs one call. |
| `targets` — node id, ordinal, derived range | The difference between "this answer is for this parent" and "this answer is for a parent that happened to render the same". |

**And the trap that would otherwise ship: no hash of the *current* tree.** Wave 2 expands several
parents at once; if parent P's key depended on the tree as it stands, Q landing would move P's key
and a resumed attempt would miss every row the previous attempt wrote — a checkpoint layer that
provably never hits under exactly the load it exists for. Freeze the seed and let each parent's own
range and ancestor chain carry the wave-to-wave dependency, which they already do because both are
in the request.

Three calls the survey left open, settled here:

- **"Exhausted attempt budget" means a per-target redraw cap**, a named constant in the cascade's own
  file — not the job layer's `REQUEUE_BUDGET = 2` (`src/jobs.ts`), which already exists for the
  lease-window sense and must not be reinvented. A fake executor cannot exhaust a lease budget, and
  stage 4's whole done-condition is against a fake executor. Whether the cascade *fits inside*
  `REQUEUE_BUDGET` is a real question and it is stage 5's, measured rather than assumed.
- **The scoped call reuses the `"hierarchy"` task** rather than minting its own. A new task means a
  new `STAGE_EFFORT` row and a different wire model, which is right only if the effort should differ
  — and nothing has shown that it should. Simplest version first; the lever is named, and stage 5's
  numbers are what would move it.
- **One checkpoint row per call, not per target.** It matches both incumbents and it is the unit
  "exact-target coverage" is phrased against. The objection — that re-batching between attempts would
  strand every row — is closed by `seedHash` and `recipe` being pinned, since `planExpansionBatches`
  is deterministic over frontier, blocks and recipe.

Two smaller things the survey found, both fixed rather than filed: the `CHUNK_CONCURRENCY` figure in
§ Concurrency above, and `database.md`'s claim that the checkpoint key's *length* is pinned by a
CHECK constraint. It is not — the regex allows 1 to 128 of `[a-z0-9_-]`, and 16 hex is the practice.
Whoever adds this namespace would have been reading that line for the rule.

#### What stage 4 landed <a id="stage-4-landed"></a>

Two new modules — [`src/hierarchy-expand.ts`](../../src/hierarchy-expand.ts) (prompt, request
assembly, strict parse, instrumentation) and
[`src/hierarchy-deepen.ts`](../../src/hierarchy-deepen.ts) (namespace, canonical request, entry gate,
executor seam, `runExpansionWave`) — plus the key minter hoisted into `src/source-hash.ts` as
`checkpointKey`, the redraw cap, one migration and three test files. Still called by nothing.

The canonical object is exactly the six fields the table above names. Three things about *how*, none
of them a change to *what*:

- **`recipe` is sorted before hashing, the one deliberate exception to "the order of the literals is
  the key".** A `CascadeRecipe` is built at several sites — the constant, an eval arm's spread, a test
  literal — and `JSON.stringify` writes insertion order, so two recipes with identical values could
  hash differently depending on which literal built them. That is a permanent miss with nothing to
  see. Sorting also keeps the field list total, so a seventh recipe field is in the key the day it is
  added rather than the day somebody remembers.
- **`bodyHash` is computed inside `runExpansionWave` from the blocks it was given**, not accepted as
  an argument, so it cannot be a digest of something else. Likewise `frozenSeed(tree)` returns the
  outline and the hash together, so a caller cannot freeze one and re-derive the other.
- **`targets[i].node` is the ordinal path** (`root > child 2`), because that is the only id a cascade
  node has, and it is derived from the tree's shape rather than from its prose — safe to hash and
  safe to log.

**Two findings from building it, each fixed at the point it was found rather than filed.** The
`max_tokens` for a scoped call was sized from `predictedChildren`, which clamps at nine — but under
the settled precedence a twenty-heading parent answers with twenty children, so a heading-dense call
would have truncated and returned nothing usable, which is the one failure on this path that costs a
whole paid call. It is now `max(predictedChildren, bodyHeadingsIn)`, and `bodyHeadingsIn` shares
`isAuthoredBoundary` with `hasUnresolvedHeading` so the stopping rule and the arithmetic bound cannot
drift into two opinions about what a heading is. And **the gist is required on every proposed child**:
letting a gistless one through would fail the whole article at `assertTreeSound` *after the entire
cascade had been paid for*, where re-asking one batch costs cents.

**The recorded spike answers do not parse in the shipped format**, and the tests say so rather than
smoothing it over. Two things moved — the `sections` wrapper and `needsDeeper: true` becoming
`verdict: "needs-deeper"` — so the fixtures carry an adapter that changes exactly those and nothing
else, and all three directions are asserted: translated parses, untranslated is refused, and the
half-migration that re-wraps without re-spelling is caught as `missing-verdict`. That last is the one
a careless migration would actually produce.

**Three things stage 4 deliberately left for stage 5**, all named in the code rather than left to be
discovered:

1. **The verdict cannot yet be paired with the child that survived.** `normaliseExpansion` discards
   `KeptChild.childIndex`, so `ExpandedTarget` carries `proposed` (every child the answer named, with
   its verdict) beside `children` (what survived the drops) — two arrays of different lengths.
   Nothing obeys a child's verdict before wave 3, so nothing is wrong today, and stage 6 cannot be
   built until it is closed.
2. **An import cycle is one edit away.** `hierarchy-expand.ts` takes `renderBlocks` and
   `PROMPT_VERSION` from `hierarchy.ts` as *values*, so the moment stage 5 makes `hierarchy.ts` import
   the cascade, `hierarchy → hierarchy-deepen → hierarchy-expand → hierarchy` closes and
   `npm run cycles` — a gate at zero — goes red. Hoisting those two is stage 5's first job, not a
   surprise at the end of it.
3. **The wave is sequential.** A concurrency budget derived from the worker's job concurrency, and
   counted 429s honouring `Retry-After`, are not decidable against a fake executor.

**The migration needs regenerating after the merge.** `drizzle/20260905020601_checkpoints_hierarchy_deepen.sql`
widens the `checkpoints_namespace` CHECK — purely additive, a drop-and-re-add because Postgres has no
`ALTER` for a CHECK expression — but it and its snapshot were generated before `origin/dev`'s
`20260904235116_ingest_events_article_id` was in the chain, so the next `drizzle-kit generate` would
diff against a snapshot that does not know about it. `npm run db:migrate` refused to run for exactly
this reason and was right to; the two statements were applied to the local database by hand and
production was never touched.

**And the two hand-kept copies of the namespace list are now checked against each other.**
`CHECKPOINT_NAMESPACES` and the CHECK constraint were two lists with nothing between them, and
because a failed checkpoint write is deliberately a `warn`, a name in the union that Postgres refused
would have shown up only as a bill. `tests/db-schema.test.ts` now inserts a row under every name.

#### What the second review changed, and the one that was my mistake <a id="stage-4-review"></a>

⟨GPT Sol, 2026-09-05, reviewing stage 4's code. Refused on two established P1s; all five findings
taken.⟩

- **F2, P1 — the scoped-id gate exempted the first child, and that was my briefing error.** I told
  stage 3 that the first child's pin to its parent's start must survive and only the later children's
  clamp becomes a refusal. The pin is right — children must cover their parent and nothing else can
  supply that block — but exempting it from the *check* is not, and `normaliseExpansion` pinned
  before it range-checked. A first `start` naming a block in a **sibling** section passed all four
  advertised gates, so that sibling's title, gist and verdict landed on this parent's prose.
  Reproduced: parent 20–39, first child at block 0, returns cleanly. Now every claimed start is
  checked and only an in-parent one is pinned. A consequence worth knowing: the head repair can no
  longer be an `"overlap"`, because that required a claim below the parent's start, which is now
  refused.
- **F4, P1 — whitespace passed the strict schema.** `.length === 0` where it needed
  `.trim().length === 0`, and the comment justified it by saying `buildTree` applies its own
  truthiness afterwards — which is true of `""` and false of `"   "`. Three spaces reached the tree as
  a real gist and rendered as a blank node a reader can navigate to. `sourceHeading` is deliberately
  *not* trimmed: a blank claim is one `buildTree` counts into `droppedHeadings` on purpose.
- **F1, P2 — the fingerprint omitted what the governor reads and what the model is shown.**
  `hashBlocks` canonicalises `[id, text, role, treatment]`; it does not carry `words` (the ceiling),
  `kind` (the heading rule), `tag` (which `renderBlocks` prints) or `gistable` (which `isStructural`
  is built from, and therefore the floor *and* `predictedChildren`). Established on `words`: two
  bodies with identical prose and different counts produced the same key while the decision moved
  from `stop/verdict` to `expand/forced-open`. Now `expansionBodyHash`, this stage's own, composed
  over `hashBlocks` plus those four — `hashBlocks` itself untouched, because its output is pinned by
  a literal hex elsewhere and its canonical form has a collision history. **`gistable` was not on my
  list of three**; the implementer found it by asking what else the governor reads.
- **F3, P2 — the prompt never asked for children in document order**, while the derivation treats
  array order as document order and silently drops anything behind its predecessor. Five otherwise
  valid children ordered `0, 8, 4, 12, 16` lost a real section. The rule is now stated and
  `EXPAND_PROMPT_VERSION` is `expand/2` — which is in the checkpoint key, so a prompt asking for
  something different cannot resume onto answers written under the old one.
- **F5, P3 — this plan's own header contradicted its stage-4 section.** Fixed above.

Not fixed, and named rather than filed: `why` is unconstrained beyond its type, where the prompt asks
for at most twelve words. It is telemetry, nothing structural reads it, and refusing a batch over a
long reason would throw away every boundary in it.

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

#### What the live run must answer, and what would make us stop <a id="stage-5-questions"></a>

Written **before** the run, because a paid run with no stated question always succeeds. Stage 5 is
split: **5a** is everything that costs nothing — the import-cycle hoist, the verdict pairing, the
derived concurrency budget, and the wiring behind a flag that is off — and **5b** is the first live
wave. 5b is a separate decision because it is the first irreversible spend in this plan, at roughly
$8.40 a book against today's $1.00, and repeats multiply it.

Five questions, each with the number that answers it and the reading that would stop the plan:

| | question | measured as | what would mean stop |
|---|---|---|---|
| 1 | **Is the verdict stable?** | the same node's raw verdict across N repeats of one wave | a flip rate high enough that obeying it is a coin toss — then stage 6 is unbuildable and the mechanical bounds have to carry the whole thing |
| 2 | **Does the model always say yes?** | raw yes rate, by wave and by node size | a rate near 1 turns a bounded cascade into a bill; the plan named this failure before the prompt was written, so it is a measurement rather than a worry |
| 3 | **How often does a bound overrule it?** | `because` tallied over every `decideExpansion` — the point of returning a union | if the bounds decide nearly everything, the verdict is costing money to be ignored, and the cheaper conditional-depth prompt is the honest answer |
| 4 | **What does it actually cost?** | per book and per ordinary article, against the incumbent's $1.00 | materially past the ~8× the plan costed, without a proportionate gain in what the reader can navigate |
| 5 | **Does it fit the budget under load?** | the whole hierarchy step including labels, under `DEFAULT_JOB_CONCURRENCY` jobs at once | past the 740 s self-abort with checkpoints that do not make the next attempt cheap |

**Two of these can only be answered by repeats**, which is where the cost is. Question 1 is the one
the rest of the plan leans on: stage 6 obeys the verdict recursively, and it should not be built on a
signal that changes its mind. **Question 3 is the one that could retire the feature** — if the
heading rule and the two counters are doing all the work, then the self-assessment is an expensive
opinion and [the conditional-depth prompt](#the-free-experiment-a-conditional-fourth-level-in-the-one-whole-document-call)
does the same job for nothing.

**The corpus's ordinary articles are part of the run, not an afterthought.** An article where nothing
is eligible must come out byte-identical to today, and that is the cheapest possible evidence that
this is inert until it is wanted.

#### What stage 5a landed, and the six P1s that shaped it <a id="stage-5a-landed"></a>

**5a is everything that costs nothing, and it is done.** The wave is wired into `generateHierarchy`
behind `SPIDERYARN_DEEPEN_HIERARCHY`, **off by default**, seeded from the built tree, exercised end to
end against a fake executor. An ordinary ingest today does not call it, and a test asserts that
directly: no flag, no executor call, `deepen: null` rather than a row of zeros, and the tree unchanged
in depth. "Nobody asked" and "asked and found nothing" stay different facts.

Three prerequisites came first. **The import cycle was broken before it closed** — `PROMPT_VERSION`,
`PRODUCTION_EFFORT` (which this plan had not noticed was also a value import) and `renderBlocks`
hoisted into `src/hierarchy-prompt.ts` and re-exported, so no existing importer changed. That move is
**proven inert rather than asserted**: the pre-move `hierarchy.ts` taken out of git at `9afcc37f` and
the new one both mint the structure checkpoint key `2993e1e4b2aaf1d6`, which is pinned as a literal.
A single changed character there would have missed every checkpoint row ever written and bought every
reader's stored table of contents again, with nothing to see but the bill. **The verdict is paired
with the child that survived** — `normaliseExpansion` is generic and returns `{node, proposed}` pairs
carrying the caller's own object by identity, so a field this file has never heard of survives the
derivation. And **the concurrency is derived rather than borrowed**: `EXPANSION_CONCURRENCY = 8`, from
`ceil(20 calls / W) × 45 s ≤ 300 s` where the 300 is the step budget less measured wave-1 and label
times — four leaves 79 s that one redraw eats, eight leaves a whole further round. The arithmetic is
itself a test, so moving `STEP_BUDGET_MS.hierarchy` goes red rather than stale.

**The review refused on six established P1s** ⟨GPT Sol, 2026-09-05⟩, and one of them changed what the
paid run is worth:

- **The per-candidate records never left `deepenTree`.** `DeepenStats` had no field for them, so
  `generateHierarchy` dropped them at the seam — and three of the five questions above need exactly
  those records. **Stage 5b would have spent the money and been unable to answer its own questions**,
  which is the waste [§ the questions](#stage-5-questions) was written to prevent. Now
  `saveDeepenRecords` writes one file per pass to `SPIDERYARN_DEEPEN_RECORDS`, unset for every reader.
- **The wave was not deterministic, and this plan claimed it was.** `WidthGate` reserves a slot and
  *then* jitters, so calls admitted together split randomly between executed and out-of-time, and the
  completed ones were published anyway. Admission is atomic; dispatch is not. Publication is now all
  or nothing, with `withheld` counting the bought answers left in checkpoint rows. **Atomic
  publication does not restore full determinism** — the deadline is wall-clock, so two runs can still
  differ between "wave-1 tree" and "fully deepened". What it removes is the *partial* tree.
- **A truncated answer was published as complete.** The executor ignored `stop_reason`, and a response
  cut exactly after a closing brace parses. Now `ExpansionTruncated`, failing the wave rather than
  redrawing — an identical redraw truncates identically, and a larger budget is a different question
  under a different checkpoint key.
- **A failed wave returned while paid peers were still in the air**, so their checkpoint rows might
  never land: calls bought and thrown away. `allOrStop` now drains before rethrowing.
- **Retries and fan-out were recorded on the wrong nodes** — children inheriting the parent call's
  redraw count, `fanOut` null everywhere. Instrumentation describing the wrong node is worse than
  none.
- **And one that was never ours.** `WidthGate.refused` returned early on a stale epoch *before*
  applying its pause, so within one burst a first short refusal bumped the epoch and a later, longer
  `Retry-After` was discarded entirely. Pre-existing shared code from the PDF stage's gate, live for
  real readers at `CHUNK_CONCURRENCY = 100` today. Every refusal now extends the pause; only the
  halving stays epoch-scoped.

**Resumption is documented rather than built**, and the distinction matters: a withheld wave returns
normally, labels are written and the job commits done, so **nothing schedules a retry**. It is the
reader's next Retry or a re-ingest, exactly as a long PDF's second lease window. The rows are there
and make that attempt cheap; nothing makes it happen.

#### And what a second review of the same code found <a id="stage-5a-round-2"></a>

⟨GPT Sol, 2026-09-05, reviewing stage 5a's code a second time. Refused on one P0 and five P1s; all
seven findings taken.⟩ **Five of the seven were ways the paid run would take the money and be unable
to answer**, which is the exact waste [§ the questions](#stage-5-questions) exists to prevent.

- **P0 — the re-ask switch was process-wide and persistent.** Written up under
  [§ the levers](#stage-5-levers) above, because that is where the lever is described.
- **`withheld` claimed checkpoint rows that did not exist.** The write is deliberately best-effort
  and its failure is a `warn`; the outcome was counted anyway, so the number saying *"this is what
  the next attempt gets for free"* included answers with no row. `ExpansionCallOutcome.checkpointed`
  is what it is read off now, and `uncheckpointed` beside it counts the answers that were paid for,
  withheld and lost — money that buys the next attempt nothing, and a `warn` when it is above zero.
  The trade stands for the *article*; the count stopped lying.
- **The drain was unbounded for a caller with no signal.** `allOrStop` waits for the calls still in
  the air before it rethrows, so a paid peer gets to write its row — and its docblock claimed that
  wait was finite because every caller either aborts in flight or is bounded by a claimant's
  deadline. Not true here: the wave is reachable from the CLI and from an exported `deepenTree` with
  no signal at all, and `ExpansionExecutor` has no abort contract. **Bounded rather than aborted**,
  because aborting the live calls would undo the change the drain exists for. `EXPANSION_DRAIN_MS`
  is 60 s and shows its arithmetic: the abort reaches every *wait*, so `EXPANSION_ATTEMPTS` and
  `MAX_RETRY_AFTER_MS` are not in the sum — one packed model call at 45 s, plus the third of it again
  `CALL_RESERVE_MS` allows for reading the answer and writing the row.
- **Two record files in one second overwrote.** `<slug>-<stamp>-<pid>.json` cannot separate two
  passes of one process, which is exactly what `--repeat` is — so the repeat overwrote the run it
  was bought to be compared against. A process-local counter, and the file is created `wx` so a
  collision fails loudly and is retried rather than overwriting.
- **A thrown wave lost its measurement.** `saveDeepenRecords` was only on the success path, so a
  fatal wave took wave 1's governor decisions, its paid peers' records, the gate's report and the
  token accounting with it. The partial telemetry now travels on `ExpansionWaveFailed` and then on
  `DeepenFailed`, and `generateHierarchy` writes a `failed: true` records file before it falls back
  to wave 1. `deepen-records/2`.
- **`where` is not a repeat-stable identity.** It is an ordinal path derived from the answer's own
  fan-out, so two repeats that split one parent at different points both emit `root > child 1` and a
  moved boundary reads as a verdict that held — wrong in the direction that flatters the feature, on
  the question most likely to retire it. `CandidateRecord.range` carries the node's derived first and
  last block id (an address, not prose), pairing is parent-plus-range, and a changed fan-out or an
  unmatched range is **structural instability** rather than a flip. The counting is in
  [`evals/deepen/report.ts`](../../evals/deepen/report.ts), which refuses to compare a record with no
  range.
- **The gate's explanation was discarded.** `runExpansionWave` computed `gate.report()` and dropped
  it, and `DeepenStats` kept only `rateLimited` — a count with no width beside it, so a slow wave
  could not say whether the gate had narrowed to one. `WidthGate.watch()` gives a **per-wave** window
  — initial, final and narrowest width, and the refusals seen while it was open — because the gate is
  a process singleton shared with every concurrent job and its cumulative figures would put another
  book's rate limit on this one's artefact.

#### Two levers, so the paid run can answer what it is being paid for <a id="stage-5-levers"></a>

Built after the review, both free:

- **`SPIDERYARN_DEEPEN_REASK`** names the articles to re-ask — a comma-separated list of slugs — and
  for those it skips the expansion checkpoint *read* — not read-and-discard, so `found` cannot report
  rows nobody used — and still **writes**, so a genuine resumption afterwards is still cheap. Without
  it a repeat is free and the verdicts are identical *by construction*, which is not a stability
  measurement. No `delete` was added to `CheckpointStore`; its header rules one out.
  **The structure call is deliberately still resumed**, holding the seed constant so a moving verdict
  is the scoped call changing its mind rather than a different tree being asked a different question —
  and saving about two dollars and eight minutes a repeat.

  **It was a boolean for a day, and that was a P0.** The variable is read from `process.env` on
  *every wave*, so a worker started with it set re-asked for every eligible article it later picked
  up — and 5b goes through the queue, so the worker doing the repeats is the worker serving everyone
  else. Real money on strangers' articles, for as long as the process lived. Now the switch is
  article-scoped: `1`, `true` and `yes` are read as slugs, match nothing, and log a warning naming
  what was parsed, because *"I set it and nothing re-asked"* must not be silent. **There is
  deliberately no spelling that means "all articles".**
- **The wave's tokens reach `HierarchyRun`**, accumulated per *draw*, so a call refused twice and
  answered on the third reports all three. Flag off, the added term is zero, and a test asserts the
  four figures are arithmetically unchanged.

**And the obvious command would have been the wrong one.** `npm run hierarchy` passes
`nullCheckpointStore()`, so it resumes nothing: every repeat would re-buy the structure call *and*
hand each repeat a different seed, which is exactly the confound the paragraph above exists to avoid.
Stage 5b goes through the queue.

> **True when written, and overtaken within the day.** Stage E of
> [260903f](260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md) put every stage CLI
> through the queue on 2026-09-05, so `npm run hierarchy` resumes like any other claim and the
> sentence above no longer describes it. Kept because the *reason* still holds and is the reason the
> harness exists: a repeat that re-buys the structure call is a repeat with a different seed, and
> question 1 cannot be asked of it. What that change also settles is that `--force` re-runs the
> **step** and not the **purchase** — it replays the structure call out of its checkpoint — so
> forcing alone would have made every repeat free and identical, and it is
> `SPIDERYARN_DEEPEN_REASK` that makes the wave cost anything the second time.

#### The harness, and the command to run it <a id="stage-5b-harness"></a>

**Built 2026-09-05, reviewed, fixed, still unrun.** [`evals/deepen/`](../../evals/deepen/) is a
self-contained eval that
drives the four phases above through the **production** ingest queue and answers all five questions
from one run's artefacts. `report.ts` is the arithmetic and has no IO, `harness.ts` owns the ingress
and the levers, `run.ts` only drives and prints; the cost eval's proved mechanisms — the
`scopeKind: "eval"` overlay and the fixture stage-1 step — are imported from
[`evals/cost/harness.ts`](../../evals/cost/harness.ts) rather than copied. ⟨There were three: the
`pump()` silencer is gone, replaced by `pump: false` on the request itself — see the dated note
below.⟩
[`tests/deepen-eval.test.ts`](../../tests/deepen-eval.test.ts) holds it to a case per way it could
report a clean result having measured nothing.

```
npm run eval:deepen -- --book output/2701-h.html \
  --article output/noema-mythology-of-conscious-ai.html --repeats 3          # preflight, free
npm run eval:deepen -- --book … --article … --repeats 3 --dry-run            # the shape, free
npm run eval:deepen -- --book … --article … --repeats 3 --spend              # ~$41
```

**Preflight is the default and `--spend` is the only way to spend.** Preflight prints the plan, the
bill and every check the run will make, and it *proves the seam rather than asserting it*: it
exercises `SPIDERYARN_DEEPEN_REASK` against this run's own book and article slugs, and runs a
`deepenTree` probe against a synthetic article under the book's slug — cold buys N calls, an ordinary
repeat buys 0, a re-asking repeat buys N again with **zero** reads, and the only checkpoint namespace
touched is `hierarchy-deepen`. That last one is how *"wave 1 stays resumed, so the seed is held"*
becomes an observation.

The book and the article are **named on the command line and hashed at run time**, because `output/`
is gitignored: adding them to `evals/cost/fixtures.ts` would point a committed manifest at a file
nobody else has and break that eval for everyone.

Two things it refuses to do, both of them the difference between a measurement and a bill:

- **Pair candidates on `where`.** A record with no `range` is refused outright rather than paired
  approximately, and the three outcomes are separate rows that must not be added together — but only
  **one** of the three pairs is disjoint, and saying otherwise was wrong. A changed fan-out is
  counted alone, because a parent that came back with a different number of children produced other
  nodes rather than changing its mind. A **moved boundary and a surviving child's verdict flip
  overlap deliberately**: one parent can do both, both facts are true, and making them disjoint would
  discard valid same-range verdict evidence — which is the number stage 6 leans on. The overlap is
  counted and printed. ⟨Sol was right, and my earlier instruction to make them disjoint was wrong.⟩
- **Report a repeat that bought nothing.** `stats.calls === 0` where `stats.targets > 0` is fatal,
  and so is a **repeat** whose `hierarchy` ledger rows carry a whole structure call's input tokens —
  the seed moved, and the flip rate would be measuring the tree and the verdict at once. So is a
  wave-1 frontier that differs between repeats, which is the same fact seen from the tree's side.
  **Phase A is not a repeat**: buying the structure call is the whole point of the ingest, and see
  below for what applying the guard there would have cost.

#### What the pre-spend review refused, and why it was worth having <a id="stage-5b-review"></a>

**GPT Sol reviewed the harness before it was allowed to spend, and refused it** — thirteen findings,
seven P0. The refusal earned its keep twice over:

- **The structure-rebought guard was applied to phase A.** The measured Moby-Dick structure call is
  453,832 input tokens ([the artefact](../../evals/results/hierarchy-waves-2026-09-04/2701-h.tree.json)
  § `usage`) against a floor of 256,900, so a **successful** $40.90 run would have spent the money
  and then reported `structure-rebought` fatally over the phase whose job is to buy it. The real
  token count is now pinned in a test.
- **$40.90 was never a bound, and neither is $85.30.** A re-asking pass that hands its claim back at
  its own 740 s deadline is requeued, and the driver re-claimed it at once — with the slug still
  named in the re-ask lever, so the next claim ignored the checkpoint rows just written and bought
  the wave again. `REQUEUE_BUDGET = 2` permits three windows, so one nominal pass could buy the
  book's wave three times, and none of it was in the printed estimate. **What the run does is stop,
  not enforce a cap**: a re-asking pass stops on its first requeue, the job is left `queued` and
  resumable, and the self-abort is a fatal finding. The estimate prints $40.90 as the **nominal
  estimate** and $85.30 as the **three-window requeue exposure**; *neither is a bound*, and nothing
  anywhere refuses a call at $N. ⟨This bullet said "the run enforces the bound" and called $85.30 a
  "worst case" until 2026-09-05, contradicting the runtime text it describes. Sol had asserted the
  bound version twice and retracted it; the plan kept the retracted claim for another round. DPN-22.⟩

The other eleven were one disease in eleven places: **an answer computed over evidence that is
absent, partial or failed, printed as though it were a result**
([silent-success.md](../reusable/silent-success.md)). What changed:

- **Every one of Q1–Q5 has an answerability gate**, and "not measured" is visibly different from
  "measured zero". Q1 refuses fewer passes than the run set out to make, a pass whose wave threw, and
  a comparison that matched nothing and found no structural instability either — `0 of 0` printed as
  a flip rate of none. Q2 and Q3 refuse a rate over no verdicts. Q4 keeps a job whose ledger was
  never read as `NOT READ` rather than filtering it out of the bill. Q5 needs three steps that
  finished `done` with a wave's stats behind them.
- **Q1 is computed from phases A and B only.** The repeats are serial *because* a contended repeat
  confounds question 1, and the harness contradicted its own design by folding phase D's book pass
  into the same population. D's pass is reported beside question 5, where the contention is the
  point.
- **Concurrency is measured over the steps' own windows, not the jobs'.** All three phase-D promises
  stay alive while two of them are told `busy`, so a whole-job overlap check passes over a phase that
  ran serially. `peakConcurrency` has to reach three, and the runtime `jobConcurrency()` is asserted
  before anything is enqueued — it reads its environment variable at call time, so a shell that set
  it to 1 would serialise phase D while the metadata went on saying 3.
- **The money is watched from both ends.** Every ledger row must carry `scopeKind: "eval"` or it is
  being billed to Product — this eval drives jobs with no `fetch` step, so the fixture check cannot
  stand in for it — and every call each step's own collector saw must have a row, because a row that
  was never inserted reads back as `unreadable: 0`. Both are `evals/cost/report.ts`'s, imported. The
  ledger is re-read once every job has stopped, to say whether the numbers stood still.
- **A failure no longer takes the phase down with it.** Phase D drains with `Promise.allSettled`
  before the levers are restored, `driveJob` turns a failed ledger read or records parse into a fatal
  finding rather than a rejection, and the run file's checkpoint writer is serialised with a unique
  temporary name — three concurrent jobs racing on one `run.json.<pid>.tmp` left the loser's rename
  with `ENOENT`.
- **Phase C's control has to be a control.** An "ordinary" article with eligible sections is fatal
  now rather than a note: an unchanged tree there is a coincidence, not the evidence phase C exists
  to produce.

**It was refused five times.** ⟨GPT Sol, 2026-09-05.⟩ The second pass found seven more, two of them
reopening findings the first round had been recorded as closing — which is the argument for reviewing
the *code* as well as the plan. The fourth and fifth are [below](#stage-5b-round-4), and each of them
found that the previous round's fix was not the fix it looked like: **twice running, a fix removed
the version of the hole it had been shown and left the version it had not.**

- **Phase C assigned over the findings array instead of appending to it**, so a fatal scope or
  ledger-completeness finding recorded moments earlier was dropped, and nothing downstream recomputes
  those checks. The sweep it prompted found one more of the shape: `passesOf` was called twice over
  the same jobs, reporting a re-driven job's extra records file twice.
- **The scope and completeness checks now run on the end-of-run ledger read as well.** Where the
  per-job read failed, those checks had never run over those rows at all — the failure was recorded
  and the checks it would have performed were simply skipped, so a job billed to Product could have
  gone unreported.
- **A fatal finding on a job that has stopped now stops the run.** Turning a failed ledger read into
  a finding was right — a throw takes the levers down under two jobs still running — but nothing
  acted on it: an unreadable phase A, whose records are the whole of question 1, went on to buy B, C
  and D anyway. Phase D still drains all three before stopping.
- **A requeued re-asking pass is retained rather than cleaned up.** "Left `queued` and resumable" was
  a claim the harness then undid: ordinary cleanup deleted the article, which cascades to its
  expansion checkpoint rows, so the paid answers the refusal existed to keep were thrown away under a
  comment saying they had been kept. It retains them and goes no further, so no later job can publish
  over that slug.
- **`hasStats` became `hasSuccessfulStats`, and now means the wave did not fail.** When a wave
  exhausts its redraws, `generateHierarchy` catches it, writes stats with `failed: true`, falls back
  to wave 1, generates labels and **completes the step** — so three failed waves were `done`, carried
  clocks, carried stats and overlapped, and question 5 read as measured. It was measuring the
  fallback path.
- **The estimate stopped calling itself a bound.** $40.90 is the **nominal estimate** and $85.30 the
  **three-window requeue exposure**; neither is a bound and nothing enforces a cap. An ordinary,
  non-re-asking pass can requeue and re-buy any answer whose best-effort checkpoint write failed, and
  a redraw buys a second answer. The sentence claiming otherwise was an overclaim and is gone.
- **The records file is published atomically.** Phase D reads one directory from three jobs at once
  and could parse a sibling's file mid-write, fail, and mark the wrong job fatal
  ([hierarchy.md](../project/hierarchy.md#deepening)). The reader also filters by slug on the
  filename before opening anything.
- **The run's own errors stopped replacing each other.** `reportRun` runs whether or not the phases
  finished, so a throw from the reporting used to replace whatever had actually killed the run; both
  travel in an `AggregateError` now, and the reporting is told that the run died so it can say so at
  the top instead of reading like a run that finished. The end-of-run ledger re-reads are concurrent
  and under a deadline. ⟨Where this went against Sol: he asked for a *database-side* statement
  deadline. `costStore.forJob` takes its connection from the shared pool, so a `SET statement_timeout`
  would land on whichever of five connections it got and outlive this function on it — a change to
  every later query a paid job makes. The client-side deadline does the job the deadline is for,
  which is making sure the original error still arrives; what is genuinely lost, and owed, is
  cancelling the query at the server rather than abandoning it here.⟩
- **Phase D starts its three measured steps together before it measures them.** The concurrency
  arithmetic was right and the phase did not arrange the thing it measures: the book's job is a
  forced `hierarchy` and starts its measured step at once, while the two load articles start at
  `fetch` and get there only after stages 1–3. The two load jobs are driven first and are **held at
  the entry** to their measured step; a **readiness wait** ends when both are there, with the gate
  still shut and nothing of the book driven or bought; then the book is driven, reaches the same
  entry through the same hook, and **all three are released together**. **It took three goes.** The
  first was a latch: announcing an arrival held nobody, so load1 could run its whole step and finish
  before load2 announced, and the wait still ended `"all"` (DPN-20). The second held the loads and
  then released them *before* driving the book, which moved the same hole one party over — with the
  third queue slot taken, both released loads could finish before the book reached `hierarchy`, and
  the outcome still said `"all"` (DPN-20-R). So the book holds too, inside its own claim, and that
  costs it nothing: its step needs 658–778 s against a 740 s deadline and can give up none of it, but
  by the time it is driven everybody else is already waiting *for it*, so its wait is one microtask.
  The two load steps are the ones that really hold, bounded at three minutes, and what it cost each
  of them is reported as a note. **A readiness wait that does not end `"all"` stops the run rather
  than buying the book** (DPN-23). **What a successful gate guarantees is a shared start, not a
  shared window**: the queue's concurrency cap is global and shared, so whether the three overlap for
  long
  enough is still `peakConcurrency`'s to measure and refuse. Sol's other
  suggestion — pre-ingest the load articles as far as `blocks`, then force three hierarchy-only jobs
  together — cannot work, and a free `--dry-run` is what showed it: a job that stops short of a
  publishable article fails, and a failed job's draft revision is rolled back, so the second job
  opens on an article with no fetched document.

#### And a fourth review, on the last round before the money <a id="stage-5b-round-4"></a>

**Three P0s, and all three were the same disease in different clothes: the run went on buying after
it already knew the answer would be incomplete.** ⟨GPT Sol, 2026-09-05.⟩ `stopIfCompromised` reads
*findings*, and only findings — so anything a stopped job did not turn into one looked, to the run,
exactly like a clean job.

- **A paid job could end non-`done` with no fatal finding** (DPN-18). A phase-B `hierarchy` writes
  valid deepening records and then label generation throws; `driveJob` recorded `jobStatus: "error"`
  and nothing more, and phase C was purchased over a repeat that never finished. Every terminal
  status other than `done` is fatal now, on a paid run. `--dry-run` is exempt, and that is the
  rehearsal's shape rather than a loophole: its step list stops at `extract`, so its jobs are
  *expected* to fail at their last free step.
- **A deepen-on job could finish `done` with no records file** (DPN-19). `saveDeepenRecords` swallows
  filesystem and hard-link failures on purpose — instrumentation must not fail a reader's article —
  and `readRecordsDir` then returned `[]`, which the run printed as *"no records file — nobody
  asked"*. **"Nobody asked" and "asked and the record was lost" are different facts**, and questions
  1–3 are computed entirely out of those records. This was the seam where they got confused; it is
  fatal now, and the line prints which of the two it is.
- **The phase-D barrier was a latch, not a rendezvous** (DPN-20) — the fix the *third* round asked
  for, which looked done and was not. See the phase-D bullet above for what it does now and what it
  does not.

  > **And the fix for that was not the fix either.** ⟨GPT Sol, round 5, 2026-09-05.⟩ Holding the two
  > load steps and releasing them before the book was driven is a **two-party** gate: they waited for
  > each other and nothing waited for the book. With another job holding the third queue slot, both
  > released loads could finish their measured step before the book reached `hierarchy`, and the
  > outcome still read `"all"` — the same defect, one party over (DPN-20-R). Worth recording as a
  > *pattern*: each round's fix removed the version of the hole it was shown and left the version it
  > was not, because "the parties I am holding" kept being a smaller set than "the parties whose
  > windows have to overlap". **Three attempts at one hole, and rounds 4 and 5 each found that the
  > previous round's fix was not the fix it looked like** — which is the argument for reviewing the
  > code after every round rather than declaring the finding closed when its example stops
  > reproducing. The third go names the invariant instead of patching the example: **no measured
  > step may start until every measured step is at the entry.**
- **The immediate ledger read was unbounded** (DPN-21). The end-of-run re-read got a deadline in
  round 3; the read `driveJob` makes the instant a job stops did not, and that one sits inside phase
  D's `allSettled` — so one read that never answers is a phase that never reaches reporting. Same
  mechanism, one constant, both callers.
- **This plan contradicted the runtime text** (DPN-22), and that is the one worth naming as a
  failure of this document rather than of the code: the estimate had stopped calling itself a bound
  and the plan still said the run "enforces the bound" and called $85.30 a "worst case". A claim that
  has been retracted must not survive in the doc that describes it.

**And a fifth review found the round-4 fix had left one more of each.** ⟨GPT Sol, 2026-09-05.⟩ Both
in `runPhaseD`, and both are the two diseases of this stage meeting in one function:

- **DPN-20-R — the rendezvous was still two-party.** Recorded with the DPN-20 bullet above, because
  the pattern is only visible with all three attempts side by side.
- **DPN-23 — the run still bought after known failure**, in the one place round 4's own fix could not
  reach. If both load jobs fail before `hierarchy`, the readiness wait ends `"jobs finished first"`,
  their DPN-18 findings are already on the record — and phase D then drove the paid book anyway,
  because "drive the book" was an unconditional statement. **The book's phase-D pass exists to answer
  question 5 and nothing else** (question 1 is phases A and B only), and question 5 needs three
  windows open at one instant, so a book bought into a phase whose load steps are gone buys nothing
  at all. `loadReadiness` is the refusal, and it is pure so it can be watched refusing without a
  database. The book's job is still *queued*, deliberately: `budgetReport`'s `expected` counts
  phase-D jobs, so a queued-and-refused book still demands a third clock and question 5 still
  refuses — where a book that was never queued would have quietly lowered the bar to two.

Two smaller things fell out of DPN-23's shape. The readiness wait abandons on **the first load job to
stop**, not on all of them: `allSettled` cannot resolve while a sibling is held at the entry waiting
for a gate that wait has not opened yet, so the old form sat out the whole three-minute timeout to
learn something that was true in the first second. And the gate's own abandon signal is the *book*
alone, for the same reason.

**And then the last known money-waster, closed on purpose rather than on a review.** ⟨Greg,
2026-09-05.⟩ Round 5 left one path that still spent knowing the answer could not come back: the
readiness wait succeeds, the book is driven, and *the gate* then gives up — the book failing to get a
claim slot inside the deadline being the likeliest way. All three steps ran, `peakConcurrency`
refused question 5 afterwards, and $7.40 of a $40.90 run had bought an answer the report would not
quote. **18% of the run, spent on a question already lost, on a shared box where "another agent holds
the third claim slot" is nearer the expected case than the tail.** So the gate tells a released step
which of two things happened — `arrive` resolves to `"go"` or `"abandoned"` — and an abandoned step
throws before `step.run`, having bought nothing. Two guards: never on `"go"`, and never under
`--dry-run`, whose jobs already stop at their last free step and must not be given a second way to
fail. The verdict is **latched at the first opening**, because `runPhaseD`'s `finally` releases on
every path including the successful one, and a second call must not tell three running steps they
were abandoned. It is the one place this eval fails a step deliberately, so it says so twice: the
thrown error carries `ABANDONED_MARKER`, and — because the queue rewrites a failed step's message
into a reader-facing sentence, the trap `checkDriving` already exists for — a fatal finding goes on
the job's own record, where `run.json` and the closing findings block will both carry it. What phase D
now guarantees end to end is written out in numbered statements in `runPhaseD`'s docblock.

**A sixth review found two more, and both were phase D again.** ⟨GPT Sol, 2026-09-05.⟩

- **A re-driven measured job ran outside the gate** (DPN-25). A load job is not re-asking, so a
  requeue re-drove it as any ordinary pass — and its second `arrive()` took the rendezvous's
  *latched* verdict and returned at once, so the retry ran beside whatever its siblings happened to
  be doing while the queue replaced the first attempt's clock (`src/jobs.ts` § `runStep`). What came
  back looked like an ordinary question-5 pass and its duration omitted the attempt that had been
  lined up. `requeueVerdict` now has a second reason to stop, and it is about evidence rather than
  money: a job whose step question 5 is timing stops on its first requeue whether or not the re-ask
  lever names it.
- **The three measured jobs had no failure signal between them** (DPN-26) — the *fifth* instance of
  "it buys after it already knows". They were driven concurrently and drained together and that was
  all, so load 1's `hierarchy` could fail on its structure call while the book and load 2 went on
  admitting expansion and label calls, for a question 5 that could no longer reach three usable
  completions. Sol asked for the invariant rather than a fifth guard, and it is this: **the three
  measured jobs share one fate, and none of them starts more paid work after any of them has lost
  it** (`startPhaseFate`). A measured step that failed, a wave that fell back, a claim handed back —
  any of them loses it, and the others stop before their next claim. The honest verb is **stops
  starting**: a call already in flight belongs to the pipeline, and `src/` is not this eval's to
  change.

Three smaller ones came with them. Abandonment was producing a **false** `no-records` finding — the
records were never *requested*, because an abandoned step never runs, and "they were lost" is exactly
the invented fact DPN-19 exists to have stopped, one branch further on; `no-records` now fires only
on a job that ended `done` (DPN-27). The abandoned jobs were named off `wait`'s `held` snapshot,
which cannot see a step that arrived *after* the gate closed, so a late arrival was refused and left
unexplained; the gate now says who it turned away, because the gate is the only thing that knows
(DPN-28). And the three claims in the docblock were not exact (DPN-29): retries falsified the first
until DPN-25 closed them, the second needed a paid-run qualification because `abandonStep` stands
down under `--dry-run`, and the third repeated a risk **that is simply not real** — after a
successful gate all three jobs hold claims, which is all three of `DEFAULT_JOB_CONCURRENCY`'s slots,
so no other job can serialise them. I had asserted the contrary three times. Sol's narrower one-liner
replaces mine and is the sentence to quote: **"it no longer starts paid measured work when the
rendezvous already knows Q5 is impossible."**

**And a seventh review found the sixth instance of the class, one level below where the fifth was
fixed.** ⟨GPT Sol, 2026-09-05.⟩

- **The shared fate stopped new claims, not new calls** (DPN-30). One claim runs the *whole*
  `hierarchy` step, and that step buys a structure call, an expansion wave **and a whole pass of
  labels** — `generateHierarchy` catches a failed wave and falls straight through to `generateLabels`
  regardless (`src/hierarchy.ts`, the `deepenFailed` catch). So the exact DPN-26 scenario survived at
  the level below: after question 5 was known unanswerable, a sibling could still *begin* an entire
  label pass. My own sentence — *"a call already in flight finishes"* — was the overclaim, which is
  the DPN-29 standard failing on the sentence DPN-29 wrote. Up to about **$10.80 of phase D's
  $14.20** was exposed: the book's $7.40 pass plus whatever remained of the other load's ~$3.40.

  **It was fixable without touching `src/`, and the fix is the abort path `src/` already documents.**
  The claim's own `AbortController` is private to `advanceJobWith`, so the *claim* cannot be
  cancelled — and does not need to be. `announcing` already intercepts `run(ctx, …)`, so it hands the
  step a `ctx` whose `signal` is `AbortSignal.any([ctx.signal, fate.signal])`; `StepContext` is plain
  data whose `report` is an arrow closing over the step, so a shallow spread carries the rest across
  intact. Only a *lost* fate aborts, and `ctx.signal` keeps doing its own job. What that buys was read
  out of `src/` rather than assumed: label batches are queued **with** the signal
  (`src/labels.ts` § `queue.add(…, { signal })`), and `tests/labels-batching.test.ts` already pins the
  consequence — *"the callback must never run either, or the 'stop paying' half of fail-fast buys
  nothing"*. The honest remaining bound is **the single request already in flight**, which may still
  be billed.
- **`peakConcurrency` had become a tautology, and `fullConcurrencyMs` replaces it.** Sol confirmed
  the argument: given three valid completions, all three clocks open before `arrive()` returns and the
  gate says go only once all three have arrived, so `peakConcurrency === 3` is *constructed* and false
  only if a clock is corrupt. It is kept as the wiring check it has become. The load measurement is
  now the longest interval with all three genuinely in flight — `min(finishedAt) - max(startedAt)` —
  held to a floor **declared before the run and printed in preflight**, so it cannot be chosen after
  the figure is seen. It is bounded by the shortest of the three, which is the point: below the floor,
  question 5 reports *latency after a synchronised start*, not sustained three-job load.
- **The rehearsal could not exercise the failure path**, which was a fair hit: the fate was disarmed
  wholesale under `--dry-run`, so the one thing DPN-26 and DPN-30 are about — a live failure reaching
  its siblings — was the one thing the free run could never show. `fateReason` draws the line
  instead: a rehearsal job failing at the **last** step it was asked to run is the expected ending and
  loses nothing, while a failure earlier in the list, a requeue, or a fallen-back wave lose the phase
  in the rehearsal exactly as in the paid run.
- Non-blocking, fixed with them: `budgetReport` still told a reader that another agent could have
  serialised a successful gate. It cannot, for the reason DPN-29 established, and a peak below three
  now means **a clock is wrong** rather than that the phase was serialised.

**The dry run found a live bug on its first pass.** `enqueue` ends with `pump()`, which drives the
job with the *production* registry, and `withoutTheInProcessPump` silences it by setting one global
variable across that call — so two overlapping `enqueue`s race on it and one job runs production's
stage 1 with no eval overlay and goes to the real network. Phase D queued its three jobs
concurrently; one of the three failed with a DNS error. Queueing is serial now and only the driving
is concurrent. The check that catches it reads the fixture step's own `detail` —
`"1382 KB (fixture book)"` — rather than the error text, because the queue replaces a failed step's
message with a reader-facing sentence: the error-matching version was watched printing *"none"* over
a run where **every fetch had gone to the network**.

> **Overtaken, 2026-09-05.** `withoutTheInProcessPump` is gone: `enqueue` takes `pump: false` on the
> request now (`src/jobs.ts` § `pump`), so the hazard is per-request and there is no global for two
> `enqueue`s to race on. **Serial queueing is therefore no longer load-bearing** — it is kept because
> it reads better, and phase D now says so in as many words rather than justifying itself by a race
> that cannot happen. The `detail`-reading check outlived its bug and stays.

**What `--dry-run` cannot prove**: that anything published. Publishing needs a tree and a tree needs
a model call, so every dry-run job stops at its last free step and fails, and the run prints what the
driving proved instead of a table of zeroes.

> **And what it did not prove, 2026-09-05.** For a morning it proved nothing at all: `dev` merged in
> `unrunnableStepPlan`, which refuses `blocks` without `hierarchy` — exactly what the free step list
> asked for — so every phase threw at `enqueue`, no job was created, and the run printed its whole
> closing report including `Findings: none` before dying on its last line.
> [260905b](../postmortems/260905b-the-rehearsal-reported-a-clean-run-over-zero-jobs.md) is the
> write-up. The free lists are `fetch,extract` and a forced `extract` now, every list is checked
> against the queue's own rule before anything is enqueued (`assertStepPlansRunnable`), and the
> summaries can say *there was nothing here*. The same run also proved, for free, that **the ingest
> cannot be split across two jobs**: a job that stops short of a publishable article fails, and a
> failed job's draft revision is rolled back, so the second job finds no fetched document. That is
> why phase D starts its three windows together with a start rendezvous rather than by pre-ingesting.

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

### Stage 8 — turn it on, or stop <a id="stage-8"></a>

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

Each of these was live at some point in this plan's life, and the first two were **measured** rather
than argued away.

- **Just sharpen the prompt: a conditional fourth level, one whole-document call, no new machinery.**
  The simplest possible version, and the one GPT Sol named as the experiment the plan was missing.
  Measured in [stage 1](#the-free-experiment-a-conditional-fourth-level-in-the-one-whole-document-call):
  it works on a 141-block article, works on a 1,326-block book and **halves rather than solves** the
  problem there, and fails **four times out of four** on a 2,569-block book. **Not dead** — it is the
  fallback if [stage 8](#stage-8) says no, because it is free and it helps
  everything under book scale.
- **Raise the depth cap to four for everyone, unconditionally.** One line, no new calls. Rejected
  because the median article section is 2–7 blocks, so a fourth level there is one paragraph per
  node — the leaf layer with extra steps.
- **A second pass that deepens only the sections a word-and-block heuristic calls fat.** This plan's
  own first draft. Superseded on two counts: one extra level is not enough on a book, and the
  heuristic is a worse instrument than asking the call that just read the prose. The heuristic
  survives as a *bound*, which is [§ The four bounds](#the-four-bounds-and-which-of-them-can-overrule-the-verdict).
- **Whole-article prompt caching on every scoped call**, so each one can see the book. Rejected on
  arithmetic: a cache read costs what sending 10% of the article costs and a section is under 1% of
  it, so this is 4× the slice-only bill. The break-even is a 257-block slice.
- **Leave it.** Still a real option, and [stage 8](#stage-8) exists to be able to
  choose it. On an article the case is thin — three of thirteen, one of them badly. It is books that
  make the case, and books are rare.

## Where the advice came from

All 2026-09-04.

- **Greg** — the adaptive shape itself, quoted at the top: waves, fanning out one level at a time,
  and the per-child self-assessment. The plan before that was a single follow-up pass.
- **Fable 5**, twice — the frontier reframe, which is the load-bearing reader-side idea; the
  words-trigger/blocks-gate conjunction; the `buildChains` trap, found by reading and confirmed
  against the source; the forced-open ceiling; and the ruling that the author's headings beat the
  fan-out target, with the observation that *"Quarter-Deck, Sunset, Dusk"* is a list of its
  children's names and therefore the tell that the grouping had nothing to say. Its claim that the
  46% residual was measured with words alone was **wrong**, and the correction is in
  [§ Where I checked Fable and it was wrong](#where-i-checked-fable-and-it-was-wrong).
- **GPT Sol**, twice, on the plan — first review: the unsafe splice point, the leaf-parent frontier,
  the conditional-prompt experiment that was missing, `shouldExpand`'s heading clause selecting a
  hundred targets rather than five, the checkpoint ordering, and the missing enable stage. Second
  review: both blockers still open, the concurrency arithmetic wrong twice, the two overstated
  claims corrected in this plan's own text, and the stage split this plan now follows.
- **A repo-wide survey** — the depth-consumer map above.

## For whoever picks this up

- **Nothing in `src/` has changed.** The two spike scripts are new and throwaway
  (`scripts/spike-book-structure.ts`, `scripts/spike-expand-section.ts`); delete them when stages 3–5
  have made them redundant.
- **Start at [stage 3](#stage-3)**,
  which is pure and needs no network. Its first test is one that fails on today's
  `normaliseExpansion` because of the missing heading snap; write that red before anything else.
- **The evidence is in the repo** at `evals/results/hierarchy-waves-2026-09-04/`, with a README
  saying what each file is and which commands regenerate it. Every number in this plan is derived
  from those files. Two of the plan's earlier claims did not survive being recomputed, so recompute
  rather than quoting.
- **The books are Gutenberg texts and their HTML is gitignored**, at `output/2701-h.html` and
  `output/1228-h.html` in the primary checkout — the only copy. `blocks.json` is deterministic and
  free to rebuild: `npx tsx src/blocks.ts <html> <out.blocks.json>`. Note that command **rewrites its
  input HTML in place** (it stamps ids), so copy the fixture somewhere first.
- **Every book run costs about a dollar** and takes 100–500 seconds. The scoped expansions are a few
  cents.
- **`docs/project/hierarchy.md` § Longer pieces is stale**: it says generating the structure section
  by section is "still not built", which is true, and it quotes a prompt that no longer matches
  `SYSTEM` (it says gists are a later stage; they are not). Fix it in whichever stage touches the
  prompt.
