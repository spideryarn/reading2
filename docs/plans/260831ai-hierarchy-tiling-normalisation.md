# The tiling stopped being checked and started being derived

**Landed 2026-08-31.** A reader pasted a Princeton memory paper (PDF) into `/add` and got this back
after a completed, paid structure call:

> The children of the node at root > child 5 do not tile it: child 5 overlaps the one before it by 2
> block(s). … Before this it mended 1 boundary(ies), moving 1 block(s): root > child 5 > child 4
> (gap, 1). The bound is `MAX_REPAIRED_BOUNDARIES` in `src/hierarchy.ts`.

Greg: *"This tiling issue is frequently an issue, and we need a clean, robust, general solution."*
And on how to get there: *"Get something working that's simple, clean and robust, and also note in
Appendix and/or comments if you have a long-term-better plan. Ideally the stepping stone should be a
step in the right long-term-direction."*

## What was already there, and why it still broke

Stage 4 asks a model to carve the article into nested sections with `[startBlock, endBlock]` ranges.
Those must tile: every block in exactly one leaf, in order, no gaps, no overlaps. Models do not
reliably produce that, and the call is ~163 seconds and most of the stage's bill, so every refusal
costs a reader a whole article after the money is spent.

Two bounds had already been fitted and then overridden, each by an article somebody lost:

1. **The per-repair size bound** (one block), removed 2026-08-30 after a 9-page arXiv PDF lost its
   ToC to a gap of three — $0.1617 spent, nothing the reader could do.
2. **The per-answer count bound**, `MAX_REPAIRED_BOUNDARIES = 1`, added the same day on GPT Sol's
   review: unlimited independent repairs would walk a systematically misaligned tree past the check
   one block at a time with every step looking defensible.

Both were fitted to the **same four observations**, and all four were single slips from **HTML
articles with headings** — the half of the corpus where the model has the author's own structure to
agree with. The failure above is the gap the code comment already named out loud: *"A headingless PDF
with two independent slips still loses its whole ToC … a known gap, left open deliberately."*

Raising the number would have been a third guess at a threshold nobody has evidence for, and the next
PDF would have arrived with three slips.

## What was built

**The partition is derived from the answer rather than checked against it.** `planChildRanges` in
[`src/hierarchy.ts`](../../src/hierarchy.ts) replaces the cursor walk. For a parent `[P0, P1]`:

- the first kept child starts at `P0`;
- every later child starts where the model said, clamped inside the parent, required to be strictly
  after the previous kept start;
- every child ends one block before the next starts; the last ends at `P1`.

A gap, an overlap, a short last child and children running past their parent were four cases to
detect and mend. They are now **not expressible** — a list of ordered split points tiles its parent
by construction. There is no bound left because there is nothing left to bound.
`assertChildrenPartition` stays, and should never fire on a derived node: it is the standing proof
that the derivation is total, not a second chance to reject the answer.

### Starts are believed, ends are computed — and the end is the tie-break

This is the one real design choice, and it is not arbitrary. Both rules are single rules; they differ
in which of the model's two claims about a boundary survives.

A **start** is a claim the model has a reason for: where the section begins, where its heading is,
what `sourceHeading` names. An **end** is the same boundary stated a second time from the other side —
a redundant field, and redundant fields are where inconsistency lives.

The visible consequence is that a gap's orphaned paragraph now joins the section **before** it rather
than the one after. On the fixture in `tests/hierarchy-repairs.test.ts` the old rule filed "Body of the
first part" under "Second", which is wrong; the new rule is right there, and right in general — a gap
means the model stopped a section early while knowing where the next one begins.

**But "starts win" on its own was too strong, and GPT Sol found where.** When a child's start does not
advance past the previous section's start, it is not a split point and it carries no information — and
the first version dropped the child on the spot. One block of overlap then deleted the article's
largest section:

```text
child 1  [0,0]   "Preamble"
child 2  [0,4]   "Large middle"   ← starts where child 1 does
child 3  [5,5]   "Close"
```

"Large middle" and its whole subtree vanished, and the report named a four-block gap the answer never
contained. So the rule is not "starts win" but **believe the start, and fall back to the previous
child's end when the start says nothing** — which gives child 2 a start of 1 and keeps all three
sections, exactly as the cursor walk would have. A child is dropped only when *neither* claim yields a
usable split point.

### The simpler option that was passed over

**Keep the cursor walk, delete the two bounds, and squeeze a swallowed child into one borrowed
block.** Smaller diff, every existing test green, also total. It was rejected because it keeps
believing ends: one badly-wrong end early in a node cascades into every child after it getting a
single block each, and the rule that produces that is the same rule that files an orphan under the
wrong heading. A total algorithm built on the less meaningful of two claims is robust in the sense
that it never throws and fragile in the sense that matters.

### What it loses, and what still throws

**A child whose start is not strictly after the previous kept child's start is dropped**, with its
whole subtree, and counted in its own field (`BuildReport.droppedChildren`, `HierarchyRun.droppedChildren`,
the CLI line, the pipeline log, the eval result). The old code refused this outright, on the argument
that emptying a child *deletes a section the model asked for* — which is exactly what this does, and
is why it gets a figure of its own rather than being folded in with the boundary repairs. A moved
boundary keeps every section the model named; this does not.

Still refused, because they are faults in what the model *said* rather than in how its sections line
up, and each has an exact message: a range that runs backwards, an endpoint that is not a block id, a
root that misses the article's ends. One unresolvable child leaves its whole sibling set underived,
so the precise error survives.

### Measurement is what stands where the bounds stood

Every boundary the model got wrong is recorded with `where`, `kind`, `at` and `size` — and `size` is
now the distance between the model's **two claims about the same boundary**, which is exactly how far
its answer was from tiling. One entry per boundary, not per child whose range moved: counting
children would report one mistake twice and make `repairedBlocks` depend on which side you looked
from.

`repairedBlocks` against `blocks` is the fraction of the article that changed hands. Greg chose to
ship and watch the numbers rather than buy an eval run first, so that fraction is the evidence this
change is now collecting.

**One coordinate bug was found this way and fixed.** `at` names a boundary, and `repairedBlockCount`
deduplicates by it so a cascade — one boundary seen at several depths — is counted once. That is only
safe while two *different* boundaries in one node cannot share a coordinate. The closing boundary was
`parentEnd`, which is also a coordinate a child's start can take, so a last child that both started
and ended in the wrong place reported two faults at one `at` and the sum silently dropped the smaller
— an undercount in the only figure anyone watches. `at` is now uniformly **the index of the first
block after the boundary**: a node's start, a child's start, or `parentEnd + 1`. The fuzz below found
it, and now guards it.

## The evidence that it is total

Totality is the whole claim, and a handful of hand-written cases cannot make it — the failure that
started this arrived as a shape nobody had thought of. So `tests/hierarchy-repairs.test.ts` ends with a
fuzz: 3,000 deliberately sloppy proposals, nested three deep, with gaps, overlaps, out-of-order
starts and children running past their parent, several to an answer. Every one must come back as a
tree `checkTree` accepts, with every block reachable exactly once.

At 20,000 iterations while developing: **7,353 proposals did not tile as written, all 20,000 produced
valid trees, and nothing was mended without being reported.**

Three controls, because a check nobody has seen fail is not evidence
([silent-success.md](../reusable/silent-success.md)):

- **the generator must keep biting** — the test asserts a floor on how many proposals are actually
  faulty, since drifting into well-formed answers is a likelier way for this to rot than the code
  regressing;
- **`checkTree` must object to a tree that is broken** — 20,000 clean results mean nothing if the
  checker returns `[]` for everything, so it is handed a corrupted tree and must fail;
- **nothing may be derived silently** — a proposal that did not tile, mended into one that does, with
  an empty report, fails the test.

The fuzz was watched failing on a one-character regression (`next.start` for `next.start - 1`) and on
the old `at` coordinate, then watched passing again.

## What the review changed

The code and the plan went to GPT Sol together
([the review](260831ai-hierarchy-tiling-normalisation-review-sol.md), against
[the prompt](260831ai-hierarchy-tiling-normalisation-review-prompt.md)). It confirmed totality —
"I found no structural totality failure for resolvable, forward ranges", with its own 54,240 shallow
combinations and 50,000 nested proposals — and found five things wrong. All five are fixed.

1. **High — dropping on the start alone deleted a section for a one-block overlap.** The case above.
   The end is now the tie-break. This is the finding that mattered: the difference between a rule that
   is clean and one that is clean and right.
2. **Medium — `repairedBlockCount` deduplicated by `at` alone.** A node's last child stopping short
   and its *next sibling's* first child starting late are two faults about two different blocks that
   meet at the coordinate between the siblings, and one of them was silently dropped from the only
   figure anyone watches. A cascade is a boundary at several *depths*, so its entries are nested
   `where` strings; deduplication now follows those chains and sums across them.
3. **Medium — `size` was measured after clamping.** For an inner parent `[0,3]` with children `[0,1]`
   and `[5,5]`, the model's two claims about the interior boundary are three apart and it was reported
   as one. It is measured against the raw proposal now. This is the number a re-ask would be triggered
   by and told about, so measuring it after our own adjustment defeats the purpose.
4. **Medium — the noise floor stopped measuring tiling.** `evals/hierarchy-structure/floor.ts` read
   only `StructureScore`, and its tiling instrument was `throwAnatomy` — the anatomy of a throw, for
   faults that no longer throw. Every such answer is now `outcome: "ok"` with `otherProblems`
   necessarily zero, so **the floor was measuring the spread of the normaliser's output rather than
   the model's.** It reads the repair scalars too now.
5. **Low — an eval row that threw lost the repairs from before the fatal node.** `ArmFailure` carries
   the `BuildReport` now, the way production's own catch already did.

**Three of the five are the same mistake in different places, and it is the one this eval has now been
taught three times: a repair inside the code under measurement redefines the measurement, and nothing
fails when it does.** `validity.otherProblems` joined `sourceHeadingValid` as a measure that became
necessarily-perfect the day this landed; both say so in their own doc comments now, and
`evals/README.md` says to read them beside `repaired`.

Sol also declined to recommend a refusal threshold, for the reason given above: *"It would be another
unsupported number and would again discard the whole article. A dropped child should instead be a
degraded outcome and, once re-asking exists, an automatic re-ask trigger."*

## What this is a step toward

Greg, 2026-08-30, when the size bound went:

> Perhaps in future, it should trigger a re-run of the LLM, where we feed in the previous output,
> with information about the gaps and ask it to adjust. But that's for later.

**That re-ask is still the right long-term answer**, and this is deliberately a step toward it rather
than a detour. Deriving a boundary is a guess: the reader gets a paragraph filed under a heading that
may not describe it. Asking the model to redraw the boundary it actually meant is not a guess. What
the re-ask needs, and what this supplies:

1. **A fallback that always yields a usable tree**, for when the second call is also wrong — which it
   will sometimes be, since a headingless article is where the model is measured disagreeing with
   *itself* between runs. Without one, the re-ask is a retry loop that can still end in a lost
   article, and it costs 163 seconds and a second bill before it fails.
2. **A number that says when a second call is worth buying.** `repairedBlocks / blocks` and
   `droppedChildren` are that number. A boundary a paragraph out is not worth $0.16 and three
   minutes; a quarter of the article changing hands, or a section dropped, is.

So the shape of the next stage is: derive as now, and if the answer was far enough from tiling, re-ask
once with the specific boundaries named, derive *that* answer too, and keep whichever needed less
moving. None of it requires undoing anything here.

Three smaller things left open, all deliberately:

- **A dropped child does not say how much went with it.** Sol's point: "if it had 100 descendants, the
  CLI still says 1 dropped section." That was sharp when a trivial overlap could discard a large
  subtree; with the end as the tie-break, a drop now means the answer asked for more sections than the
  parent has blocks, and the discarded children are usually leaves. Worth adding when a real run shows
  a non-zero count, and not before.

- **The root's own range is not derived**, only its children's. A root that misses the article's ends
  still throws. Same argument would apply — clamp it to the body and report — but it is not an
  observed failure, and the discipline that produced two overridden bounds in two days is to change
  what broke rather than what might.
- **Nothing aggregates or alerts on the repair rate.** GPT Sol's point from the earlier review,
  unchanged: the figures are per-run, and a rate that drifts is still something a person has to
  notice.

## Verification

`npm test` and `npm run typecheck`. `tests/hierarchy-repairs.test.ts` was rewritten around the new rule —
29 cases including the fuzz above, the reproduction of the failure that started this (written first,
and watched failing with the exact production error), and one case for each of the review's first
three findings.

**This work landed in the middle of the `toc` → `hierarchy` rename**
([260831ak](260831ak-rename-the-toc-step-to-hierarchy-everywhere.md)), so `src/toc.ts` became
`src/hierarchy.ts` underneath it and the review above was written against the pre-rename diff. Nothing
was lost — `git mv` carries uncommitted work — and the findings were applied to the new paths. Three tests elsewhere had encoded the old bounds as the vehicle for
their own claim and were re-pointed at faults that are still refused:
`tests/hierarchy-structure-eval.test.ts` (an arm is judged on the pipeline's rules — now a backwards
range), `tests/hierarchy-write-guard.test.ts` (the repair figures reach the error on a refused run — now a
root that stops short).

The suite has failures that are not this work's: peers' fixture uuid collisions, a Postgres advisory
lock held by another agent's run, a missing `api-dist/vercel.js` build artefact, and PDF concurrency
tests timing out at 5s under parallel load. `scripts/db-corpus-readiness.ts` has a typecheck error and
is an untracked peer file.
