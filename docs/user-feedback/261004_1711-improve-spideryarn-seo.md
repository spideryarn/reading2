---
reports: spya-qfu4uz
ending: shipped
---
# Improve Spideryarn's SEO

From Greg (admin; the Overseer relayed the report's production row), filed 2026-10-04 17:11 UTC
from `/changelog`. Sentry event `8a91e0b92b6d4eba988893728732c8e0`.

> Let's try and improve Spideryarn SEO.
>
> For public articles, I want to make sure we're behaving ethically, so we're pointing the article's origin as the canonical link. That should still be the case. Perhaps we should even do a tiny bit of work to find the canonical url in the case that users uploaded them? Dunno maybe that's overkill, and would surprise users.
>
> But beyond that, presumably we could be providing a nice description and keywords and snippets and anything else that's ethical and valuable to search engines, SEO, and users.
>
> Use your judgment within reason, and ask me if you have questions that involve tradeoffs.

**Shipped**, on `dev`, 2026-10-05, after Greg answered the two questions: our own pages, *"yes
definitely we want those to be visible"*; a shared article, ever, *"no"*.

Search engines may now list nine pages of ours (the homepage, `/features`,
`/features/public-readable-sharing`, `/pricing`, `/changelog`, `/help`, `/privacy`, `/contact`,
`/opensource`), each with its own title, description and canonical, and a sitemap that names them.
Everything else still says `noindex`: every article, shelf, profile, admin page and API path. The
page that tells authors what we do with a shared article was rewritten to match. How it works is
[deployment.md](../project/deployment.md), under "Our own pages may be listed", and the plan is
[261005f § Stage 2](../plans/261005f-link-previews-and-seo-for-shared-links.md#stage-2-what-gregs-five-answers-build).

Not built, each named in the plan: the pages' text is still drawn by JavaScript, so a crawler that
does not run it sees only the head; keywords, which no engine uses; and a canonical for an uploaded
file, which does nothing for a page that is never listed.

Not yet checked: a deployment. Three things about Vercel's routing can only be seen on one, and
`scripts/check-public-shell.ts` asks about each.

What stood here before the answers:

*Awaiting Greg.* Researched and written up, nothing built, because the first step is his.

The whole site is out of search engines on purpose: `robots.txt` says `Disallow: /`, every response
says `noindex`, and `/features/public-readable-sharing` tells authors "It is kept out of search
engines". So no description, keyword or snippet we wrote would be read by one. The canonical
pointing at the original is there and unchanged.

What the research found
([261005b](../research/261005b-link-previews-and-seo-for-republished-articles.md)): shared articles
should stay out of search, which is what Google itself asks of a republisher; the value is in
letting search engines list Spideryarn's own pages; keywords are used by no engine; and a canonical
for an upload is only safe from something explicit in the file, such as a DOI.

The two questions are Q-index-own-pages and Q-index-shared-articles in
[261005f § Questions for Greg](../plans/261005f-link-previews-and-seo-for-shared-links.md#questions-for-greg).
