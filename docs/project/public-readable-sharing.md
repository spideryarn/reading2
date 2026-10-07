# Public-readable sharing, and what we tell the person who wrote it

`/features/public-readable-sharing` — the single place the claims we make about republishing
somebody else's article are written down.

Up: [reading-view-overview.md](reading-view-overview.md)

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

## In this doc

- [§ The page has two readers](#the-page-has-two-readers-and-that-is-the-design-constraint) — the rules for writing or rewording the page
- [§ Two of the five briefed claims were false](#two-of-the-five-briefed-claims-were-false-which-is-the-fact-worth-carrying-forward) — what is actually true about training, canonical, origin link and consent (and the review that found eight more overclaims)
- [§ The three awkward facts](#the-three-awkward-facts-named-on-purpose) — what the page admits on purpose
- [§ The banner on every shared article](#the-banner-on-every-shared-article) — what a visitor sees without looking for the page
- [§ A private link](#a-private-link-the-same-republishing-to-fewer-people) — republishing to fewer people, and the Sharing section
- [§ While the article is still importing](#while-the-article-is-still-importing) — a visitor who arrives early
- [§ Where the code is](#where-the-code-is) — the page, strings, address and tests
- [§ The claims that can go stale silently](#the-claims-that-can-go-stale-silently-and-the-test-that-holds-them) — which sentences are pinned to which file
- [§ The simpler option that was passed over](#the-simpler-option-that-was-passed-over) — what we did not build

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
| "zero-data-retention AI models that won't train on your work" | **False, and it has got worse.** When this was checked, `zdr: true` was set on dictation and nothing else, which made it false as a *blanket* claim. Since 2026-09-07 it is set on **nothing** (`AI_JOB_ROUTE`, [`src/ai-call.ts`](../../src/ai-call.ts)): dictation moved to `openai/gpt-transcribe` on the transcription endpoint, where OpenRouter does not apply routing preferences or `zdr` — [260907c](../plans/260907c-dictation-onto-an-openai-transcriber.md). Live conversation still does not go through the gateway at all ([ai-gateway.md](ai-gateway.md)). The page makes the *no-training* commitment carrying the same hedge `/privacy` gives it — that it rests partly on an account setting, so it is a commitment we hold ourselves to rather than something the page can prove |
| "the SEO canonical link points to your original page" | **True, and not the protection.** The `<link rel="canonical">` is real ([`src/public/page-head.ts`](../../src/public/page-head.ts) § `tags`), and what keeps a shared article out of search is that every `/read/` response is `noindex, nofollow`. It is also omitted entirely when the source URL carries a query string (`safePublicCanonical`, [`src/urls.ts`](../../src/urls.ts)). So the page leads with the strong claim — **a shared article is not listed** — and mentions the canonical after it as belt-and-braces. *Until 2026-10-05 the strong claim was "we are not in search engines at all"; since then our own pages may be listed and nobody's article may, and `robots.txt` lets a crawler fetch `/read/` so that it can read the `noindex` — [deployment.md](deployment.md), under "Our own pages may be listed". The page's section was rewritten that day and `tests/public-readable-sharing-page.test.tsx` holds each sentence to the file it describes* |
| "we prominently link to the original" | **True, and stronger than briefed** — the article's `<h1>` *is* a link to the original, and `OriginLine` prints host and path beneath it, both shown to a signed-out visitor ([`src/web/Masthead.tsx`](../../src/web/Masthead.tsx)) |
| "we check with users before making things public" | **True as a mechanism, and it is not a check.** A dialog, a tick-box, a server that returns 400 without it ([`src/routes.ts`](../../src/routes.ts)), and an audit row in `article_visibility_changes`. The page says all of that **and** says plainly that nobody reviews an article before it appears |
| "we hope this will increase human readership and appreciation of your work" | True, and the one most likely to read as self-serving. Last on the page, one section, making a claim about *our tool* rather than about the author's benefit, and conceding the point in its final sentence |

The origin line is prominent because Greg asked for it to be —
[260906e](../plans/260906e-the-origin-url-under-the-masthead-title.md):

> Show the url from which the original came (if there is one) right underneath the title in the
> masthead. I know we have the view-the-original button, but I think it's important that we are
> prominent about the origin.
>
> — Greg, 2026-09-06

**"We want to behave legally and ethically" is not said.** Nobody who is behaving legally says so;
it invites *"so are you?"* and it is the sentence somebody would quote back. The facts and the offer
say it instead.

### And then the first draft got eight more things wrong

The table above is what checking the *brief* caught. A cross-family review of the built page
(GPT Sol, 2026-09-06) found eight further overclaims in prose that had already been written
carefully, which is the fact worth carrying forward rather than the individual corrections: **on this
page, "I checked the claims" is not the same as "the claims are right", and neither is one pass.**

The worst of them is worth naming because of its shape. The page said a sharer's *"notes, their
comments and their conversations stay private to them"*. The truth is the near-opposite —
`SHARED_LINK_CARRIES` says marks, notes and searches travel with the link and only conversations do
not, and [`src/store/public-reader.ts`](../../src/store/public-reader.ts) really does select and
serialise them. **A page whose entire purpose is to be trusted told an author that publicly visible
material was private.** It was written from what felt right about "a reader's own side" rather than
from the constant that already owned the fact, which is the failure mode to watch for here: this
page restates things other files know, and every restatement is a chance to restate them wrongly.

The other seven, in one line each, because each is now pinned by a test:

- **Web images are stored** — the page had claimed we do not copy them at all. They were not yet
  *served* when that was written; since 2026-09-06 they are, and the sentence was rewritten on the
  day the test said so (below).
- **The source link and the canonical share one condition** (`safePublicCanonical` refuses a query
  string), and the draft hedged the canonical while stating the source link unconditionally.
- **`scripts/deploy.ts` checks `robots.txt` and nothing else** — it never invokes the shell checker
  that verifies the `X-Robots-Tag` header, so the page could not credit it with that.
- **The allowance discount is conditional**, and the free allowance is *lifetime*, not monthly. The
  unconditional version repeats a mistake `UNSHARING_COSTS_ALLOWANCE` already had corrected on
  2026-09-05, when it turned out to be false for two real owners.
- **Extraction is a heuristic**, so "the site around them is not reproduced" was too categorical.
- **A PDF's text is reconstructed**, so "the paragraph you actually wrote" was unsafe for PDFs.
- **The byline sits under the title**, not above everything.

Sol also asked for two disclosures that were simply missing: the **private source snapshot** we keep
so a page can be re-extracted, and that some reading aids **may have been shaped by the sharer's
reader profile**, though the profile is never published. Both are on the page now.

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

## The banner on every shared article

> For anything public readable, let's make sure there's a banner at the top that … highlights the
> URL where it came from … if you're the … IP owner and you don't want this to be public readable,
> that email … hello at spideryarn.com and we'll take it down. And … that we explicitly use models
> that don't train on your content, and then point them to the privacy page.
>
> — Greg, 2026-09-29

The page above is where an author has to go looking; this is what they see without looking.
A visitor's `SharedNotice` (`src/web/PublicChrome.tsx`), the box under the masthead, carries three
more lines: the source, the takedown offer and the training promise. For a shared upload, the source
is our found guess at its source, which a visitor was never sent before (`PublicArticle.sourceGuess`).
The plan is
[261002g](../plans/261002g-a-banner-on-every-public-readable-article.md).

The rule from this doc's top still holds: **the banner points, it does not restate.** It names
the mailbox and links `/privacy` § If something here is yours for what taking down means. It makes
the no-training claim with the same hedge, and links `/privacy` for it.
`tests/shared-notice-banner.test.tsx` holds the training wording to both pages. The banner does not
ask for evidence, because `/privacy` promises we won't.

## A private link: the same republishing, to fewer people

Since 2026-10-05 an owner can make a **private link**, `/read/<slug>?key=<key>`, instead of or as
well as making an article public. Anyone who has it reads what a visitor to a public article reads.
It is listed nowhere and the owner can turn it off. The plan is
[261005e](../plans/261005e-share-an-article-with-some-people-a-private-link-first.md); what keeps it
closed is in
[security-map.md § The unauthenticated namespace](security-map.md#the-unauthenticated-namespace-and-the-tripwire-under-it).

> When they open a page with a private link, it should say that it's a private link, i.e. not visible to anyone without the link
>
> — Greg, 2026-10-05

**The notice.** When the server says `sharedBy: "link"`, `SharedNotice` leads with
`SHARED_BY_PRIVATE_LINK` in place of `SHARED_WITH_YOU`: *"This is a private link. This article isn't
listed anywhere, and nobody can see it without the link."* The source, takedown and training lines
are the banner's own, unchanged. The chip in the bar takes the same sentence for its hover. A public
article opened with a key is `sharedBy: "public"` and gets the public notice, because public wins.
The owner never sees either. `tests/shared-notice-banner.test.tsx` and
`tests/public-network-trace.test.tsx` § a visitor holding a private link hold all three.

**The card.** Access & sharing on the Metadata page is two controls:
[`PrivateLink.tsx`](../../src/web/PrivateLink.tsx) above, the public switch
(`AccessSharing.tsx`) below. The private link's control reads its state from
`GET /api/article/:slug/share-link` each time the card opens, never from a copy. *Create a link*
opens the same confirmation going public does: the derived inventory, the note about the reader
profile and the rights tick-box, with the sentences about listing swapped for ones about a link. On,
it draws the whole link, *Copy*, *Turn off* and *On since*. Two sentences depend on the other
control:

- when both are on, the link's control says the public address works without the link and turning
  the link off will not make the article private (`PRIVATE_LINK_ALSO_PUBLIC`);
- while a link is on, the public switch does not say *"Only you can read this"* of a private
  article. It says who else can (`SHARING_OFF_WITH_LINK`), and when the link's state could not be
  read it says only that the article is not public.

A refusal from the server, such as a paper not read through yet, is shown in the server's words
and leaves the card as it was. A write that did not come back draws no link and no state.

**Still asking, and having failed to find out, are two sentences.** While the Metadata page's read
is out the public switch says *Checking who can read this…* (`SHARING_CHECKING`); *We could not
check…* (`SHARING_UNKNOWN`) is drawn only once a read has failed. A failed first read is asked
again four times over about fifty seconds (`READ_AGAIN_AFTER_MS` in `Metadata.tsx`), so the card
mends itself without a reload —
[261006e](../plans/261006e-access-and-sharing-says-checking-while-it-asks-and-asks-again-after-a-failed-read.md).
`tests/private-link-card.test.tsx` and `tests/access-sharing.test.tsx`.

**The owner's marks carry only a boolean.** `Article.privateLinkOn` and
`LibraryEntry.privateLinkOn` let the masthead and shelf name a private link without carrying its
key. The card reports changes back to the owner article view, including an unknown result after
a lost reply. Public wins when both are on. `tests/masthead-sharing-mark.test.tsx`,
`tests/shelf-shared-badge.test.tsx` and `tests/metadata-sharing-card.test.tsx` hold these paths.

**The pages.** `/features/public-readable-sharing` has a section, *A private link*; `/privacy`
names it in *Who can see your shelf*, *If you send us a bug report*, *Deleting things* and
*If something here is yours*; `/help` § Sharing describes both ways. The first two are held to the
code by `tests/public-readable-sharing-page.test.tsx` and `tests/privacy-page.test.ts`.

## While the article is still importing

Since 2026-10-05 the add page has a **Make it public** box
([`AddShare.tsx`](../../src/web/AddShare.tsx) drawing a `ShareAtAdd`,
[`src/web/add-share.ts`](../../src/web/add-share.ts)), which Greg asked for (`spya-e9t58e`). The plan
is [261005l](../plans/261005l-permalink-and-share-while-an-article-is-importing.md). **The server
did not change.** `PUT /api/article/:slug/visibility` has always needed only the owner's row, and
every public read needs a published revision, so a switch pressed early exposes nothing early: the
article becomes readable by others when the import publishes.

- **The confirmation is this card's own**: the same title, body, inventory, profile note and rights
  tick-box, and nothing is sent without the tick and the press. The inventory is the one for an
  article nothing has been built on, so everything a model makes is under *would be shared if
  built*.
- **Which is why it first asks whether there is already an article.** An import can adopt one
  already on the shelf, with a glossary and notes that would go out at once. The box is offered
  only when the owner's metadata read is a fresh 404. On a 200 it points at this card, and on
  anything else it offers nothing.
- **One `ShareAtAdd` per slug, per tab** (`shareAtAddFor`), so two spellings of one add address
  never give one article two writers. A Retry that comes back under another slug shows that slug's
  own unticked box.
- **It sends `private` only when the reader unticks.** The first build also took a share back by
  itself when the slug changed. GPT Sol's review showed that a take-back nobody is watching can be
  refused unseen, or land after a newer confirmation and undo it, so it went. What that leaves: a
  failed import that was shared stays public under its old slug, with nothing published for
  anyone to read.
- **A reload cannot read the switch back before publication.** No owner read returns visibility
  until there is a published revision. So the tab writes a mark in `sessionStorage` before a
  share request is sent, and a reloaded page that finds the mark shows *we cannot read that back* and offers
  the untick. The mark never sends a public request. A second tab has no mark and shows an
  unticked box over an article that is public: accepted for now, and the fix is a server read
  ([postmortem 261005r](../postmortems/261005r-a-publication-404-does-not-establish-sharing-state.md)).
- **Coming back to the add page asks again, and a published article belongs to this card.** The
  controller outlives the page, so on every return it repeats the metadata read before sending
  anything. If the article has published since, whatever it remembered gives way to the line
  pointing here: this card may have changed the switch, and an intent from an earlier visit must
  not publish over a later unshare. A page that stays open through publication is not asked again.
- **A 404 while the job is alive means the row is not there yet** and is retried. After five
  minutes it stops, and tries once more when the import completes.
- **The add page does not leave by itself while sharing is unsettled**: the confirmation open, or
  the request waiting, refused or unanswered. It shows *Open the article*.

### Stage 2, 2026-10-06: one Sharing section, a private link, and a visitor who arrives early

Greg's answers to the three questions stage 1 ended on, in his words, are in the plan
([261005l § Greg's answers](../plans/261005l-permalink-and-share-while-an-article-is-importing.md)).

- **Both controls sit in one *Sharing* section, shut by default**
  ([`AddSharing.tsx`](../../src/web/AddSharing.tsx)): *"because most people won't want to use
  it"*. It opens itself when a control is on, waiting, refused or unknown, cannot be shut over an
  open question, and shut it names what is on (*Sharing: public*). Shut, neither control is
  mounted, so a link's key is not in the page.
- **Create a private link** ([`AddShareLink.tsx`](../../src/web/AddShareLink.tsx) drawing a
  `LinkAtAdd`, [`add-share-link.ts`](../../src/web/add-share-link.ts)) sends the Metadata card's
  own requests behind its own confirmation. Unlike the public switch **it can read its state
  before publication**: `GET /api/article/:slug/share-link` needs only the owner's row. So it
  reads on every attachment and keeps no mark. **A create that did not come back is never sent
  again by itself**, because a second create replaces the first link: it shows *unknown* and a
  *Check again* button. An older read that answers after a newer write is dropped
  ([postmortem 261006b](../postmortems/261006b-a-read-completion-does-not-prove-it-followed-a-write.md)).
- **Controllers belong to one reader.** The registry is keyed by reader and slug and is emptied
  when the session changes, where the upload engine is fenced
  ([`add-sharing-session.ts`](../../src/web/add-sharing-session.ts)); a reply for a retired
  controller is drawn nowhere. A key in memory must not outlive the account it belongs to.
- **A visitor before publication is told the article is still being added.** The public article
  read answers **409 `still-being-added`** when the request may read the article (public, or the
  right key), nothing is published, and its owner has a queued job or a running one with a live
  lease (`publicPendingImportQuery`, [`src/store/public-reader.ts`](../../src/store/public-reader.ts)).
  The body is a fixed sentence and the code. The head, assets, the shelf and every other read are
  as they were, so no title goes out. A wrong key, a private article, a failed or abandoned
  import are the same 404 as before. Greg accepted what it gives away, *"i'm not too worried
  about the security tradeoff"*: somebody holding the address learns an unpublished article is
  there. The page ([`StillBeingAddedVisitor.tsx`](../../src/web/article/StillBeingAddedVisitor.tsx))
  asks again every ten seconds while the tab is visible. The owner of a shared import gets their
  own import's card, as in stage 1.
- **Console logs no longer print a response's query string** (`logFailure`,
  [`src/web/lib/api.ts`](../../src/web/lib/api.ts)): the expected 409 on a private link was
  logging `?key=…` ([postmortem 261006a](../postmortems/261006a-a-secret-bearing-response-url-escaped-through-a-diagnostic-sibling.md)).

Not built, by Greg's decision: a read of the public switch before publication, so the second-tab
limit above stands.

## Where the code is

| File | What's in it |
|---|---|
| [`src/web/PublicReadableSharingPage.tsx`](../../src/web/PublicReadableSharingPage.tsx) | the page, prose in JSX like `PrivacyPage.tsx`, and the argument for each claim's wording |
| [`src/web/router.ts`](../../src/web/router.ts) § `PUBLIC_SHARING_HREF` | the address, built from `FEATURES_HREF` so the pair cannot come apart |
| [`src/messages.ts`](../../src/messages.ts) § If something here is yours | `PUBLIC_SHELF_PROVENANCE`, `PUBLIC_SHELF_TAKEDOWN` and the three `TAKEDOWN_TIP_*` strings |
| [`src/web/PublicLibraryPage.tsx`](../../src/web/PublicLibraryPage.tsx) | the line under the shelf's lede, and the `ControlTip` on it |
| [`src/web/PrivateLink.tsx`](../../src/web/PrivateLink.tsx), [`AccessSharing.tsx`](../../src/web/AccessSharing.tsx) | the two controls of Access & sharing on the Metadata page — [§ A private link](#a-private-link-the-same-republishing-to-fewer-people) |
| [`src/web/AddShare.tsx`](../../src/web/AddShare.tsx), [`AddSharing.tsx`](../../src/web/AddSharing.tsx), [`add-share.ts`](../../src/web/add-share.ts) | sharing from the add page, while the import runs — [§ While the article is still importing](#while-the-article-is-still-importing) |
| [`src/web/PublicChrome.tsx`](../../src/web/PublicChrome.tsx) § `SharedNotice` | the banner a visitor sees — [§ The banner](#the-banner-on-every-shared-article) |
| [`tests/public-readable-sharing-page.test.tsx`](../../tests/public-readable-sharing-page.test.tsx) | each claim that can go stale silently, held to the file it describes ([§ below](#the-claims-that-can-go-stale-silently-and-the-test-that-holds-them)) |
| [`public/robots.txt`](../../public/robots.txt), [`vercel.json`](../../vercel.json) | what the page says about crawlers and `noindex` — [deployment.md § Our own pages may be listed](deployment.md#our-own-pages-may-be-listed-nothing-a-reader-put-here-may) |

**It is the app's only nested address.** `parseRoute` matches it above `/features`, the way
`/read/public` sits above `/read/:slug` — not because the `/features` regex could swallow it today
(it is anchored `/?$`) but because that ordering is the habit that stays correct if somebody relaxes
the anchor.

There is deliberately **no footer link and no nav entry**. It is reached from the shelf, from
`/privacy`, and from the article's own details page — which is where somebody looking for it will
be. A fifth entry in the footer row aimed at people with no account would cost every reader a link
they will never press.

## The claims that can go stale silently, and the test that holds them

Nine sentences on the page describe things that live outside it and could change without anybody
touching the prose: the `Disallow: /` in [`public/robots.txt`](../../public/robots.txt), the
`X-Robots-Tag` header in `vercel.json`, the `<link rel="canonical">` in `page-head.ts`, the
no-training wording that has to keep matching `/privacy`, and the five the review added — what a
shared link carries, what `rehost.ts` serves, the query-string condition, what `deploy.ts` verifies,
and the allowance qualifier.

**The image sentence was the one predicted to go stale first, on a known day, and it did — the
tripwire fired on 2026-09-07.** Written 2026-09-06 asserting against `rehost.ts`'s own *"this walks
only the second"* comment, precisely so that the day stage E of
[260906a](../plans/260906a-figures-from-a-pdf-are-placeholders-with-no-image.md) turned on serving
our stored copies of a web article's images, the page's *we do not serve those copies* would be
caught rather than left standing. Stage E landed and it was.

**What replaced it is a hedge rather than a new state**, and that is the durable part. Most of the
traffic has moved to us, and *never* is still not the word: an image the ingest could not store, and
one of ours that fails or is too slow (`IMAGE_WAIT_MS`), both fall back to the publisher's URL. So
the page claims the move and names the exceptions, and the test now pins that shape — both
collections walked, the fallback still real, the page hedged, and an explicit refusal of any
sentence promising a reader never reaches the author's servers. A tripwire re-aimed rather than
deleted, because the claim can go stale in the other direction too.

**A claim about a header is exactly the kind that stays on a page for a year after the header goes** —
[silent-success.md](../reusable/silent-success.md) — so the test reads the page as text and fails
when one of them stops being true, the way `tests/privacy-page.test.ts` pins model names.

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
