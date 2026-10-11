---
reports: spya-h2d3my
ending: shipped
comment: Both Needs a decisions now show one number, the questions waiting on you, so one you have replied to or deferred no longer counts. A report's row says Waiting.
---
# Needs a decision: one number on the pill and the button

An admin report from Greg (`scripts/feedback-reporter.ts` exit 0), `spya-h2d3my` (#575,
SPIDERYARN-READING2-HS), filed 2026-10-11 at 15:26 UTC from `/` (build `5ee936b6`). Queue item
`qi-3j3j269j`, session `fbh2d3my-needs-a-decision-counts`. Plan and reviews:
[261011ad](../plans/261011ad-needs-a-decision-one-count.md).

> In feedback reports, the needs a decision in the top right next to Write and Earlier gives a
> different count than the needs a decision next to open, shipped, etc. And one of them says it
> needs my decision for something that I think I deferred, so that doesn't seem like it does
> actually need my decision.

**Ending: shipped**, on `dev`.

**What was wrong.** The button beside the tabs counted the question threads waiting on Greg. The
pill counted his *reports* whose notes say awaiting, with `· N to decide` beside it. A reply or
Defer changes a thread's state at once, but a report stays waiting until an agent's note lands.
Measured read-only against production, with the deployed build's compiled questions: the pill said 1
and the button 4. The pill's one report was `spya-x6qjbn`, whose question `q-a0qp3x` Greg had
already answered, which is the "doesn't actually need my decision" half. The sweep's lead was a
deferred question, `q-xd9es7`. It was correctly *Deferred*, but its report (`spya-thpsnd`) is
shipped, so it was in neither count.

**What changed.** The pill draws the button's own number: the live threads waiting. A replied or
deferred thread is not counted, and a report waiting on a question nobody has written yet is not
counted either; it is still listed under the pill, as before. The suffix is gone. A waiting
report's row in *All* says **Waiting**, so *Needs a decision* now means only a thread that needs
one. What it gives up: the five pills no longer add up to All.
[feedback.md § What became of each report](../project/feedback.md#what-became-of-each-report-for-an-admin-since-2026-10-07).

GPT Sol's plan review said RETHINK, and argued for renaming the pill instead. Opus arbitrated: the
button opens exactly what the pill opens, so the two must say the same thing. The row change came
from Sol's review.
