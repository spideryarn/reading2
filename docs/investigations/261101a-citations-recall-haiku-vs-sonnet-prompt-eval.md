# Citations: can Haiku 5.5 find every work, more cheaply?

2026-11-01, for queue item `qi-cypykdrn`, report `spya-d5e2jk` and Greg's answer to
[q-ns76uq](../user-feedback/questions/q-ns76uq.md). Plan:
[261101a](../plans/261101a-citations-every-work-cheaply-with-haiku.md), which has the method and
GPT Sol's review of it. Up: [investigations.md](../project/investigations.md). Builds on
[261027a](261027a-how-often-citations-are-missed.md).

> Let's run some evals on a few papers. I'm hoping we can do this with Haiku v5.5, maybe with a
> medium or higher amount of reasoning. Give it a bunch of examples of what citation formats can look
> like, and we definitely want it to find all of the citations, but I also feel like it should be able
> to do this more cheaply. I'm surprised that the model didn't find them all. I feel like that's
> probably a failure of prompting, or we need to pick a different model.
>
> — Greg, 2026-10-29 (`spya-yyvxm0`)

**In short.** Greg was right on both counts. Today's prompt *tells* the model to stop at 80 works, and
Sonnet under-lists well below that too. **Haiku 5.5 at high effort, with a prompt that asks for every
work and shows the shapes a citation takes, found more than today's Sonnet on five articles and
matched it on two, for about a sixth to a seventh of the cost.** It is not perfect: on the long
footnoted Wikipedia page its three runs ranged from 61% to 99%; none was complete. Its one-line
descriptions are a little worse than Sonnet's, and a list takes two to four minutes instead of one.
That trade-off is Greg's, so nothing ships. It goes back to him as q-ns76uq, rewritten.

**Review caveat.** The Synesthesia truth builder enumerated bracketed footnotes but not every linked
or named work. H1-2 correctly returned Nabokov's *Speak, Memory* from a body passage, but the truth
has no row for it; *The Yellow Sound* and the 14 *Further reading* entries likewise need an explicit
list-only classification. The 667-work denominator and the Synesthesia unmatched-row claim are
therefore provisional until those blocks are adjudicated and the free scorer is rerun. The block
dumps needed to rebuild that truth are intentionally outside the repository.

## What was measured

Seven articles: the six of the 261027a hand count, plus the paper Greg reported (Butlin, Long et
al., *Consciousness in AI*, arXiv 2308.08708, 251 works cited in its body). LeCun's was read from
production read-only; the rest are local. Ground truth was built from the blocks by a subagent before
any arm ran, and no model's list was used for it. It holds 667 works and reconciles with the hand
count on all six of its articles under its bracketed-note counting rule. Synesthesia has 152 note
numbers but 148 works: four pairs of notes are the same source. The truth files, their README and
the script that built them are in
[`evals/results/citations-recall/261101a-truth/`](../../evals/results/citations-recall/261101a-truth/)
and [`evals/citations-recall/build-truth.py`](../../evals/citations-recall/build-truth.py).

The request uses production's article text, schema and PDF reference-list construction. Its wire
parameters vary the model, effort, prompt (both system and user turn), and `max_tokens` (128K for the
new prompt). It also deliberately omits production's conditional article-cache breakpoint so every
eval call is cold. The runner is [`evals/citations-recall/run.ts`](../../evals/citations-recall/run.ts)
and the new prompt is [`prompt.ts`](../../evals/citations-recall/prompt.ts). The new prompt makes
three changes to `citations/7`:

- it asks for every work, keeping a hard ceiling of 300;
- it adds a section of citation shapes (semicolon and comma lists, letter suffixes, one author with
  two years, page numbers, *forthcoming*, `[3–6]`, superscripts run into the word, footnotes);
- it says to go block by block, where ten citations in a paragraph are ten rows.

Scoring is [`score.ts`](../../evals/citations-recall/score.ts). It runs each answer through
production's own `buildBibliography`, so place verification, both folds and code's author–year fill
are all applied. It then matches rows to truth one to one by maximum matching, exact edges first.
It reports three numbers:

- **model**: the folded list with no cap and without code's rows. This is what the model found.
- **@80**: what a reader gets today, with the 80 cap and code's fill.
- **@300**: the same with the new ceiling.

Cost is what OpenRouter billed per call, through `collectSpend`, cold, with no caching. The whole
eval cost **$2.95**.

## Results

Cells read **model / @300 / @80** recall, then the billed cost and the time the call took. S = Sonnet
5.5, H = Haiku 5.5. "today" is `citations/7`, "new" is the candidate prompt.

| article (works) | S0 Sonnet today | S1 Sonnet new | H1 Haiku new, medium (×2) | H2 Haiku new, **high** (×3) |
|---|---|---|---|---|
| LeCun (105) | 17/97/97 $0.14 14s | 98/98/98 $0.23 55s | 98/98/98 $0.02 ~70s | 98/98/96–98 $0.03 ~155s (×2) |
| Butlin (251) | 27/96/96 $0.30 63s | 22/96/96 $0.28 49s | 24–27/95 $0.02 ~85s | 97, 67, 96 / 100, 97, 99 / 96 $0.03–0.04 126–234s |
| Synesthesia (148) | 22/22/22 $0.13 31s | 97/97/54 $0.27 92s | 39–45/39–45 $0.01 ~75s | **99, 73, 61** / same / 48–51 $0.02 ~100s |
| Layfield (70, superscripts, PDF) | **6/6/6** $0.06 6s | 6/6/6 $0.05 5s | 99/99/99 $0.01 ~70s | 99/99/99 $0.02 82–114s |
| Dropout (36) | 97/97/97 $0.11 | 97/97/97 $0.10 | 100 $0.01 | 100 $0.01 |
| Clark & Chalmers (17) | 100 $0.05 | 100 $0.05 | 100 $0.004 | 100 $0.006 |
| Vaswani (40) | 100 $0.11 | 100 $0.11 | 100 $0.01 | 100 $0.02 |
| **all seven** | 32% / 71% / 71%, **$0.89** | 60% / 87% / 78%, $1.10 | 57–60% / 84–85%, $0.08 | 81–98% / 92–99%, **$0.12–0.14** |

Two more arms. **H0** (Haiku with today's prompt) found 47% overall, against H1's 57–60%; it did
better than H1-medium on Butlin and tied on some short articles, so the candidate prompt was not a
uniform gain by itself. **H3** (Haiku, new prompt, `xhigh`) found 99–100% on five articles. But
Synesthesia's thinking ran into the 128K output ceiling, which made the answer unusable, Butlin took
421 s, and the cost was double that of high. It is not viable as a setting.

What the table shows:

- **Removing the cap and showing citation shapes helped some formats; effort moved the long
  lists.** Haiku at medium still stopped early on the two long papers (24–45%), and so did Sonnet at
  medium on Butlin (22%, 55 rows). At high effort Haiku wrote 100 to 260 rows. A single call had
  enough room, but the wide Synesthesia spread does not rule out a second call as a reliability fix.
- **On author–year papers a reader barely notices**, because code's fill already brings LeCun and
  Butlin to 96% whatever the model does (plan 261029b). **The model matters for footnotes and
  numbers**, which code cannot read: on Synesthesia today's list has 22%, and Haiku-high has 61–99%.
- **Today's Sonnet nearly fails on superscript-numbered PDFs.** On Layfield it returned 4 raw rows,
  then 14 on a second run, out of 70; only 4 and 5 respectively survived production verification.
  It mostly listed those the prose names ("Lever and colleagues15"). Its stored list from October
  had 69. Every Haiku run with the new prompt found 69 of 70.
- **Haiku-high is not reliable on a long footnoted page.** Its three Synesthesia runs found 99%, 73%
  and 61%. Each answer ended normally (`end_turn`), well under the ceiling: the model simply stopped
  early. A union of two runs did not fix this either: 76% on the worst pair, with Butlin's rows
  doubled where the two runs named a work differently.
- **The 80 cap would throw away what Haiku finds**: Synesthesia's 99% becomes 51% at 80. Shipping
  Haiku means shipping the higher ceiling with it.
- **No fabricated citation was found in the manual read of unmatched rows.** Some are legitimate
  list-only works or duplicate rows. But the Synesthesia truth does not encode all of those classes,
  and *Speak, Memory* is a body-truth gap, so `scores.json` cannot yet support a clean false-row rate.

**The descriptions** (`why`, relevance, influence). These were compared blind: 24 pairs, the first
four shared works on each of six non-PDF articles, with sides randomised by hash, judged by Opus from
the citing passage. Layfield is absent because the pairing script did not re-read its PDF reference
list. The pairs and key are `why-pairs.json` and `why-key.json` in the results directory. The judge's
verdicts, unblinded, are in `why-judgement.md` beside them.

- **Preferred:** Sonnet 10, Haiku 6, ties 8.
- **Probable errors:** Haiku 3, Sonnet 1. Haiku named the wrong task for one Vaswani citation,
  summarised a book instead of saying what the article uses it for, and wrote "case material" that
  the passage does not support. Sonnet overstated "may be similar" as "model for".
- **Scores:** Haiku scored relevance more confidently than the passage supports in 3 cases, against
  Sonnet's 1. It also gave one confident low influence where null was safer.

So Haiku's descriptions are a little worse, not broken.

## What it would take to ship, if Greg says yes

From GPT Sol's plan review (plan § review, 4–7). Pin `bibliography` to Haiku with a model constant of
its own, used for the call, the stamp, the logs and the store's freshness check, at both powers. Use
`citations/8` with the new prompt and `MAX_CITATIONS` at 300 (`capped` still means more than that).
Set the output budget at the model's 128K: H2's longest call used 67K output tokens, including its
adaptive thinking. Run one 250-row list through `citation-blurbs` first, for its time and spend.
High-powered AI would no longer move this step, as with the other Haiku jobs. Code's fill stays as
the safety net.

## Left open

- Why Haiku-high sometimes stops early on Synesthesia, and whether a "last check" sentence or a
  second call over the notes it skipped closes it. Code could also make rows from footnote blocks,
  as `rowsFromText` does for author–year (261027a, item 4). That would make footnoted pages complete
  without trusting any model's stamina.
- Sonnet's Layfield collapse was seen on two runs of one article. Whether other superscript PDFs
  fail the same way was not measured.
- Prompt caching was off in every arm. Production caches the article, so real costs are a little lower
  for all arms alike.
