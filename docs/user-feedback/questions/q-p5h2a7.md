---
id: q-p5h2a7
report: spya-mdp0em
status: answered
asked: 2026-10-08
title: Public shelf topic pills: may I build them, automatic up to 20 articles with an admin rebuild button beyond?
refs: SPIDERYARN-READING2-BX · qi-4far27sc · follows q-deh67j · docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md · docs/investigations/261008a-public-shelf-topic-rethink-cost.md · docs/user-feedback/261004_1000-topic-pills-on-the-public-shelf.md
---
You said: make the public shelf's topic pills update by themselves, billed to the site, if each update costs half a cent or less and I am confident of it; otherwise an admin-only button. I measured it. Filing one article into a 20-article tree was far under half a cent; it remains one bounded call as the shelf grows, so I expect that to stay under the bar. Full rebuilds are under it only while the shelf is small. Nothing is built yet, because it changes what a stranger's page receives, which is a security defence only you can approve. May I build it?

A. Yes, automatic up to 20 public articles, with a button on the admin page beyond that (recommended). When someone shares an article, it is filed into the existing pills, about 0.01 of a cent, billed to a new site account. Now and then the whole set is rebuilt: 0.03 of a cent today, about 0.1 of a cent at 20 articles. Past 20, a rebuild can cost more than half a cent, so it waits for you to press Rebuild on the admin page, which says when one is due. New shares are still filed automatically. About a day and a half. It also creates one account in production that cannot sign in, so the spend has somewhere to go.

B. Yes, and fully automatic at any size. No button. Gives up your half-cent bar: a rebuild is about half a cent at 45 articles, and the measured 96-article run cost 1.44 cents.

C. The admin button only, nothing spent automatically. Gives up freshness: a newly shared article is in no pill until you press it.

D. Not now.

Either way, pills appear only once 8 articles are public, the same rule as your own shelf. Today there are 6.

Details

What you asked. On 2026-10-04 you asked for topic pills on the public shelf, the /read/public page that lists every shared article for anyone, signed in or not. On 2026-10-08 you confirmed that is the page you meant, and set the half-cent bar.

What I measured, on the code that would run, with no reader profile. A full rebuild of today's 6 public articles cost 0.03 to 0.04 of a cent in three runs. 20 articles: about 0.09 of a cent. 45 articles: 0.48 and 0.52 of a cent in two runs, so already at the bar. 96 articles: 1.4 cents. Three different new articles filed into the 20-article tree for 0.007 to 0.011 of a cent each. The jump between 20 and 45 is where a subject gets big enough to earn finer topics inside it. A failed call that is tried again could roughly double that part of a run, which is why the cut-off is 20 and not 40.

How it would work. Your own pills are stored once per reader and updated when your shelf changes. The public shelf has no reader, so the site account stands in for one. A stranger opening the page gets the stored pills with the cards, in the same single request as now. Nothing is worked out for them and nothing is spent. The pills are made only from the shared articles' titles and one-line summaries, which the page already shows. Nobody's profile and nothing private goes in. If an article is un-shared, the public pills disappear until they are rebuilt, because a pill's name may have come from that article's title. Under 20 articles the un-share itself rebuilds them, so strangers will rarely see the gap.

What you are approving. What a stranger's page receives gains the pill names and which cards are under each, and the page draws them. For the first time a request records spend against an account other than the person making it. One new account in production, which cannot sign in, is left out of the reader counts and is labelled as the site on the costs page. And the privacy page gets one line: shared articles' titles and summaries go to OpenAI to name the public pills, as they already do for their owner's own pills.

One new risk. Today a hostile title can only put its own words on its own card. With this it could also nudge the pill names, and which other people's articles sit under them, on the public shelf. The limits are the ones your own pills already have: names at most 40 characters, shown as plain text, and the model can only point at articles it was shown.

Abuse. Someone who shares and un-shares over and over can make the site pay at most about 8 cents a day before the usual limit stops it. Then the public pills stop updating until the next day.

What would decide it. A if you want it automatic within your half-cent bar. B if a cent or two now and then, once the shelf is big, does not bother you. C if you would rather nothing was ever spent automatically. D if 6 public articles do not need pills yet.

## Greg's answer, 2026-10-09 (in the Overseer's terminal, not the Feedback dialog, so no reply id)

> q-p5h2a7 A
>
> — Greg, 2026-10-09

Option A: automatic up to 20 public articles, billed to a site account, with a Rebuild button on
/admin beyond that. Built in plan docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md.
