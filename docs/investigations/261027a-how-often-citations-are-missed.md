# How often the citations list misses a work the article cites

2026-10-27, for report `spya-ez2vus` and plan
[261027b](../plans/261027b-citations-missed-in-the-text-filled-by-code.md). Production was only
read: the reported article's blocks, its stored list, its stored PDF and the step's log line.
Everything else ran against the local stack. No model was called (the box's OpenRouter key is over
its limit until 2026-11-01). The hand count's full tables and missed lists are
[`evals/results/citations-recall/261027a-hand-count.md`](../../evals/results/citations-recall/261027a-hand-count.md)
(and `.json`). What code would add is
[`scripts/spikes/261027a-citations-filled-from-text.ts`](../../scripts/spikes/261027a-citations-filled-from-text.ts).

Up: [investigations.md](../project/investigations.md).

## What was asked

> Why didn't it notice the citation for Levine 2021 in this paragraph? I feel like citations often
> seem to miss stuff.
>
> — Greg, 2026-10-26

Two questions, then. Why was that one missed, and how often does this happen?

## Levine 2021

The paragraph `spya-g9ssef` cites three works: *(Craik, 1943)*, *(Bryson and Ho, 1969)* and *(see
for example (Levine, 2021))*. The list has rows for the first two and nothing for Levine.

Production's log line for the run that made the list (2026-10-26 21:45 UTC, job `spya-t5kmwd`,
`claude-sonnet-5-5`, `citations/6`) settles which stage lost it: `works: 23`, `capped: false`,
2,777 output tokens, and **every drop counter at zero**. That means no place failed verification,
no row was merged, and nothing was cut at the cap. **The model returned 23 works and Levine was not
one of them.** Nothing in code dropped it, and nothing in code could see it was missing. The
coverage witness counts notes and reference-list blocks reached, and a PDF made into an article
has neither: `notes: 0, references: 0`.

The same line said `referenceList: "found", referenceListEntries: 9`, which was a second fault.
LeCun's reference list is author–year, so it has no numbers. Reading the stored PDF locally
reproduced it. The first numbered run after the `References` heading is the appendix's Table 1, ten
rows of loss functions (*"1 Max Likelihood discrete y exhaustive …"*). The model was sent nine of
them, introduced as *"Its numbered reference list is not among the blocks, so here it is"*.
Whether that pushed it towards a short answer cannot be measured until model calls are possible
again.

## How often: a careful hand count

A subagent counted every distinct work cited in the body of six articles. A script proposed
candidates, and the subagent read every candidate block to drop false ones and add what the script
missed. It then checked each work against the stored rows. Per article:

| Article | Citation style | Works cited | Listed | Recall | `capped` |
|---|---|---|---|---|---|
| LeCun, *Path Towards AMI* (PDF) | author–year, no list in the blocks | 105 | 23 | **22%** | false |
| Srivastava et al., *Dropout* (JMLR) | author–year | 36 | 36 | 100% | false |
| Vaswani et al., *Attention* (arXiv) | numbered `[n]` | 40 | 40 | 100% | false |
| Layfield et al. (Sci Rep) | superscript numbers | 70 | 69 | 99% | false |
| Clark & Chalmers 1998 | author–year and footnotes | 17 | 17 | 100% | false |
| *Synesthesia* (Wikipedia) | numbered footnotes | 152 | 42 | **28%** | true |

What it shows:

- **Misses follow how many works the article cites, not its style or the cap.** Every article
  citing 70 or fewer works scored 99–100%. Both articles citing more than 100 scored 22–28%. The
  model said `capped: false` over 23 of 105, and `capped: true` over 44 of 152, so its own flag
  is no guide. Neither list reached 80, so the cap was never what cut them.
- **Within a long article, dense paragraphs lose the most.** In LeCun's related-work section
  (blocks 326–354), 8 of 71 works were listed. The five paragraphs that each first-cite five or
  more works listed 1 of their 33. One fourteen-work parenthesis yielded one row.
- **On Wikipedia, sources that look scholarly survive.** Footnotes with a DOI, PMID or ISBN were
  listed 37 times in 80. Web and news footnotes were listed 5 times in 72.

So Greg's *"often seem to miss stuff"* is right for long articles, and wrong for the rest. On
anything citing fewer than about 70 works the list was close to complete.

## What code can recover now, without a model

[`src/citation-author-year.ts`](../../src/citation-author-year.ts) reads author–year citations in
the body. The plan's `rowsFromText` adds a row for each one no model row stands for. Run over every
local article's stored list:

| Article | Model's rows | Author–year works in the body | Rows code adds |
|---|---|---|---|
| LeCun (production) | 23 | 103 | 78 |
| arXiv 2308.08708 | 66 | 194 | 136 |
| NIHMS 536461 | 76 | 183 | 115 |
| *Antikythera mechanism* (Wikipedia) | 79 | 5 | 2 |
| *Dropout* (JMLR) | 35 | 30 | 1 |
| *The Scaling Hypothesis* | 58 | 6 | 1 |
| the other fourteen | — | 0–11 | 0 |

**Against the hand count on LeCun, code fills 79 of the 82 missed works and adds nothing that is
not a real citation.** The three it leaves out are left out by design:

- *Chen et al. 2020b* and *Lake et al. 2017b* sit beside a model row for the same first author and
  year with no letter. One row covers both, which risks a missed work rather than a duplicate.
- *Hénaff et al. 2019* and *Henaff et al. 2019* are two works with one key once accents are
  folded, so they share one row.

Two kinds of false hit turned up during the measurement, and each now has a test:

- **Reference entries the extraction did not mark.** A Wikipedia *Further reading* line such as
  `Russo, Lucio (2004). The Forgotten…` was read as a citation of `Lucio`. A line that starts with
  names, then `(year).` and then a title, is now treated as an entry.
- **A title written before its year.** Examples are `Voyelles (1871)`, `The Woman Who Tried to Be
  Normal (2018)` and `Mental Disorders IV (1994)`. A lone narrative name now counts only in an
  article that also cites author–year in the stronger forms at least three times. A surname must
  also have a lowercase letter.

Numbered and footnote citations (Vaswani, Layfield, Synesthesia) get nothing from this. The
Wikipedia miss, 110 of 152, is untouched, and is the next thing to fix.

## What is left, and needs a model

Each of these waits for model calls (2026-11-01). Each is a before-and-after on the same six
articles, recall counted the way the hand count did it.

1. **Did the bogus reference list matter?** Re-run LeCun's list with and without the nine table rows
   (the fix now refuses them) and compare how many works the model names.
2. **Give the model the parser's list as a checklist**, so the rows code adds become rows the model
   describes, with a `why` and scores. Code's rows then remain only as the safety net.
3. **Split a long article**, so that no single call has to name 150 works. This is the only lever
   that reaches numbered and footnote articles like Synesthesia.
4. **Footnoted articles.** A note the list did not reach is already counted (`notes` against
   `notesReached`). A row could be made from the note's own text, as `rowsFromText` does for
   author–year, if (3) does not close the gap.
