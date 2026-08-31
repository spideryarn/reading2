# Five kinds of line on the Force diagram

> Let's try and improve the Force diagram together.
>
> Add thick links with an arrow on one end to show the sequence, i.e. between each consecutive pair.
>
> Add thin links if there's an anchor link between sections.
>
> And when we generate the Force diagram, let's generate an embedding for each block, and add
> dotted links between the most similar handful of blocks, to see what that does to the shape of
> the Force diagram.
>
> — Greg, 2026-08-27

**Status: built, 2026-08-27.** Builds on [260826ah-diagram-mode.md](260826ah-diagram-mode.md), which built the six
pictures, and on [260826n-semantic-search.md](260826n-semantic-search.md), which chose the embedding model and has
still not been built.

**GPT-5.6 Sol reviewed this plan before it was built and returned NO-SHIP** —
[the review](260827d-force-diagram-links-review-sol.md), ten findings, six of them blockers. All ten were
acted on and each is marked ⟨Sol⟩ below where it changed the design rather than being quietly folded
in. Three of the six blockers turned out to be about things the implementation had already got
right; the other three were real, and one of them — the force-strength scale — would have silently
destroyed the experiment this whole change exists to run.

Today the Force picture draws three kinds of edge and they are hard to tell apart: containment
(faint), sequence (fainter, and only between siblings), and vocabulary (the one worth seeing). This
adds a fourth kind and makes all four *say what they are* — because the whole claim of this picture
is that a line means something, and four kinds of line rendered as three shades of grey is not a
claim, it is a texture.

---

## 1. Sequence: the reading-order chain, thick, with an arrowhead

**What is wrong today.** `buildGraph` emits a `sequence` edge between *consecutive siblings* — so
between 1.1 and 1.2, and between part 1 and part 2, but never between 1.4 and 2.1. The article's
actual reading order is exactly the edge that is missing, and it is missing at every part boundary,
which is where the reader most wants to know what follows what.

**What it becomes.** One chain through the **deepest drawn** nodes in reading order, across part
boundaries. A part that has drawn children is not in the chain — its children are, and the chain
passes through them; a part with no drawn children (a depth-1 leaf, or one the reader has collapsed)
is itself a link in the chain. That way the chain is always *the article*, and collapsing a part
shortens it rather than breaking it.

**Why an arrow rather than a colour.** The vertical axis already says which of two bubbles comes
first, so an arrow is redundant — right up until two sections sit at nearly the same height, which
on a long article is most of them. The arrow is what makes the redundancy hold at the density where
it stops being redundant.

**The geometry that has to be right.** An arrowhead at the *centre* of the target bubble is under
the bubble and invisible. Both ends of a sequence line are therefore shortened to the circle's
edge — `r + 1` at the tail, `r + HEAD_GAP` at the head so the tip sits clear of the stroke.

⟨Sol, blocker⟩ **The first draft of that would have drawn a backwards arrow.** The signed length is
`d − rs − rt − gap`, so any two bubbles closer than that produce a line pointing *up* the article —
which `forceCollide` allows, since it runs below full strength and positions are clamped afterwards
without re-running it. There is no honest short line between two circles inside each other, so
nothing is drawn. Also ⟨Sol⟩: `r + 5` is meaningless until the marker's `refX` and units are fixed,
so the marker is `userSpaceOnUse` with its tip exactly at `refX` — with the `strokeWidth` default,
changing the line's weight in the stylesheet would silently move every arrowhead.

`arrowPath` is **exported so it can be tested against separated, touching, overlapping and
coincident circles directly.** The first attempt tested it through a whole layout, could not make
the simulation produce an overlap, and passed with the guard deleted.

**What it does to the physics: nothing.** The `link` force keeps its existing weak `sequence`
strength (0.08). A thick line is a rendering decision; making it pull harder would drag the picture
back towards a column and undo what `force` is for.

## 2. Anchor: the article's own cross-references, thin

The article links to itself. Stage 3 has already repointed every such `href` at *our* block id
(`retargetAnchors` in [src/blocks.ts](../../src/blocks.ts), and
[internal-links.ts](../../src/web/internal-links.ts) is the click-time other end of it), so finding
them is a scan of `block.html` for `href="#…"` and a lookup — no model, no network, no guessing.

**A fragment that is not a block id still resolves.** An `id=` or `<a name=>` on something smaller
than a block usually survives stage 3, so the scan also indexes every `id`/`name` attribute inside
every block's html and maps it to the row that contains it.

⟨Sol, blocker⟩ Three corrections to that sentence and to the code under it.

*The index is two passes, not one.* Every `id` in the document beats every `<a name>`, wherever each
sits — the order the HTML spec resolves a fragment in, and the order stage 3 renames them in.
Interleaved per block, a `name` in block 2 beat an `id` in block 40, which is neither of those orders
and is a divergence from what a click actually does.

*"Survives untouched" was false.* DOMPurify **deletes** clobber-prone ids, which is why stage 3
stamps its own before sanitisation ([block-ids.md](../project/block-ids.md)). A link whose target was
removed that way resolves to nothing here — correctly, since it resolves to nothing in the reading
view either.

*It is a DOM parse now, and the argument for the scan was wrong.* I answered the plan review by
keeping the regex and arguing that this is not arbitrary web HTML — it is jsdom's own serialisation,
so it is well-formed and double-quoted. Sol's **code** review produced the counterexample and ended
the argument: `<a title="1 > 0" href="#target">` is valid serialised output, because the serialiser
escapes `&`, `<` and `"` inside an attribute value and has no reason to escape `>`; `[^>]*` stops
there and the link vanishes. Confirmed against the old pattern: it found **0 links**. And the tag
strip returned `A &amp; B` to be printed at a reader. Both silent, both free in a parser. One inert
`DOMParser` pass for the whole article; `graph.ts` needs a document now, and the two test files that
build graphs declare one.

This is the clearest case in the round for **weighting the code review above the plan review**, which
is what [AGENTS.md](../../AGENTS.md) says to do: the plan-stage version of this finding was a
generality about fidelity that I could argue with, and the code-stage version was a five-character
string that made it indefensible.

**The honest yield, measured across the whole corpus on 2026-08-27:**

| article | blocks | internal links | resolvable |
|---|---:|---:|---:|
| `constitution` | 360 | 5 | **5** |
| `noema-mythology-of-conscious-ai` | 141 | 0 | 0 |
| `fowler-phrenology` | 72 | 0 | 0 |
| `revistes-ub-30977` | 43 | 0 | 0 |
| `writes` | 19 | 0 | 0 |

So on six of the seven articles this feature draws **nothing at all**, and that is the correct
output rather than a failure — an essay that does not cross-reference itself has no cross-references
to draw. The one article that has them is the case worth having it for, because all five are
*long-range*:

```
row  12 → row  97   "being broadly ethical"
row  23 → row 273   "how we think about corrigibility"
row  30 → row 244   "principal hierarchy"
row  98 → row 173   "discussed below"
row 179 → row 236   "Being broadly safe"
```

Every one of those is the author saying *this depends on that*, over a distance no other line in the
picture can span truthfully. The vocabulary edges are a guess about shared subject matter; this is
the one edge in the picture that is a **fact about the document**. It gets its own colour for that
reason, and the hover card quotes the link text — which is the author's own words for the
relationship, and better than anything we could compute.

**Self-links are dropped**, along with links whose two ends land in the same drawn node: a section
that links to itself is a footnote marker, not a structure.

⟨Sol⟩ **That is not enough on its own.** Several links between one pair aggregate into one edge with
a count, and there is a **degree cap** as well as a total: a paper whose every section links into one
endnotes section would otherwise draw a star, which is perfectly true and tells a reader nothing
about a bibliography they did not know. The five-link corpus measurement does not bound anything —
it is evidence about these seven articles, not about the next one.

## 3. Semantic: embeddings, dotted

**The model is already chosen and already measured.** `voyageai/voyage-4`, from
[evals/embedding-retrieval.ts](../../evals/embedding-retrieval.ts) — 18 reader-phrased queries, 221
judged pairs, judged twice by two model families. It is tied with `openai/text-embedding-3-small` on
quality and wins the tie-break by billing to OpenRouter credits rather than to Greg's OpenAI
account. See [260826n-semantic-search.md](260826n-semantic-search.md) § The model. Nothing here re-litigates that.

**A POST, because the first call spends money** ⟨Sol⟩ — GET is meant to be safe, and a prefetcher, a
proxy retry or a double-tap on Back may repeat one without anybody having asked.

**What the server returns is pairs, not vectors.** A 360-block article at 1024 dimensions is about
3MB of JSON, which is not a thing to send to a browser so it can compute a dot product. The cosine
runs on the server — 360 blocks is 65,000 pairs, about 70M multiply-adds, tens of milliseconds — and
the response is each block's top few neighbours:

```
POST /api/similar/:slug
→ { model, blocks: 360, eligible, omitted, pairs: [{ a: BlockId, b: BlockId, score: 0.81 }, …] }
```

**Reading order is excluded twice, and once is not enough.** The server drops immediately-adjacent
blocks (`|i − j| ≤ 1`): two consecutive paragraphs of one argument are similar for a reason already
drawn in thick with an arrow on it. ⟨Sol, blocker⟩ But that guard is about *blocks* and the picture
draws *sections* — two paragraphs six rows apart can sit in consecutive sections, sail past it, and
come out as a dotted line along exactly the thick arrow that is already there. So the client also
drops any node pair the sequence chain already joins, which is the only side that knows what the
chain currently is (it changes under collapse).

**The pool is ranked globally, not per block.** ⟨Sol, blocker⟩ The first draft returned each block's
own top three, reasoning that a global cut would be won by whichever region of the article has the
densest vocabulary. That trades one problem for a worse one: per-block K **censors**. A pair that is
genuinely the best in the whole article can be absent because both of its blocks happened to have
three stronger neighbours each — and the client, which then sorts globally and takes a handful,
cannot recover what it was never sent. Worse, the client drops same-section pairs, so under
per-block K those had already *spent* a block's quota and taken nothing's place. All the pair scores
are computed anyway, so a global ranking costs nothing extra and has none of that.

**The client maps pairs to nodes and keeps the best handful.** A pair whose two blocks land in the
same drawn node is dropped; the rest collapse to one edge per node pair, keeping the best-scoring
pair and remembering *which two passages* earned it, so the card can name them. Then the top
`MAX_SEMANTIC_EDGES` survive.

**It arrives late and the picture does not wait for it.** Force draws immediately with the other
four kinds of line; the dotted ones appear when the request lands. A spinner over a picture that is
already four fifths there would be a lie about what is missing — so the status goes in the chrome
beside the picture instead, including the case where the request *failed*, since a picture quietly
drawing four kinds where five were promised is the [silent-success](../reusable/silent-success.md)
shape exactly.

⟨Sol, blocker⟩ **But arriving late must still change the shape.** Greg asked to see what embeddings
do to the picture; edges that are only painted afterwards do nothing to it, and the result would look
exactly as though it had worked. The pairs go into `buildGraph` **before** `layoutForce` runs its
ticks, so the simulation re-runs once when they land — and there is a test that node *coordinates*
move, not merely that the line count went up.

**Caching: in the server's memory, keyed by slug and source hash.** Not on disk and not in Postgres,
deliberately. ⟨Sol, blocker⟩ "Bounded, cached" was not a claim the first draft had earned, and four
things now make it one: the in-flight promise is cached **before** the first `await`, so two tabs
opening a cold article buy one copy rather than two; failures are never cached; the map is an LRU;
and there is a block-count ceiling and a per-passage character ceiling, so a single bad extraction
cannot become one enormous billable request. Persisting vectors is the substance of
[260826n-semantic-search.md](260826n-semantic-search.md) — it needs pgvector, a migration, a re-embed-on-change rule
and a place in the pipeline — and none of that should be decided by a diagram toggle wanting a cache.
The cost of being wrong is small and known: a cold server re-embeds one article for about
$0.002 and two seconds. Written down here so the next person does not read a memory cache as an
oversight.

**What this is for.** Greg's words: *"to see what that does to the shape of the Force diagram."*
This is an experiment with a stated question — do embeddings cluster the article differently from
tf-idf? — and the two are drawn on the same picture so the answer is visible rather than argued.

## 4. The four kinds have to be distinguishable, which means `depth` has to stop being the kind

`DiagramLink` carries `part` and `depth`, and Force has been abusing `depth` as a kind
discriminator (0 = sequence, 1 = parent, 2 = vocabulary). With five kinds that stops working, and
more to the point it was always a lie to the three tree pictures, where `depth` really is a depth.

⟨Sol⟩ **And `kind` is required, not optional** — an optional discriminator leaves the exact trap this
refactor exists to remove: a sixth Force edge could forget to say what it is and still compile. Every
layout therefore names the kind of every line, which on the tree pictures is not ceremony (every line
there really is containment). Sol also pointed out that **Arc had already made `depth` a fourth
thing** — a weight band, quantised into the three stroke widths its stylesheet has — so the honest
description of that field is "a per-picture rendering channel", not "a depth", and it now says so.

| kind | weight | dash | colour | what it claims |
|---|---|---|---|---|
| `parent` | hairline | — | neutral, faint | containment |
| `sequence` | **thick + arrow** | — | neutral | reading order |
| `anchor` | thin | — | its own hue | **the author linked these** |
| `vocabulary` | medium | — | categorical | shared distinctive words |
| `semantic` | thin | **dotted** | its own hue | similar meaning, per the model |

Paint order matters: parent, then sequence, then vocabulary, then anchor and semantic on top, since
the last two are the sparse ones and being under a thick line is the same as not being drawn.

---

## What could go wrong, and what catches it

- **The chain skips a node** — if `walk` returns nodes out of reading order, or a collapsed part is
  neither in the chain nor represented by children. Test: the chain over a fixture with a collapsed
  part visits every drawn leaf exactly once, in `startRow` order, and its length is `n − 1`.
- **The arrowhead sits under the bubble** — a `marker-end` at the centre. Test: pins the shortened
  endpoint against the target's radius.
- **An anchor edge from a fragment that is not a block** silently resolving to row 0. Test: a
  fixture with an `id=` inside a block's html, and one with a fragment nothing answers to (which
  must produce **no** edge, not an edge to nowhere).
- **The similarity response coming back permuted.** The eval already re-sorts `data[]` by `index`
  rather than trusting the order, for exactly this reason — the failure is invisible, every vector
  is a real vector. The extracted module keeps that.
- **A stale cache after a re-ingest** — the key includes the source hash, so a re-extracted article
  misses rather than serving vectors for text that is gone.
- **Money spent by pressing a toggle.** One article's blocks is ~$0.002. Bounded, cached, and only
  on `force`. Said out loud rather than assumed harmless.

## The code review, which was the more useful of the two

⟨Sol, code review⟩ **NO-SHIP again, ten findings, and the first was caused by my fix for the plan
review's fifth.** Moving to a globally-ranked pool removed the censoring — and introduced a way to
lose *everything*: same-section pairs were still in the ranking, so on Sol's 52-block probe the top
240 were all inside one section at score 1.0 and not one cross-section pair survived. The client
then discarded all 240 and the picture reported that nothing useful came back. A global pool of the
wrong candidates fails completely where per-block K failed partially. The exclusion has to happen
**before** the ranking, which means the server needs the tree — and therefore the structure hash in
the cache key, which Sol had already stipulated in the plan review.

The rest, in short: **no overall deadline** (one batch can take ~345s against a slow provider, past
Vercel's 300s cap, so the work is killed having been paid for); **dimensionality checked per batch
but not across batches**, which nothing downstream could catch because `dot` walked the shorter
vector; **the anchor scan** above; a **cache key that did not cover the recipe**; an **LRU that was a
FIFO**; a **truncation the response did not report** while a comment said it did; and — for the
second round running — **evidence computed and never shown**, this time the passage ids on a
semantic edge, documented as "so the card can name them" and dropped by the card.

That last one is the pattern worth naming. Twice now the same mistake, both times found by the same
reviewer, both times invisible to a passing test suite. `relatedFor` is a function rather than an
inline memo precisely so the third occurrence has something that can fail.

## What GPT Sol found that turned out to be already handled

Recorded because a review's misses are as useful as its hits, and because "we already did that" is a
claim that should be checkable.

- **In-flight coalescing, an LRU, a block ceiling, and not caching failures.** All four were in the
  code Sol was not shown; it reviewed the plan, which had not said so. The plan now does.
- **The reading-order chain under collapse and truncation.** The existing `leaves` definition is
  already "at the draw ceiling **or** with no drawn child", which covers every case Sol listed — but
  it named five fixtures worth having and only one existed, so all five were written. Four of them
  now fail if the chain reverts to sibling-only.
- **Stale-response guarding in the client hook.** The fetch aborts on slug change already.

## Open questions for Greg

1. **Should `arc` get the anchor and semantic edges too?** It is the picture that shows *distance*,
   and all five of the constitution's cross-references are long-range — arc is arguably the better
   home for them. Not done here; Force is what was asked for.
2. **Is a memory-only cache good enough**, or should this wait for the pgvector work in
   260826n-semantic-search.md? Recommendation: memory, on the grounds above.
