---
reports: spya-s2rsxy
parts: 2
ending: shipped
---
# High-powered AI, per article

SPIDERYARN-READING2-6C (report `spya-s2rsxy`), from Greg (admin — `scripts/feedback-reporter.ts`
exits 0 for the issue's user id), a suggestion sent from `https://www.spideryarn.com/` at 02:30 BST.
The report id was read from the production `feedback` table (read-only); this session runs on a pool
account and could not read Sentry.

> In some cases, for difficult articles, we might want to really be using the best AI thinking
> available. So, for example, we might switch Sonnet -> Opus or whatever, especially for the modes
> that will benefit from greater intelligence, like chat or summary or trajectory or, well, probably
> most of them.
>
> We also need to provide a way for the user to specify this in the UI. I think the two obvious
> places would be during the import process as a flag they can flip while it's importing, perhaps up
> to the point where it starts doing the structure. I don't know, or keep it simple and find a
> natural place in the UI to include it. And also, I guess we might want to include it in the
> metadata mode, perhaps in or near the section about running the AI processing again, so that you
> could easily say, I want to switch to the high-powered AI and run things again, and presumably a
> way to switch back again, though you wouldn't want to rerun things. You just might say go.
> Forward, I worry about that with this cleverer model. There's probably a lot of potential
> complexities to this. So, you know, write a doc about it, implement it. But if there's
> complexities, try and look for a sort of simple but decent v1 that communicates clearly to the
> user, you know, gets 80% of the value for 20% of the effort.
>
> Oh, and I think this should broadly double the processing cost for an article. So we should flag
> that somewhere in a small way on the pricing page, mention in the features that this is an option,
> document it in our docs. And I guess it means it probably would be disabled if they've only got one
> doc remaining, because it requires two docs in order to do it. And I suppose it interacts with the
> public pricing. So I think we'd said something like, if you make a document public, i.e. publicly
> shared, then that only costs half a doc. So I suppose you could do the high-powered AI processing on
> a doc you've made publicly shared, and it would cost a single doc, because the 0.5 multiplies by
> the two.

**Ending: Shipped**, in two halves, both on `dev` and not deployed. Resolve 6C: this session has
no Sentry sign-in, so the next feedback sweep does the status write. The admin half is in commit
`8784aeee` and nearby, [260930f](../plans/260930f-high-powered-ai-per-article.md). The reader half
is in commit `3b515253` and the code-review commit after it, [260930k](../plans/260930k-high-power-for-readers-and-cost-only-for-admins.md),
built on Greg's answers relayed by the Overseer around 23:00 on 2026-09-30.

**What a reader gets.** A **High-powered AI** switch at the top of *Re-run AI processing* on
`/metadata`, on their own articles. Switched on, that article's capable-tier calls go to Claude Opus
instead of Sonnet: the pipeline modes, and chat, explain, search, quiz marking, referee and
citations. Quick jobs, PDF reading, dictation and images do not move. Switching re-runs nothing;
*Run it again* redoes a mode with Opus.

**What it costs, read against billing** (Greg: *"it should double the processing cost
per-article"*):

- **Private article:** switching on counts as one more article, so two in all with its ingest.
- **Public article:** half of one more, so one in all.
- **Charged once per article, in the period it is switched on.** Its age doesn't matter: an old
  article switched on this month costs one article of this month's allowance.
- **Switching off refunds nothing, and switching on again is free.** That closes *switch on, run
  everything on Opus, switch off*.
- **It must fit whole.** With less than that left, it is refused (`[pay-high-power]`).
- **The administrator is exempt**, as with ingests.

`/pricing` has an answer for it, and `/features` a line. Both state the price in articles.

**/privacy** now says "Opus or a similar frontier model", in Greg's words, and the test that every
model is covered still holds, through an approved-wording table. It also now names Illustrated's
image model, which had been missing from the model list altogether.

**Report 68's rule, audited.** No AI cost figure reaches a non-admin. The ledger was already safe:
the cost route is behind `/api/admin`, and no reader payload carries a cost field. **Five
hand-written dollar figures were not safe**: Sketch "about $0.20", Illustrated "$0.40–$0.65", a
debate re-run note, the reset dialog, and a `/changelog` entry. All five are gone, and
`tests/no-ai-cost-for-readers.test.ts` fails if one comes back.

**Not built:** the import-time flag. The first pass of an article is always Sonnet; switch on, then
*Run it again*. That is the natural next step, and it needs its own plan, because the charge would
have to ride the job.
