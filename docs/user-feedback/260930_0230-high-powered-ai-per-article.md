---
reports: spya-s2rsxy
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

**Ending: Shipped** — on `dev`, not deployed. Resolve 6C (this session has no Sentry sign-in, so
the next feedback sweep does the status write). The reader-facing half waits on Greg and has its line
in [awaiting-approval.md](awaiting-approval.md).

What we did: a **High-powered AI** switch per article, at the top of *Re-run AI processing* on
`/metadata`, visible to the administrator only. Switched on, that article's capable-tier calls — the
pipeline modes and chat, explain, search, quiz marking, referee, citations — go to Claude Opus 5.5
instead of Sonnet 5, at twice the token price. Quick jobs, PDF reading, dictation and images do not
move. Switching either way re-runs nothing; *Run it again* on a mode is how you redo it with Opus, and
what Opus wrote stays current after you switch back. Checked end to end on the local stack: the
ledger records Opus sent and answered, and switched off the same mode skips as already done.

**Not built, and why:** the two-docs charge (one if public), the refusal with one doc left, the
import-time flag, and the `/pricing` and `/features` lines. That is slot accounting and published
copy; the plan's § Deferred has the recommendation (a one-time charge of one extra article when first
switched on, so private totals two and public one) and draft copy.

**For Greg to look at:** one new clause on `/privacy` naming `claude-opus-5-5`, which the privacy
test requires of every model the app can send.

Plan: [260930f](../plans/260930f-high-powered-ai-per-article.md).
