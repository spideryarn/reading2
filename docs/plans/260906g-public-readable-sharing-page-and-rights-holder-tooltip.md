# The public-readable-sharing page, and the line at the top of the shelf

Status as of 2026-09-06: **decided, being built** — evidence: nothing at
`src/web/PublicReadableSharingPage.tsx` yet, no `public-sharing` member in `Route`.

> In `/read/public`, we have this note: *"If something here is yours, ask us to take it down."*
> Let's move that to the top. But add a rich tooltip (see `tooltips.md`) to it, explaining that we
> have set up the SEO canonical link to point to your original page, we prominently link to the
> original, we use zero-data-retention AI models that won't train on your work, we check with users
> before making things public, and we hope that this will actually increase human readership and
> appreciation and understanding of your work. But at the same time, we want to behave legally and
> ethically, so … etc etc. Perhaps we should even have a separate page at
> `/features/public-readable-sharing` or similar that describes this in more detail as the single
> source of truth, and then we can signpost to that from the tooltips and `/read/public/` and
> `/privacy` etc, and signpost to it from our docs.
>
> — Greg, 2026-09-06

## What this is really about

`/read/public` lists the full extracted text of other people's articles to anybody, signed in or
not ([public-shelf.md](../project/public-shelf.md)). The only thing standing between that and a
rights-holder's complaint is an owner's tick-box and a way to complain — and until now the way to
complain was **one line of faint grey type at the foot of the page**, and the *reasons a
rights-holder might be reassured* were written down nowhere a rights-holder could read them.

This makes those reasons a page, and moves the offer to where somebody looking for it will find it.

## Two of the five claims were not true, and that is the main finding

Greg listed five things to say. A verification pass over the code found two of them false or
misleading as stated, which is exactly the failure `PrivacyPage.tsx` § *Everything on this page has
to be true of the code* was written about. **A rights-holder cannot check what we say, so a false
sentence here is worse than a false sentence anywhere else on the site.**

| Claim as briefed | Verdict | What we say instead |
|---|---|---|
| "SEO canonical link points to your original page" | **Partly true, and the wrong framing** — the `<link rel="canonical">` is real (`src/public/page-head.ts:251`) but inert: every page is `noindex, nofollow` and `robots.txt` is `Disallow: /`, so no search engine ever reads it. It is also omitted entirely when the source URL carries a query string (`safePublicCanonical`, `src/urls.ts:170`) | Lead with the *strong* claim — **we are not in search engines at all**, three layers deep and re-checked on every deploy — and mention the canonical after it as belt-and-braces |
| "we use zero-data-retention AI models that won't train on your work" | **False as a blanket claim.** `zdr: true` is set on dictation and nothing else (`AI_JOB_ROUTE`, `src/ai-call.ts:545`). Live conversation bypasses OpenRouter entirely and has no ZDR at all. `/privacy` already says this deliberately, and calls the no-training promise *"a commitment we hold ourselves to rather than something the page can prove to you"* | The no-training commitment with the same hedge `/privacy` uses, and **no ZDR claim** |
| "we prominently link to the original" | **True, and stronger than briefed** — the article's `<h1>` *is* a link to the original, and `OriginLine` prints host and path beneath it, both shown to a signed-out visitor (`src/web/Masthead.tsx:163`, `:399`) | Say it, and say it is what a signed-out stranger sees |
| "we check with users before making things public" | **True as a mechanism, and it is not a check.** A confirmation dialog, a tick-box reading *"I have the right to share this article's text"*, a server that returns 400 without it (`src/routes.ts:4714`), and an audit row in `article_visibility_changes` | Say all of that **and** say plainly that nobody reviews an article before it appears |
| "we hope this will increase human readership and appreciation of your work" | True, and the one most likely to read as self-serving | Last on the page, one paragraph, with the point conceded: our hope, not their obligation, and it changes nothing about the offer above |

"We want to behave legally and ethically" is **not said**. Nobody who is behaving legally says so;
it invites *"so are you?"*. The facts and the offer say it instead.

## Decisions

- **The address is `/features/public-readable-sharing`** — Greg, 2026-09-06, choosing it over
  `/republishing`, which Fable argued for on the ground that `/features` is a sales page and filing
  a rights-holder's page under it says their article is a feature of our product. Greg's call, and
  it carries a real consequence: **the page serves two audiences**, an owner deciding whether to
  share and a rights-holder who arrived from a search, so every sentence has to work read either
  way. It is also the app's **first nested route**, in a router whose comment on `/privacy/cookies`
  is *"an address nobody minted"* — so the specific arm goes above the `/features` one in
  `parseRoute`, the way `/read/public` sits above `/read/:slug`.
- **The three awkward facts get named, briefly.** Greg, 2026-09-06: *"But don't let's make too big
  a deal of this. Let's wait and see if this upsets anyone."* So one sentence each, not a section
  each: public articles are the showcase on `/` and `/features`; making an article public halves
  what it costs the owner's allowance; and the gist, glossary and summaries are written by a model
  and appear under the author's byline with no label saying so.
- **`/privacy` § If something here is yours stays exactly as it is**, and keeps the takedown
  promise — the mailbox, what *taken down* means, days rather than hours. That prose has been
  through a review and it is a policy commitment; this page links to it rather than restating it,
  which is [documentation-policy.md](../reusable/documentation-policy.md) § cite don't restate
  applied to reader-facing prose. What the new page owns is **what we do with a republished
  article**; what `/privacy` owns is **what we will do when you ask**.
- **The foot line on `/read/public` goes**, replaced by a line under the lede. Not duplicated —
  a page with the same offer twice reads as anxious.
- **`PublicPages.tsx`'s takedown link is left alone.** It is on the details page *for one article*,
  where the reader already has the piece in front of them and wants that one down; `/privacy` is
  the right destination for them. The shelf is the one that needed the fuller story.

### The simpler option passed over

**A section on `/privacy`, which is where takedown lives today** — no route, no second public
address whose claims have to stay true alongside the first, and it is the argument
`PrivacyPage.tsx:550` makes against exactly this page. Rejected because the section is already the
longest on that page, and a rights-holder would have to read past a subprocessor table to reach it.
The cost is named rather than dodged: **there are now two public addresses making claims about what
we do**, and `tests/public-readable-sharing-page.test.tsx` exists to stop the claims that can go
stale silently — the robots `Disallow`, the `noindex` header, the canonical, the no-training
wording — from drifting away from the code, the way `tests/privacy-page.test.ts` pins model names.

## Stages

1. **The doc** — `docs/project/public-readable-sharing.md`, owned by
   `reading-view-overview.md`, plus its line in `CLAUDE.md`.
2. **The page** — `src/web/PublicReadableSharingPage.tsx`, the route, the title case, the two
   `App.tsx` arms, and the test.
3. **The shelf** — the line moved to the top, and the `ControlTip` on it.
4. **Signposts** — `/privacy`, `/features`, and the docs that describe the surfaces this changes.
5. **Review** — GPT Sol, with the routing table, `robots.txt`, `vercel.json`, `page-head.ts` and
   `ai-call.ts` as evidence, because every previous review of a page like this found false
   sentences in it.

## What is deliberately not built

- **No label on model-generated text in the visitor's view.** The page now says the gist and the
  glossary were written by a model; the product does not say so beside them. That is a real gap and
  it is Greg's to decide — flagged here rather than fixed, because a chip under every gist is a
  reading-view change, not a copy change.
- **No form, no queue, no moderation view.** Unchanged from
  [privacy.md](../project/privacy.md) § If something here is yours.
- **No change to what is actually shared.** This stage says what we do; it does not alter it.
