---
reports: spya-h3ac82
ending: shipped
---
# PDF transcription glitches: survey production, add the cases, fix the post-processing

SPIDERYARN-READING2-69, from Greg (admin), a suggestion. The time in the file name is when this
session picked the report up; it had no Sentry access, and the report text came in the brief.

> I think you now have access to the production database. So have a look at some of the articles
> and the transcribed versions of them, and look for little glitches. Look for ways in which author
> names got slightly mangled, or footnotes are not represented properly, or paragraphs that span
> pages are not kind of joined together, or any other sort of minor boo-boos in the transcription.
> And if you need to sort of then check against the original PDF or whatever, then you can do that.
> You should have access to that too, I hope. And then either add those papers to our evals or
> something to try and make minimal tweaks to whatever post-processing we do during the import
> process to fix those going forwards. Because my understanding is that we run a LUNA model, and
> maybe we need to upgrade it to Sonnet, but we run some kind of model that takes the output from
> the import process, the early stages, and does some kind of corrective stuff like this. And I'm
> just saying let's keep on improving it.

**Ending: Shipped** — on `dev`, not deployed. Resolve 69; the next feedback sweep does the Sentry
status write.

What we found, reading all 21 PDF articles on production (read-only) and re-reading 7 with the
current pipeline: the model had flagged every paragraph continuation correctly, and our renderer cut
~70 of them anyway, wherever a figure or a running footer or footnote sat between the halves. And
an author list was thrown away whole when one affiliation failed, leaving the byline with its
footnote markers.

What we did:

- Paragraphs cut by a figure, a table, or a page footer are joined back, where the page shows the
  sentence was cut.
- When every author's name checks out but an affiliation does not, the byline is the clean names.
- The real cases are in the tests.

Not done, and in the plan for Greg: showing a PDF's footnotes at all (they are transcribed but not
displayed), stacked NeurIPS-style bylines, re-rendering articles already on the shelf, and a model
switch to Sonnet — which nothing in the survey argues for, at about ten times the cost of every
import.

Plan: [260930e](../plans/260930e-pdf-transcription-glitches.md).

## Follow-up, 2026-09-30: Greg's answers, and footnotes shipped

> yeah, we could list them at the end somehow. and/or perhaps better still, make them clickable
> inline with a tooltip, then no need to list them at the end? go with whatever's simplest
>
> — Greg, 2026-09-30 (relayed by the Overseer), on footnotes

> sure, sounds good, but as i say, i'm more worried about things working well going forwards
>
> — Greg, 2026-09-30, on re-rendering the articles already on the shelf

**Ending: Shipped** — on `dev` as `ebee390c` (and its review fix, `bbccf08c`), not deployed. A newly imported PDF now shows its footnotes in a
Notes list at the end, and a marker in the prose (`…nonphysicalists13`) opens the same hover card a
web article's footnote does. Both came from one change, because the PDF renderer now writes the note
markup the web path already had. No prompt change, so no import costs more. On every cached
production chunk: 314 notes shown, 238 linked, and all 238 read by hand and right.

**Re-rendering the articles already on shelves: not done, and written up.** It needs a deploy first,
14 of the 23 would need a fresh paid transcription (they were read under older prompts), and every
later stage would re-run. Greg owns all 23, so after a deploy "Start this article again" on the
Metadata page does it one article at a time; the six live ones that re-render without a new
transcription are listed in the plan.

Still open for Greg: the trailing-author gap in the author check (on awaiting-approval.md).

Plan: [260930k](../plans/260930k-pdf-footnotes-shown-and-linked.md).

## Follow-up, 2026-10-01: stacked bylines and the trailing-author gap

> perhaps gather a whole bunch of different examples of different ways authors can be presented and
> create a little eval of this. It's not super-important though, so maybe start with just a v1
> improvement, and defer more complicated improvements to a future plan.
>
> — Greg, 2026-10-01

**Ending: Shipped** — on `dev` as COMMIT_PLACEHOLDER, not deployed. A PDF's author list is now taken
when the byline prints name / institution / email per author (NeurIPS), or the names together and
their addresses after (`{jacobdevlin,…}@google.com`), as long as there is one address per author.
The address count is what proves nobody was left out; an institution the model names is never
proof on its own. And the check now also looks after the last name, so a trailing author can no
longer be dropped (the gap left open above).

A new eval of 39 real bylines (`evals/pdf/bylines/`, in `npm test`): the old check let a dropped
author through in 60 of 739 derived answers, the new one in none; it takes 26 of the 39 clean
lists against 25. Six bylines the old check took (at the price of those drops) are now left as
printed; the shapes still to do, and the one risk the brief accepts — the model calling a person an
affiliation where no address count can catch it — are in the plan.

Plan: [261001l](../plans/261001l-pdf-stacked-bylines.md).
