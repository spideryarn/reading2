# A glossary underline fades with each repeat of its term

Report `spya-htsjmf` (#701, admin, 2026-10-24), on `arxiv-2308-08708-spya-xax6v4`:

> In this article, there's a few glossary terms that just show up over and over and over again.
> Consciousness is one. Indicator properties, I think, is another. And it gets quite distracting
> after a while to see the little orange dotted lines everywhere for the same word. I wonder if we
> could have some kind of function that drops off the prominence eventually towards zero after
> repeated examples of a given glossary term. So by the time consciousness has appeared five or ten
> times, it should basically not need an orange dotted line. Now it's possible someone skimmed to
> the bottom and is seeing it for the first time, but I think that's a pretty unlikely case, and we
> can accept that so it goes. […] maybe the first, I don't know, half dozen examples get an orange
> dotted line, which fades according to a function you choose. And, you know, maybe even half dozen
> is too many, so maybe it should be a smooth function.
>
> — Greg, 2026-10-24

## What changes

Each glossary term's occurrences are counted **in document order**, per entry (an alias is the same
entry), and the n-th one's dotted rule is drawn at a fraction of today's strength:

```
prominence(n) = 1 / (1 + ((n − 1) / 3)³)        n = 1, 2, 3, …

n:          1     2     3     4     5     6     8     10    15
prominence: 1.00  0.96  0.77  0.50  0.30  0.18  0.07  0.04  0.01
```

The rule's colour is today's `--highlight` at 70%, times that number. So the fourth time a term
appears it is at half, the sixth barely there, and by the eighth it is gone to the eye.

### Why this function

- **A plateau, then a fall, not a fall from the start.** The first two or three occurrences are
  doing the teaching — *this word has a card* — and a reader can miss the first one (in a heading,
  a caption, a sentence they skimmed). An exponential (`0.7ⁿ⁻¹`) is the obvious one-parameter
  choice and takes 30% off the *second* occurrence; this one takes 4%.
- **Smooth, with no cliff.** Greg asked for a smooth function rather than "the first six". A cutoff
  at six would make the seventh occurrence vanish next to a sixth that is still clearly drawn; here
  neighbours differ by at most 0.27 (the third to the fourth), and the tail approaches zero rather than stopping.
- **Lands where he said.** Half at the fourth, under a third at the fifth, under a tenth by the
  eighth: "basically not need an orange dotted line" by five-to-ten. One constant says where the
  half point is (3, i.e. the fourth occurrence) and one how steep (the cube), both named in code.

### What stays

- **The mark is still there.** A faded term keeps its `<mark>`, its `help` cursor and its hover
  card, and **hover restores the full rule** (`mark.term:hover` already sets its own colour). So
  the skim-to-the-bottom reader Greg mentions loses the hint, not the card.
- **Pressed and armed terms are drawn in full**: `[data-term-open]` and `[data-hover-tap]` set
  their own colour, which wins.
- **A comment or a chat over a term keeps its own underline at full.** They share one `<mark>` and
  one `border-bottom`, so a run that carries either writes no `--term-a` (Sol's plan review, F1:
  the plan first said "unchanged", and it would have faded the reader's own clickable mark).

### Folded front and back matter does not count

The abstract is folded to a stub on arrival ([front-and-back-matter.md](../project/front-and-back-matter.md)),
and an arXiv abstract is exactly where *consciousness* turns up two or three times. Counted, the
reader would meet the term in the body already at half. So occurrences inside a matter stretch
neither count nor fade: they are drawn as today, and the body's first occurrence is the first.
`TableView` already holds the stretches (`matterStretches`) before it computes `termMarks`, so this
is one extra argument. **The masthead's echo is in the set too** (Sol F2): those rows stay in
`article.blocks` but are never drawn, so a title that names the term would otherwise spend the
body's first occurrence.

## Where

- `termMarks` (`src/web/annotate.ts`) takes the matter block ids, counts per entry across
  `article.blocks` in order, and puts `prominence` on each term `Mark` (term marks only).
- `annotateHtml` writes it as `--term-a` in the mark's `style`, the `--hit-a` / `--quote-a`
  pattern: a number, not a colour, so the colour stays the token's. Where two terms share a run the
  **larger** wins (the same rule as `strength`). Written only below 1, so the common case adds no
  bytes. The `style` array is hoisted out of the hit branch so a term-only run can carry it.
- `mark.term` in `styles/annotations.css`: `calc(70% * var(--term-a, 1))` in the existing
  `color-mix`.
- `glossary.md § The underline is always there` gets a paragraph and Greg's words.

## Passed over

- **Fading by what the reader has read** (reading-time data). Greg said so himself: not worth it.
- **Per block rather than per occurrence** — two occurrences in one sentence would both be full.
  Per occurrence is simpler to state and is what "appeared five or ten times" means.
- **Dropping the mark entirely past n.** Loses the card and is a cliff.
- **Making it a reader setting.** Nobody asked; add it if a reader does.

## Review

GPT Sol on the plan: [261024s-glossary-fade-plan-review-sol.md](261024s-glossary-fade-plan-review-sol.md).
F1 (comment faded) and F2 (echo counted) fixed as above, each with a test; F3's `quote-fill.test.ts`
parser now reads `calc(70% * var(--term-a, 1))` as 70%; F4's wrong "a quarter" corrected. The
browser check (Playwright, local `love-spya-kwm06n`, a term met five times) read the computed
`border-bottom-color` alpha as 0.70, 0.67, 0.54, 0.35, 0.21, and 0.90 on hover:
[261024s-shot-1-fade-1440.png](261024s-shot-1-fade-1440.png).

## Tests

`tests/annotate.test.ts`: prominence falls in document order per entry and not across entries; a
matter block neither counts nor fades; the n=1 run writes no `--term-a`; two terms on one run take
the larger. Written first and seen red.
