---
reports: spya-c5gvp0
ending: shipped
comment: Where it sits opens on a summary box (overview, its chat, a count per kind), then the findings folded by kind, the most worrying open. The tools moved up as Go further: buttons, each saying what it opens and costs.
---
# Where it sits: a layout you can take in at a glance

Greg (admin, `feedback-reporter.ts` exit 0), 2026-10-26 09:54 UTC, filed from
`/read/index-spya-wq3rud?mode=sources`. Sentry SPIDERYARN-READING2-PD (#714). Session
`fbc5gvp0-where-it-sits-layout`, with its siblings spya-mfuz6g and spya-pkpqch. It builds on the
session that made *Where it sits* the day before
([261025h](../plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md)), whose
Stage 4 it waited for and merged. No addenda when re-read before this note.

> The new where it sits submode of sources looks very powerful. The layout a bit confusing. Perhaps
> we could start with things being default collapsed so that I can easily tell what belongs to
> what. So, for instance, challenged would be default collapsed with a little indicator of how many
> are found or something. Or if you can find a better way of laying it out, maybe with sub-tabs or
> I don't know what. Just right now, when I ran where it sits, the output was good but hard to tell.
> Maybe it's just about groupings and boxes. Also, there were tools at the bottom that if I clicked,
> they kicked off chats somehow. I don't know. Should those be more prominent? Should they be
> buttons? Should they—how are they different? Could we fold them in and run them automatically?
> How can we make this less confusing, less manual for the user? Take lots of screenshots, get
> sub-agents to pretend to be product managers and users. Run some spikes. Really try and figure out
> a nice way of doing this. I feel like it's going in a good direction. Start with the goals of the
> user in mind. And remember to assume that the user is using it for the first time.

**Ending: Shipped**, on `dev`. Plan
[261026g](../plans/261026g-where-it-sits-made-clear-runs-itself-and-reaches-the-margin.md) §§ Stage
2–3, which has the evidence.

**How it was decided.** A browser agent shot the band on three articles, desktop and phone. Four
persona subagents — a first-time policy analyst, a cognitive-science postdoc, a product manager and
a UI designer — read the shots and your words, and agreed independently: *a count strip and folded
groups, not sub-tabs* (tabs hide the counts, which are the summary, and a third row of tabs does not
fit a phone), the most worrying group open, findings as cards, the tools made legible. That was
built, shot again, and read again by the analyst and the designer (*"mostly yes, much better"*); the
fixes from that second look went in too.

**What you will see.** A summary box: the head line, the overview, its chat button, and a count
strip, one press per kind, which opens that group and scrolls to it. Then the groups, folded, each
with its name, count and what the kind means, in the order that most changes how far to trust the
piece (Challenged, Since, Citation?, Not cited?, Reception, Supported), the first open. Each passage
is a card; its quoted words are themselves the way to the passage; two findings about the same words
share one quote. Then *What was searched*, then **Go further** — the four tools as buttons, each with
a line saying what it opens and where its cost is (for example *"Searching for them there costs a
few cents"*), the chat one with the chat icon.

**What was not done, and why.** Folding *Pages about it* and *Close to it, not cited* into the
dossier and running them on open: three of four personas suggested it, and it is the step after
this, but *Close to it* sends the piece's opening to OpenAlex (a privacy press today), *Pages about
it* is a second paid search on every open, and the literature search already looks for replies to
the piece. The clear buttons first, so you can judge it with the new layout in front of you. Also
left for you to steer by playing: the kinds' names (*Citation?* beside *Not cited?* confused both
personas; they are the margin's stamps too), the overview's length on a phone, and *Search again*
reading as one more tool.
