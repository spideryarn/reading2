# Citations — every work the piece cites, with a link out

A mode in the band between the spine and the prose. It answers *what does this piece lean on, and
where do I find it*: the works the article cites — through a bibliography, footnotes, or a name in
running text — each with a link. Asked for through the Feedback button on 2026-09-11
(SPIDERYARN-READING2-2Y):

> Add a Citations mode that looks at citations and looks at the bibliography and references and
> provides, you know, a link to all of them. And you can either order them by when they appear in the
> text, or how relevant they are, or how influential, or a prioritized score. (the default, with
> threshold bar, kinda like Glossary etc)

The design, the review that reshaped it and the real runs are
[260911g-citations-mode.md](../plans/260911g-citations-mode.md). This page says what is built.

## A row

The title — a link out, opening a new tab ([links.md](links.md)) — then authors · year as the article
gives them, one plain sentence on *what the piece uses it for*, and a quiet line: relevance and influence as two small bars (the numbers in their tooltip, as in the glossary),
where the link came from, and **first cited**, a jump to the passage
([`BlockRef`](../../src/web/BlockRef.tsx)). A work the article names only in its bibliography says
*only in the references* and jumps there.

## The one safety property

**Every address a row presents as the work's own was in the article, and code found it.** The model
never writes a URL we keep: a DOI or arXiv id in the reference's text or hrefs, else one of the
article's own anchors whose text is the title or the mention, else — and on every ambiguity — a
**Google Scholar search**. `linkFor` in [`src/citations.ts`](../../src/citations.ts) is the order;
the plan says why a link to the wrong work is worse than a search.

The row always says which. An address shows its host and its rule (*doi.org · DOI in the article*); a
search is drawn as a search — the title is not a link, and the one link says *search Scholar*.
`sourceOf` in [`CitationsPanel.tsx`](../../src/web/CitationsPanel.tsx) is total over `linkFrom`.

## The orders, and the bar

Four, under the glossary's order buttons ([glossary.md](glossary.md)):

- **prioritised**, the default — `(2 × relevance + influence) / 3` against the threshold bar, in
  first-cited order. A work missing a score survives every position of the bar
  ([`threshold.ts`](../../src/web/threshold.ts)), and the line under it says how many are hidden. The
  bar starts at **0.40**, set from the stage-1 runs (the plan's Progress). Falls back to first cited
  when no position of the bar would hide anything.
- **first cited** — the artefact's own order.
- **relevance**, **influence** — descending, a work missing that score last.

Only the two raw scores are drawn on a row, never the combination — the glossary's rule. The foot
says `influence` is the model's memory, not a citation count, and, **only when the model reported
it**, that the list was capped at 80.

**The URL keys are `?citeby=` and `?citebar=`, not the glossary's `sort` and `gate`.** Every
parameter survives a mode switch, and `Reader` reads `?gate=` in every mode to reveal a glossary
term from the prose, so a shared key would carry a citations bar into the Glossary as its threshold.
[url-state.md](url-state.md) has the rows.

## Who sees it

Owner-only, and behind the [experimental switch](experimental-features.md). A visitor gets the
explanatory band — the public projection its rows' URLs would pass through is not built.

## Deferred

*Find it on the web* for a searched row (the plan's stage 3); selecting a work to mark every passage
that cites it (`?cite=`); *Find more* past the cap; real influence from a citation database; a
visitor's list; marks in the prose. Each is in the plan's list of what is deliberately not built,
with the reason.

## The code

[`src/citations.ts`](../../src/citations.ts) (the stage) ·
[`useCitations.ts`](../../src/web/useCitations.ts) ·
[`CitationsPanel.tsx`](../../src/web/CitationsPanel.tsx) ·
[`CitationsMode.tsx`](../../src/web/modes/citations/CitationsMode.tsx) ·
[`citations.css`](../../src/web/styles/citations.css).

---

Up: [reading-view-overview.md](reading-view-overview.md)
