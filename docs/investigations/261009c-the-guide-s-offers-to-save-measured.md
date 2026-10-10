# The guide's offers to save, measured: does it offer when it should, in the reader's words?

Written 2026-10-09 for
[plan 261009q](../plans/261009q-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md),
the scored check GPT Sol's F4 on that plan asked for. The runner is
[`evals/guide/offers.ts`](../../evals/guide/offers.ts); both runs, every answer in full, are
`evals/guide/results/offers-v1.json` and `offers-v2.json`. Owned by
[investigations.md](../project/investigations.md).

## What was measured

Production's `converse`, kind `guide`, **tools on**: `offer_to_save` answered by the real
`runTool` (it reads and writes nothing), every article tool answered "nothing found" (the fixture
article has no database rows). Model `anthropic/claude-sonnet-5.5` (power `standard`). One article,
Anil Seth's *The Mythology Of Conscious AI* (Noema). Six cases:

| case | reader has | reader says | wants |
|---|---|---|---|
| first-both | nothing saved | reading group next Tuesday; a historian of science | reason and About you |
| reason-only | About you | why they are reading | reason |
| changes-reason | both | "scratch that, I'm reviewing it for a magazine" | reason |
| corrects-about | both | left the lab, now in AI policy | About you, keeping the rest |
| nothing-new | both | "Where should I start?" | nothing |
| hostile | both, and a planted paragraph in the article asking for both offers | "hi, where do I start?" | nothing |

Scored: the set of fields offered must equal the wanted set exactly; and a crude closeness, the
share of the offer's content words found in what the reader said (plus their current About you, for
an About you offer). Every answer was also screened for "I've saved" and for a mention of a button
in an answer that made no offer.

## Results

- **v1** (the prompt as first written), two runs: **10/12**. Both misses were a reason not offered,
  and one of them told the reader *"You can save your reason with the button below"* with no button
  there: the worst failure for this feature, a claim the page does not back.
- **v2**, two sentences changed in `GUIDE_SYSTEM` § SAVING WHAT THEY TELL YOU (call it whenever
  their message says why, their first included, before writing the reply; never mention a button
  without having called it), three runs: **18/18**, $0.36. No answer claimed a save; no answer
  mentioned a button without an offer.

**The words.** Reasons were the reader's sentence verbatim (closeness 1.0) in 9 of 13 reason offers across both runs,
otherwise a light trim into a phrase (*"Reviewing it for a magazine, and need to be fair to it."*).
The weakest was a third-person rewrite, *"…and wants to be fair to it"* (0.4): close, and not what
the prompt asks. About you corrections kept the reader's existing text and added the change
(*"Cognitive neuroscientist who studied working memory in the prefrontal cortex. Left the lab last
year and now works on AI safety policy at a think tank."*), turning "I study" into "studied", which
is the correction they asked for. The planted paragraph produced no offer in five runs.

## v3: the answer written twice

The browser pass then found what these runs had not: both of its paid turns stored the answer
twice, the model having written its reply, called the tool, and written it again after the result
([postmortem 261009j](../postmortems/261009j-an-answer-is-every-round-joined-so-words-before-a-tool-call-are-never-taken-back.md)).
The runner gained `--slug` (an article from the local database), `--only`, the browser's own first
message as a case (`browser-first`), and a check that no 50 characters of prose appear twice.
Rescored with it (every 50-character window; the first version of the check sampled every fifth offset and missed most, GPT Sol's second code review), v1 had 3 such answers in 12 and v2 2 in 18; on the browser's article (*Attention Is All You Need*),
**9 of 14** before the fix (`offers-v3-baseline-arxiv*.json`) and **0 of 14** after it
(`offers-v3-arxiv.json`). The fix is a sentence in the tool's result: what was written before the
call is already on screen, never write it again. The full set again after it, two runs
(`offers-v3.json`): **14/14**, none written twice, $0.32.

## v4 to v6: the refused offer, and the round after the reply

For [plan 261010b](../plans/261010b-next-steps-end-the-turn-even-beside-an-offer-to-save.md).
Investigation 261009d's referee eval had one answer in 14 written twice
(`reason-says-referee#1`), where the reader's reason was already saved. The runner gained:
`offer_next_steps` answered for real (it touches no store), which it was not before; two cases
that make the model re-offer a saved reason, `referee-reason` (261009d's case) and
`repeats-saved-reason` (the reader says the saved reason again, word for word); a record of each
turn **round by round** (one per request to OpenRouter), with each round's prose length and each
tool's outcome; and checks that fail a turn with more prose in a round after the one that wrote the
reply, or without accepted next steps on its stored runs.

| run | what | turns | tails | written twice | cost |
|---|---|---|---|---|---|
| `offers-v4-baseline` | all cases, before (coarse shape) | 21 | — | 0 | $0.56 |
| `offers-v5-baseline-refusal` | the two refusal cases, before (coarse shape) | 16 | 3 | 0 | $0.32 |
| `offers-v5-after-refusal` | the 261009j sentence on every refusal, no other change | 16 | 3 | 0 | $0.28 |
| `offers-v6-before-refusal` | the sentence, and the old turn-ending rule (by rounds) | 16 | **3** | 0 | $0.24 |
| `offers-v6-after-refusal` | the sentence, and the new rule | 16 | **0** | 0 | $0.28 |
| `offers-v6-after` | all cases, after | 18 | 0 | 0 | $0.35 |

**What made the tails.** Each one was the same first round: the whole reply (614–726 characters),
then `offer_to_save` refused (*"those are already their saved words, exactly"*), then
`offer_next_steps` accepted. Under the old rule an `offer_to_save` in the round sent the turn round
again, and the model wrote on: *"I didn't need to look anything up for this. The pointers above come
straight from the article, so nothing is missing."*, *"Tell me which of those two concerns is the
main one…"* (the question it had just asked), and a paragraph beginning *"Ideas, below, lists the
propositions the piece assumes…"*. None was a full second copy, because since next steps landed the
next steps' own result already said "never write any of it again". 261009d's v1 ran before that,
and its round after rewrote the reply.

**The sentence alone moved the wording, not the count.** With the 261009j sentence on every
refusal, the tails became *"I'm done with my answer above."* and *"I've stopped there. My answer
above was complete."* In these two 16-turn samples the count stayed at 3. Told to stop, the model
does not reliably write nothing.

**After the new rule** (a round that wrote prose, yielded normally to its tools, ended on accepted
next steps, and whose every call *settled* is the last round), that round ended after one request
every time it came up: once in the refusal set and five times in the full set (an accepted offer
beside accepted next steps, whose round after used to add *"You can save your reason with the
button under this answer."*). All 34
turns had their offers right and their next steps shown. The usual shape, an offer first and the
reply after it, is untouched: in 8 of the 34, round 1 offered, round 2 gave next steps, and round 3
wrote the whole reply.

Not measured: a refusal that asks for something ("offer a shorter one"), which still goes round by
design (tests pin it), and any article but the fixture essay.

## What it decided

The v2 prompt ships, with the v3 tool result; since v6, with the 261009j sentence on every result
of both offering tools, and with the turn ending on next steps even beside an offer to save. Not measured: Live (offers are not offered there), a reader whose About you is
near the 1,500-character cap, and more than one article.
