---
reports: spya-hwdefp, spya-v322fd
ending: awaiting
comment: Waiting on you: not built, because you asked to discuss first and every version changes who may read an article. Three stages, three questions. Recommended: a private link first.
---
# Share an article with some people

Two reports on one subject, both from Greg (admin, each proved by `feedback-reporter.ts` exit 0),
filed from the signed-in home page: `spya-hwdefp` at 2026-10-04 20:30 UTC (Sentry event
`497220526b1b4f41bdc20ce3603ee314`) and `spya-v322fd` at 22:21 UTC (SPIDERYARN-READING2-D7). The
words are from the reports' production rows, as the Overseer relayed them.

`spya-hwdefp`:

> I would like to be able to share articles with a subset of people. There's a lot of potential complexity to this:
> - Ideally we'd be able to add a list of email addresses, and only those people could see it.
> - It would need to send them an email when shared with them.
> - It means the UI needs to support & distinguish public vs shared articles, and adding new people (so you can share with multiple people), and seeing who you've shared with, and how it looks to a person looking at an article that has been shared.
> - Ideally multiple people (including sharees can comment), and perhaps even use the AI processing. Hmmm. That could get complicated for cost-tracking, cos ideally I'd want to know exactly who incurred which costs.
> - Probably the owner (original uploader) of the article is the only person that can modify or view the list of sharees
> - As a bonus, I would quite like to be able to share articles with particular people who aren't logged-in yet. But then I suppose it would be a share link, and there's nothing stopping them passing it on. Probably best to say that shared articles require the sharee to be logged-in for now.
>
> Maybe the simpler 80-20 solution would be to create a special link and anyone who has that link can view the article, kinda like a public article with a password embedded in the url. (Perhaps with the ability for the owner to invalidate previous shared links, or to make them time-bound. But actually, I think those ideas are out of scope for a v1). But this is less secure, and probably then we wouldn't want them to be able to incur costs.
>
> Perhaps the ideal would be offer both options:
> - Share with email addresses, and allow them to run AI processing, and track the costs to them. If the email address isn't already a user, then it would somehow deal with that in a nice way, e.g. the email would say "[person X] has shared [article Y] with you - sign in here to be able to access it" etc.
> - Share with a special link, but then sharees can't run AI processing.
>
> If any of the above adds substantial complexity, let's stop and discuss. Or do the simpler version first if there is one.

`spya-v322fd`:

> In a previous feedback report, I talked a lot about being able to share articles. I think one of the most important things is that people can comment on them and highlight stuff. I guess if it doesn't involve AI processing, then we should let them. It's tricky. I would like to allow people to do it, even if they aren't logged in, but then we won't know who did it. So I guess only if they're logged in can they actually comment or highlight or anything else.

**Ending: Awaiting Greg.** Nothing built. Mark both ignored in Sentry, with this reason; the next
feedback sweep does the status write.

Two things stopped it. Greg asked to stop and discuss if it adds substantial complexity, and the
email version does. And every version changes who may read an article, which is a listed security
defence that an unattended session does not edit.

The plan sets out three stages and recommends the first: a private link that anyone holding it can
read, not listed, no AI, which the owner can turn off. Then comments and highlights for signed-in
people who have the link. Then named email addresses, with an invitation and AI charged to whoever
ran it, which is the large one. Three questions are put to Greg: which to build first, who sees a
sharee's comment, and whether a link-shared article counts against the allowance as private.

Queue entry `qi-98933vdd`. Plan:
[261005e § Questions for Greg](../plans/261005e-share-an-article-with-some-people-a-private-link-first.md#questions-for-greg),
reviewed by GPT Sol
([review](../plans/261005e-share-an-article-with-some-people-review-sol.md)).
