# Quotes long enough to stand on their own (`quotes/6`)

Report [SPIDERYARN-READING2-3C](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3C), the note
is [260912_0823](../user-feedback/260912_0823-quotes-long-enough-to-stand-on-their-own.md). It builds on
the two quotes changes before it rather than undoing either:
[260911a](260911a-quotes-find-more-and-a-fade-that-carries-priority.md) (importance first, one per
~200 words, Find more) and [260911e](260911e-quotes-prompt-asks-for-diverse-lines.md) (`quotes/5`, one
point per quote).

> Make a small tweak to the way quotes mode works to allow the quotations to be a lot bit longer. I
> mean, they could almost be an entire block if the whole block is really, really good. But right now
> I'm noticing there are quotes where it sort of captures the introductory bit, but not the rest. And
> so one couldn't read the quote on its own in isolation and get much from it. You'd have to click on
> the quote to get to the original block and read the rest of the block in order to see what the— to
> get, for the quote to sort of, in other words, the quote is not self-sufficient. It only has real
> meaning in the context of the wider block that it's part of. So that to me is an indication the
> quote needs to be longer.
>
> — Greg, 2026-09-12, on an iPad, reading `entropy-24-00930` in production

**The test he gives is self-sufficiency**: a quote that means something only once you have opened
the block it came from is too short. A whole block is acceptable when the whole block is good.

## Why a prompt tweak alone cannot do it

The ask reads like a prompt tweak, and half of it is. The other half is a number in code.

`MAX_QUOTE_CHARS` is **400**, and `place` drops anything longer (`wrongLength`). Its docstring says
exactly what Greg is now asking us to stop doing: *"Longer than this is the paragraph, not a line out
of it."* The prompt says the same to the model: *"Anything under 30 characters or over 400. Below that
it is a phrase; above it it is the paragraph, and both are thrown away."*

Measured against the paragraphs (`kind: "text"` blocks) of two articles, 2026-09-12:

| article | paragraphs | median chars | over 400 | over 800 | over 1200 | longest |
|---|---|---|---|---|---|---|
| `entropy-24-00930` (local copy of the one Greg was reading) | 69 | 705 | **53** | 30 | 8 | 2,077 |
| `noema-mythology-of-conscious-ai` (fixture) | 109 | 473 | **63** | 5 | 0 | 1,098 |

So on the article he reported from, **three paragraphs in four cannot be quoted whole under any
prompt**, and a quote that carries its point through to the end of one is usually over 400 too. The
model has learned the lesson the prompt teaches: every quote stored locally (112, across seven lists)
is one sentence or so — median 109 characters, longest 264.

## What changes

Three things, in [src/quotes.ts](../../src/quotes.ts):

1. **`MAX_QUOTE_CHARS` goes from 400 to 1,200** — about 200 words, a long paragraph. It covers every
   paragraph in the noema fixture and 61 of 69 in the entropy paper. Its meaning changes from *"the
   paragraph, not a line"* to *"longer than a reader will read in a list"*, and the docstring says so.
   Dropped rather than truncated, as before: that rule is about an ellipsis in the author's mouth and
   does not move.
2. **The prompt makes self-sufficiency the test**, in the words Greg used — and, after the first
   wording failed (§ Before and after), it does so from the first sentence rather than in a section
   near the bottom:
   - **A quote is a passage, not a line.** The opening sentence says so — one sentence, several, or a
     whole paragraph, as much as it takes to make sense on its own — and "line" becomes "passage"
     through the choosing sections, which had set the single-sentence frame.
   - **`LONG ENOUGH TO STAND ALONE` moves up**, to straight after `WHAT EARNS A QUOTE`, and says it
     matters as much as choosing well. It names the commonest failure — stopping at the set-up and
     leaving the payoff in the next sentence — with a BAD/GOOD pair of exactly that shape, invented
     rather than taken from the entropy paper so the prompt is not tuned to the one article it was
     measured on. And a self-check: read the quote as if you had never seen the article; if you would
     ask *"and so?"*, the answer is in the sentences after it.
   - **The counterweight stays**, so this does not become "quote every paragraph": a whole paragraph
     only when all of it earns its place, and when a paragraph's point is complete in one sentence,
     that sentence is the quote.
   - `WHAT DOES NOT`'s bullet *"A sentence that needs the paragraph around it"* folds into that
     section, and the mid-sentence bullet gains *"and end where a sentence ends"*.
   - The length line quotes the constants rather than the literal numbers, so the prompt and `place`
     cannot disagree again.
3. **The answer's token allowance scales with the new ceiling.** `500 + count * 220` was sized for
   quotes of at most 400 characters (its comment says so). Undersizing does not degrade — it throws
   `truncationFailure` and the reader loses the whole pass — so the per-quote allowance comes from
   `MAX_QUOTE_CHARS` in one named function, and a test holds that a pass of `count` maximum-length
   quotes fits. `max_tokens` is a ceiling, not a charge; this costs nothing unless it is used.

`PROMPT_VERSION` goes to `quotes/6`. **New lists only**: every existing list shows its *outdated*
sentence, and a Find more on one appends lines chosen by the new prompt under the list's older stamp —
the rule `quotes/4` set and `quotes/5` kept.

What stays: the count (one per ~200 words, 10–40), importance first, one point per quote, Find more,
the fade, `MIN_QUOTE_CHARS`. `dedupeOverlaps` already keeps **the longer** of two overlapping spans, so
a whole-paragraph quote beats a sentence out of the same paragraph rather than losing to it.

## Passed over

- **The prompt alone, keeping 400.** The simplest change, and the one the report's wording suggests.
  It cannot deliver either half of the ask on the article it was reported from: 53 of its 69
  paragraphs are over the ceiling, and a quote extended to finish its point would be dropped as
  `wrongLength` and counted, not shown.
- **No ceiling at all — the block is the bound.** Honest in its way, since a quote cannot be longer
  than the block it is in. But the ceiling is also what bounds the answer's token allowance, and a
  2,000-character "quote" in an 18rem band is a page of reading presented as a line. 1,200 is a guess
  at where a quote stops being one; it is named here so it can be moved.
- **Fewer quotes, to hold the marked area constant.** Longer quotes mark more of the prose. Greg has
  asked for more quotes twice this month and did not ask for fewer now; the bar already hides the
  tail. Worth watching, not pre-empting.
- **Showing the rest of the block in the panel** (an expander under a short quote). A UI answer to a
  selection problem: the quote would still be the introductory bit, and the prose mark still only
  outlines that bit.

## Stages

1. This plan, and GPT Sol's read-only review of it.
2. The code: the constant, the prompt, the allowance, `PROMPT_VERSION`, with tests written red first —
   a whole paragraph over 400 characters is kept; the prompt states the constants; the allowance fits
   `count` maximum-length quotes. One live pass on the entropy paper before and after, recorded below.
   GPT Sol's code review, fixing what it finds.
3. Docs ([quotes.md](../project/quotes.md)), the feedback note, land on `dev`.

## Before and after

One paid pass each on the local copy of `entropy-24-00930-spya-pywwkq` (8,580 words, revision
`c8574064`), through `generateQuotes` directly, writing nothing: `scratchpad/run-quotes.mts`. One
article, one sample each — a direction, not a measurement.

| | prompt | ceiling | kept | median chars | p75 | longest | median share of its block | whole blocks | elapsed | cost |
|---|---|---|---|---|---|---|---|---|---|---|
| before | `quotes/5` | 400 | 18 | 148 | 186 | 285 | 0.16 | 1 | 18.6s | $0.061 |
| after, first wording | `quotes/6` draft | 1,200 | 15 | 169 | 225 | 312 | 0.16 | 1 | 14.3s | $0.056 |
| after | `quotes/6` | 1,200 | 22 | 255 | 291 | 747 | 0.28 | 1 | 24.9s | ~$0.07 |

**The first wording did not work**, and the ceiling on its own does nothing either: it removes the
barrier and does not move the model toward it. The draft added a `LONG ENOUGH TO STAND ALONE` section
after `WHAT DOES NOT`, and the model went on choosing single sentences — median 169 against 148, the
same sixth of the paragraph, and **Greg's own example back verbatim**: *"A grand challenge of modern
neuroscience is to discover how brains “process information”."*, 89 of 657 characters. One sample, but
that one quote coming back unchanged is the symptom itself. The likely reason is that the rest of the
prompt still talks about *lines* — "the lines that matter most", "a line earns its place", "the line
you would repeat" — and one section near the bottom does not outweigh a frame set in the first
sentence.

Nothing was dropped for length before: the model is not being cut off at 400, it has been taught not
to go near it. The median quote is a sixth of the paragraph it came from.

**The symptom reproduces**, in the shape Greg described. Two of the eighteen:

- *"A grand challenge of modern neuroscience is to discover how brains “process information”."* — 89
  characters, the opening line of a 657-character paragraph. The set-up, and none of the rest.
- *"Synergy was maximized when the source neurons were intermediately similar"* — 73 characters out of
  a 2,470-character block, 3% of it. A finding with none of what makes it one.

And one starts inside a sentence — *"not only does the existence of statistical synergy add nuance…"* —
which the prompt already forbids; a short ceiling pushes the model to cut a long sentence down rather
than keep it whole.

**The second wording works, and a second sample of it agrees**: 22 kept, median 202, a median 22% of
the paragraph, two whole paragraphs. Greg's two reproduced failures are gone in both samples — the
*"grand challenge"* opening is no longer chosen alone, and *"Synergy was maximized…"* is no longer
offered without the rest of the finding. What replaced them is the shape he asked for:

> Interestingly, synergy only increased up to a point. The peak in synergy occurred when the mutual
> information was about 7% of the maximal value, regardless of the timescale. Past this level, the
> synergy began to decrease …

Neither sample drifted towards whole paragraphs by default (one and two whole blocks of 22; one at
92% of an 814-character paragraph, which is the argument stated whole).

**One regression, in both samples**: *"This is not intended to be an exhaustive review of relevant
findings but rather to serve as an approachable overview …"* — scaffolding, which the prompt forbids
and which the baseline did not choose. A sentence about what the piece is for is complete on its own,
so the stand-alone test on its own admits it. The scaffolding bullet now says so: a sentence about the
piece's own scope or audience is scaffolding however complete it sounds, and standing alone is
necessary, not sufficient.

**A third sample, on that wording, has no scaffolding quote** — 22 kept, median 235, a median 27% of
the paragraph, one whole block, 26.0s, $0.070 — and it fixes Greg's own example in exactly the way he
described: the *"grand challenge"* opening now runs on into its next sentence, 323 of its paragraph's
657 characters, where the baseline stopped at 89.

| | kept | median chars | median share of its block | whole blocks | scaffolding chosen |
|---|---|---|---|---|---|
| before (`quotes/5`, 400) | 18 | 148 | 0.16 | 1 | no |
| first wording | 15 | 169 | 0.16 | 1 | no |
| passage framing, sample 1 | 22 | 255 | 0.28 | 1 | yes |
| passage framing, sample 2 | 22 | 202 | 0.22 | 2 | yes |
| **`quotes/6` as shipped** | 22 | 235 | 0.27 | 1 | **no** |

**One thing not fixed**: a quote starting inside a sentence — *"not only does the existence of
statistical synergy…"* — turned up in the baseline and in two of the three later samples. The prompt
has forbidden it since `quotes/1`; nothing in this change caused it and nothing here stops it. A
mechanical check (refuse a span that starts lower-case after a comma) is the next step if it matters.

## GPT Sol's plan review, and what was done with it

Read-only, `gpt-5.6-sol`, high effort, on the plan and the first wording, 2026-09-12. **No P0, and
no hidden 400-character assumption anywhere downstream**: `Quote.text` is unconstrained, stored as
`jsonb`, the URL carries only the quote's id, and the matcher, the resolver, the prose annotation, the
panel row, the owner and public routes and export all take a long quote as it is. Chat, quiz and
Remember do not put the quotes into a model prompt.

| # | finding | what we did |
|---|---|---|
| 1 | P1 — a `quotes/5` list cannot be repaired by Find more: its old spans win every clash, so a longer version of an old short quote is dropped. Greg's own article keeps its short quotes. Suggested an explicit rewrite for outdated lists. | **Not built; for Greg.** The brief this was dispatched with said so — *"Bump the prompt version; the new wording reaches new articles only"* — though it was written before anyone had noticed that Find more cannot lengthen an old list. A rewrite button on an outdated list would partly reverse his own *"Remove the 'Choose them again' button"* of 2026-09-11, so that product choice is recorded in the feedback note and in [awaiting-approval.md](../user-feedback/awaiting-approval.md). |
| 2 | P1 — the plan blamed the "line" framing for the failed first wording and did not replace it. Suggested "passage" throughout, and the counterweight *"Choose the shortest contiguous passage that stands on its own. Length is not a virtue."* | **Framing: done** — that is the second wording. **Counterweight: not taken.** Two samples show no drift to whole paragraphs, and "shortest … length is not a virtue" pulls straight back towards the single-sentence habit this is undoing. The existing counterweight stays. |
| 3 | P1 — the token test derived its bound from the same ÷3 as the code, so it could only agree with itself; three characters a token is not safe for maths-heavy text. Suggested one token a character. | **Taken.** `answerTokensFor` is `500 + count × (MAX_QUOTE_CHARS + 100)` — 52,500 at forty, 92,500 with the thinking headroom, under 128,000. The test states the bound itself, so an optimistic edit goes red. |
| 4 | P2 — the census counted text paragraphs, but the stage quotes from every body-evidence block, captions and code included. | **Recounted** over `blocks.filter(isBodyEvidence)`: entropy 89 of 99 within 1,200 (median 505, 57 over 400; the ten over include two figure captions, 1,226 and 2,470); noema 141 of 141. 1,200 is an editorial ceiling, not a promise that every good block can be quoted whole. |
| 5 | P2 — text inside `<svg>`/`<math>` is counted but not wrapped, so a long quote crossing a formula has a gap in its outline. | **Accepted as known behaviour**, written into [quotes.md](../project/quotes.md). Longer quotes make it likelier; it was already true. |
| 6 | P2 — `STEP_BUDGET_MS.quotes` is a scheduling budget checked between steps, not a timeout on the call. | **Wording corrected below.** The measured passes took 14–27 seconds. |

## Not measured

Whether readers find the longer quotes better, and what a list of forty of them does to the density of
marks in Plain — that was already open ([quotes.md § What is still open](../project/quotes.md#what-is-still-open))
and this makes it more so. Timing: the answer is longer — 2,800–2,900 output tokens against 2,075 —
and the passes took 14–27 seconds. `STEP_BUDGET_MS.quotes` (240s) is a scheduling budget the queue
checks between steps, not a timeout on the call (GPT Sol), so nothing here is at risk of being cut off
and no change to it is justified.
