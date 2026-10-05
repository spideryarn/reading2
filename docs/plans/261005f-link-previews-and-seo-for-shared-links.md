# Link previews that look like something, and what SEO would take

Up: [plans.md](../project/plans.md)

Two reports from an admin, so trusted input. The research is
[261005b](../research/261005b-link-previews-and-seo-for-republished-articles.md).

`spya-jwepsa`, Greg, 2026-10-04:

> If I share a Spideryarn link (e.g. on X/Twitter, WhatsApp, Facebook, etc etc), make sure it looks
> nice. Probably the article title and/or authors first in the title, then `- Spideryarn`. Probably
> a 1-sentence summary of the article (as per the Metadata page for the description.
>
> Should we also mention "powered by Spideryarn, for deep & efficient reading", or something like
> that?
>
> Use Sonnet for web research on best practices for this kind of thing. Use your judgment.

`spya-qfu4uz`, Greg, 2026-10-04:

> Let's try and improve Spideryarn SEO.
>
> For public articles, I want to make sure we're behaving ethically, so we're pointing the article's
> origin as the canonical link. That should still be the case. Perhaps we should even do a tiny bit
> of work to find the canonical url in the case that users uploaded them? Dunno maybe that's
> overkill, and would surprise users.
>
> But beyond that, presumably we could be providing a nice description and keywords and snippets and
> anything else that's ethical and valuable to search engines, SEO, and users.
>
> Use your judgment within reason, and ask me if you have questions that involve tradeoffs.

## Where we start from

More is built than either report assumes, and one thing is the opposite of what the second assumes.

- A shared `/read/<slug>` already has a server-written head: `<title>` ending ` · Spideryarn`,
  `og:title` (the bare title), the gist as the description, `og:site_name`, `og:url` (ours), and a
  canonical pointing at the original ([`src/public/page-head.ts`](../../src/public/page-head.ts)).
- It has **no image and no author**, and X is asked for the small card.
- **Every other page** (`/`, `/changelog`, `/features`, `/pricing`) is the static shell, whose head
  says *Spideryarn* and one line of description, with no `og:` tags at all.
- `robots.txt` lets in two preview robots, Meta's and X's, and only under `/read/`. LinkedIn,
  Telegram and Discord are refused, so a link there is a bare URL.
- **The whole site is `noindex`**, by `robots.txt`, a header and a meta tag, and
  `/features/public-readable-sharing` tells authors "we are not in search engines at all". Nothing a
  search engine could read is read. So "improve SEO" is first a decision to be listed at all.

## What is built now: the link preview

All of it is what a card says. None of it changes what a search engine may do.

1. **A brand image on every card.** One static `public/og-card.png`, 1200x630 and under 300KB (the
   size WhatsApp is reported to drop a thumbnail above): the logo, the word *Spideryarn*, and the
   strapline *AI-assisted reading*, which is Greg's own and already on the homepage tab. Made once by
   `scripts/make-og-card.ts` (headless Chrome over a small HTML page) and committed, so nothing runs
   at build time. Tags: `og:image`, its width, height and alt, `twitter:image`, and
   `twitter:card` becomes `summary_large_image`.
2. **The authors after the title, on the card only.** `og:title` and `twitter:title` become
   `Title · Jane Doe`, `Title · Jane Doe and John Smith`, or `Title · Jane Doe et al.` for three or
   more. From the structured `article_revisions.authors`, and only the names the public byline
   already contains (`publicAuthorNames`): a visitor is sent `byline` and never `authors`, so the
   byline is the licence. A web page with only a free-text byline ("By Jane Doe | Staff reporter")
   gets none, because that is not clean enough to print in a title. Nothing is added when the title
   was cut at the 120 clamp, or when the names would push the whole string past it. The tab's
   `<title>` does not change, because React rewrites it a second later and the two must agree
   ([page-titles.md](../project/page-titles.md)).
3. **A card in every other page's head.** The static head in `index.html` gains `og:title`
   (`Spideryarn · AI-assisted reading`, the homepage's title), `og:description`, `og:site_name`,
   `og:type=website`, the image tags and the Twitter ones. No `og:url`: one static head serves every
   path, so any address in it would be wrong for most of them, and `og:url` is also the signal
   `articleWaitTitle` reads to know a head was composed for an article. Open Graph lists `og:url`
   as required; platforms use the address they fetched when it is missing, and that is to be looked
   at after the deploy.
4. **The other preview robots are let in, to three paths.** One `robots.txt` group naming
   `facebookexternalhit`, `Twitterbot`, `LinkedInBot`, `WhatsApp`, `TelegramBot`, `Discordbot` and
   `Slackbot`, with `Allow: /read/`, `Allow: /og-card.png`, `Allow: /$` (the homepage alone) and
   `Disallow: /`. The `*` group keeps `Disallow: /`. The picture needs its own line: a robot shut
   out by `Disallow: /` cannot fetch the image a card names.
5. **The sentence that names this hole to authors is corrected**, on
   `/features/public-readable-sharing`. It said Facebook's and Twitter's fetchers, at `/read/`. It
   now names the seven platforms, the homepage and the picture of our logo. A test holds the page
   to `robots.txt`, robot by robot and path by path.

### The choices in that, and the simpler thing each passed over

- **A static image, not one per article.** Passed over: the article's own lead picture, which is
  what most previews show, and a generated image with the title drawn on it. The lead picture is
  somebody else's image on a card with our name on it, and `page-head.ts` already refused it for
  that reason; a generated one is a new endpoint and a renderer. Both are later, and the first is a
  question for Greg (Q-lead-image).
- **`summary_large_image` with a brand image** makes every share of ours look alike on X. Accepted:
  Facebook, LinkedIn, Slack and Discord draw a 1200x630 image large whatever X is told, so the small
  card would only make X the odd one out.
- **No tagline in the title or description.** WhatsApp's own guidance is a title "without any
  branding", and it shows about 80 characters of description, which the gist needs. The strapline is
  on the image and the name is in `og:site_name`. Greg's "powered by Spideryarn, for deep &
  efficient reading" is a new published sentence, so it is asked (Q-tagline), not written.
- **Three paths for the preview robots, not the whole site.** The first draft of this plan gave
  them `Allow: /` and `Disallow: /api/`, so that a new page could never be forgotten. GPT Sol's plan
  review refused it: nothing private would be exposed, since every other path answers with the bare
  shell, but it goes well past the hole we describe to authors. So the group keeps `Disallow: /`.
  **The cost, named**: `/changelog`, `/features`, `/pricing` and the rest have a card in their head
  that Facebook's, X's and LinkedIn's robots are not let in to read. WhatsApp, iMessage and Slack
  are not known to consult `robots.txt` for a preview, so they will draw it. Letting the robots in
  to those pages is a line each, and is Q-cards-for-other-pages.
- **`scripts/check-public-shell.ts` changes with it**, since it is the deploy's check on this head.
  - It told the default shell from a composed one by `og:title` being absent. The default now has
    one, so the default's must be the default's exactly, and `og:url` must be absent.
  - An article's `og:title` may be the title alone, or the title, ` · ` and something. **That is a
    weaker check than the exact one it replaces**, and Sol said so: `Title · Wrong Person` passes.
    The names come from a column the public payload does not carry, and publishing a names-only
    projection so that a deploy check can be exact is more surface than the check is worth. A head
    composed from the wrong article still fails, on the title.
  - Its robots judge learns the seven names and three paths, and now refuses a named group with no
    `Disallow: /` of its own.
  - It gains a check that `/og-card.png` is answered as a PNG, since a missing file there is
    answered by the SPA shell with a 200.

### Tests

`tests/page-head.test.ts`: the image and card tags on a composed head, one of each; the author forms
(one, two, three, none; a clamped title and an over-budget one taking none); the tab title unchanged
by authors; an author's name escaped like any stranger's text. `tests/public-dto.test.ts`: only the
names the byline shows. `tests/public-read-rewrite.test.ts`: the robots group, its four rules, and
`*` unchanged. `tests/og-card.test.ts`: the PNG is 1200x630 and under 300KB, its address is written
out, and the default head names the same picture, carries no `og:url`, and keeps every card tag
inside the managed region. `tests/public-readable-sharing-page.test.tsx`: the page names every
robot and path in `robots.txt`. `check-public-shell --self-test` covers its changed judgements.
Two of these were seen red by mutation: a fourth `Allow:` line, and `publicAuthorNames` ignoring
the byline.

The real check is a pasted link after a deploy, which no test here can stand in for.

## What is not built: search engines

**Nothing in the second report can take effect while the site is `noindex`**, and lifting that is
Greg's: it reverses a standing decision ("a private beta, none of it meant to be listed yet",
`public/robots.txt`) and changes a sentence we publish to authors. So this half ends *awaiting
Greg*, with the questions below. What the research says, shortly:

- **Shared articles should stay out of search.** Google's own advice to a republisher since 2023 is
  to block indexing, not to rely on a canonical, because a canonical is a hint it may ignore when the
  copy looks different, and ours does. If it is honoured our page is invisible anyway. The canonical
  we publish stays, as the second line of defence it already is.
- **The value is in Spideryarn's own pages**: `/`, `/features`, `/pricing`, `/help`, `/changelog`,
  `/privacy`. Opening those is about a day: `robots.txt`, the header in `vercel.json` narrowed by
  path, a `sitemap.xml`, a self-canonical and a server-written title and description per page, the
  deploy check, and the sentence on `/features/public-readable-sharing`.
- **Keywords**: no engine uses them. **Structured data** on a republished article would have to
  name the original's author and publisher, and is read by nobody while the page is `noindex`.
- **A canonical for an upload**: only from something explicit in the file (a DOI, an arXiv id, a
  `rel="canonical"` in an uploaded HTML page), never from a guess. It too does nothing while
  `noindex` stands, so it is not worth building first.

## Questions for Greg

- **Q-index-own-pages.** Let search engines list Spideryarn's own pages (not anybody's articles)?
  Recommended: yes.
- **Q-index-shared-articles.** Should shared articles ever be listed? Recommended: no.
- **Q-tagline.** A line such as "powered by Spideryarn, for deep & efficient reading" on the card?
  Recommended: not in the text; the image carries *AI-assisted reading*, and its words are his to
  change.
- **Q-lead-image.** Use the article's own lead picture on the card when we host a copy?
  Recommended: not yet.
- **Q-cards-for-other-pages.** Let the preview robots in to `/changelog`, `/features`, `/pricing`,
  `/help` and `/privacy` as well as the homepage, so that a link to any of them draws a card on
  Facebook, X and LinkedIn? Recommended: yes; it is a line each, and a few words on the page that
  names the hole to authors.

## Reviews

GPT Sol reviewed this plan on 2026-10-05, before the build: approve with changes. Taken: the
narrower `robots.txt` rule and the corrected published sentence; the robots judge in the deploy
check, which the first draft had missed and which would have failed the next deploy; one budget for
the whole card title; the image address written out in a test, and a deploy check that it is
served as a PNG; and softer wording in the research where it had overstated what a canonical does
not do. Not taken: an exact deploy check on the authors, for the reason given above.
