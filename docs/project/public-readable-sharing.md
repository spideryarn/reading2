# Public-readable sharing, and what we tell the person who wrote it

`/features/public-readable-sharing` — the single place the claims we make about republishing
somebody else's article are written down. Part of
[reading-view-overview.md](reading-view-overview.md).

> Perhaps we should even have a separate page at `/features/public-readable-sharing` or similar that
> describes this in more detail as the single source of truth, and then we can signpost to that from
> the tooltips and `/read/public/` and `/privacy` etc, and signpost to it from our docs.
>
> — Greg, 2026-09-06

Its two neighbours, and the split between them is the thing to hold on to:
[public-shelf.md](public-shelf.md) is **the page that lists other people's articles**;
[privacy.md](privacy.md) is **what we will do when somebody asks**; and this is **what we do with an
article in the meantime**. One home per fact, so the takedown promise is not restated here and the
robots headers are not restated there.

## The page has two readers, and that is the design constraint

Greg chose this address over a top-level `/republishing`, which Fable argued for on the ground that
`/features` sells the product and a rights-holder should not be told their article is a feature of
it. His call — and the consequence is that every sentence has to read correctly to two people at
once: **an owner deciding whether to press the sharing switch**, and **an author who found their own
writing on `/read/public` and is not pleased**.

The rule that resolves it, and the one to keep if the page is rewritten: **second person means the
author.** The owner is *a reader* or *somebody*, never *you*. A page that switches which of them it
is addressing is a page the second one stops trusting, and the second one is who it exists for.

The other rule is the ordering. **The offer comes before the argument** — the box at the top is the
takedown offer, and everything below it is a reason to be less unhappy. The reader who most needs
that box is the least likely to read to the bottom.

## Two of the five briefed claims were false, which is the fact worth carrying forward

Greg's brief named five things to say. A verification pass over the code found two of them false or
misleading, and that is not a one-off: it is the same live cost
[`PrivacyPage.tsx`](../../src/web/PrivacyPage.tsx) § *Everything on this page has to be true of the
code* names. **A rights-holder cannot check any of it and is relying on us to have.**

| Briefed | What is actually true |
|---|---|
| "zero-data-retention AI models that won't train on your work" | **False as a blanket claim.** `zdr: true` is set on dictation and nothing else (`AI_JOB_ROUTE`, [`src/ai-call.ts`](../../src/ai-call.ts)), and live conversation does not go through the gateway at all ([ai-gateway.md](ai-gateway.md)). The page makes the *no-training* commitment carrying the same hedge `/privacy` gives it — that it rests partly on an account setting, so it is a commitment we hold ourselves to rather than something the page can prove |
| "the SEO canonical link points to your original page" | **True and inert.** The `<link rel="canonical">` is real ([`src/public/page-head.ts`](../../src/public/page-head.ts) § `tags`) and no search engine ever reads it, because every response is `noindex, nofollow` and `robots.txt` is `Disallow: /`. It is also omitted entirely when the source URL carries a query string (`safePublicCanonical`, [`src/urls.ts`](../../src/urls.ts)). So the page leads with the strong claim — **we are not in search engines at all** — and mentions the canonical after it as belt-and-braces |
| "we prominently link to the original" | **True, and stronger than briefed** — the article's `<h1>` *is* a link to the original, and `OriginLine` prints host and path beneath it, both shown to a signed-out visitor ([`src/web/Masthead.tsx`](../../src/web/Masthead.tsx)) |
| "we check with users before making things public" | **True as a mechanism, and it is not a check.** A dialog, a tick-box, a server that returns 400 without it ([`src/routes.ts`](../../src/routes.ts)), and an audit row in `article_visibility_changes`. The page says all of that **and** says plainly that nobody reviews an article before it appears |
| "we hope this will increase human readership and appreciation of your work" | True, and the one most likely to read as self-serving. Last on the page, one section, making a claim about *our tool* rather than about the author's benefit, and conceding the point in its final sentence |

**"We want to behave legally and ethically" is not said.** Nobody who is behaving legally says so;
it invites *"so are you?"* and it is the sentence somebody would quote back. The facts and the offer
say it instead.

## The three awkward facts, named on purpose

> But don't let's make too big a deal of this. Let's wait and see if this upsets anyone.
>
> — Greg, 2026-09-06, choosing to name all three

One sentence each rather than a section each: **public articles are where the examples on `/` and
`/features` come from** ([`PublicShowcase.tsx`](../../src/web/PublicShowcase.tsx)); **making an
article public halves what it counts against the owner's allowance**
(`UNSHARING_COSTS_ALLOWANCE`); and **the gist, glossary, summaries and timeline are written by a
model and appear under the author's byline with nothing beside them saying so**.

The third is the one that is also a product gap. The page says we intend to close it; nothing has
been built. **If a label ever lands beside generated text in the visitor's view, this page's
sentence has to change with it** — it is written as an admission, and an admission left standing
after the fix is a lie in the other direction.

## Where the code is

| File | What's in it |
|---|---|
| [`src/web/PublicReadableSharingPage.tsx`](../../src/web/PublicReadableSharingPage.tsx) | the page, prose in JSX like `PrivacyPage.tsx`, and the argument for each claim's wording |
| [`src/web/router.ts`](../../src/web/router.ts) § `PUBLIC_SHARING_HREF` | the address, built from `FEATURES_HREF` so the pair cannot come apart |
| [`src/messages.ts`](../../src/messages.ts) § If something here is yours | `PUBLIC_SHELF_PROVENANCE`, `PUBLIC_SHELF_TAKEDOWN` and the three `TAKEDOWN_TIP_*` strings |
| [`src/web/PublicLibraryPage.tsx`](../../src/web/PublicLibraryPage.tsx) | the line under the shelf's lede, and the `ControlTip` on it |
| `tests/public-readable-sharing-page.test.tsx` | the four claims that can go stale silently |

**It is the app's only nested address.** `parseRoute` matches it above `/features`, the way
`/read/public` sits above `/read/:slug` — not because the `/features` regex could swallow it today
(it is anchored `/?$`) but because that ordering is the habit that stays correct if somebody relaxes
the anchor.

There is deliberately **no footer link and no nav entry**. It is reached from the shelf, from
`/privacy`, and from the article's own details page — which is where somebody looking for it will
be. A fifth entry in the footer row aimed at people with no account would cost every reader a link
they will never press.

## The claims that can go stale silently, and the test that holds them

Four sentences on the page describe things that live outside it and could change without anybody
touching the prose: the `Disallow: /` in [`public/robots.txt`](../../public/robots.txt), the
`X-Robots-Tag` header in `vercel.json`, the `<link rel="canonical">` in `page-head.ts`, and the
no-training wording that has to keep matching `/privacy`. **A claim about a header is exactly the
kind that stays on a page for a year after the header goes** —
[silent-success.md](../reusable/silent-success.md) — so the test reads the page as text and fails
when one of the four stops being true, the way `tests/privacy-page.test.ts` pins model names.

What the test deliberately does **not** pin is the prose. Those are words that will be rewritten,
and a test quoting them is a test somebody edits to make green — the rule
`tests/takedown-privacy-section.test.tsx` already states.

## The simpler option that was passed over

**A longer section on `/privacy`**, which is where takedown already lives and which needs no route,
no `Route` member, no title case and no second public address whose claims have to stay true. That
is the argument [`PrivacyPage.tsx`](../../src/web/PrivacyPage.tsx) makes against exactly this page,
and it was rejected for one reason: that section is already the longest on a long page, and a
rights-holder would have to read past a subprocessor table to reach it.

**The cost is real and is named rather than dodged: there are now two public addresses making
claims about what we do.** The test above is what stops them drifting; the split at the top of this
doc is what stops them saying the same thing twice.

[260906g-public-readable-sharing-page-and-rights-holder-tooltip.md](../plans/260906g-public-readable-sharing-page-and-rights-holder-tooltip.md)
is the plan.
