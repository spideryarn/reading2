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

## Q2, Q3 — decided <a id="q2"></a><a id="q3"></a>

Both settled on 2026-08-24 and written up where they belong. Anchors kept so older links still land.

- **Q2 — who assigns block ids, and how stable are they?** Stage 3 (blocks + ToC agent), and ids are
  **random**, not sequential, because sequential ids silently break on re-extraction. See
  [block-ids.md](block-ids.md#why-random-and-not-sequential). Note this went *against* the
  recommendation recorded here, which was sequential-plus-`textHash`; the hash-migration step it
  proposed is unnecessary once ids simply survive.
- **Q3 — what is a "block"?** The **finest** unit a reader takes in as one thing: an `<li>` is a
  block, the `<ul>` is a tree node. See
  [architecture.md § What a block is](architecture.md#what-a-block-is). Also against the
  recommendation here, which was one block per top-level flow element — that would have made
  "a ToC row per list item" permanently unreachable.

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

---

## Q8 — Where does a sentence's rank come from, in the fisheye view? <a id="q8"></a>

Only bites once the [fisheye view](granularity-zoom.md#the-other-view-fisheye) is built; the
[tabular view](granularity-zoom.md#the-tabular-view) needs only per-node gists and is unaffected.

Fisheye varies granularity *within* one screen, so it needs a number per sentence, not per node.
Two ways to get one:

| Option | For | Against |
|---|---|---|
| **Hierarchical budget** — each node promotes its best sentence, which inherits the node's depth | coverage is guaranteed even; the far-left view is literally "one sentence per chapter", which is what the brief asked for; only local judgments, which LLMs are good at | a dull section gets the same airtime as the crux |
| Global salience score | honest about where the substance actually is | clumps badly; whole sections render as nothing when zoomed out, so the map develops blind spots |
| Global score with a per-section quota floor | strictly better output than either | two interacting mechanisms to tune and debug |

**Recommendation: the hierarchical budget**, because it delivers the brief's own description of the
leftmost column and because it degrades gracefully. Revisit if the coarse levels feel like they are
giving equal weight to unequal material.

Related and also open: the fisheye sketch leans toward showing the author's **real sentences** where
the tabular view shows **generated gists**. Those are different bargains with
[principle 1](vision.md#principles) and should be reconciled deliberately.


---

## Q9 — A hostile article can run JavaScript in the reading view <a id="q9"></a>

Found by the linter — `lint/security/noDangerouslySetInnerHtml` at
[`src/web/TableView.tsx`](../../src/web/TableView.tsx). Not a style complaint. The chain is:

```
any URL the reader gives us
  → fetch → JSDOM → Readability            (src/extract.ts)
  → output/<slug>.html
  → content.outerHTML  →  block.html       (src/blocks.ts)
  → annotateHtml(...)  →  dangerouslySetInnerHTML   (src/web/TableView.tsx)
```

Readability is **not a sanitiser** and Mozilla says so in its own README. Tested rather than assumed
— a hostile page through the real pipeline, checking what comes out the other end:

| Payload | Survives Readability? |
|---|---|
| `<script>` | stripped |
| `<iframe>`, `<form>` | stripped |
| `javascript:` href | stripped |
| `onmouseover=` | stripped |
| **`<img onerror=…>`** | **survives** |
| **`<svg onload=…>`** | **survives** |

`<script>` inserted via `innerHTML` never executes, which is presumably why this has gone unnoticed.
`onerror` and `onload` are not so lucky: both fire, and the surviving `<img src="…/x" onerror="…">`
runs on load failure — which is guaranteed, because the src is bogus. So arbitrary JavaScript from
the article's author runs in our origin.

**What it gets.** Not much on the open web — no other site's cookies, since we are our own origin.
Locally it is worse than it looks: `npm run dev` is a Vite dev server, so same-origin `fetch` reaches
the dev middleware and whatever Vite will serve off disk, and the result can be POSTed anywhere. The
whole point of the app is to point it at arbitrary URLs, so "don't open untrusted articles" is not
available as a mitigation.

**Recommendation: sanitise at stage 3, in [`src/blocks.ts`](../../src/blocks.ts), not in the client.**
Then the stored `blocks.json` is clean, every later consumer inherits it, and the client stays a
renderer. Use a real sanitiser — DOMPurify is the boring choice, runs under JSDOM, and is what
Mozilla points at — rather than a hand-rolled attribute filter, because the interesting cases are
exactly the ones a hand-rolled filter misses. Follow
[third-party-library-selection.md](../reusable/third-party-library-selection.md) and write the
decision down.

Left undone deliberately: stage 3 belongs to another agent, this adds a dependency, and it wants a
deliberate choice rather than a drive-by fix from whoever happened to install the linter. The lint
error is **not suppressed** — it should keep complaining until this is really fixed.
