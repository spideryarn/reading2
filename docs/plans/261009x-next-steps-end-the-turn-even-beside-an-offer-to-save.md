# Next steps end the turn, even beside an offer to save

Up: [plans.md](../project/plans.md) · Overseer queue item `qi-642ha9j9` (a bug, under Greg's
standing permission, 2026-10-09) · class:
[postmortem 261009j](../postmortems/261009j-an-answer-is-every-round-joined-so-words-before-a-tool-call-are-never-taken-back.md)
· measured in [investigation 261009c § v4 to v6](../investigations/261009c-the-guide-s-offers-to-save-measured.md#v4-to-v6-the-refused-offer-and-the-round-after-the-reply)
· reviews: [plan, first](261009x-plan-review-sol.md) (REWORK), [plan, second](261009x-plan-review-2-sol.md)

## The bug

The guide's answer is sometimes written twice. Investigation 261009d's `referee-offer.ts` v1 found
one in 14 (`reason-says-referee#1`): the whole reply, then the reply again, reworded, after an
`offer_to_save` call. 261009j had taken the same class from 9/14 to 0/14 with a sentence in the
tool's result: *everything you wrote before calling this tool is already on the reader's screen …
never write any of it again.*

## What the measurements show

`evals/guide/offers.ts` now records each turn's shape: each stretch of prose with its length, and
each tool with what it did (offered, steps, or the refusal's first words). Two new cases are
built to make the model re-offer a reason that is already saved: `referee-reason` (261009d's case)
and `repeats-saved-reason` (the reader says the saved reason again, word for word).

- **Baseline (v5-baseline-refusal, 16 turns):** 3 turns wrote the whole reply (687–808
  characters), then called `offer_to_save` and were refused (*"those are already their saved
  words, exactly"*), with `offer_next_steps` accepted in the same round. Each went round again and
  wrote a tail: *"Your referee brief is already saved, so I haven't offered it again."*, *"Nothing
  to add; the suggestions above are where I'd begin."*, and once a whole extra paragraph (429
  characters). None was a full second copy: since next steps landed (261009u), the next steps'
  own result says "never write any of it again" in the same round. 261009d's v1 ran before that,
  and its round after rewrote the reply.
- **With the 261009j sentence added to every refusal (v5-after-refusal, 16 turns):** the same
  shape 3 times, each still with a tail, now about stopping: *"I'm done with my answer above."*,
  *"I've stopped there. My answer above was complete."*, *"I've put the next steps under my
  answer."* **Told to stop, the model cannot reliably write nothing.** A sentence can stop a full
  rewrite; it cannot stop the tail. Only not asking can.
- The accepted path has the same tail, only an invited one: 3 of 18 turns in the full set wrote
  the reply, offered, and added *"You can save your reason with the button under this answer."*

The coarse shape could not show round boundaries (GPT Sol's second review, F1), so the runner now
records each round. Re-measured that way, with the sentence and the old rule (`v6-before-refusal`):
3 tails in 16, and **every one came from the same first round**: the reply, `offer_to_save` refused
as already saved, and `offer_next_steps` accepted.

## The fix

**Two parts.**

1. **Structural, in `converse`:** a round is the last round when it wrote prose, yielded normally
   to its tool calls rather than running out of tokens, its **last call is `offer_next_steps`**, and
   **every call in it settled**. *Settles* is a typed field on the tool's
   outcome (`ToolOutcome.settles`) meaning "once the reply is written, the model needs nothing back
   from this result". Only the two offering tools ever set it, and only on: steps accepted; an
   offer made; an offer refused because the words are already saved, exactly. Every other refusal,
   any throw, and any look-up leaves it unset, so the turn goes round as today.
2. **The sentence, on every result of both tools** (the 261009j sentence as one constant,
   `ALREADY_ON_SCREEN` in `src/chat-tools.ts`). This is for the paths that still go round, such as
   an offer with no next steps beside it, as in 261009d's v1. It stops a rewrite, not a tail.
   Refusals also say "say nothing to the reader about offering or saving it" in place of "do not
   tell the reader you offered anything".

Why this, and not "any prose round with only offering tools ends, whatever they returned" (the first
draft; GPT Sol, [first review](261009x-plan-review-sol.md) F2 and F3, and
[second review](261009x-plan-review-2-sol.md) F2):

- **Accepted next steps, last, are the model's own "my reply is done".** The prompt makes
  `offer_next_steps` "the very last thing, after your reply is complete", and `converse` already
  ended on it alone (261009u). Prose in that round is not a preamble ("Let me note that."), which is
  the risk Sol raised for prose beside `offer_to_save` alone. That still goes round.
- **A result that asks for something still reaches the model.** "Offer a shorter one", "what is
  saved could not be read", a refused next step, and a throw all leave `settles` unset. That outcome
  is typed rather than read back out of the result's words.

| round: prose, then … | before | after |
|---|---|---|
| `offer_to_save` refused as already saved, then accepted next steps | another round: a tail, or (before next steps existed) the reply again | ends |
| `offer_to_save` accepted, then accepted next steps | another round: "you can save it with the button under this answer" | ends. The card carries its own heading and button ("Save as why you're reading") |
| `offer_to_save` refused any other way, then next steps | another round | unchanged |
| next steps, then `offer_to_save` (not last) | another round | unchanged |
| accepted and refused next steps in one round | another round | unchanged |
| `offer_to_save` alone | another round | unchanged |
| any throw, or a look-up beside the offers | another round | unchanged |
| a round cut off by `max_tokens`, even with complete-looking calls | with next steps alone, it ended on the unfinished sentence (261009u); otherwise another round | another round, and the answer is still marked truncated (GPT Sol's code review, F1) |

This narrows GPT Sol's 261009u F2 ("with `offer_to_save` beside them, the model is owed that tool's
answer"); it does not reverse it. The model is owed nothing after an offer that settled. The one
thing it used to add was a sentence about a card that explains itself, and paying for that sentence
with a round is where the tails and the second copies came from.

**Passed over:**
- **The sentence alone** (Sol's first recommendation). Measured above: in two 16-turn samples it
  moved the tail's wording and left the count at 3.
- **Holding back the round after an offer and dropping it if it repeats.** "Repeats" would have to
  be judged on a reworded copy (v1's second copy was paraphrased); a tail like "I'm done" repeats
  nothing; and holding back defeats streaming.
- **Ending on any prose round with only offering tools, whatever they returned** (the first draft).
  Sol's F2 and F3.

## What remains of the class

Every path in the "unchanged" rows above still goes round after a written reply, and there the
sentence is the only defence: it stops a full rewrite (261009j) but not a tail. None of them came
up after a written reply in the runs here. The model calls the offering tools together, offer
first, next steps last.

## Stages

1. **Red first.** Built. `tests/guide-offer-to-save.test.ts` and
   `tests/guide-next-steps-tool.test.ts`: every result of both tools carries `ALREADY_ON_SCREEN`,
   and the outcomes that settle are exactly the three named. `converse` tests (`describe("beside an
   offer to save")`): accepted offer, both fields, and already-saved refusal each end in one request
   (red against the old rule). An empty or too-long refusal, an unread basis, refused next steps,
   accepted plus refused next steps, next steps not last, a thrown offer, a round with no prose,
   a truncated round with fully reconstructed calls, and a preamble beside an offer alone each go
   round. The old "goes round again when another tool was asked for" used `offer_to_save` as the
   other tool; a look-up takes its place.
2. **The change.** Built: `ToolOutcome.settles`, the condition beside `ENDS_THE_TURN` and its
   comment, `docs/project/chat-tools.md` and the `OFFER_NEXT_STEPS_TOOL` comment (Sol's F4).
3. **Measured.** [Investigation 261009c § v4 to v6](../investigations/261009c-the-guide-s-offers-to-save-measured.md#v4-to-v6-the-refused-offer-and-the-round-after-the-reply):
   before, 3 tails in 16; after, 0 in 16, and 0 in the full set's 18, with every offer right and
   every turn's next steps shown. The runner now fails a turn with a tail or without accepted next
   steps on its stored runs.
4. Write-up: the investigation section above, and an addendum to postmortem 261009j. Then the GPT
   Sol code review, the gates, and landing on `dev`.
