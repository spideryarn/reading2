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

**Decided**, Greg, 2026-10-05:

- Q-index-own-pages: **yes**. "yes definitely we want those to be visible"
- Q-index-shared-articles: **no**. "no"
- Q-tagline: **not in the text**, as recommended. "use your judgment"; the Overseer took the
  recommendation.
- Q-lead-image: **use the lead image** when we host a copy. "hmmm, not sure. go with the lead image
  for now"
- Q-cards-for-other-pages: **yes**. "yes, allow them"

Dispatched to session `seo-own-pages-and-cards`.

## Stage 2: what Greg's five answers build

Session `seo-own-pages-and-cards`, 2026-10-05. Q-tagline builds nothing.

### One list of our own pages

`src/site-pages.ts` is the allow list: each page's path, its tab title and one sentence of
description. Nine pages: `/`, `/features`, `/features/public-readable-sharing`, `/pricing`,
`/changelog`, `/help`, `/privacy`, `/contact` and `/opensource` (Greg: "and any other marketing
page"; `/login` is the app's door and stays out). Everything below is read from that list or held
to it by a test, so a page cannot be listed in one place and not another:

| What | Where | How it follows the list |
|---|---|---|
| who may crawl | `public/robots.txt` | written by hand; a test holds it, path by path |
| the sitemap | `dist/sitemap.xml` | written by the build from the list |
| the `noindex` header | `vercel.json` | one rule for every path **not** on the list; a test holds it |
| each page's head | `dist/_pages/<name>.html` | written by the build from the list |
| the deploy's check | `scripts/check-public-shell.ts` | imports the list |

### A head per page, written by the build

A search engine needs a title, a description and a canonical that are about *this* page, in the
HTML it is sent. Today every page that is not a shared article is one static file with one head.

After `vite build`, `scripts/build-site-pages.ts` writes, from the built shell and the list:

- `dist/shell.html`: the shell exactly as Vite built it, with the default head, which still says
  `noindex, nofollow`. The catch-all rewrite in `vercel.json` now sends every app path here, and
  this is the file compiled into the function for `/read/<slug>`.
- `dist/_pages/<name>.html`: the same file with the managed head swapped for one page's: its title
  (the string React sets a moment later, held equal by a test), its description, a canonical and an
  `og:url` naming itself, the card tags, and no robots tag. `vercel.json` gains one rewrite per page,
  ahead of the catch-all.
- `dist/index.html`: the homepage's head. `/` is answered from the file system before any rewrite
  is looked at, so the homepage's head has to be in this file.
- `dist/sitemap.xml`.

**Passed over: composing these heads in the serverless function**, as `/read/<slug>` does. It would
put a cold start in front of the homepage. **Also passed over: leaving `index.html` as the default
shell and dropping its `noindex`**, which needs no new file, but leaves the homepage with no
canonical and the bare word *Spideryarn* as its title until JavaScript runs, and takes the
fail-closed robots tag off every app page.

**The cost, named**: `dist/index.html` stops being "the shell". Three things that read it change to
`shell.html`: `scripts/client-shell.ts`, the hash comparison in the deploy check, and the catch-all
rewrite. `npm run dev` is untouched and serves the default head at every path, as now.

**A limit, named**: the body of every page is still drawn by React. Google runs it; a crawler that
does not sees the head and an empty page. And what a page fetches from `/api/` (the changelog's
entries, the shared articles on the homepage) is behind `Disallow`, so a crawler that renders will
not see those parts. Server-rendering the pages is the fix, and is a different project.

### `robots.txt`

```
User-agent: *
Allow: /$                 one line per page on the list, each ending in $
Allow: /features$
...
Allow: /assets/           the script and stylesheet, or a renderer sees nothing
Allow: /sitemap.xml
Allow: /read/             see below
Disallow: /
Sitemap: https://www.spideryarn.com/sitemap.xml
```

The preview robots' group gains the same page lines (Q-cards-for-other-pages) and
`Allow: /api/public/asset/` for the lead picture.

**`Allow: /read/` for every crawler is how "never listed" is made true, and it is a trade-off.**
A `Disallow` stops a crawler *fetching* a page; it does not stop the address being *listed*. Once
our homepage may be crawled, it links to shared articles, and Google lists a linked address it may
not fetch as a bare URL ("indexed, though blocked by robots.txt"). The `noindex` we send on every
`/read/` response, as a header and as a meta tag, is what keeps a page out, and a crawler has to be
let in to read it. What it gives up: any crawler that obeys `robots.txt` may now fetch a shared
article's page, where before only the seven preview robots could. What that page holds is the
title, the one-sentence gist and the canonical; the article's text comes from `/api/public/`, which
stays disallowed. The sentence we publish to authors changes to say so. **Passed over: leaving
`/read/` disallowed**, which keeps today's sentence and risks the bare listing. It is one line to
take back out, and it is flagged to Greg in the debrief.

### The `noindex` header

`vercel.json` had one rule putting `X-Robots-Tag: noindex, nofollow` on every path. It becomes a
rule for every path **except** the nine, so a new address is `noindex` until somebody lists it. The
referrer policy moves to a rule of its own and still covers everything. Fetched directly,
`/index.html`, `/shell.html` and `/_pages/*.html` are not on the list, so they carry the header.

The rule is a negative lookahead in a path pattern, and whether Vercel reads it as we do cannot be
tested here. The deploy check asks: no `noindex` header on each listed page, one on a shared
article, one on an app path.

### The lead picture (Q-lead-image)

A shared article's `og:image` is its own first picture when all of these hold, and our brand image
otherwise:

- we hold a copy: a `stored` entry in the revision's image manifest, so the address is our own
  `/api/public/asset/<slug>/<hash>.<ext>`, which re-asks whether the article is shared on every
  request. Never the publisher's URL;
- it is the first such entry in the manifest's `entries`, which are the pictures in the article's
  own HTML. A PDF's extracted figures are not used: a paper's first figure is a chart, not a lead
  picture;
- it is a PNG or a JPEG between 20 KB and 5 MB. The manifest records no width or height, so bytes
  are the only way to pass over an icon or an avatar, and the card carries no `og:image:width`.

**One switch**: `LEAD_IMAGE_ON_CARDS` in `src/public/page-head.ts`. `false` puts the brand image
back on every card and nothing else changes.

**Known and accepted**: the first picture may be an author's portrait or a chart; WhatsApp is
reported to drop a picture over about 300 KB, and there is no per-platform fallback. And **a
manifest that says `stored` over a bucket that has lost the object** gives a card whose picture
answers 500, so the card has no picture and nothing reports it. That state is real on the local
corpus (one seeded article, found again here on 2026-10-05:
[article-images.md](../project/article-images.md) describes it). Asking the bucket on every head
request would catch it and costs a storage round trip per shared link; not built. The deploy check
fetches the picture of the one article it is given.

### Checked against the real build, locally

`npm run build`, then the built `dist/` and the real function behind a stand-in for Vercel's
routing (`vercel.json` through `@vercel/routing-utils`, files first), fetched with
`facebookexternalhit`'s and `Twitterbot`'s user agents, 2026-10-05:

| Address | Served | `X-Robots-Tag` | Head |
|---|---|---|---|
| `/` | `index.html` | none | the homepage's title, description, canonical, `og:url`; no robots tag |
| `/pricing`, `/features/public-readable-sharing` | `_pages/…` | none | each page's own |
| `/login`, `/pricing/` | `shell.html` | `noindex, nofollow` | the default, with the robots tag |
| `/index.html` asked for by name | `index.html` | `noindex, nofollow` | the homepage's |
| `/read/<shared>` | the function | `noindex, nofollow` | the article's, with the robots tag |
| `/read/<absent>` | the function, 404 | `noindex, nofollow` | the default |
| `/sitemap.xml` | the file, as XML | `noindex, nofollow` | nine addresses |

Of seven shared articles in the local library, two drew their own picture and five the brand
image. One of the two pictures was served (200, `image/png`, 334 KB); the other is the lost object
above. Another article's hash under a different slug answered 404.

This is a stand-in and not Vercel. What only a deployment shows is in "What the plan review
changed", below.

### The deploy check

`scripts/check-public-shell.ts` learns: the shell hash is of `/shell.html`; each listed page
answers with its own title, canonical and `og:url` and no `noindex` anywhere; an app path still
has both; `robots.txt`'s two groups, line by line; the sitemap is XML naming exactly the list; and
an article's `og:image` is the brand image or an address under its own `/api/public/asset/<slug>/`
that answers as an image.

### Tests, written first

`tests/site-pages.test.ts` (the list against the router and `pageTitle`; `robots.txt`;
`vercel.json`'s header rule and rewrites, against every listed path and a set of paths that must
stay out; the built heads; the sitemap), `tests/page-head.test.ts` (the lead picture and its
switch), `tests/public-readable-sharing-page.test.tsx` (the sentence), and
`check-public-shell --self-test`.

### What the plan review changed

GPT Sol, 2026-10-05, read-only: approve with changes, no P0
([the review](261005f-link-previews-stage-2-plan-review-sol.md)). It confirmed the three Vercel
assumptions from Vercel's documentation, the reasoning for `Allow: /read/`, and that the manifest is
in document order.

Taken:

- **A link with a query string.** `Allow: /pricing$` refuses `/pricing?utm_source=x`, because a
  `robots.txt` match is against the path and the query. Each page now has a second line,
  `Allow: /pricing?`. The canonical names the address without the query.
- **The shelf at `/read/public` is let in by `Allow: /read/` too**, and the plan had not said so. It
  is: crawlable, and `noindex` like every other `/read/` address, and tested as that.
- **The shell the function compiles in must be the default one.** `scripts/client-shell.ts` now
  refuses a head with no `noindex`, or with a canonical: the homepage's `index.html` passes every
  other check it had. A test builds a `dist/` holding both files and proves which is embedded.
- **A test from the database to the head** for the lead picture, in
  `tests/public-visibility-pg.test.ts`, which also pinned the head's exact keys.
- **Our icons and card picture are allowed to every crawler**, so a search result can show one.
- **The bytes floor is a stand-in and said to be.** A small photograph is passed over and a heavy
  icon is not. Recording each picture's width and height at ingest (`imageDimensions` in
  `src/assets.ts` already exists) is the fix, and is not built.
- **Vercel's own converter, not only `new RegExp`.** `@vercel/routing-utils`' `getTransformedRoutes`
  over our `vercel.json`, run once in a scratch directory: the header rule is absent on each of the
  nine pages and present on 16 addresses that must stay out (`/pricing/`, `/pricingx`, `/Pricing`,
  `/read/public`, `/shell.html`, `/_pages/pricing.html` among them), and each page's rewrite
  reaches its file. Not added as a dependency for one check.
- Three docs that still described a blanket exclusion: `deployment.md`,
  `public-readable-sharing.md`, `page-titles.md`.

Not taken, and why:

- **Wiring the deploy check into `npm run deploy`.** `scripts/deploy.ts` does not run
  `check-public-shell.ts`, and the page we publish to authors says, truthfully, that it does not.
  Changing what a deploy runs is the Overseer's, who deploys. **So the first deploy of this needs
  the check run by hand, with a shared article's slug**, and the debrief says so:
  `npx tsx scripts/check-public-shell.ts --public-slug <slug>`.
- **Redirecting `/pricing/` to `/pricing`.** A trailing slash is served the default shell, with
  `noindex`, and is not let in by `robots.txt`. Nothing links to that form.
- **`scripts/check-two-builds.ts`** builds with Vite directly and serves its own `index.html` as
  the shell. It skips the new step, so its `index.html` still *is* the shell, and it is right as it
  stands.

**Tests-first, and where it was not**: the box refused every test run while the first tests were
written (out of memory, then a fleet-wide pause), so the implementation was written before any of
them had been seen red. They were mutation-tested afterwards instead, by the code reviewer, below.

### In a browser

A Sonnet subagent, headless Chrome at 1440 wide, signed out, against the same local build,
2026-10-05. All nine pages drew from their new files, with the page's own title from the first byte
and the same title after React mounted. No console error, no failed script or stylesheet. Clicking
from the homepage to Pricing and back kept the titles right. `/login` and `/read/public` start at
the bare word *Spideryarn* and change when React mounts, as before: they are served the default
head. The rewritten section on `/features/public-readable-sharing` read cleanly.

### What the code review changed

GPT Sol, 2026-10-05, write-capable
([the review](261005f-link-previews-stage-2-code-review-sol.md)): no P0 or P1, and a verdict of
*reject* for two P2s it reported and did not fix. Both are now dealt with, so read the verdict as
of the code it was given.

It fixed, and each was read before it was kept:

- **A manifest value that only looked like a hash.** A `jsonb` manifest can hold `["<hash>"]` or an
  object where a string belongs, and a regular expression coerces before it tests. One such value
  threw while a head was being composed; another hid a good picture behind it. `isLeadImage` in
  `src/asset-delivery.ts` now checks the type and the shape, at the choosing and again at the
  address. [Postmortem](../postmortems/261005i-coercive-validation-trusts-malformed-json-hashes.md).
- **The deploy check could pass having checked no article**, accepted a shared article with no
  robots tag, and refused one with no gist. It now requires `--public-slug`.
- **Four sentences to authors that claimed more than the code does**: that every card has a
  description, that every article links to its original, which picture is used, and what a deploy
  checks.

It reported, and what was done:

- **`/login` could be listed as a bare address.** Every page of ours links to it, and it was shut
  to crawlers, so its `noindex` could not be read. It is now let in, by two lines in `robots.txt`
  (`CRAWLABLE_NOINDEX_ROBOTS_ALLOWS`), exactly as `/read/` is. `/profile`, the admin pages and the
  API stay shut: nothing a crawler can reach links to them.
- **A deploy's `robots.txt` check was satisfied by the file's own comments**, which say "Disallow".
  It looks for the directive now (`hasDisallowAll`, `scripts/deploy-checks.ts`), with the case that
  exposed it as a test. Older than this work.
  [Postmortem](../postmortems/261005j-keyword-checks-accept-comments-as-restrictions.md).

Its five mutations each went red: a page removed from the list (4 tests), the header lookahead
widened to let `/read/` through (5), the `$` dropped from an `Allow` (11), `leadImageOf` ignoring
`status` (6), and a robots tag in a page's own head (10).

**Gates**: `npm run typecheck`, and 17 test files (624 tests), the database one among them. **The
full suite and `npm run check` were not run**: the Overseer asked every session not to, with the
box at a load of 58, and said the readiness and deploy runs cover it.

## Reviews

GPT Sol reviewed this plan on 2026-10-05, before the build: approve with changes. Taken: the
narrower `robots.txt` rule and the corrected published sentence; the robots judge in the deploy
check, which the first draft had missed and which would have failed the next deploy; one budget for
the whole card title; the image address written out in a test, and a deploy check that it is
served as a PNG; and softer wording in the research where it had overstated what a canonical does
not do. Not taken: an exact deploy check on the authors, for the reason given above.
