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

Still unmeasured **for the tree**, but no longer unmeasured for everything. A ~54-minute article is
on the order of 400 blocks; bottom-up generation is roughly one call per node plus one per leaf batch.

What 2026-08-26 established, from `npm run eval:caching` against the live API
([evals/results/](../../evals/results/README.md)) — these are *search* calls, not tree generation, so
they answer the per-token economics rather than the question as asked:

| | tokens | cold | warm | uncached |
|---|---:|---:|---:|---:|
| `constitution`, 360 blocks | 47,739 | $0.11945 | $0.00965 | $0.09558 |
| `noema`, 141 blocks | 18,793 | — | $0.00386 | $0.03769 |

So one pass over the constitution's text costs about **10 cents** uncached, and about **1 cent** once
the prefix is cached. A tree is more than one pass — the structure call plus a label batch per
section — but the unit price is now known rather than guessed, and
[prompt-caching.md](prompt-caching.md) means the repeat passes are the cheap ones.

**What is left:** log a real ingest end to end. `src/pipeline.ts` already logs `inputTokens`,
`outputTokens`, `cacheReadTokens` and `cacheWriteTokens` per step, so the number now falls out of one
run rather than needing an experiment built for it.

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

## Q9 — decided <a id="q9"></a>

**A hostile article could run JavaScript in the reading view.** Settled 2026-08-25 and written up in
[security.md](security.md), which is now the place for anything on this. Anchor kept so older links
still land.

Short version: Readability is not a sanitiser and never claimed to be, so `<img onerror>`,
`<svg onload>`, `<span onmouseover>` and `<video onerror>` all reached `dangerouslySetInnerHTML`.
DOMPurify now runs at **stage 3** in [`src/blocks.ts`](../../src/blocks.ts), before ids are minted,
so `blocks.json` is clean and every later consumer inherits that. Video embeds survive behind an
exact-origin allowlist; author CSS does not.

Two things worth carrying forward rather than burying:

- The payload table originally written here **was wrong in a reassuring direction** — it had
  `onmouseover` and `<iframe>` as stripped, which is true only for the cases it happened to test.
  Corrected in [security.md § What was wrong](security.md#what-was-wrong).
- The linter found this (`lint/security/noDangerouslySetInnerHtml`), and the rule was deliberately
  left unsuppressed until it was really fixed. It stayed useful precisely because nobody silenced it.

---

## Q10 — Should a tooltip be hoverable? <a id="q10"></a>

Every card in the app is `pointer-events: none`, so the pointer cannot enter one: move onto it and
it closes. WCAG 2.1 § 1.4.13 asks for the opposite — hover content must stay available while the
pointer moves onto it — and while the native `title` attribute is exempt from that criterion, a card
we draw ourselves is not. The homepage masthead's three links were conforming by exemption until
2026-08-28, when they stopped being `title` attributes. Raised by ⟨Sol⟩ reviewing that change.

| Option | For | Against |
|---|---|---|
| **Leave it** | the rail is most of the tooltips in the app, and a spine card that took hover would sit on the band you are pointing at and hold itself open | a known 1.4.13 failure, worst for anyone using magnification or a large cursor, where crossing the gap is easy to do by accident |
| Hoverable everywhere | one behaviour, conforming | breaks the rail, which is the surface the tooltip was built for |
| **Per-use**: `Tooltip` takes a prop that adds `.tooltip-anchor.interactive` and a `safePolygon()` corridor | the masthead and any future prose-ish card conform; the spine keeps what it has | a second interaction mode inside a shared component, and `safePolygon` is the fiddliest part of Floating UI to get right |

**Recommendation: per-use, when something needs it.** Nothing in these three cards is worth
travelling to — no link, no button, nothing to select but a sentence and an address — so the cost
today is the standard, not the reader. The machinery already exists (`ProseHoverCard` uses
`.interactive` for real reasons), so this is a prop and a corridor rather than a design.
[tooltips.md § The pointer cannot enter a card](tooltips.md#the-pointer-cannot-enter-a-card-and-that-used-to-be-exempt)
has the detail.
