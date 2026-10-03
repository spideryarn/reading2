# A stage was widened and measured at the store, while a default filter downstream hid what it added

Up: [postmortems.md](../project/postmortems.md) · fixed by
[plan 261003o](../plans/261003o-debate-reception-and-claims-sub-modes-and-a-tidier-panel.md) ·
measured in
[investigation 261003g](../investigations/261003g-debate-on-a-thinly-received-paper-what-reception-finds-and-how-claims-spread.md)

## What happened

On 2026-10-02 Debate's search for responses was changed to look for the work that **cites** a
piece, and to stop losing those rows to a quote check
([261002i](../plans/261002i-debate-leads-with-who-has-cited-this-article.md), commit `177b69c58`).
It measured the result as rows **kept**: 4 before, 10 after.

A day later Greg wrote that Debate "doesn't tell me anything about how the paper has been received
more generally" (report `spya-caue42`). On his paper the search had found nothing to keep. But on a
paper with a famous published reply, *Attention is not Explanation*, two fresh runs each kept one
reception row, the reply itself, and **the panel showed neither** until a slider was moved.

The panel's identification bar hides a row whose page only *names* the piece and shows one that
*quotes* or *links* it. Its default has been `quoted` since 2026-09-06 (commit `04f7b3675`), chosen
on a three-article corpus to hide one decoy: a page about a different document with the same title.
At the time, a row that named the piece was the weak case. 261002i made it the main case. It told
the model to witness a citing paper by its title or its reference-list entry, and a paper that
cites another almost never quotes its sentences. So the rows the change was built to add are
`named`, and the default hid them, under a line reading "1 response is hidden".

Nobody saw it, for three reasons. The eval and the plan counted rows in the stored debate, which
is upstream of the bar. The panel's tests pinned the default as correct (`expect(DEBATE_LEVEL_DEFAULT).toBe("quoted")`),
so they were green. And the reader was told, truthfully, that something was hidden, in a control
whose label ("identification") did not say what.

## The root cause

Two decisions, each measured, were made about the same population at different times, and the
second did not re-ask the first. The default was a statement about what `named` rows usually are.
The search change altered what `named` rows usually are. Nothing connects the two: the default is a
constant in a client file, the population is made by a prompt on the server, and the only check on
the default is a test that restates it.

## The class: measured at the store, hidden at the screen

A change widens what a stage produces and is measured where the stage writes. A filter with a
non-trivial default sits between that and the reader, tuned for the population as it used to be.
The measurement goes up and the screen does not change.

It is a relative of *something reporting success while doing nothing*
([silent-success.md](../reusable/silent-success.md)): the success was real, and one step short of
the person it was for. It will recur wherever a list has a default threshold: Glossary's `?gate=`,
Quotes' `?bar=`, Search's `?conf=` are the same shape.

## The fix

Shipped, and the one that is right for the long term: **the default view hides nothing, and the
doubt is shown as layout rather than applied as a filter.** Reception lists the rows that quote or
link the piece first, and the title-only rows under a heading that says so. The decoy is on screen
and labelled; the genuine reply is on screen too. The slider and `?name=` are gone.

The first draft of the fix only moved the default to `named`. GPT Sol's plan review (F5) pointed
out that this puts the known decoy first in the list, looking like reception. A default moved is
still a default tuned to one population.

## What would have caught it, ranked by ease against value

1. **A test that every stored row is on screen when the reader has touched nothing**, in each
   sub-mode. One assertion, and it fails the moment any default hides a row. Done, in
   `tests/debate-panel.test.tsx`.
2. **When an eval reports rows kept, also report rows a reader would see with defaults.** A habit,
   stated as a rule: measure at the screen, not at the store. `replay --rows` now prints each kept
   reception row's identification level, which is what showed this; with the bar gone there is no
   second number to print for Debate.
3. **A rule for the other threshold bars: a default may hide rows only if the panel's first line
   says how many.** Not done here. Glossary, Quotes and Search each chose their default against
   their own data, and each already prints what is hidden. Worth a look in the next codebase
   sweep, not a change to make blind.
4. A browser check of the mode after every prompt change. Rejected as the answer: 261002i's change
   had no UI in it, so nobody would have thought to look, and the rows were hidden behind a
   truthful note that reads as normal.
