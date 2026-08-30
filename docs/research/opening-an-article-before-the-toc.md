# Opening an article before the ToC has been built

**Status:** research, 2026-08-30. Nothing here is built. It exists to be argued with, and then to
become a plan.

**Reviewed by GPT Sol, 2026-08-30** — verdict *"revise the research before writing a plan"*. Its
findings are in
[`opening-an-article-before-the-toc-sol.md`](opening-an-article-before-the-toc-sol.md), and the
corrections are folded in below where the claim was wrong rather than appended, so nothing here
misleads on its own. Every one of them was re-verified against the code. **The biggest is that
option A saves a quarter of what the first draft claimed** — see § 3.

The question, from Greg (2026-08-30):

> Now let's talk about how to make the ToC build as an optional step outside the pipeline when the
> user chooses that mode.

And, on the three options that came back:

> 1 Yes, or even an empty tree?
> 2 This sounds promising.
> 3 Could we use NDJSON instead of JSON? Would that help with displaying while streaming?

This doc answers those three, in order, with what the code actually does rather than what it looks
like it does. The short version:

- **An empty tree is invalid** — not merely ugly. `checkTree` rejects it. The smallest *valid*
  placeholder is root + one leaf per block, and it needs one thing a free tree cannot produce.
- **Splitting the ToC step is the cheapest real win** and the code already says so in a comment.
- **NDJSON works, but buys the last quarter of the call**, because three-quarters of the wait is the
  model thinking before it writes a single character. That is measured, not guessed.

---

## 1. The thing that makes this hard: the tree is not the mode's data

The framing in the question is that the ToC is what the Hierarchy mode draws, so a reader in another
mode should not have to wait for it. That is true of the *arc*, which is why deferring the arc was
cheap. It is not true of the tree.

`tree.json` is the reading view's skeleton. Everything hangs off it:

```
                            tree.json
                                │
    ┌──────────┬────────────┬───┴────┬──────────────┬───────────┐
    │          │            │        │              │           │
 geometry   outline      stats   arc · ideas    loadArticle   library
    │       (the spine)          glossary        gate          gate
    │                            similar
    │
 ┌──┴──────┬────────────┬──────────┬────────────┐
 │         │            │          │            │
gist    sections     navPlan    fitView     TableView
columns  (?at=        (↑↓ keys)  (column      (hover,
         scroll pos)             widths)      parents)
```

### Five places refuse an article that has no tree

| Where | What happens |
|---|---|
| `loadArticle`, [`src/api.ts:157`](../../src/api.ts) | `continue`s to the next candidate dir — **and falls through to `example/`**, serving the fixture |
| `describeDir`, [`src/api.ts:962`](../../src/api.ts) | `{ skipped: slug }` — the article never appears on the shelf |
| `articleDir`, [`src/api.ts:620`](../../src/api.ts) | **also falls through to `example/`** — the metadata page describes the fixture rather than 404ing [corrected: Sol] |
| pg `loadArticle`, [`src/store/pg.ts:1246`](../../src/store/pg.ts) | `throw notFound(slug)` |
| pg library, [`src/store/pg.ts:1285`](../../src/store/pg.ts) | `if (!row.revision.hasTree) continue` |

Two more that the first draft missed, both found by Sol and both verified:

| Where | What happens |
|---|---|
| public reading, [`src/store/public-reader.ts:411`](../../src/store/public-reader.ts) | independently requires tree **and** blocks |
| `reasonsNotToPublish`, [`src/store/pg-revisions.ts:1115`](../../src/store/pg-revisions.ts) | runs `checkTree` on the draft — so a placeholder must pass the **full** invariants, gist rule included, to publish at all |

The first is the nasty one. It is not an error path — it is the fixture fallback (`candidateDirs`
returns `[data/<slug>, example]` unconditionally), and it is the same fallback that once hid a path
traversal (`src/api.ts` carries the standing alarm about it). An article mid-ingest would silently
serve somebody else's prose — and so would its metadata page.

**Sol's recommendation, which I agree with: fix this before any feature work.** Removing the
fixture fallback for non-fixture slugs is independent of everything else here, and serving the wrong
article is worse than returning a visible "still building".

`publishRevision` ([`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts)) also refuses a
revision with no tree, and `Article.tree` is `Tree`, not `Tree | undefined`
([`src/types.ts:1088`](../../src/types.ts)) — as is the visitor's
([`src/public-types.ts:132`](../../src/public-types.ts)).

**So "make the tree optional" is not a small change**, and what is left on screen after removing the
columns, the spine, the `?at=` tracker and the keyboard nav is a plain page of text. That is a
different product for four minutes, followed by the whole layout reflowing under the reader.

The way through is the opposite: **never let the tree be absent**. Give the article a cheap tree at
once and upgrade it in place. Every gate and every client branch above keeps its invariant.

---

## 2. "Or even an empty tree?"

Worth taking seriously, because an empty tree is free and a heading tree is not. The answer is that
the floor is higher than it looks, and finding out where it is tells us what a placeholder must
carry.

### An empty tree — root and nothing else — is rejected

`checkTree` ([`src/tree-invariants.ts:149`](../../src/tree-invariants.ts)) decides leaf-vs-internal
by `children.length === 0`. A root with no children is therefore a **leaf**, and leaves must span
exactly one block:

```
if (mySpan[0] !== mySpan[1])
  fail(`${node.id}: leaf spans ${mySpan[1] - mySpan[0] + 1} blocks, expected 1`);
```

Separately, every block index must be covered by some leaf.

[corrected: Sol] The first draft said "one failure plus 299 uncovered blocks", which is not a state
the code can produce. Coverage marks every index in a leaf's range *even when the leaf is invalid*,
so there are two cases and neither is that one: a root spanning all 300 blocks gives **one**
"leaf spans 300 blocks" failure and no coverage failures; a root spanning one block gives a
root-span failure **plus** 299 uncovered blocks. The conclusion — rejected either way — holds.

This is not a check we should weaken. It is what stops a tree "silently drawing a wrong article",
and the header of that file states the asymmetry: **a valid tree is never rejected by the stronger
check, so the dangerous outcome is acceptance.**

### The smallest valid tree is root + one leaf per block

That satisfies coverage and the one-block leaf rule. Cost: zero model calls, milliseconds. But the
root is now an *internal* node, and internal nodes must carry two things:

```
if (t === 0) fail(`${node.id}: internal node has no title`);
...
} else if (!node.gist) {
  fail(`${node.id}: internal node has no gist — nothing to render at its level`);
}
```

The title is free — it is the article's title. **The gist is the problem.** It is one sentence
saying what the piece is, and there is nowhere free to get one. `meta.excerpt` is the publisher's
blurb, which is sometimes exactly right and sometimes marketing.

### What a flat tree would actually look like on screen

`buildGeometry` gives `maxDepth = 1`, so `leafDepth = 1` and `gistDepths = [0]`: one gist column
holding one cell — the root's gist — spanning the whole page. Honest, and nearly useless, but it
does not break.

The spine is worse. `buildOutline` returns `root.children` mapped to entries
([`src/web/tree.ts:402`](../../src/web/tree.ts)), and with a flat tree those children are the
leaves. So the rail becomes **one band per paragraph, every one of them blank**, because a leaf has
no title and no gist and would have no navLabel yet.

**[corrected: Sol] — "blank" is wrong, and I quoted a docstring selectively to get there.** The
rail is not blank:

- `bandLabel` names an unnamed top-level band **"Untitled section"**, and a nested one
  `"Section 2 of 4"` ([`src/web/Spine.tsx:907`](../../src/web/Spine.tsx)).
- Outline mode *drops* a row with neither title nor navLabel rather than drawing a blank one
  ([`src/web/outline.ts:118`](../../src/web/outline.ts)).
- If a marker lets an internal node omit its gist, `TableView` falls through to
  `navLabel ?? title`, so the root shows its title rather than an empty cell
  ([`src/web/TableView.tsx:797`](../../src/web/TableView.tsx)).

The Spine docstring I quoted is real but is about blank **child rows inside a band card**, not the
root children that become top-level bands here — and those child rows are now filtered. Quoting it
against a different case was the mistake.

**Verdict on the empty tree, restated honestly: valid at root + leaves, fails the gist rule, and
draws a rail of 300 tiny bands called "Untitled section" over one column holding the root's title.**
Not broken — useless, and indistinguishable band-to-band. The usability objection survives; the
"blank rail" framing does not. Headings remain worth far more for nearly the same money.

### The heading tree, and the one rule in its way

Most articles carry `<h2>`/`<h3>` blocks, and `blocks.json` already marks them (`kind: "heading"`,
`isStructural`). Building internal nodes from them is deterministic and instant:

- `title` = the heading text
- `sourceHeading` = the same text — and `checkTree` verifies a `sourceHeading` matches a heading
  block inside the node's range, which holds by construction
- heading **leaves** can carry `navLabel` = the heading text, and `checkTree` exempts heading leaves
  from the 6–20-word rule ("its label is the author's own title, and 'Soul Machine' is exactly right
  at two words")

So the spine gets real bands with real names, and the sections column reads properly. That is most
of the reading view, for free.

**It still fails the same gist rule**, now once per section instead of once.

### The precedent for how to relax it

Do not relax it by absence. That is settled, and the reasoning is already written down — it is why
`treatment` exists on a node at all rather than the supplement being inferred from a missing gist:

> Keyed on absence alone, a pipeline bug that drops a gist becomes indistinguishable from a
> deliberate supplement, and the dangerous outcome here is acceptance … Never infer the role from a
> missing gist.
>
> — [`src/tree-invariants.ts`](../../src/tree-invariants.ts)

So a provisional tree needs an **explicit marker**, and `checkTree` exempts a marked node from the
gist rule and nothing else. The marker is also what the client reads to decide whether to say "still
arriving" instead of drawing an empty cell, and what makes the upgrade legible rather than a layout
that mysteriously improves.

**[settled by Sol's review: a tree-level flag, not `treatment`.]** `treatment` already means
*apparatus rather than argument* and carries six supplement-specific invariants; overloading it puts
two unrelated meanings on one axis. `provisional: "headings"` on the **tree** is right, because the
whole tree is replaced atomically and no node becomes final on its own. A node-level state only
earns its place if partial NDJSON nodes will later coexist with finished ones (§ 4).

**One alternative worth naming, and rejecting as a general answer:** put `meta.excerpt` in the
root's gist. It makes the flat tree valid with no schema change at all. But `excerpt` is
Readability's last-resort card blurb — sometimes publisher marketing, not the article's claim — where
`gist` promises substitutable reading content; **only 5 of our 9 articles have one**; it fixes the
flat tree's single root and cannot supply a gist for each section of a heading tree; and without a
separate marker the client cannot tell a publisher blurb from a finished model gist. A defensible
fallback after a product decision, not a replacement for provisional state.

### Measured, 2026-08-30: do real articles have usable headings?

This was open question 3 and nobody had counted. Counting it is free.

> **[corrected 2026-08-30, and the correction matters] The corpus contains one document three
> times.** `source`, `source-2` and `revistes-ub-30977` are three extractions of the same
> 3,106-word article ("Forms of Memory in Post-colonial Australia") — identical word counts,
> 41/42/43 blocks. Found by the eval agent while building arm zero. **Every denominator on this page
> is therefore 7 distinct documents, not 9**, and the first version of this section triple-weighted
> one article. The numbers below are deduped.

```
document                       blocks  headings   model L1   heading L1   exact L1 match?
constitution                      360        36          7            7      yes
what-if-we-had-bigger-brains      172         9          8            8      yes
noema-mythology-of-conscious-ai   141         9          5            5      yes
forms-of-memory (×3 on disk)       41         5          5            5      yes
scaling-hypothesis                186        25          9           11      no — over-segments
fowler-phrenology                  72         8          9         flat      no — see below
writes                             19         1          4         flat      no — one heading
```

**"Heading L1"** is what a deterministic heading tree produces
([`evals/toc-structure/heading-tree.ts`](../../evals/toc-structure/heading-tree.ts)). **"Exact L1
match"** is 100% Jaccard agreement on depth-one cut points with the tree the model actually shipped.

- **6 of 7 documents have three or more headings.** Only `writes` (19 blocks, about a page) does not.
- **4 of 7 get a heading tree whose top-level carving is identical to the model's.** Not similar —
  identical cut points.
- **What the model demonstrably adds on those four is the level *below*.** Agreement across *all*
  boundaries is only 28–48%, because the model cuts long unheaded runs at topic shifts and headings
  cannot. Plus the gists, and titles where no heading exists.

That last point is the honest form of the denominator claim, and it is sharper than "the headings
are nearly as good": **the author gives us the parts for free on most articles; the model earns its
money on the sections inside them.** Which is an argument for waves (§ 6) as much as for B.

#### A headingless article does not just degrade the free tree — it destabilises the model

**Observed on a real ingest, 2026-08-30, not in a test.** Someone added
`paulgraham.com/read.html` ("The Need to Read", 23 blocks, **exactly one heading** — its own h1
title) through the ordinary queue. It took **16 model calls and $0.39** and produced no article.
A 23-block piece should cost one structure call and one label batch.

```
attempt 1  FAIL     n0025: sourceHeading does not match any heading block in its range
attempt 2  SUCCEED  11 sections, 58.2s
attempt 3  FAIL     n0022: same
attempt 4  FAIL     n0025: same
attempt 5  SUCCEED   9 sections, 69.7s
attempt 6  nav labels: asked 21, got 17 (missing 6,14,17,20)
           retry:      asked 21, got 13 (missing 6,10,11,14,16)
cost:      0.06 -> 0.19 -> 0.30 -> 0.39
```

**Eleven sections one run and nine the next, on byte-identical input.** That is not a model being
slightly unreliable; it is a model with nothing to hold onto. `src/toc.ts`'s prompt tells it a node
must begin at a heading wherever one exists — with one heading it improvises, and three runs in five
improvised a `sourceHeading` for a range containing none, which `checkTree` correctly refused.

The label failure is the same cause wearing a second face: `src/labels.ts` batches along the
**tree's own section boundaries**, so an article with almost no boundaries gets one batch containing
everything — the unbounded-output problem the batching was built to prevent, arriving through the
one door it does not close. The missing indices scattered differently between attempts (overlapping
only on 6), which is what a too-large batch looks like; four genuinely hard labels would fail on
roughly the same four each time.

**Under investigation** — root cause and postmortem in progress; the reproduction has to clear a
confound first, since the ingest ran inside a `src/toc.ts` refactor window. The observed facts above
are from the server log and `data/_ai-calls.jsonl` and are not in doubt.

**What it changes here.** § 2 treated "an article with no headings" as the case where option B
degrades to the flat tree — a free tree that is poor. That was the wrong way round. On such an
article **the expensive path is the unreliable one**, so there is no good tree to wait four minutes
for. That is an argument *for* opening on something free and honest, not against it.

It also says something about the corpus. Five held-out documents were approved that morning to probe
exactly this hole, with another Paul Graham essay as the top pick for exactly this reason — and the
gap arrived on its own, on an ordinary ingest, for 39 cents, before anyone paid to look for it. The
lesson generalises past headings: **a real ingest of an ordinary article is a cheaper instrument
than a corpus, and we were not running any.**

#### The two that fail, and why they fail differently

**`scaling-hypothesis` over-segments** — 11 heading parts where the model chose 8. Recoverable: a
merge rule for short segments is already in arm zero.

**`fowler-phrenology` is the interesting one, and the first draft described it wrongly.** I said
"headings the model ignored". In fact **all 8 of its headings sit in the first 10 blocks** — Wellcome
catalogue front-matter (Contributors, Publication, License) — followed by **61 blocks of unbroken
lecture**. No heading rule can carve that, and arm zero collapses it to flat, which is the honest
free answer. It is the case where a model arm earns its money outright.

This also produced a better measure than heading *count*, arrived at independently by GPT Sol and by
the eval agent: **the longest prose run with no heading in it.** 61 blocks in fowler, 42 in
scaling-hypothesis, 38 in the constitution. That predicts whether a heading tree yields usable bands;
counting headings does not.

**The conclusion is unchanged and slightly better supported than before.** The worry was that
unstructured prose would leave most readers with the flat fallback. On the real corpus it happens on
one document of seven, and on a second the free tree is over-segmented rather than absent.

Caveats, stated plainly: **n = 7, and it is our corpus, not the world's** — mostly long-form essays,
one legal-ish document, no news, and the three PDF/HTML articles in `data/` are stuck before
`blocks.json` and could not be counted. Seven documents is thin for choosing between models, which is
an open question for the eval (§ 9).

### The cost that is not obvious: swapping the tree invalidates its dependants

`arc`, `ideas`, `glossary`, `summary` and `labels` all address the tree by **exact block range**, and
a re-cut tree silently drops every entry that no longer matches — no error, no gap. The good news is
that the machinery for this now exists and was proven once: `structureHash` + `inputFingerprint` +
`isStale`, built for the arc on 2026-08-29 ([`src/arc.ts`](../../src/arc.ts),
[`docs/plans/defer-arc-and-rename-hierarchy.md`](../plans/defer-arc-and-rename-hierarchy.md)).
Anything generated against the provisional tree must carry that stamp, or it will look current
against the real one.

The simplest way to avoid the whole class: **generate nothing against a provisional tree.** Refuse
`arc`/`ideas`/`glossary`/`summary` while the marker is on. That needs checking against the job
queue, and it is one of the questions for Sol.

---

## 3. Splitting the ToC step in two

Greg: *"This sounds promising."* Agreed, and the code agrees too — it names this option and its
condition, unprompted, in [`src/toc.ts:648`](../../src/toc.ts):

> Deferring the labels so a reader can start sooner is a real option and a deliberate later one; it
> needs a state that says "still arriving" rather than an absence that says nothing.

### What it buys

**[corrected: Sol] The first draft overstated this win by a factor of nearly three, and the error
was mine — I summed three calls that run concurrently.** `src/labels.ts:1355` batches the label pass
in parallel on purpose. The ledger's timestamps say so plainly:

```
                        start     end    wall-clock
toc  structure call       0.0   163.1      163.1s  ████████████████████████████████  88%
toc  label batch x3     163.1   186.2       23.1s  ####   (concurrent: 22.0, 23.2, 20.0)  12%
arc                     187.4   197.8       10.4s  ##
                                          --------
     ingest total                          197.8s
```

Publishing the tree the moment the structure call returns puts the reader in at **163s instead of
186s — a 12% cut of the ToC phase**, not 31%. The labels then arrive as a deferred job.

The same error was in [`docs/plans/defer-arc-and-rename-hierarchy.md`](../plans/defer-arc-and-rename-hierarchy.md),
which is now corrected; the arc's share is 5%, not 4%, and that plan's conclusion is unchanged.

**The structure call is 88% of the wait, not 68%.** Every other option on this page is a rounding
error beside it — which is the single most important thing the review changed.

### What it costs

`navLabel`s are used in more places than "the leaf column, which only shows in outline mode":

- outline mode's paragraph rung ([`src/web/outline.ts`](../../src/web/outline.ts))
- the spine's band cards, via `titleOrNav` ([`src/web/Spine.tsx:887`](../../src/web/Spine.tsx))

Internal nodes have real titles from the structure pass, so the *bands* are fine. It is the **leaf
rows inside an expanded band** that go blank — which is precisely the bug quoted in §2. So this
needs the "still arriving" state the docstring asks for, in two views.

There is also a stamping question: `labels.json` records `structureHash(opts.tree)`, and the
supplement is appended **before** `generateLabels` so the labels are not stale at birth
([`src/toc.ts:762`](../../src/toc.ts)). Publishing the tree first must keep that ordering.

---

## 4. NDJSON, and why it only helps at the end

Greg: *"Could we use NDJSON instead of JSON? Would that help with displaying while streaming?"*

**Yes it would work, and the plumbing is already there — but it addresses the smaller half of the
call.** The measurement is the whole answer.

### The measurement

`data/_ai-calls.jsonl` has two structure calls. `reasoning_tokens` arrives inside
`completion_tokens_details` ([`src/ai-call.ts:287`](../../src/ai-call.ts)), so it is a **subset** of
output tokens, and the subtraction below is the actual JSON:

| article | duration | input | output | reasoning | JSON tokens | thinking share |
|---|---|---|---|---|---|---|
| bigger-brains | 163.1s | 27,068 | 18,369 | 13,716 | **4,653** | **75%** |
| (second run) | 320.4s | 28,569 | 34,175 | 28,800 | **5,375** | **84%** |

The tree itself is only ~5,000 tokens. **Three-quarters to five-sixths of the call is the model
thinking, and thinking emits no answer text at all.** At `effort: "high"` adaptive thinking expands
into the room it is given — the lesson of `docs/postmortems/toc-max-tokens.md`.

Assuming a roughly even token rate, first JSON arrives at:

```
bigger-brains   163s × 0.75 = ~122s   →  NDJSON saves up to ~41s
second run      320s × 0.84 = ~270s   →  NDJSON saves up to ~50s
```

So progressive rendering starts the reader at ~122s rather than 163s: **~25% off the structure call,
~17% off the whole ingest.** Real, and much less than it sounds like it should be. It also does not
change *when the reader can open the article at all* unless a partial tree is publishable, which
lands us back in §2.

**The estimate's weak point, stated plainly:** it assumes thinking tokens and answer tokens are
emitted at the same rate. They usually are not. This should be checked by timestamping the first
non-thinking delta on one real call before anyone commits to it — `onText` already exists, so it is
a few lines and one article, not a project.

### What NDJSON would change in the code

Nothing in the transport. `streamMessage` already exposes `onText`
([`src/messages-stream.ts:387`](../../src/messages-stream.ts)), and `generateToc` already takes an
`onProgress`. The docstring is explicit about the only thing standing in the way:

> For the structure call there is nothing useful to say about *what* has been written — the JSON is
> unparseable until it is complete — so it reports that something is still coming.

NDJSON — one node per line, each with its own id, parent and range, instead of one nested object —
makes each line independently parseable, so `onProgress` could report real structure and a partial
tree could be drawn.

### The objections, after review

The first draft listed three and stated all of them too absolutely. Sol's corrections, verified:

1. **"Validation cannot go early" — false.** Syntax, record shape, known block ids, valid ranges,
   parent existence, ordering and duplicate ids can all be checked as records arrive. Only complete
   coverage and the final sibling partition must wait. And nested JSON does **not** give partition
   correctness for free — `assertChildrenPartition` validates it explicitly today.
2. **"A partial tree always fails `checkTree`" — usually, not always.** It fails while records are
   still missing; once every needed node has arrived it can pass before any terminator does. A
   completed top-level subtree can also be validated on its own.
3. **"Truncation stops being loud" — true only for a weak protocol.** A header declaring the article
   range and the expected count, plus an END record carrying a count or a hash, keeps it loud. This
   has to be designed in, not noticed later.
4. **The one I missed, and it is the real blocker: there is no browser delivery path.** The model
   stream exposes text deltas, but a step's `report` takes a short string held in memory
   ([`src/pipeline.ts:283`](../../src/pipeline.ts), [`src/jobs.ts:317`](../../src/jobs.ts)). Nothing
   carries partial structured data to an open article. NDJSON needs an application stream or a new
   incremental artefact channel before it can show anybody anything.

Sol also offers a better protocol than flat parent-pointer records: **stream one nested top-level
subtree per line**, with a header and a terminator. That keeps the representation the model already
handles — so the quality risk I worried about mostly evaporates — while letting each finished part be
checked and drawn as it lands.

Expect, in return: repeated geometry changes, column reflow, scroll-anchor movement, resume and
duplicate handling, and node ids changing while records arrive.

## 5. Three risks the first draft missed entirely

All three found by Sol, all three verified, and all three change the shape of a plan rather than
decorating it.

### Image privacy — `assets` is a defence, and opening early defeats it

`assets` is in `DEFAULT_INGEST_STEPS` for a reason that is written down at
[`src/pipeline.ts:1378`](../../src/pipeline.ts):

> **The only step with no model call and a network cost**, which is why it is in
> `DEFAULT_INGEST_STEPS` while the four after `arc` are not: nobody has to ask for it, because
> leaving it undone means every reader's browser announces itself to the publisher's CDN once per
> image, per read.

**Opening an article before `assets` finishes reintroduces that leak.** Every option here opens the
article earlier, so every option must either wait for `assets` or suppress external images until the
manifest lands. This is a security property, not a polish item, and it belongs in
[security-map.md](../project/security-map.md)'s terms rather than in a latency table.

> **Updated 2026-08-30, and "wait" is now dead.** Two findings from the session that owns
> `src/collect-assets.ts`, both landed:
>
> - **The step now has a wall-clock bound, `ASSETS_BUDGET_MS = 300_000`.** So waiting is bounded
>   rather than unbounded — but 300s on top of `toc`'s measured 320s worst case is not a page anyone
>   holds. **Suppression is the only route to opening early.** Take this option off the table.
> - **The step used to go on fetching after it returned.** The budget's first implementation handed
>   back the manifest on time while ~38 queued fetches drained afterwards, so the article kept
>   talking to the publisher's CDN for a step that had already finished. Every test passed and
>   deleting the guard changed nothing. Fixed, with a test that re-reads the request count 150ms
>   after the step returns.
>
> The second is a finding about *this* design, not only theirs. Suppression was going to lift when
> the assets step reported done — which, under the old behaviour, would have uncovered the images
> while the leak it exists to close was still draining. **So suppression keys on the manifest, not
> on the completion signal.** A manifest is a fact about bytes we hold; a completion signal is a
> claim about a process, and this one was wrong.
>
> The step also now records `out-of-time` as its own entry state, distinct from `budget` (the
> 200-image cap) and `network` (a fetch that was attempted and failed). That is the distinction the
> reading view needs, because the question it must answer per image is *"will waiting help?"* — and
> the three states answer it: yes, no, and maybe.
>
> **Sizing, measured 2026-08-30:** the frightening 3,000s figure comes from the 200-image policy cap.
> The real corpus tops out at **18 images** (`noema`), then 9, then 7; most articles have one or
> none. So the bound is generous rather than tight.

### Stage 3 does not publish the blocks the reader opens

Stage 3 writes `output/<slug>.blocks.json`. **The ToC stage is what copies them into
`data/<slug>/blocks.json`** — the file the reading view actually opens
([`src/toc.ts:826`](../../src/toc.ts)). So "write a placeholder tree at stage 3" is not one write; a
placeholder needs its own publication boundary that emits blocks **and** tree together, and does so
atomically for the same reason the ToC stage already writes the tree last.

### Nothing replaces the tree in an open reader

An open article holds its fetched `Article` in component state, and nothing refetches it when a
ToC-related job finishes ([`src/web/App.tsx:405`](../../src/web/App.tsx)); the add page navigates
only once the whole job is done ([`src/web/AddPage.tsx:174`](../../src/web/AddPage.tsx)).

**This affects A, B and C equally.** Every option assumes a reader watching the page get better, and
that seam does not exist. `useArc` is the closest precedent — it revalidates one artefact on job
completion — but swapping the *tree* moves the geometry, the columns, the sections and the scroll
anchor underneath the reader, which is a harder problem than replacing an arc.

**This is the single largest piece of unbudgeted work on the page.**

### And one consequence for the work that just shipped

`useArc` starts an arc job automatically when an owner opens an article with no arc
([`src/web/useArc.ts:133`](../../src/web/useArc.ts)). With a provisional tree in place, that hook
fires immediately and **spends a model call against the placeholder**. The marker must gate it.

## 6. Greg's two follow-ups, 2026-08-30

### Progressive waves — L1, then L2, then L3

> I also wondered about doing it progressively, e.g. first doing the L1, then another call for L2,
> and so on. (We want to be able to support more than 3 levels, because for a book-length text we'll
> probably need the extra hierarchy). I realise that adds complexity, but it would significantly
> improve latency.
>
> — Greg, 2026-08-30

**The depth argument is stronger than the latency one, and it is close to decisive.** Today the whole
tree must fit in one response. That constraint has already forced one split: the nav labels were 73%
of the answer and took the stage over the token ceiling, which is what `src/labels.ts` and
[toc-max-tokens.md](../postmortems/toc-max-tokens.md) are about. A four- or five-level tree over a
book is the same wall, further along. Waves turn depth from a budget problem into a loop.

The latency case is real but unmeasured. L1 over the whole article is a few hundred tokens of answer
and should think far less than the 13.7k tokens the all-at-once call spends; L2 is one call per part
and they parallelise, exactly as the label batches already do.

**The happy part: waves need the same machinery as § 2.** A tree that is honest about being partial,
a marker, per-wave freshness, and the tree-replacement seam of § 5. Build it once and B and this both
land — which is the opposite of the complexity Greg was bracing for.

**The costs:** each wave must tile its parent exactly (`assertChildrenPartition` already enforces
it); a run can now die half-done, so it needs resuming (`src/labels.ts` already checkpoints, so
there is a pattern); and input tokens rise unless the article prefix caches well.

**And a cost nobody had named, which may be the decisive one.** On 2026-08-30 the structure call was
found to have a **baseline per-call failure rate**: two calls in ten returned a tree whose children
do not partition their parent — a one-block gap, a one-block overlap — and it happened on a
well-headed article as readily as a headingless one, so it is independent of every other bug found
that day. `assertChildrenPartition` catches it loudly and nothing dangerous ships; the call simply
costs its money and produces nothing.

**One big call absorbs that. Waves multiply it.** The arithmetic is unforgiving if the rate holds
per call and the calls are independent:

```
today          1 call            P(clean run) = 0.8
waves, 3 deep  1 + ~8 + ~30      P(clean run) = 0.8^39  ≈  0.02%
```

Nobody would run it that way — each wave would be retried on its own, which is much cheaper than
retrying the whole tree and is a genuine argument *for* waves. But it turns "roughly 39 calls" into
"roughly 49 calls" in expectation, and it means **a wave-based design needs per-wave retry from the
first commit rather than as a later hardening.**

Two things are unknown and one of them is cheap to learn:

- **The rate itself is n = 10.** The eval's calibration panel — the incumbent four times over three
  documents — estimates it properly as a free by-product, and was asked to report it.
- **Whether the rate is per-call or per-difficulty.** A wave asks a smaller question over a smaller
  range, so it may fail *less* often than one call over the whole article — or the same rate over
  many more calls, which is worse. **This is the single measurement that decides whether waves are
  cheap or expensive**, and no one has it. It should be the first thing the waves arm reports.

### Author headings as model input

> they're rarely granular enough, and we often need shorter and longer versions, and so perhaps we
> provide them as input to the model (if they exist), but allow it to modify and even completely
> replace them?
>
> — Greg, 2026-08-30

**The measurement in § 2 says the model is already doing this, unprompted.** Heading blocks are in
`blocks.json`, so they are already in the prompt, and `sourceHeading` is where the model records
that it quoted one. On 4 of 7 documents it chooses the author's structure outright (7/7 on the
constitution, 8/8 on bigger-brains). On `scaling-hypothesis` it takes 8 parts where the headings
offer 11; on `fowler-phrenology` the headings are catalogue front-matter over one unbroken lecture
and no rule could use them. That is the judgement Greg is asking for, being exercised.

So the resolution: **headings are an excellent placeholder and a poor final answer.** Use them for
the tree the reader opens on; let the model overwrite it. `sourceHeading` preserves the legitimacy
point by recording which headings are really the author's.

What is genuinely untested is whether making them *salient* — an explicit list, with instructions on
when to depart — beats leaving them embedded in the blocks. That is an eval arm, not a guess.

**Sol adds a fourth product option worth keeping on the table:** when an article's headings are good,
**keep the heading tree as the final geometry** and have the model fill in gists and labels without
re-cutting it. That removes tree-swap invalidation entirely for the majority of articles. The price
is giving up model-discovered boundaries on well-headed pieces — and on the corpus the model mostly
agrees with those headings anyway, which is an argument that the price is small.

## 7. Which model, and at what effort

Every pipeline stage sends `CAPABLE_MODEL_OPENROUTER` = `anthropic/claude-sonnet-5`; the quick tier
is `openai/gpt-5.6-luna` ([`src/models.ts`](../../src/models.ts)). The ToC structure pass runs at
`effort: "high"`.

**That `high` has never been evaluated.** [effort-vs-quality.md](../../evals/results/effort-vs-quality.md)
tested high-versus-medium for arc, thread and glossary and found the settings on disk already right.
The ToC was not in it; its `high` was argued for in the max-tokens postmortem, not measured.

Greg's combinations, which are now arms in the eval being built (§ 9): smart-with-less-thinking
versus cheap-with-more; a cheap first pass revised by a capable model; and waves. **Model choice and
wave structure interact** — once L2 is a small call over twenty blocks it may not need `high` at all —
so they must be evaluated together rather than separately.

## 8. Prioritised — revised after review

Sol declined to keep A → B → C, and having checked its reasoning I agree. A is a 12% cut, not 31%;
and the tree-replacement seam of § 5 is a prerequisite for all three rather than a detail inside one.

| # | Change | Effort | Risk | Why here |
|---|---|---|---|---|
| **0** | Remove the `example/` fallback for non-fixture slugs; decide what "safe to open" means (incl. `assets`); build **one** article-refetch / tree-replacement seam | small–medium | low | Serving the wrong article is a live bug. The seam is a prerequisite for A, B and C. |
| **B** | Heading tree at a new publication boundary, upgraded in place | medium | medium | The only option that answers the ask. Evidence: 6/7 documents have usable headings, 4/7 match the model's L1 exactly. |
| **A** | Fold the labels into the same upgrade state machine | small | low | Once B's machine exists this is a state in it, not a project. 12%. |
| **W** | Progressive waves | medium–large | medium | Shares B's machinery. The only answer to book-length depth, and it attacks the 88%. |
| **C** | NDJSON + progressive render | medium | medium–high | Needs the browser delivery path that does not exist. Measure first-text timing first. |

**Recommendation: 0, then B, then A folded in, then W — and C last or not at all.** W and C attack
the same 163 seconds from different ends, and W does it without needing a new streaming channel.

## 9. Open questions

Answered along the way and kept for the record: the provisional marker is a tree-level flag (§ 2);
node ids are persisted nowhere, so a tree swap is safe (below); real articles do have usable
headings (§ 2).

1. **What is "safe to open"?** Blocks + a tree is the old bar. `assets` (§ 5) argues the bar is
   blocks + tree + either the asset manifest or image suppression. This needs deciding before B.
2. **Optional stages against a provisional tree — refuse, or allow and stamp stale?** Sol recommends
   refusing all four for the 80/20, and corrects the doc's claim that they share one representation:
   arc fingerprints blocks + tree + metadata and ideas fingerprints blocks + tree, so "allow and
   stamp" is *already* safe for those two — but **glossary and summary currently hash only the
   blocks** ([`src/glossary.ts:699`](../../src/glossary.ts),
   [`src/summarise.ts:790`](../../src/summarise.ts)) despite reading the tree, so they would need
   freshness work first. There is no first-class "waiting for final tree" job state today.
3. **The section-heading-level rule.** The naive "shallowest tag occurring more than once" picks
   `h1` for `fowler-phrenology`, which has two h1s and six obvious h2 sections. Sol suggests a better
   predictor than heading *count*: **the longest prose run with no heading in it** — 61 blocks in
   `fowler-phrenology`, 42 in `scaling-hypothesis`, 38 in the constitution. That measures whether a
   heading tree gives usable bands, which is the actual question.
4. ~~Does anything persist node ids across a tree swap?~~ **Checked — nothing does, and this was
   designed for.** `src/web/position.ts` states the hazard: *"Node ids (`n0003`) are … regenerated
   whenever `tree.json` is rebuilt — a URL holding one would silently point somewhere else after the
   next run … Hence: the id of the first **block** of the section, never the id of the node."* `?at=`
   holds a block id; comments anchor on `blockId`; `Section.nodeId` is in-memory only.

   One second-order effect remains: `sectionDepth` is `max(1, leafDepth - 1)`, so what counts as "a
   section" is derived from the tree's depth. A heading tree is likely shallower than the model's, so
   on the swap the section depth moves and a reader's `?at=` block id — still resolvable — may stop
   being a section boundary and snap to the nearest one. Small; should be a decision, not a surprise.
5. **Measure before building**, per Sol, cheapest first: the longest-unheaded-run figures above;
   excerpt availability (5/9 today) and suitability; external-image incidence and `assets` duration
   on a wider corpus; and **first-text timing on the next naturally occurring ToC call** rather than
   a bought one — OpenRouter's generation endpoint may already carry it for the stored generation
   ids, which would cost nothing at all.
