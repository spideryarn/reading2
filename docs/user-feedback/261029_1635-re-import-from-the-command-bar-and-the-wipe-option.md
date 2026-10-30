---
reports: spya-gkmgdd
ending: awaiting
comment: Re-import keeping your data was already there (Metadata › AI processing › Whole article › Start again, behind the experimental switch); now the command bar finds it too. The wipe option is a question: q-bjkb37.
---
# Re-import from the command bar, and the wipe option

Report #738, `spya-gkmgdd`, Greg (admin, `feedback-reporter.ts` exit 0), a suggestion, 2026-10-29
16:35 UTC, from Structure on *Consciousness in AI* (`arxiv-2308-08708-spya-xax6v4`). Sentry
event 8a7a93eb0c7345aaadf074e32151c27c. No addenda when re-read before acting and before this note.
Session `fbgkmgdd-reimport-and-rerun-a-stage`.

> I was trying to find a way with Tomambar to sort of re-import or reload or reset a page, but I
> couldn't figure out how. In an ideal world, we'd have an easy way to do that, and it would—well, I
> guess there's two versions. One is sort of re-import, which might involve extra improvements and
> new stuff that we're doing now, but keep my data. And I suppose then there's another version,
> maybe with a special option that would be default false, for kind of wipe all of my chats and
> comments and bookmarks and input of all kinds as well. So in this case, what I want to do was to
> see the new structure mode in action, which would presumably involve re-importing this article, I
> don't know. Or actually, maybe I can just rerun the structure mode. Maybe I'll try that. But
> anyway, I still think it would be useful to be able to say I want to re-import this article, with
> or without kind of throwing away all of my user input.

"Tomambar" is the top bar, the command bar.

**Ending: Awaiting Greg**, on question **q-bjkb37** (the wipe). The rest is built and on `dev`, not
deployed.

**The re-import that keeps your data already existed**: *Whole article › Start again*, the first
row of Metadata's *AI processing* section ([260928a](../plans/260928a-reset-and-regenerate-article.md)).
It re-reads the stored copy with today's pipeline and keeps comments, highlights, bookmarks, notes,
chats and reading time, and a tick box makes the extra modes again too. It is behind the
experimental switch, and the section is shut until opened. **What was missing was the command bar**:
nothing answered *re-import*, *reset* or *start again*. Now *Start this article again* does (also
*reimport*, *reset article*, *start over*, *reload article*). It opens *AI processing*, where the
reset keeps its confirm. Like the row it leads to, it shows only while the experimental switch is
on. Could not check on production whether yours is on, so if it is not there, that switch on
/profile is why.

**Seeing the new Structure on this paper** is the companion report,
[spya-cqg70c](261029_1637-re-run-structure-on-its-own-from-metadata.md): *Structure › Run again*
re-runs only that step. Neither does anything new on this paper until the deploy and the AI key's
reset on 1 November.

**The wipe** destroys a reader's data, so it is a question rather than a build: q-bjkb37, with
*not now, delete and add again does it* as the recommendation.

**Spending was already settled**: both are slug-only jobs, so they spend no slot and we pay the
model cost ([billing.md](../project/billing.md#which-requests-spend-a-slot-and-why-the-wall-is-at-the-routes)).

Plan [261029l](../plans/261029l-re-run-structure-from-metadata-and-start-again-from-the-command-bar.md),
with GPT Sol's plan and code reviews beside it. Queue item `qi-74cjmsq2` holds the one thing found
and not fixed: cross-references go quiet after a re-cut tree.
