# Deepen the sections that came back too fat

**Status: planned, not yet reviewed, not yet built.** Started 2026-09-04. Worktree
`deepen-fat-sections`.

One extra rung on the zoom ladder, bought only where the reader is missing one — and a change to
what a column *means*, which is the part that makes it work.

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

Keep the single whole-document structure call **exactly as it is**, and add a second pass that
subdivides only the sections that came back fat — recursively, until nothing is fat or a depth cap
is reached.

That distinction is the whole design, and it is what makes this different from the cascade in
[260904c](260904c-hierarchy-structure-in-waves.md):

> Below ~125,000 words a single structure call sees every boundary and every sibling title at once,
> which is strictly better than any decomposition and much simpler.
>
> — [260826h § D](260826h-toc-scaling.md#d-coarse-to-fine-a-global-outline-first-then-subtrees-in-parallel)

That argument is about **deciding the global outline**, and it stands. Deepening does not touch the
global outline: the top three levels still come from the one call that saw everything. The extra
calls only subdivide a range whose boundaries and title that call has already fixed — the one job a
scoped call does as well as a global one.

### It does not fix latency, and saying so is part of the proposal

The structure call on the 142-page paper is 508 s, and this plan adds calls rather than removing
any. Deepening makes the *tree better*, not the wait shorter. If the wait is the priority this is the
wrong plan and [260904c](260904c-hierarchy-structure-in-waves.md) is the right one.

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
   `L2`/"Sections" becomes **the frontier**: for each block, its leaf's parent, the finest gist that
   contains this paragraph. On an undeepened article that is bit-for-bit what it shows today, so
   nothing changes for ten of thirteen articles; on a deepened one it shows sections where sections
   were fine and sub-sections where they were fat.

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

After:

```
raw answer ──parseJson──▶ ModelNode ──DEEPEN──▶ ModelNode ──buildTree──▶ Tree ──appendSupplement──▶ …
```

**Before `buildTree`, on the model's nested proposal** — not on the built tree. Three reasons:

1. Every check `buildTree` makes — the tiling, the coverage, the repairs, the root clamp — then runs
   **once**, over the finished proposal, unchanged. There is no second validation path to keep in
   step with the first.
2. The leaf layer is grown once, under whatever the deepest node on each branch turns out to be. No
   leaf is minted and then re-parented.
3. Supplements are appended *after* `buildTree`. Deepening never sees one, so it cannot break the
   depth-1 rule — which is also the phantom the measurement above tripped over.

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

#### And the last one is arithmetic, not a model failure

The prompt asks for two things that cannot both be true of a book:

- *"The article's own headings are HARD boundaries. A node must begin at a heading block wherever
  one exists."*
- *"Aim for 5-9 children per node"* and *"Go 3 levels deep"*.

Three levels at a fan-out of nine is **at most 81 sections**. Moby-Dick has 144 authored headings, so
at least 63 of them have nowhere to go. The model produced 54 sections, which is close to the
ceiling, and dropped the rest — it was not disobeying, it was doing the only thing the instructions
left it. A fourth level lifts the ceiling to 729 and the contradiction disappears.

**This is the strongest argument in the plan**, and it is not about fat sections at all: at a fixed
depth of three, a book's own structure cannot be represented, however good the model is.

### Stage 2 — the deepening pass, behind a flag, not yet on

`shouldExpand` gains the words half of the conjunction; a `deepenProposal` step between `parseJson`
and `buildTree`, driving the existing cascade core; the request builder and the executor; per-section
checkpoints under the existing `hierarchy-structure` namespace (keyed on a digest of that section's
own request, so the namespace and its DB CHECK need no change); supplement exclusion; and
`OversizedTarget` and `CapReached` surfaced onto `HierarchyRun` rather than swallowed.

**Done:** an article with a fat section produces a depth-4 tree that passes `buildTree`,
`assertTreeSound` and `checkTree` including the every-internal-node-has-a-gist rule; ten of the
thirteen corpus articles produce a **byte-identical** tree to today, which is the assertion that says
the pass is inert where it should be; injected failures resume the exact completed sections; and the
label pass runs over a variable-depth tree, which is the thing only a real run can show.

### Stage 3 — the reading view learns that a column is a frontier

The `buildGeometry` continuation fix and its invariant; the frontier column; `sectionDepth`; the
outline band's rung ladder; summary mode's three coupled caps; the CSS tokens; auto-fit's starting
set; and the two section counters.

**Done:** the browser check, on the box, at three, four and five internal levels — an undeepened
article renders identically to today, a deepened one shows sub-sections in the frontier column with
no blank or duplicated cells, `?at=` stays section-granular, and `?cols=` shows a ragged ToC that
reads like a ragged ToC.

### Stage 4 — docs, eval, and the numbers

`hierarchy.md`, `granularity-zoom.md` (§ The tree: "a column is a depth" becomes "a column is a
frontier"), `url-state.md`, `keyboard.md`, `tooltips.md`, `summaries.md`. The eval gains a
sections-fatness metric so the threshold can be tuned against something rather than chosen.

**Done:** no doc still states three levels as a fact; `npm test`, `npm run typecheck` and
`npm run check` green; GPT Sol's review of the built code answered.

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
