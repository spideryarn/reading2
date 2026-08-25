# A prioritised order for the glossary

**2026-08-26.** The glossary panel ([glossary.md](../project/glossary.md)) lists the terms an article
uses in a non-obvious way. Until today it could be ordered three ways: **first use** (document order,
the default and what the artefact stores), **hardest** (the model's `difficulty`, 0–1) and **most
central** (the model's `centrality`, 0–1).

Greg asked for a fourth, and for it to become the default:

> for the Glossary, let's add a "Prioritised" order (that should be the default) that somehow takes
> into account importance, centrality, and order. Perhaps it's a combination of important and
> centrality and first-order appearance? Or combination of importance and centrality, thresholded
> somehow, then ordered by first-appearance?
>
> — Greg, 2026-08-26

Two sketches in that, and they are genuinely different: a **blend**, or a **gate**. This doc is the
argument for the gate, the four designs it was chosen from, and the two things it is a bet on.

Fable was asked for ideas and tradeoffs before anything was built; the interaction question below is
its finding, and the recommendation is largely its design D. Where this doc departs from it, it says so.

## The question that decides everything else: do the two scores pull the same way?

**No, and this is the whole design.** The quantity worth ordering by is not "importance" — it is
**what it costs the reader not to know this term**, which is two things multiplied:

```
how likely this term is to stop me   ×   how much of the argument is blocked when it does
        = difficulty                                = centrality
```

A **sum** gets both failure cases wrong, in opposite directions:

- *Very central, very easy* — "attention" in a paper about attention, `centrality 0.9`,
  `difficulty 0.1`. A sum ranks it high. But the reader already knows the word; there is nothing to
  prioritise. It is high-scoring and useless.
- *Very hard, very peripheral* — a piece of jargon dropped once in an aside, `difficulty 0.9`,
  `centrality 0.1`. A sum ranks it high too, and this one is worse than useless: it is the
  distraction, promoted to the top of a list whose whole job is to say what to attend to.

A **product** sends both of those to the bottom and lets through only the terms that are hard **and**
load-bearing, which is what "prioritised" ought to mean. `max` is worse than either. So: product.

**But a product of two noisy 0–1 model scores should group, not rank.** Models emit clumped scores —
lots of 0.6, 0.7, 0.8 — so a continuous composite manufactures thirty distinctions the data does not
contain, and the tie-break ends up doing most of the actual sorting. Use the product for the one
decision it can carry: **in, or out**.

## The four designs

### A — weighted blend (Greg's first sketch). Rejected.

`priority = 0.6·centrality + 0.4·difficulty`, descending, document-order tie-break, optionally minus
a small bonus for appearing early.

Rejected for three reasons, and the first is fatal:

1. **There is no honest number to put on the row.** The house condition on these scores is that
   whichever number the list is ordered by is shown ([glossary.md § The
   scores](../project/glossary.md#the-scores-and-the-condition-attached-to-keeping-them)). `0.68` is
   *our arithmetic dressed as the model's judgment* — a number the reader cannot interpret and cannot
   check. Showing the two components instead is honest but then the visible numbers do not explain
   the order: `0.9/0.2` beats `0.5/0.6` and nothing on screen says why.
2. It is a sum, so it has both failure cases above.
3. It degrades badly. An entry with one score present needs the weights renormalised, which changes
   what the number means from row to row.

### B — threshold on either score, then document order (Greg's second sketch). Close.

`centrality ≥ 0.5 OR difficulty ≥ 0.6` floats to the top, document order within each group.

Right shape, wrong gate. The `OR` readmits the hard-but-peripheral distraction — that is precisely
the entry an `OR` is built to let through. And a threshold with no visible divider is a silent
judgment, which is the thing the condition on these scores forbids.

### C — rank by expected cost. Rejected.

Sort descending by `difficulty × centrality`, full ranking, composite shown on each row. The right
quantity at the wrong resolution: it ranks the noisy middle as confidently as it ranks the clear top,
and it has design A's dishonest number.

### D — product-gated tiers, first use within each. **Chosen.**

Two groups, with a visible labelled divider between them:

- **Worth knowing first** — every entry where `difficulty × centrality ≥ 0.30`, in **first-use order**.
- **The rest** — everything else, including every entry missing either score, in **first-use order**.

`0.30` is about `0.6 × 0.5`: the model called it more than half load-bearing and more than half
likely to stop you. On a 20–40 term list it promotes roughly the top third.

Every row in this mode shows **both raw scores** — `d 0.80 · c 0.60`, the model's actual outputs —
and the divider states the rule in a sentence.

**Why this beats both of Greg's sketches:** it uses the scores only for the decision they can
support, and it keeps the reader's own order — first use — as the order *everywhere*, so inside a
group the model has chosen nothing. It is the gentlest possible ranked default. And it is Greg's
second sketch, with the `OR` replaced by the product.

## What "prioritised" does when the scores are not there

Falls back to exactly today's behaviour, with nothing said about it:

- Entries missing **either** score cannot pass the gate and sit in the lower group — never scored as
  zero, which is the existing rule and the reason it exists: *an entry the model declined to score is
  not one it scored as trivial.*
- If **nothing** passes the gate, or if **everything** does, the list is one group in document order —
  identical output to `first use`, so no divider is drawn.
- **The control is offered only when the gate actually splits the list.** Not merely "when scores
  exist" — SortBar already refuses to offer a sort that would silently do nothing, and this is the
  same rule one step further on. When it is not offered, the default falls back to `document` and
  `first use` shows as the selected order, which is true.

Old glossaries with no scores at all therefore see no change whatsoever.

## The absolute gate, and why not a relative one

The strongest objection to D is that **`0.30` is a guess with no feedback loop**. If the model's
scores run hot the top group swallows the list; if cold, almost nothing is promoted. A relative gate
— top third by product — is self-calibrating and avoids that.

We took the absolute one anyway, because the two fail in very different directions:

| | when it misfires |
|---|---|
| **absolute gate** | degenerates to one group — i.e. to plain first-use order, today's default |
| **relative gate** | always promotes exactly a third, even when the scores say nothing distinguishes them |

The absolute gate's failure mode is *doing nothing*. The relative gate's failure mode is
**inventing a ranking that is not in the data** and putting a confident label over it — which is the
exact failure this feature has been shaped to avoid since the review of the version it was borrowed
from. `PRIORITY_GATE` is one exported constant, and it is meant to be adjusted once we have looked at
real glossaries.

The one real glossary we have, `data/writes` (Paul Graham, *Writes and Write-Nots*), promotes **two
of eight**:

| term | difficulty | centrality | product | |
|---|---|---|---|---|
| writes and write-nots | 0.50 | 1.00 | **0.50** | in |
| Leslie Lamport | 0.60 | 0.50 | **0.30** | in, exactly on the line |
| writing is thinking | 0.30 | 0.90 | 0.27 | out |
| Martin Luther King Jr. | 0.40 | 0.20 | 0.08 | out |
| escape valve | 0.20 | 0.40 | 0.08 | out |
| John F. Kennedy | 0.30 | 0.20 | 0.06 | out |
| boilerplate | 0.15 | 0.25 | 0.04 | out |
| blacksmithing | 0.10 | 0.30 | 0.03 | out |

**"writing is thinking" falling just outside is the design working, not misfiring.** It is the
article's thesis and the model scored it `centrality 0.90` — a sum would put it second. It is also
`difficulty 0.30`: the model is saying a reader will not be stopped by it. A term you already
understand does not need to be told to you first, however central it is, and that is the whole
argument for the product in one row.

## Does defaulting to this contradict the vision?

In the letter, yes, and it is worth saying so plainly rather than arguing it away. Our own review of
the original version said to drop these scores because *"here are the important terms, ranked by how
important we think they are"* is the model doing the reader's prioritising, which
[vision.md](../project/vision.md#principles) is against. Greg overrode that on 2026-08-25 with a
condition — **keep them, never sort by them silently** — and a default ranked order is, in the
letter, sorting by them unasked.

The recorded objection was to **silence**, not to ranking, and the principle's owner is asking for
this. So it is an override, of the same kind as the two in
[AGENTS.md](../../AGENTS.md) — recorded, dated, in his words, with the conditions that keep it in the
spirit of what it overrides:

- the order control shows **prioritised** as selected — it is a visible state, not a hidden default;
- the divider **names the rule** that promoted the group above it;
- **both scores are on every row** in this mode;
- **first use is one tap away**, and inside a group it is still the order.

## Deliberately not in this version

**Occurrence count.** `blocks` gives us frequency and spread for free, and it is tempting as a third
ingredient. It is left out: it correlates with centrality — the model read the same text we counted —
so it mostly adds noise, and using it as a tie-break would break the property that inside a group the
list is in the reader's own order. Revisit only if the gate is seen to misfire.

**Position as a weight.** Greg's first sketch had first-appearance as a term in the arithmetic. Here
it is the *order*, which is a stronger form of the same idea and costs no explaining.

## Not checked in a browser

**This landed without a visual check**, and that is worth writing down rather than leaving for
somebody to discover. No Chrome extension was connected to the session, so the two things a browser
would have caught are still unverified:

- whether the sticky group headings actually stick and are opaque while the list scrolls — the
  failure that [browser-testing.md](../project/browser-testing.md) says looks fine in the CSS and
  wrong on the screen;
- whether a long term name plus **two** numbers fits one line in an 18rem band. `min-width: 0` on
  `.gloss-name` and `flex-shrink: 0` on `.gloss-score` mean it degrades by wrapping the name rather
  than overflowing the band, which is the right way round, but "degrades correctly" is not "looks
  right".

Everything else is covered by [`tests/glossary.test.ts`](../../tests/glossary.test.ts), which is
where the actual decisions live. Both of the above are one look away for whoever is next in this
file with a browser attached.

## The two things this is a bet on

1. **The threshold is untuned.** Stated above. One constant, one line, and it needs looking at against
   a real glossary or two.
2. **Two groups may be too coarse to feel like "prioritised".** A reader who expects the single
   hardest, most central term to be *first* will instead find it wherever the article first uses it,
   possibly at the bottom of the top group. If that is Greg's mental model, design C is closer to what
   he meant. The bet is that a glossary read before or during the article is read in article order
   anyway, and that the useful question is *which of these do I need* rather than *which is worst*.

## What changed

| File | What |
|---|---|
| [`src/web/params.ts`](../../src/web/params.ts) | `prioritised` joins `TERM_SORTS`; it is the parser's default |
| [`src/web/GlossaryPanel.tsx`](../../src/web/GlossaryPanel.tsx) | `priorityOf`, `splitsOnPriority`, `groupEntries`, `rowScores`; the panel renders groups |
| [`src/web/styles.css`](../../src/web/styles.css) | `.gloss-group-head`, and a score cell that holds two numbers |
| [`tests/glossary.test.ts`](../../tests/glossary.test.ts) | the gate, the fallbacks, the two-score row |
| [glossary.md](../project/glossary.md) | § The scores, rewritten around the new default |
| [url-state.md](../project/url-state.md) | `?sort=` — what its absence now means |

The artefact is untouched. `glossary.json` still stores document order, all of this is client-side and
pure, and [glossary.md § Four ways to break this
quietly](../project/glossary.md#four-ways-to-break-this-quietly) item 2 — *do not sort the entries in
the artefact* — is unaffected and still stands.

## See also

- [glossary.md](../project/glossary.md) — the feature, and the two bugs it is shaped around
- [original-version/glossary.md](../project/original-version/glossary.md) — where the scores came
  from, and the review that said to drop them
- [url-state.md](../project/url-state.md) — `?sort=` and why it pushes history
- [vision.md § Principles](../project/vision.md#principles) — the principle this override is against
