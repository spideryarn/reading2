---
reports: spya-qxufp9
ending: declined
---
# Parts & Sections stay at import

SPIDERYARN-READING2-7V (report `spya-qxufp9`), from Greg (admin, verified by
`scripts/feedback-reporter.ts`), in production, build `7aaead6d`, on
`/read/what-if-we-had-bigger-brains-imagining-minds-beyond-ours?mode=summary…`. This session ran on
a pool account and could not read Sentry.

> It looks as though we generate the Summary-mode Parts & Sections automatically on article import.
>
> Do we need to do that? Could we defer generating them until they're needed (e.g. if the user
> clicks on the Summary mode or anything else that depends on them?
>
> If that's going to substantially complicate things, stop and let's discuss.

**Ending: Declined** — resolve 7V (the next feedback sweep does the Sentry status write).

Why: the Parts & Sections were the Hierarchy stage's summaries on the article's one tree, and that
tree is what Structure, the Masthead, the shelf, hover cards, Diagram and Debate all read from the
moment the article opens. One model call writes the tree and its summaries together, so deferring
them means splitting that stage or opening articles with no tree yet — the substantial change you
asked to be told about. You reached the same answer when Summary lost them (spya-b3ggv4):

> if they are the same data that we need for Structure mode, I guess we still need to do the AI
> processing for them.

Summary no longer shows them at all (fb7q-7r, 2026-10-01). Two things already go after the cost you
were pointing at: bulk import's **minimal papers** skip the tree until you press *Read this*
(261001m), and the thinking-effort eval is measuring whether Hierarchy needs its `high` effort
setting.

Plan: [261002a § 7V](../plans/261002a-summary-generates-on-open.md). The companion report, 7T, is
[261001_0933](261001_0933-opening-summary-writes-it.md).
