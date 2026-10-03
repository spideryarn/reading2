# Quick search falls back to a lower floor when nothing clears it

Up: [plans.md](../project/plans.md)

Feedback report `spya-jp5nxn` (Sentry `SPIDERYARN-READING2-BG`), from Greg, 2026-10-03, on build
`d3f34a0f`. Queue item `qi-6hmbz43m`. The note is
[261003_1809](../user-feedback/261003_1809-quick-search-still-finds-too-little.md). The measurement
is [investigation 261003f](../investigations/261003f-quick-search-category-words-score-under-the-floor.md),
and every number here is from it.

> The quick search still doesn't seem to find enough - see
> https://www.spideryarn.com/read/arxiv-2610-spya-bfrbaj?mode=search&…&match=quick&runs=spya-uusd5t
>
> — Greg, 2026-10-03

This is the second report on the subject. The first, `spya-ats9dk`, was answered the same morning
by [261003i](261003i-quick-search-eval-thorough-replaces-quick-colour-key-and-no-wash.md): the
question Jev is asked changed from *match* to *mention or discuss*. **That fix was in the build Greg
filed this from** (`035a2d9c7` is an ancestor of `d3f34a0f`), so this is not a stale build. It did
not go far enough.

## What he saw

Quick search asks a small, fast model (Jev) one yes/no question per paragraph, *"does this passage
mention or discuss what the reader is looking for?"*, and gets a probability back for each. It keeps
paragraphs at 0.7 or more, best first, at most 20 (`QUICK_FLOOR`, `hitsFrom` in
[`src/quick-search.ts`](../../src/quick-search.ts)). *Thorough* is the slow search (Sonnet), which
reads the article and quotes sentences.

The run he links, `spya-uusd5t`, is a *thorough* search for "results" with seven hits. Since this
morning, pressing *thorough* deletes the quick row it came from, so the quick answer he was unhappy
with is not stored. **The sequence is inferred**: he typed "results", quick search showed nothing,
he pressed *thorough*, it found seven, he filed the report.

Sent again as production sends it, "results" on that article returns nothing on five runs of five.
Its best paragraph scores 0.52 to 0.57. Jev's top three include two of the four paragraphs the
thorough search chose (its other three hits are headings), and a blind judge marked all three
right. **The ranking is right; every score is under the floor.**

## The shape

A **bare label**: one or two words naming a kind of passage ("results", "examples", "criticism") or
a field ("linear algebra", "statistics"), where the right paragraphs are instances and do not say
the word. On 37 such queries over four articles, 62 of 111 searches return nothing. It is a
description of what was measured, not a proven cause, and how the word is typed moves the score a
lot: "results" 0.52 to 0.57, "Results" 0.63 to 0.67, "result" 0.41 to 0.45, and
**"what were the results?" 0.93, with 14 paragraphs**.

This morning's eval could not see it: its queries were phrases, questions, and topics the article
literally mentions.

## The fix

**When nothing clears 0.7, keep what clears 0.5 instead, the best 8.** In `hitsFrom`:

```
kept = blocks at QUICK_FLOOR (0.7) or more, best MAX_HITS (20)
if kept is empty:
    kept = blocks at QUICK_FALLBACK_FLOOR (0.5) or more, best QUICK_FALLBACK_HITS (8)
```

What the reader sees: where a quick search said "nothing", it now shows a few paragraphs, each with
its own score (55, 62…), lower than a normal quick hit's and printed as it is today. A topic the
article does not contain still shows nothing.

Measured, with two blind judges (the stricter one's numbers):

- It fills 50 of the 62 empty searches. 71% of what it shows is right; the top result is right on
  36 of 50.
- Greg's two queries ("results", "linear algebra"): every paragraph shown was marked right.
- It changes none of the 150 runs this morning's eval saved. The fallback is read only when the
  list is empty.
- 25 absent and near-miss topics, 75 searches: 71 still show nothing.

Why this shape and not another:

- **A lower floor for everybody** was refused this morning; replayed, 0.5 adds 93 right paragraphs,
  33 known wrong ones and 174 nobody judged to searches that already work.
- **Topping up a short list** pads a one-word search that correctly found its one paragraph.
- **A floor relative to the best score** with no absolute part returns 20 paragraphs for a topic
  the article does not contain. With an absolute part (0.7, or 0.5 and within 0.15 of the best) it
  fills the same 50 searches and also changes 9 that already had results, unjudged.
- **A smaller cap** (1 or 3) is no more accurate: 73% right at three, 71% at eight. It only shows
  fewer right ones.
- **0.55 instead of 0.5** is 80% right and leaves 28 of the 62 empty, Greg's own "results" among
  them on one run in three. See Q1.

## What it gives up

- **13 of the 50 new lists hold nothing right.** They are four queries where the word has no clear
  referent: "philosophy" and "definition" on the Constitution (one wrong paragraph each), and
  "results" on a narrative article with no results section.
- **A neighbouring topic the article does not cover can show wrong paragraphs.** "human memory" on
  a paper about a network forgetting: 1 to 4. "government regulation": 1, on one run in three.
- **12 of the 62 stay empty** ("result", "example", "Philosophy", "Statistics": best under 0.5).
- **A jump at 0.7.** Three of 37 queries cross it between runs. "methods" shows 4, 0 and 2 today
  and would show 4, 8 and 2.
- **Nothing on the row says "these are weaker".** The score is the only signal. See Q2.

## What is not being done, and where each went

- **Wrapping the reader's words** (`passages about: …`). A probe: it halves the empty searches and
  does not flood this morning's sets or the absent topics. It changes what every search sends, so
  it needs this morning's eval re-run and its results judged. Queue entry `qi-8xaejt6k`. This is the
  likeliest next real improvement, and it would stack with the fallback.
- **Asking about headings.** The thorough search's top hit for "results" is the heading
  "5 EXPERIMENTAL RESULTS". Quick search never asks about a heading. With headings left in it
  scores 0.54, so headings alone would not have fixed this. Queue entry `qi-2ymzypwt`.
- **Another wording of the question.** Six tried; none removes the empty lists without keeping far
  more elsewhere. Unjudged, so not ranked.
- **A different model.** Greg, this morning: stays on Jev.
- **A string match.** Greg, this morning: *"I think we should rely on that rather than adding weird
  special string match cases."*

## Stages

### Stage A: measure. Done.

[Investigation 261003f](../investigations/261003f-quick-search-category-words-score-under-the-floor.md).
Two rounds; the second answers the plan review (below). $0.85.

### Stage B: build

1. Red first, in `tests/quick-search.test.ts`: nothing at 0.7 and paragraphs at 0.62, 0.5 and 0.4999
   gives the first two, best first; one at 0.7 and one at 0.65 gives only the first; nothing at 0.5
   gives nothing; ten at 0.6 gives eight and counts two in `dropped.truncated`.
2. `hitsFrom` and the two constants, with the measurement in their comments. The finished-search
   log line gains `fallback: true | false` (no text).
3. `docs/project/search.md` § Quick search: the floor bullet. The help page, if it states the floor.
4. Gates: `npm test` (this file, then the suite through `scripts/tmux-job.ts`), `npm run typecheck`,
   lint on touched files.
5. GPT Sol code review, write-capable, with the investigation's conclusion in the candidate.
6. Queue entries for the two deferrals. The feedback note, `feedback-endings.ts`, push to `dev`.

## The plan review (GPT Sol, round 1)

[Prompt](261003o-quick-search-fallback-plan-review-prompt.md),
[answer](261003o-quick-search-fallback-plan-review-sol.md). No P0 or P1. Verdict: not ready, Stage A
needed more. It found no client code that assumes a quick hit is at least 70 (the display threshold
is 30).

| | finding | what was done |
|---|---|---|
| F1 | four of five absent topics were too easy | 20 near-miss topics written by a subagent from the article text alone. 59 of 60 searches stay empty. Per-list outcomes reported. |
| F2 | one judge, no heading context, wordings unjudged | a second independent judge with each paragraph's heading; 88% agreement; the stricter is used. Wordings are reported as counts and not ranked. |
| F3 | one thorough search is not a yardstick | it is now reported only as overlap; the judged labels are the yardstick. |
| F4 | caps 1 and 3 missing; the jump unmeasured | both added; mode flips and list-size spread reported. |
| F5 | "category word" is not a proven cause | renamed and stated as a description; case, number and request variants measured, which found the request effect. |
| F6 | the replay is 50 queries, not 48 | stated. |
| F7 | "results" and "Results" were conflated | separated throughout; the sequence is called inferred. |

Not done from F2: showing the judge a paragraph's neighbours, and adjudicating the 15 disagreements.
Not done from F5: a natural-language control for every query (8 were run).

There was no second plan review. The findings were all about the evidence, each is answered by a
measurement that is in the candidate, and the code review reads both.

## Questions for Greg

**Q1. How unsure may a fallback result be?** When a quick search finds nothing it is sure of, it now
shows its best guesses. The cut-off for a guess is a choice between finding more and being wrong
more often:

- **A (built): 0.5.** Of 62 searches that found nothing, 50 now show something. About 7 in 10 of
  the paragraphs shown are right. "human memory" on the forgetting paper shows up to 4 wrong ones.
- **B: 0.55.** 34 of the 62 show something. 8 in 10 are right. "results" on your paper would still
  come back empty about one time in three.

Pick B if a wrong paragraph in a list bothers you more than an empty list does.

**Q2. Should a fallback list say that it is one?**

- **A (built): say nothing.** Each result already prints its score, and a 55 reads as a 55.
- **B: one line on the row**, such as *"nothing scored highly; these are the closest"*. It needs a
  flag stored with the search (a database column, so it survives a reload and reaches the public
  reader). About half a day.

Pick B if you find yourself trusting a fallback list as much as an ordinary one and being let down.

**A tip in the meantime, and Q3.** A question or a phrase works much better than a bare word today:
"what were the results?" finds 14 paragraphs where "results" finds none. Should the search box say
so (its placeholder, or the help page)? Not built: if wrapping the query works out, the tip
becomes unnecessary.

## Log

- 2026-10-03: plan written after the reproduction and the first Jev run. GPT Sol's plan review:
  seven findings on the evidence, no P0 or P1. Stage A's second round answers them. Constants
  settled: 0.5 and 8.
