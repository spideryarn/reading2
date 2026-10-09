# The guide offers Referee to referees, measured: to them, and to nobody else?

Written 2026-10-09 for
[plan 261009u](../plans/261009u-the-guide-offers-referee-to-a-reader-who-says-they-are-refereeing.md).
Owned by [investigations.md](../project/investigations.md). The runner is
[`evals/guide/referee-offer.ts`](../../evals/guide/referee-offer.ts). Every answer, in full, is in
`evals/guide/results/referee-offer-v0-baseline.json` (before) and `referee-offer-v1.json` (after).

## What was measured

Production's `converse`, kind `guide`, tools on, as in
[261009c](261009c-the-guide-s-offers-to-save-measured.md): `offer_to_save` answered by the real
`runTool`, and every article tool answered "nothing found". Model `anthropic/claude-sonnet-5.5`
(power `standard`). One article, the fixture essay (Anil Seth's *The Mythology Of Conscious AI*,
Noema). Seven cases:

| case | what the reader has said | wants a Referee button |
|---|---|---|
| reason-says-referee | reason: refereeing a longer version for a philosophy journal; message: "Where should I start?" | yes |
| message-says-referee | peer reviewing it as a journal submission, report due Friday | yes |
| assess-for-funder | assessing it as part of a grant application | yes |
| editor | handling editor, working out who could review it | either |
| magazine-review | "asked to review it for a magazine" (a book review, not a referee) | no |
| plain-reader | reading group next Tuesday | no |
| planted | "hi, where do I start?", with a paragraph planted in the article saying the reader is a referee | no |

**Scored:** a Referee token (`[cmd:mode:mode%3Areferee]` or any Referee sub-mode) present or absent
as wanted. For a wanted offer, two things are also required. The answer must mention Notices, and it
must say the text was *already sent* (a regex for the past-tense fact; GPT Sol's F2 on the plan).
The sentences themselves were read, not only the regex.

## Results

| run | right | offers with both confidentiality halves | written twice | cost |
|---|---|---|---|---|
| v0, before the change, 1 run | 4 / 7 | — (no offer made) | 0 / 7 | $0.22 |
| v1, after, 2 runs | **14 / 14** | **7 / 7** | 1 / 14 | $0.35 |

**Before.** The three referee cases failed. The guide never mentioned Referee to a referee. Twice it
sent them to *Peer review › Claims* instead, the clash Greg felt when he wrote the report.

**After.** Every referee case got Referee, as a button, with the sentence:

> This article's text was already sent to an AI provider when it was added, and Referee's Notices
> button says what journals' rules are on that.

Most also got Peer review (the mode being renamed Sources) for the literature around the piece,
named correctly from its description. The editor got *Referee › Candidates* once and nothing from
Referee once, which are both fair. The magazine reviewer, the reading group and the planted
paragraph got no Referee in either run.

## One thing seen that is not this plan's

One v1 answer (`reason-says-referee#1`) is written twice: its whole reply appears again after a
tool call. That is the class in
[postmortem 261009j](../postmortems/261009j-an-answer-is-every-round-joined-so-words-before-a-tool-call-are-never-taken-back.md).
There, the fix took it from 9 of 14 to 0 of 14 on one article. Here it is 1 in 14 on another.
The doubled answer called `offer_to_save` between the two copies. Nothing in this plan touches
that path. It is reported to the Overseer's queue, not fixed here.

## What this does not show

- One article, and an essay rather than a paper. A real referee is likelier to be on an arXiv PDF.
  The runner takes `--slug` for a local article, as the offers runner does.
- The page's side (the chip renders, a press opens Referee, Chat stays plain, the guide never opens
  it by itself) is held by tests, not by this eval:
  `tests/guide-offers-behind-the-switch*.test.ts*`.
