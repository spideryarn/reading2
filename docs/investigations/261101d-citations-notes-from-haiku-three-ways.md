# Citations: can Haiku's notes on each work match Sonnet's? Three tries

2026-11-01, stage 2 of [plan 261101c](../plans/261101c-citations-list-on-haiku-and-better-notes.md),
for Greg's answer to [q-ns76uq](../user-feedback/questions/q-ns76uq.md). Up:
[investigations.md](../project/investigations.md). Follows
[261101a](261101a-citations-recall-haiku-vs-sonnet-prompt-eval.md), which found Haiku's notes "a
little worse".

> Okay, I'm leaning towards A, but I'm wondering if we can split this into two stages. PMaybe Haiku
> to find them all, and then try some experiments to see if you can make this work better with Haiku
> to improve the notes.
>
> — Greg, 2026-11-01 (`spya-mgvawf`)

**In short.** Nothing ships from this stage. Stage 1 (Haiku finds every work) is live on `dev`, and
its notes stay as they are. Two ideas were tried:

- **A better notes section in the one call (N1)** reduced Opus-counted errors 9 → 2 and relevance
  slips 5 → 1 under the Opus judge. But it **cost recall**: one run failed outright, and
  Synesthesia fell to 38%.
- **A second Haiku pass that writes only the notes (N2)** keeps recall by construction, costs about
  $0.07 more for seven papers, and fixed relevance (0 slips). In the raw tally it **met the
  preference threshold** (Opus 16 : 15, Sol 21 : 15), but had more errors (Opus 9 : 4, Sol 20 : 19)
  and lost the held-out half (Opus 4 : 10, Sol 6 : 10). The error comparison is not a fair gate,
  though: N2 could write from two passages while each judge saw only one, and six of Opus's nine
  errors assert something in another passage the pass was shown.

The rule fixed before the runs required an arm to show, under both judges, that it was preferred as
often as Sonnet and had no more errors. N2 meets the first half but has not established the second.
Under that pre-declared rule, an arm that has not established every condition does not ship.

## What "the notes" are, and how they were judged

Each row of the citations list has a `why` (one sentence: what this article uses the work for) and a
`relevance` score. `influence` was not judged: it cannot be judged from the citing passage.

- **A frozen sample**: 48 works, eight per article on the six non-PDF test papers, chosen in the
  truth's order before any stage-2 arm ran, from works both today's Sonnet list (S0-1) and stage 1's
  list (P-2) describe ([`manifest.json`](../../evals/results/citations-recall/261101c/manifest.json),
  [`notes-pairs.ts`](../../evals/citations-recall/notes-pairs.ts)). Every arm is judged on exactly
  these. A work an arm has no note for is still a pair, scored as a loss and an error. The first
  four per article were 261101a's 24 pairs, which informed N1's rules, so each tally is also read on
  the other 24 alone ("held-out").
- **Two blind judges**: an Opus subagent and GPT Sol, each judging every arm against Sonnet's note
  for the same work. Each saw only the manifest's one citing passage and two shuffled sides. A fresh
  judge was used for each arm. That is matched evidence for N0 and N1, which wrote in the article
  call, but not for N2, whose separate pass could see two passages.
- **Per pair**: which `why` is better, whether each side has an error (contradicts the passage,
  names the wrong use, summarises the work instead of its use, or asserts something specific the
  passage does not support), and whether each side's relevance is clearly off.
- Sol is a much stricter error-finder than Opus: it marks roughly 40% of *both* sides as errors.
  So compare its error counts between sides, not with Opus's.

## Results

Cells read **arm : Sonnet**, over all 48 pairs. The held-out 24 are in brackets where they differ in
direction. These are the raw blind tallies; N2's error counts have the evidence mismatch above.

| arm | what it is | recall (reader, 300) | Opus: preferred · errors · relevance off | Sol: preferred · errors · relevance off |
|---|---|---|---|---|
| N0 (P-2) | stage 1 as shipped | 99% | 8 : 14 · 9 : 3 · 5 : 0 | 20 : 17 · 20 : 19 · 7 : 3 |
| N1-2 | rules in the one call | 98% (N1-1: 80%, one failed) | 10 : 14 · 2 : 1 · 1 : 1 | 15 : 16 · 21 : 18 · 3 : 5 |
| N2-3 | a notes-only second pass | 99% (unchanged) | **16 : 15** · 9 : 4 · 0 : 0 (held-out 4 : 10) | **21 : 15** · 20 : 19 · 0 : 4 (held-out 6 : 10) |

Verdicts and keys are in
[`evals/results/citations-recall/261101c/`](../../evals/results/citations-recall/261101c/):
`<arm>-vs-S0-1-pairs.json` is what the judges saw, `-key.json` unblinds it, and `-opus.json` and
`-sol.json` hold each judge's verdicts with a reason per pair.

### N1: a better notes section, inside the finding call

[`notes-prompt.ts`](../../evals/citations-recall/notes-prompt.ts) replaces only the `why` and
`relevance` instructions in production's `citations/8`. It says to write from the sentence that
cites the work and add nothing it does not say, and gives two good and two bad examples (invented,
not from any test paper). It also says that in a long list most works are 0.1 to 0.3.

- **Opus counted fewer slips.** Errors fell from N0's 9 to 2 (Sonnet 1), and relevance
  slips from 5 to 1. Opus still preferred Sonnet's 14 to 10.
- **Recall got worse.** Over two runs on all seven papers: N1-1 failed on Vaswani outright, because
  Haiku put 98 block ids into its places that are not in the article, so no row could be anchored.
  N1-1 also found only 38% of Synesthesia. N1-2 was fine (98%). Production's request has not failed
  that way in five runs on Vaswani (H2 ×3, P ×2), but one failure in two is enough to rule this
  out. A longer prompt competing with the finding for the model's attention is the plausible
  reading, not a tested one.

### N2: a second pass that writes only the notes

[`notes-pass.ts`](../../evals/citations-recall/notes-pass.ts) takes stage 1's finished list. For each
work it sends Haiku (high effort, 40 works a call, three calls in flight) the title, authors and year
and up to two passages that cite it, and asks for `why` and `relevance` by id. The join is checked:
every batch must answer exactly the ids it was sent, each once, or its rows keep the first pass's
notes. No batch failed in any run. Nothing but the two fields is written, and the script asserts
that.

It took three runs to give the pass the right passages, and the first two are worth knowing about:

1. **N2-1 sent the model's own places**, which for an author–year paper are often only the
   reference entry. Haiku, shown "Nagel, T., 1974. What is it like to be a bat?…", wrote "given only
   in the reference list, so the passages do not show how this article uses it". That is true of
   what it was shown, and useless. Opus preferred Sonnet 23 : 9.
2. **N2-2 sent code's `citedAt`**, which did not help on Butlin: there, code also anchors many rows
   only at their reference entry, and those entries are not blocks with a reference role, so they
   passed for body text. GPT Sol's plan review had warned that `citedAt` was not passages (finding
   8).
3. **N2-3 adds every body block whose author–year citation names the work's first author and
   year** (`bodyAuthorYearCites`, the reader behind code's own rows), and filters those inferred
   passages against blocks it recognises as reference entries. It could still append one of the
   model's own places as its second passage. This is the best generation harness run, and the row
   above. It is not a fair error test because the judges still saw only the manifest's first passage.

N2-3's nine errors under Opus are of two kinds:

- **A claim beyond the judge's passage** (six, all on Synesthesia), where the pass saw a footnote's text
  or a different citing block than the one the judge saw.
- **The wrong use** (three: Kingma 2013, Birch 2022b, Michel 2021), where the surname-and-year match
  found a different place the work is cited.

Both are about which passage the pass is shown. That is a problem of the harness's choice of
passage, and might be fixable. But fixing it is the third harness change after seeing judged
results, and the held-out half already goes against it, so it stops here.

Cost and time: about +$0.07 across all seven papers (+$0.002 to +$0.023 each), +9 to +47 s each,
on top of the finding call. All seven together: $0.20 against stage 1's $0.13 and today's Sonnet's
$0.89.

## What this says, and what would come next

- **A separate Haiku pass can meet the aggregate preference threshold, but did not do so on the
  held-out half.** Asking one call to find 250 works and describe each well traded recall for fewer
  Opus-counted slips in these runs.
- **A notes-only pass is the promising shape.** It costs little, cannot touch recall, and fixed
  relevance outright. Its errors come from the passage it is shown, so the next try is better
  passage choice. For example: the same blocks the finding call anchored, plus the full note text
  for a footnoted work, and never a block chosen on surname alone when the work has its own anchored
  place.
- **Shipping it would add parts**: a second call in the `bibliography` step, a join checked by id,
  its own prompt version in the stamp, and its own ledger job. That is worth doing only once a run
  passes the rule above.

Nothing here touches production. Stage 1's notes stay as 261101a measured them: preferred less often
than Sonnet's, with the slips counted above.

## Spend

Stage 2's paid calls: N1 two runs $0.27, N2 three runs $0.18. The judges ran on subscriptions
(Opus subagents and GPT Sol through Codex), so they cost nothing per call. Stage 1's measurement
(arm P, three runs) was $0.27, and the real step plus two notes runs on Butlin about $0.08.
