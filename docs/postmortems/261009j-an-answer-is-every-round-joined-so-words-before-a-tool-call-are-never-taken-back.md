# An answer is every round joined, so words before a tool call are never taken back

Up: [postmortems.md](../project/postmortems.md) · plan:
[261009o](../plans/261009o-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md) ·
measured in [261009c](../investigations/261009c-the-guide-s-offers-to-save-measured.md)

The guide's new `offer_to_save` tool made its answers come out twice. In the browser pass, both
paid turns stored an answer that said everything once, then said it all again, the second copy
glued onto the first: *"…or in how the work came about?You can save your reason with the button
under this answer. For a historian's read…"*. **It did not reach readers**: found before the
feature left the worktree.

## What happened

`converse` (src/converse.ts) runs a turn as rounds: the model writes, asks for tools, gets their
results, and writes again. Every round's text is streamed to the reader as it arrives and appended
to one `text`, which is the stored answer. That has been the design since chat got tools
(`be59cf968`, 2026-08-26), and it assumes a model writes a little before a tool ("Looking.") and
the answer after it.

`offer_to_save` broke the assumption. It is a tool a model calls *after* deciding what to say:
it wrote the whole reply, then called the tool to attach the card, then, handed the tool's result
in the next round, wrote the reply again, because nothing told it the first copy had already been
shown. Nothing in the loop can take back what a round already streamed. On the browser's article
(*Attention Is All You Need*), 9 of 14 runs were written twice; on the eval's fixture essay, 5 in
30, which a check comparing only answers' openings did not see.

The glue was a second, older bug: rounds were joined with no separator, so a round ending on
"…came about?" met the next round's "You can…" with no space. Every tool-using conversation had it
whenever a model wrote on both sides of a tool call.

## The class

**A streamed answer cannot be revised, so a loop whose later rounds do not know what the earlier
ones already showed will repeat itself.** The text a model writes before a tool call is final the
moment it streams; a tool whose result reads as "now answer" invites the answer again.

## The fix

- The tool's result says so: *"Everything you wrote before calling this tool is already on the
  reader's screen … never write any of it again. If your reply was already complete, stop here."*
  0 of 14 written twice after, from 9 of 14 before, on the same case.
- `converse` starts a later round's first words on a new paragraph when neither side brings
  whitespace, as a delta, so the stream and the stored answer agree
  (`tests/guide-offer-converse.test.ts`); the round replayed to the model keeps its own bytes
  (GPT Sol, second code review).

The right long-term fix, if another tool shows the same shape: tell the model in every tool result,
or in the system prompt's tools section, that text already written stays written. Not done for the
other tools now: they are look-ups the model calls before answering, and the measurements show no
repeats there.

## What would have caught it

A check, in any eval of a tool-using prompt, that no stretch of the answer appears twice
(`writtenTwice` in evals/guide/offers.ts), run on a real article as well as the fixture. The first
version of the eval compared only the openings, and the browser's second copy began with different
words.
