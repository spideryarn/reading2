# Open questions

Undecided calls, each with a recommendation so work isn't blocked. When one gets decided, write the
decision into the relevant doc ([vision](vision.md) / [granularity-zoom](granularity-zoom.md) /
[architecture](architecture.md)) and delete it from here — this file should shrink over time.

---

## Q1 — Where does the hierarchy come from? <a id="q1"></a>

Greg's framing was structural:

> imagine a book, you could think of the book as being divided into chapters, which are divided into
> sections, which are divided into, I don't know, pages or paragraphs

But most web essays aren't books. The test article ([Noema, Anil Seth](../../output/noema-mythology-of-conscious-ai.html))
is ~54 minutes of largely bare `<p>` with few subheads, so "chapters → sections" mostly has to be
*invented* rather than read off the document.

| Option | For | Against |
|---|---|---|
| Source headings only | faithful, free, the author's own seams | depth varies wildly; flat articles collapse to 2 levels, which kills the left-right axis |
| LLM segments semantically | uniform depth on any article | boundaries are the model's opinion; costs a structuring pass |
| **Headings as hard boundaries, LLM subdivides the gaps** | keeps the author's seams where they exist, gives flat articles real depth | tree shape differs between articles; more code paths |

**Recommendation: the third.** Provisionally adopted in
[granularity-zoom.md § Where the tree comes from](granularity-zoom.md#where-the-tree-comes-from).
Target branching factor ~5–9 so levels feel like even strides.

---

## Q2 — Who assigns block ids, and how stable are they across re-extraction? <a id="q2"></a>

Ids are [the one contract that matters](../../AGENTS.md#the-one-contract-that-matters). Two sub-questions:

- **Which stage owns assignment** — the extractor (stage 2) or the ToC/blocks stage (stage 3)? Both
  are owned by other agents right now, so this needs an explicit call.
- **Sequential or content-hashed?** `p0001…` in document order is simple and readable, but if the
  article is re-fetched and one paragraph is inserted near the top, every downstream id shifts and
  every note, highlight, and cached gist is silently wrong.

**Recommendation:** sequential ids for readability, *plus* a `textHash` per block, and a re-extraction
step that matches new blocks to old by hash to migrate reader state. Ship sequential-only in v1 and
record the pipeline version in every artefact so stale caches are detectable rather than invisible.

---

## Q3 — What is a "block"? <a id="q3"></a>

Paragraphs are the obvious leaf, but a Readability-extracted article also contains headings, lists,
blockquotes, figures, `pre`, and tables. Are list items individual blocks or is the whole `<ul>` one
block? Does a figure get a gist?

**Recommendation:** one block per top-level flow element (a whole `<ul>` is one block), because that
keeps blocks close to "a thing you read as a unit". Figures and `pre` are blocks that carry no gist
and are shown verbatim at any level where their parent is expanded.

---

## Q4 — Discrete levels or continuous zoom? <a id="q4"></a>

Greg described it as continuous motion:

> by scrolling rightwards, you get more detail. By scrolling downwards, you progress through the
> chronology of the article

A true continuous axis would need interpolation between compression levels, which nothing about the
tree gives us for free.

**Recommendation:** discrete depths with animated transitions in v1; a continuous-feeling *gesture*
(horizontal scroll / trackpad swipe) that snaps to depths. Revisit only if the snapping feels wrong
in the hand.

---

## Q5 — Uniform-level zoom, or focus+context? <a id="q5"></a>

The brief describes the whole article at a uniform granularity. But the likely real usage is: scan
the coarse level, spot the one part you care about, and drop into *that* alone while the rest stays
coarse.

**Recommendation:** build both, default to uniform, instrument which gets used. Noted as a failure
mode in [granularity-zoom.md § What would make this fail](granularity-zoom.md#what-would-make-this-fail).

---

## Q6 — How do we know it's working? <a id="q6"></a>

[vision.md](vision.md) claims we're augmenting rather than replacing cognition. That claim needs a
test, or it's just a slogan. Candidate signals: do readers actually scroll right? Can they
reconstruct the argument afterwards? Do they quote the piece?

**Recommendation:** unresolved, and worth resolving early — it's the difference between this being an
experiment and a demo. Explicitly *not* time-in-app or articles-completed
([anti-goals](vision.md#anti-goals)).

---

## Q7 — Which model, and how much does a tree cost? <a id="q7"></a>

Unmeasured. A ~54-minute article is on the order of 400 blocks; bottom-up generation is roughly one
call per node plus one per leaf batch.

**Recommendation:** measure on the Noema article before optimising. Load the `claude-api` skill for
current model ids before writing the calls; don't hardcode a model from memory.
