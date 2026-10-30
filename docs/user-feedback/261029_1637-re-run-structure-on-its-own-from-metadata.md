---
reports: spya-cqg70c
ending: shipped
comment: Structure now has its own row under Metadata › AI processing, and Structure › Run again in the command bar. On this paper it can build the deeper tree once the change is deployed and the AI key resets on 1 November.
---
# Re-run Structure on its own, from Metadata

Report #739, `spya-cqg70c`, Greg (admin, `feedback-reporter.ts` exit 0), a suggestion, 2026-10-29
16:37 UTC, from the Metadata page of *Consciousness in AI* (`arxiv-2308-08708-spya-xax6v4`). Sentry
event ef9a9f4cb5204179828455c2ac6f6fa8. No addenda when re-read before acting and before this note.
Session `fbgkmgdd-reimport-and-rerun-a-stage`, together with its companion report.

> In the most recent feedback report, I said I was going to try and rerun the structure mode. I'm
> looking at it in metadata, and I can't see a way to rerun just the structure mode...?

**Ending: Shipped** — on `dev`, not deployed.

**Why it was missing.** Structure was left off Metadata's re-run list on purpose (2026-09-07): a
forced run throws away the paragraph labels and queues the slow labels pass to write them again,
and that second cost was hidden behind the press.

**What we did.** *Structure* is now a row under *AI processing*, and *Structure › Run again* in the
command bar (also *rerun structure*, *rerun outline*). Its note says what the press does: it builds
the outline again with today's Structure, usually reusing saved answers when nothing has changed,
and the paragraph labels are rewritten after it and missing until then. That is honest because the
structure answer and the labels are saved per exact request, model and prompt version. So a press
over an unchanged article mostly replays, and it buys a new tree when how Structure is made has
changed, which is the case you wanted it for (the deeper level from
[261029_0300](261029_0300-structure-one-level-deeper.md)). Comments, notes and bookmarks are
untouched; they are pinned to block ids, which a Structure run does not change.

**A bug found on the way and fixed.** After any Structure re-run, the summary-of-each-part arc
could stay on screen with its sentences for the re-cut parts silently dropped. That was already
true after Structure's own *Try again*, in every tab but the one that pressed. The article load now
leaves out an arc that no longer has exactly one sentence per part, and the owner's view makes it
again. Public and shared-link readers see no arc rather than a broken one. A tree that only went one
level deeper inside its parts keeps its arc (GPT Sol's plan and code reviews).

**Known limits**, in the plan: other modes made from the old tree may say they are out of date, as
after a reset, and none remakes itself; cross-references go quiet after a re-cut tree (queue item
`qi-74cjmsq2`); the row is free again before the labels land, so a second press replays.

**What waits**: no real Structure run was possible here (the AI key is over its limit until
1 November). Tests cover the list, the bar's words and the arc check, which was seen red without
the fix.

Plan [261029l](../plans/261029l-re-run-structure-from-metadata-and-start-again-from-the-command-bar.md).
Companion: [re-import from the command bar](261029_1635-re-import-from-the-command-bar-and-the-wipe-option.md).
