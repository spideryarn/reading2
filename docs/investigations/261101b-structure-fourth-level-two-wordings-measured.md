# Structure's fourth level: two prompt wordings measured, neither shipped

2026-11-01, for feedback `spya-pn7gvw` (Greg: *"each of them have their own section"*), queue item
`qi-negzd289`. Plan [261029a § Stage 2](../plans/261029a-structure-one-level-deeper.md). Up:
[investigations.md](../project/investigations.md).

**The question.** Can the one whole-document structure call (Sonnet 5.5, effort `low`, strict
schema) make an optional fourth level, sub-sections, where the author's sub-headings divide a
section, without losing what the three-level tree does today, at under ~20% more cost and time for
the median article?

**Followed up the same day**: Greg suggested doing it in stages, and a staged second pass passed
every gate and shipped — [261101c](261101c-structure-fourth-level-staged-measured.md). The
one-call prompt below stays `toc/13`.

**The answer, for now: the cost is no obstacle, the reliability is.** Both wordings made the level
on the report's paper. Both also left one article with **no sections at all**, in both runs, where
the old prompt gave 6–30. So the live prompt stays `toc/13`; what to try next is Greg's call
([q-k25zfg](../user-feedback/questions/q-k25zfg.md)).

## How it was measured

[`evals/structure-fourth-level/`](../../evals/structure-fourth-level/run.ts) calls production's own
`wholeDocumentRequest`, parser and builder, with production's one re-ask, on 14 of Greg's own
production articles, read once, read-only (blocks kept in gitignored `data/`). The set is the
report's paper, the Rovelli book (1,123 blocks), six articles with sub-headed sections and six
without (`corpus.ts`). There were two runs per arm, separated in time: `before-*` on 087a9b260
(`toc/13`), then each wording on its own commit. `report.ts` rebuilds every tree from its saved
answer and re-scores all arms alike. It gates quality before money: the paper's hand-checked shape;
no invented split in a section under 10 blocks; no rise in failures, re-asks or dropped children;
no article left with under half the control's sections in every run. GPT Sol's plan review
([261029a-stage2-plan-review-sol.md](../plans/261029a-stage2-plan-review-sol.md)) shaped the gates.
The last of them was added after the first report missed exactly that failure. **$10.24 in all,
seven runs.** The numbers are in `evals/results/structure-fourth-level/`; the wordings are kept
verbatim in [`wordings.ts`](../../evals/structure-fourth-level/wordings.ts).

## What came back

Parts / sections / sub-sections, two runs each:

| article | toc/13 | wording 1 | wording 2 |
|---|---|---|---|
| the paper (h2/h3/h4) | 6/31/0 · 6/28/0 | 6/16/21 · 6/16/**4** | 7/23/30 · 7/16/21 |
| Rovelli book | 7/14/0 · 7/21/0 | 8/14/24 · 6/21/0 | 7/17/29 · 6/13/0 |
| arxiv-2602-11988 (unnumbered h4s) | 13/6/0 · 12/30/0 | 9/21/0 · 9/21/0 | 8/**0**/0 · 9/**0**/0 |
| 2607-22753 | 11/20/0 · 9/28/0 | 10/**0**/0 · 8/**0**/0 | 10/21/0 · 10/24/0 |
| s41593 | 6/26/0 · 6/28/0 | 6/25/0 · 8/26/15 | 6/25/5 · 10/25/0 |
| dhp (h2 only) | 8/20/0 · 6/17/0 | 7/10/0 · 7/17/0 | 7/9/0 · 7/13/0 |

- **Cost and time are fine.** Under wording 2 the median article moved +3% in cost and +1% in time.
  The control's own spread was 2% and 9%. On the paper it was +12% and +69% (20 s → 34 s), because
  it writes twice the output; the book moved +7% and +50%.
- **The paper passes under wording 2 in both runs.** 2.4.1–2.4.6 are sub-sections of 2.4, 2.5 is
  2.4's sibling, and the mis-tagged `h2` "2.4.5(a)–(c)" are not promoted. Swallowed headings fell
  129 → 118 across the corpus.
- **Wording 1** ("in two cases only… most sections have none… the one place a heading does not begin
  a node") lost the section level on 2607-22753 in both runs. It made sub-sections for 43 of 340
  next-level author sub-headings.
- **Wording 2** (Opus's: map heading levels onto depths, numbering before tags, sections "exactly as
  before", a divided section in the OUTPUT example) fixed that article. It lost the section level on
  arxiv-2602-11988 instead, whose h4s are unnumbered run-in headings under numbered h3s. It made 61
  of 266 sub-headings, and h2-only articles came out somewhat coarser (dhp 20/17 → 9/13 sections).
- **The model does not think on this call**: 0 reasoning tokens in every run of every arm, `toc/13`
  included. The diagnosis (Opus) is that without thinking, general-sounding cautions about depth 3
  leak into depth 2, and the schema's optional `children` on a part makes "no sections" always a
  valid answer.

## What was decided, and what was ruled out

- **Not shipped.** A prompt that empties one article in fourteen of its sections, reliably, is a
  regression a reader sees, for a gain on perhaps a third of articles. `src/structure.ts` is
  `toc/13` again, byte for byte (the parity pin is unchanged).
- **Kept**: the run counts. Every structure run now logs `subsections`, `deepenedSections` and
  `swallowedHeadings` ([`src/structure-depth.ts`](../../src/structure-depth.ts)), so the next
  wording is watched from its first production run. The harness, the gates and both wordings are
  kept too.
- **Not tried: a third wording on these 14 articles.** It would be fitting the prompt to its own
  test set. The next attempt needs a fresh held-out sample whichever lever it pulls.
- **The levers left**, for Greg ([q-k25zfg](../user-feedback/questions/q-k25zfg.md)): a third
  wording measured on held-out articles (~$8); letting this one call think (`medium` effort, a
  measured cost and time rise, untested here); making sub-sections from the author's headings in
  code, which the plan passed over because every node needs a model gist; or stopping at three
  levels.
