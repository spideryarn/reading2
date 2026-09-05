# Links — what the article's own hyperlinks say about where they go

Hover a hyperlink in the prose and a card says something about the destination. Greg, 2026-08-27:

> add hover-tooltips for hyperlinks (including anchor links) that show something about the
> destination

and, the same day, once the first version was on screen:

> Can you make the tooltips richer, e.g. show the title, full url, and/or anything else that you
> might think would be useful. Perhaps we could quickly run Mozilla Readability on it and show the
> first paragraph and number of words with a loading spinner while that's happening?

**All of that is now there**, and the last part of it — *running Readability on the destination* in
the general case — arrived on 2026-09-05, two days after this file was first written. It took a
detour, and the detour is worth knowing rather than tidying away: it cannot be done from the reader's
browser at all ([What a browser can and cannot reach](#what-a-browser-can-and-cannot-reach)), so it
is our own server that fetches the page, once, and caches it for everybody
([What our own server can reach](#what-our-own-server-can-reach)). Where the card shows a title, a
first paragraph and a word count for a page *on the reader's shelf*, that is a different and older
answer: Readability already ran, at ingest.

The card is drawn by [`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx), which is the *same*
card the glossary term's hover uses — see [Two things over one phrase](#two-things-over-one-phrase),
which is the reason it is one component and not two.

## What is actually in an article

Measured across the corpus on 2026-08-27, before any of this was built, because "how much does this
feature matter" is a question with an answer:

| Article | Source | Links | of which in-article anchors |
|---|---|---|---|
| noema-mythology-of-conscious-ai | web | 72 | 0 |
| constitution | web | 11 | 5 |
| writes | web | 0 | 0 |
| fowler-phrenology, revistes-ub-30977, source, source-2 | **PDF** | **0** | 0 |

Two things fall out of that table, and both shaped what got built:

- **A PDF-ingested article has no links at all.** Stage 2 for a PDF is a model reading the pages
  ([content-extraction.md](content-extraction.md)), and it produces prose, not hyperlinks. So this
  feature is a web-article feature, and on this corpus that is two articles out of seven.
- **Anchors are rare and external links are not.** Five in-article anchors exist, all in the
  constitution; there are 83 links in total. Greg asked for anchors by name and they are the *easy*
  case — we can show the destination itself, because it is on this page — but the volume is all
  outbound, and it is overwhelmingly scholarly: philpapers ×9, anthropic.com ×5, arxiv ×4, then
  sciencedirect, plato.stanford, nature, science.org.

That last skew is the uncomfortable one. For `https://philpapers.org/rec/BUTAAT`, the host is nearly
the only thing the URL contains, and a card that shows only the host has told the reader roughly what
the link text already told them. Which is why the free version below is a *floor* rather than the
whole answer, and why the research doc puts three richer sources above it.

## Two things over one phrase

**13% of the links in this corpus have a glossary term as their link text** — "computational
functionalism", "autopoiesis", "4E cognitive science", "corrigibility", "principal hierarchy". Eight
in the noema piece, three in the constitution.

Those are the most interesting links in an essay, and they are precisely where two separate hover
components would have raced to put two panels over the same three words. They are also where one
card is *better* than either alone, because the two halves answer different questions about the same
phrase:

- the glossary says **what this author means by it**
- the link says **where they are sending you to read about it**

So there is one card, composed of sections, and one hover machine feeding it. `read` in
`ProseHoverCard` looks *up* from whatever the pointer hit (a text node inside a `<mark>` inside an
`<a>`) and also *down* from an `<a>` that was reached by keyboard, so both halves are found whichever
way the reader arrived.

## What a card can say for free

[`link-preview.ts`](../../src/web/link-preview.ts) is the part that costs nothing: it reads the href
and says what is in it. No fetch, no API, nobody told that this reader hovered this link.

That last clause is the point rather than a bonus. A card that fetched the destination on hover would
report the reader's browsing to a stranger's server on a gesture they did not think of as a visit —
and [logging.md](logging.md) already refuses to write a reader's URLs to our *own* logs.

**Still true of this half, and it is what the whole card falls back to.** One exception has since been
taken, knowingly and for one host — a Wikipedia link does cause the reader's browser to ask Wikipedia,
under the four rules in [What Wikipedia is told](#what-wikipedia-is-told-and-what-it-is-not). Nothing
else is asked about, ever.

Three questions, which are the three a reader deciding whether to follow a link actually has:

- **Where does it go** — the host, without `www.`
- **Does it leave this publication** — the fact the bare host cannot give you, because you have to
  know where you *are* to know it. An essay linking to its own magazine's back catalogue and an essay
  linking out to arXiv are different acts. `null` when the article has no source host (an uploaded
  PDF came from nowhere on the web), and null prints nothing: "I cannot tell" and "it leaves" are
  different answers.
- **What will I get** — a PDF is not a web page, and following the link is the rudest way to find out.

Plus the path trail, for the cases where a URL really does say something (`/2024/03/the-title-of-the-piece`),
and dropped when it does not. `philpapers.org/rec/12345` shows no trail: `rec` is the site's filing
system and the record id is not a word, and printing noise under the host is worse than printing
nothing.

**The same-site test is not a public-suffix lookup**, because there is no public-suffix list in the
bundle. It is exact host, or one being a subdomain of the other. That gets `www.noemamag.com` →
`noemamag.com` right and would call two unrelated `.github.io` pages the same site — wrong in the
harmless direction, and in the direction a reader would agree with.

## The one destination we can show

An in-article `#fragment` is the only link whose destination we can put in the card, because it is on
this page. So the card shows **the target paragraph's own words**, clipped at a word boundary, with a
rule down the side — the same mark the glossary's "in this piece" section uses, for the same reason.

Trimmed rather than summarised, deliberately: the first sentence of a paragraph is the author's, and a
gist of it would be ours, and the reader can see the whole thing by following the link.

Resolution goes through `internalTarget` in [`internal-links.ts`](../../src/web/internal-links.ts) —
**the same function a click goes through**, so the card and the jump can never disagree about where a
fragment lands. It returns null for a fragment this document does not answer to, and then there is no
card: an honest "we cannot tell you" rather than a panel about nothing.

## Every link that leaves the app opens a new tab

> So I'm using Spideryarn shared to home page, and so if I click the link I certainly don't want it
> to open instead of Spideryarn, so then I have to click back. I wanted to open in a new blank tab
> or whatever.
>
> — Greg, 2026-09-04 ([SPIDERYARN-READING2-10](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-10))

The load-bearing half of that is **"shared to home page"**. Added to an iPad's home screen the app
runs standalone: no address bar, no back button. A link that navigates in place therefore replaces
the whole of Spideryarn with somebody else's page and leaves nothing to come back with. On a desktop
the same click only loses the reader's place — worse than a new tab, and not an emergency — and it
is one rule on both, because two behaviours would be two things to explain.

So an `http(s)` link whose origin is not ours gets `target="_blank" rel="noopener noreferrer"`, and
**the browser does the rest natively**: a middle click, a ⌘-click and a long-press *Open in New Tab*
all behave exactly as they do everywhere else, which is what an interception in a click handler
would have taken away.

**It is written at ingress, beside the browser sanitiser and not inside it**
([`src/web/external-links.ts`](../../src/web/external-links.ts), applied by `sanitizeArticle` in
[`src/web/sanitize.ts`](../../src/web/sanitize.ts)), and that placement is two decisions rather than
one.

*Not in the pipeline*, because `ARTICLE_CONFIG` governs what is *stored* — the export, the public
payload, every model prompt — and this is a fact about our reading view, not about the author's
markup. Running at ingress also means it reaches every article already on the shelf, with nothing
re-extracted, and it reaches **every** sink `block.html` is later injected into: the prose column,
the note preview card (whose links are live, outside `.prose`, and mostly external), and the figure
lightbox. A pass bolted onto one sink would leave the other two navigating in place.

*Not inside the sanitiser*, because the two sanitiser bindings have to be the same function. It was
written as a client-only DOMPurify hook on 2026-09-04 and the browser binding immediately stopped
matching the server one — `tests/sanitize-client.test.ts` went red the same day, and the comment at
the top of it is the argument: two passes that disagree "look like defence in depth and are really
two half-policies". A sanitiser answers *what is allowed*; where a link opens is *how it is
presented*. So it is one policy, identical on both sides, and then this, afterwards, on the browser
only. There is no per-render cost: it runs once per article load, not on the render path
[`tests/prose-not-rebuilt.test.tsx`](../../tests/prose-not-rebuilt.test.tsx) guards.

**`target` is not in the sanitiser's allowlist, and that is what makes it safe.** DOMPurify drops an
author's own `target` (measured 2026-09-04; `tests/prose-links-new-tab.test.ts` pins it), so by the
time the second pass runs no anchor carries one and the only `target` a reader can meet is ours — a
publisher cannot aim a link at `_top`. **That is why the order is sanitise, then rewrite**, and it is
the reason the two passes cannot simply be swapped for convenience. *A comment in `TableView.tsx`
claimed the sanitiser kept an article's `target`; it never did.*

Left alone: an in-article `#fragment`, a relative href, a `mailto:` or `tel:` — a blank tab left
behind by a hand-off to another app is litter — and a link back into Spideryarn, which should stay
in Spideryarn.

**"Every link" means more than `<a href>`.** An `<area>` in an image map is a link, and so is an
`<a>` inside inline SVG, which may spell its destination `xlink:href`; all three survive the
sanitiser. There are **0 of any of them in 5,301 stored blocks** (measured 2026-09-04), so this is the
promise being true rather than a hole being closed — but a promise with three quiet exceptions is not
one, and nothing else would ever have noticed. An SVG anchor that said only `xlink:href` is also
given a plain `href`, so the hover card, `internalTarget` and the touch rule all find the link the
same way this pass did; widening the rewrite without that would have swapped one disagreement for
another. Found by a GPT Sol review, 2026-09-04.

### On a coarse pointer the first tap reveals and the second opens

> What I wanted was for it to first show me a pop up about the web link. And then perhaps if I click
> again it should open it in a new page or browser.
>
> — Greg, same report

The spine's `bandPress` rule, which this card already used for a glossary term and for a footnote
marker — [touch.md](touch.md#what-happens-where) has the pattern and the trap. Nothing new was
built: `tapSelector` gained `.prose a[target="_blank"]` and `onCommit` gained a third branch.

Two things about that selector are deliberate. It is keyed on **`target`, not on the href**, because
the rule is *"a link that is about to take you out of the app shows itself first"* and that attribute
is exactly the set of links that do — and only our own ingress can write one, so a publisher can
neither opt in nor out. And **a glossary term inside a link still wins**: `closest` returns the
innermost match, so a tap on the underlined words finds the `mark.term` and the link is never the
hit. That keeps the rule a reader has already learnt for the 13% of this corpus's links whose text
is a term ([Two things over one phrase](#two-things-over-one-phrase)); the link is still one press
away at the card's foot. Decided against reversing it, on a GPT Sol review, 2026-09-04.

The commit calls `window.open` rather than letting the click through, because the hook swallows the
compatibility click after any tap it has acted on (`useHoverCard.ts` § `swallowed`); unpicking that
for one consumer would be a second way of committing beside the one every other target uses. It runs
inside the `pointerup` listener, so it is a user activation rather than a popup for a blocker to
refuse, and it passes `noopener,noreferrer` — a `window.open` does not inherit the anchor's `rel`.

**Checked in Chrome on an 834×1194 viewport with `hasTouch`, 2026-09-04**, driving CDP
`Input.dispatchTouchEvent` rather than synthetic events, because
[260903g](../postmortems/260903g-the-touch-card-closed-itself-on-every-tap.md) is 24 synthetic-event
tests staying green through a bug that broke every real touch device. First tap opened the card and
navigated nothing; a tap on a *different* link revealed that one instead; the second tap on the same
link opened exactly one tab at the right URL with `window.opener === null`; a 140px drag opened
nothing; a term inside a link went to `?mode=glossary&term=…` and opened no tab; a marker still
previewed and then jumped. On a 1440×900 mouse viewport a plain click, a middle click, a ⌘-click and
Enter all opened one tab and left the reading view where it was, and an in-article fragment still
jumped in place.

## A footnote marker is one of those links, and it gets the note instead

A superscript `1` is an in-article `#fragment` like any other, so the card above would happily draw
it — as *elsewhere in this article* over 260 clipped characters of the note. That is the wrong answer
for the one link whose destination is short enough to show in full, and it is why
[`notes-view.ts`](../../src/web/notes-view.ts) exists.

Three things it does differently, and each of them is a decision rather than a detail:

- **It shows the whole note, over the note's whole range of blocks.** A note is a *range* — gwern's
  longest is eight blocks — so the fragment gathers every block carrying the same `noteId`, in
  document order, and a long one scrolls rather than being cut. The reasoning is
  [260828o-footnotes.md](../plans/260828o-footnotes.md): the preview being good is what makes the jump rare, and the
  jump is expensive because it recentres all three panels on "Notes".
- **It rebuilds the fragment rather than injecting the stored html**, stripping every `id` out of the
  copy. The stored html of a note carries its own block id and, on Wikipedia, a hundred of Parsoid's
  — and duplicate ids in a document where everything is addressed by id would reach `internalTarget`
  itself.
- **It owns its own links.** The card is in a portal, outside `TableView`'s delegated handler, so a
  link inside the preview would otherwise navigate the whole page away.

A marker is recognised by its `data-spya-note-ref` stamp **and** by the `role` of the block that
stamp resolves to — never by being inside a `<sup>`, because superscripts are also powers, ordinals
and trademarks. The other direction is the same machinery: a note's back-links point at the passages
that cite it, one per use, and their card says *cited here* rather than *elsewhere in this article*.

## What the reader meets at the note

> When I get to the bottom, I want to be able to go back and it doesn't show the number at the
> bottom either. … if we know that they are footnotes … then we should surround them in a box, or
> otherwise indicate that they are footnotes. But the key thing is at the bottom, they should be
> numbered, and there should be a way back to the point in the article where they come from.
>
> — Greg, 2026-09-04, on `xanadu-spya-ueuvaf` ([SPIDERYARN-READING2-14](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-14))

**The data was all there and none of it was drawn**, which is worth stating in that order because a
review had guessed the opposite. Read out of that article's own public payload, 2026-09-04: nine
notes, each `role: "footnote"`, `treatment: "supplement"`, with a `noteId`; nine markers, each
labelled `1`…`9`; and nine back-links, every one of them the author's own `↩︎` carrying
`data-spya-note-back`. Nothing had gone down a different path. What reached the reader was:

- **No number**, because a note's body is an `<li>` and stage 3 gives every block its own row — so
  the `<ol>` that numbered it is gone, and an orphan `<li>` numbers nothing. This is a rendering
  gap, not a pipeline one.
- **No boundary**, because a note is `gistable` body prose to every rule in the reading column. The
  spine and the outline both dress a supplement differently ([granularity-zoom.md](granularity-zoom.md));
  the prose did not, so nine notes simply followed gwern's `## Bibliography` looking like nine more
  paragraphs.
- **A back-link nobody could see.** It was there and it worked: a bare `↩︎`, `--ink-faint`, three
  pixels of padding, at the end of 126 words. The reader asking for "a way back" was looking
  straight at one. `data-came-from` was already marking the right one of them (§ above), with a 1px
  outline on a glyph a few pixels wide.

So the fix is entirely in the reading view, and it is three things:

- **The region is set apart** — `td.text.note` on every block of it, `note-open` on the first, from
  the note index rather than from `block.role`, so the stylesheet and the hover card share one
  definition of what a note is. A rule across the top, a `--muted` ground, softer ink, and the list
  markers dropped now that the number replaces them. `background-color` and not the `background`
  shorthand, or the search bar down the left of a matched paragraph would be reset to none.
- **Every note carries its number**, and it is **the author's own** — the text of the first marker
  that cites it, in document order, so `[5]` on Wikipedia stays `[5]`. Counting was rejected: it
  drifts the moment one note of a piece goes unrecognised, and then the marker and the note disagree
  with nobody able to say which is lying. `Note.label` in
  [`notes-view.ts`](../../src/web/notes-view.ts) falls back to an ordinal for a note nothing cites
  and for a label too long to be a number.
- **The back-link is a control.** A pill with a border, 44px square on a coarse pointer — the number
  the bottom bar already answers to ([touch.md](touch.md#how-big-a-thing-has-to-be-to-press-it)) —
  and the one the reader actually came by says *back to your place* in words. Only that one: a
  Wikipedia note with thirteen back-links would be noise if every one of them were labelled, and
  exactly one of them can be theirs.

A **"Notes" heading** is drawn only where the source wrote none. Wikipedia's own `References` counts;
**`Bibliography` deliberately does not**, because gwern's page ends with one directly above the
notes, and reading it as their heading is how this fix would silently do nothing on the very page it
was reported from.

Seen in Chrome at 834×1194 with a coarse pointer, 2026-09-04: nine numbered notes, one *NOTES*
heading, one 1px rule at the top of the region, back-links measuring 44×44 (30×31 under a mouse),
and a tap on marker 7 landing at note 7 with its back-link on screen and highlighted.

**Deferred**, and written down as deferred rather than left as an idea: margin or side notes, a
floating "return" button that follows the reader down the notes, and making browser Back restore the
scroll position.

## The identifier the path is carrying

The section above says `philpapers.org/rec/BUTAAT` shows no trail, because `BUTAAT` is a catalogue
key rather than a word. That is right about the words and wrong about the value: **a catalogue key is
exactly the thing you paste into a search box**, and saying which catalogue it belongs to costs
nothing and is read off the same string.

So a card also prints `arXiv 2212.13345`, `DOI 10.1073/pnas.2306525120`, `PhilPapers BUTAAT`, in
monospace, because an identifier is meant to be compared character by character. Measured on this
corpus: **16 of the 62 distinct external links carry one** — 7 PhilPapers records, 5 DOIs, 3 arXiv
ids, one both — and they are disproportionately the links whose host was nearly the whole of what the
free card could otherwise say.

A DOI is found **in the middle of a path**, not only on `doi.org`: `science.org/doi/10.1126/…` and
`link.springer.com/article/10.1007/…` both carry one behind a publisher's own routing, and five of
this corpus's do. The test is the registry's own rule — `10.`, four to nine digits, a slash, and then
something. The registrant alone (`doi.org/10.1073`) names a publisher and no paper, and is refused.

## What a browser can and cannot reach

Greg's suggestion was to run Mozilla Readability on the destination and show its first paragraph.
**For an ordinary host that cannot be done from the reader's browser**, and it is worth writing the
measurement down rather than the conclusion, because "we could just fetch it" is the obvious next
idea every time somebody looks at this file.

Checked on 2026-08-27, with an `Origin:` header set to this app's own:

| Destination | From the page | Why |
|---|---|---|
| `philpapers.org/rec/BUTAAT` | `TypeError: Failed to fetch` | **403 `cf-mitigated: challenge`** — Cloudflare, not CORS |
| `arxiv.org/abs/…` | `TypeError: Failed to fetch` | 200 to a server, no `access-control-allow-origin` |
| `plato.stanford.edu`, `nature.com` | `TypeError: Failed to fetch` | same — no ACAO on the 200 or the redirect |
| `en.wikipedia.org/wiki/<Article>` | `TypeError: Failed to fetch` | **no ACAO on article pages** |
| `en.wikipedia.org/api/rest_v1/page/summary/…` | 200, 2.5KB of JSON | **`access-control-allow-origin: *`** |

A cross-origin `fetch` without that header is rejected before the response body is readable, and a
`no-cors` request hands back an opaque response with nothing in it — no status, no headers, no text.
There is no flag, no library and no amount of care that gets round it; it is the rule the header
exists to state. The general case therefore needs **our own server**, which is
[the third source](#what-our-own-server-can-reach) and has existed since 2026-09-05.

Three things fall out of that table that are worth keeping, and two of them are not about CORS:

- **philpapers is not refusing our origin, it is refusing a robot.** The 403 carries
  `cf-mitigated: challenge` and comes back for any Origin and any user-agent, browser strings
  included. So the corpus's commonest destination will fail the *server-side* version too — which
  was the prediction, and it was **confirmed from a server on 2026-09-05**, before the plumbing:
  [What our own server can reach](#what-our-own-server-can-reach).
- **Wikipedia's permissive CORS does not extend to its article pages** — only to the REST API paths.
  Worth stating because "just fetch the Wikipedia page and run Readability on it" is the obvious next
  idea, and it was checked and it does not work.
- **The summary endpoint is the exception, and deliberately so** — it is the API half of Wikipedia's
  own Page Previews, published for exactly this.

One incidental trap, for anyone debugging this later: `response.headers.get("access-control-allow-origin")`
returns **null even on the call that succeeded**, because that header is not CORS-safelisted and
script cannot read it back. The browser used it and will not show it to you. Diagnose with `curl -I
-H "Origin: …"` rather than from the page.

## The three things somebody can tell us

[`link-facts.ts`](../../src/web/link-facts.ts) is the asynchronous half of the card. Three sources
since 2026-09-05, and the section each adds appears *under* a card that was already complete —
nothing above it waits, nothing moves, and a lookup that finds nothing leaves the free card exactly
as it was. That is what lets these be allowed to be slow, and why the spinner is a line rather than a
state.

**Only one of them is ever drawn**, and the order below is a ranking rather than a layout: the shelf
beats Wikipedia beats the page's own metadata, because that is the order of how much we can say. The
card declines to *ask* the further sources when a nearer one has already answered, and declines to
*draw* them too — the shelf can land after the answer did.

**An article already on this shelf.** Its title, its root gist and its length are already ours, so
this is a lookup rather than a fetch — and it is the answer to *"run Readability and show the first
paragraph and the word count"*, because stage 2 ran Readability over that page at ingest and stored
the result. One `/api/library` request, shared by every link in the article, fired lazily on the
first external link anybody actually hovers: four of the seven articles in this corpus came from
PDFs and have no hyperlinks at all, so an eager fetch could never have paid for itself.

Matching is by `urlKey` ([`src/ingest.ts`](../../src/ingest.ts)) — the same function that decides
whether a pasted URL is an article we already have, so the card and the shelf cannot disagree about
what counts as the same page. *This doc previously said that was blocked on `urlKey` being off the
client's import allowlist. It is not: `ingest.js` has been on that list since the Add box needed to
show the slug the server would mint.*

**The measured hit rate is 1 in 67, and the one hit is an article linking to itself** — the noema
essay's own canonical URL, in its own prose. Which is worth knowing for two reasons: the value of
this grows with the shelf rather than being there on day one, and *"you are reading this"* had to be
a case in its own right, because the alternative is a **read it here** button that takes the reader
to the page they are already on.

**Wikipedia.** `…/api/rest_v1/page/summary/<title>` returns the real title, Wikidata's one-line
description and a genuine lead paragraph. One link in this corpus of 62 — so it is built because it
is nearly free and Wikipedia is everywhere on the wider web, not because it pays here.

Deciding *whether* a URL names a Wikipedia article is reading an href, so it happens in
`link-preview.ts` and the fetching code is handed a title. A title containing a colon is refused,
which is how `Special:`, `Talk:`, `File:` and `Category:` are excluded; the cost is the handful of
real articles whose names contain one, and they lose the extra section and keep the ordinary card.

**The page itself, fetched by our server.** The general case, and the only source that answers for an
arbitrary destination — `GET /api/link-preview`, [`src/link-previews.ts`](../../src/link-previews.ts),
built 2026-09-05. It gives the destination's own title, site name, description and opening paragraph,
plus a word count. See [What our own server can reach](#what-our-own-server-can-reach) below for what
it does and does not get, and [Fetched once, for everybody](#fetched-once-for-everybody) for the part
that is a privacy decision rather than a caching one.

### What Wikipedia is told, and what it is not

This is the first thing in the reading view that contacts a third party on a reader's gesture, so the
rules are stated rather than assumed:

- **It fires on the open card, not on the pointer.** The lookup is driven by what is actually shown,
  and a card takes 320ms of rest to open — so a pointer crossing the prose on its way to the
  scrollbar sends nothing at all. The honest caveat: once a card *is* open the hover machine swaps to
  the next target after 60ms, so a reader deliberately running along a row of Wikipedia links with a
  card up can fire several. Cheap, cached, and a real reading gesture rather than a stray pointer.
- **No cookies.** A cross-origin `fetch` defaults to `credentials: "omit"`, so a reader with a
  Wikipedia login is not identified to it here.
- **No referrer.** `referrerPolicy: "no-referrer"`, or the request would carry the address of the
  article being read — the same reason every outbound link on this card already has `rel="noreferrer"`.
- **Once per title per session**, from a module-level cache.

What is left is Wikimedia learning that some IP looked up a title, which is exactly what their own
Page Previews does from every reader's browser. It is the trade the research doc accepted **for this
one host**, and it is not a precedent for fetching arbitrary destinations from the client — the same
doc refuses that, at length, and the table above says it would not work anyway.

## The full address, and why it is there at all

Greg asked for the full URL and it is at the foot of every external card, quiet, monospace, clamped
to three lines. Everything above it is *us deciding what matters about this URL*; the address itself
is for the reader who wants to judge it rather than take our reading of it — a paywall host they
recognise, a tracking payload, a domain they do not trust. Three lines because that is enough to
recognise any URL and to read most of them whole, and past that it is a query string pushing the card
off the screen.

**The clamp is a cap on what is drawn, not a truncation**, and that distinction had to be made real
rather than asserted — a GPT Sol review pointed out that the part three lines hides is the *tail*,
which is precisely where a tracking payload lives, so a card showing the harmless half of a URL and
cutting the interesting half would be worse than one showing none of it. The whole string is in the
DOM, is selectable, and is on the element's `title`.

**A real title supersedes the path trail** rather than joining it. The trail is a guess read off an
address; a title is a title, and printing both would show the reader our working next to the answer.
It is also the one thing on the card that a late-arriving lookup *changes* rather than adds —
everything else only grows downwards.

## Add it to Spideryarn

Since 2026-09-05 the foot of an external card carries a second control, and it is the one way this
feature compounds rather than merely describes.

> When I click on an external hyperlink, how can we make the experience really great? … It should
> show an Add to Spideryarn button, which would kick off ingestion of that article to my shelf.
>
> — Greg, 2026-09-05

It queues the ingest **in place**, and that is Greg's call against the obvious answer:

> I don't want to open in a new tab, because that's disruptive when I've added Spideryarn to my
> Homepage on iPad, because then it opens on top. Card shows progress is fine for now — eventually
> we'll want a richer per-article-queue progress bar for this and other per-article jobs.
>
> — Greg, 2026-09-05

The alternative was navigating to `/add/<url>`, which inherits the progress list, Stop, dedupe and
the quota notice for nothing. What survives from it is the wiring: this presses `useJobs().add(url)`,
which is the *same* `POST /api/jobs { url }` the shelf's Add box sends, so slot admission, the
deduplication and the 402 all arrive without a second implementation
([ingest-queue.md](ingest-queue.md), [billing.md § Which requests spend a slot](billing.md#which-requests-spend-a-slot-and-why-the-wall-is-at-the-routes)).
**One press spends a metered ingest slot**, and a free account has three for life, so this is a
genuinely new low-friction front door onto a metered action.

**Only an owner is offered it, and the seam is that `useJobs` is not called** — `canAddToShelf`
gates whether `WithAddToShelf` exists, exactly as `lookUpLinks` gates `WithLinkFacts`, and for the
identical reason: a hook cannot be skipped conditionally, and a mounted `useJobs` subscriber sets the
job engine's polling cadence whether or not it draws anything.
[reader-capability.ts](../../src/web/reader-capability.ts) is the written-up version of that trap.

**And four more silences, each of them a metered slot not spent by mistake.** No button for a link
that does not leave the app; none for a link back to the piece being read, decided from the href
rather than from the shelf, because the noema essay links to itself and re-ingesting the article you
are standing in is the worst thing this could do; none for a page already on the shelf — which is
what keeps the foot to **two controls at most**, since *read it here* and *add to Spideryarn* are
mutually exclusive by construction and the three-control wrap the plan expected never arises; and
**none until the shelf is actually known**. That last one is why `LinkFacts` carries `shelfKnown`:
`library` is null while `/api/library` is in flight *and* if it failed, so without it the first hover
of every session offered to add articles the reader already owned. Under uncertainty about a metered
action, offer nothing. GPT Sol's review of the built code, 2026-09-05, finding P1-1.

**A refusal only gets a button when another press could help.** `worthRetrying` (src/messages.ts)
decides, so a `[pay-free]` reader gets the sentence and a link to the page that answers it and
nothing to spend the next attempt on — the sentence says the pricing page is the way forward, and a
*try again* under it would be the card arguing with the copy. A **failed ingest** gets its sentence
and no button at all, because retrying an ingest is `POST /api/jobs/:id/retry`, which keeps the slug
and the steps that already succeeded; all this card holds is a URL, so the only thing it could press
is a fresh add wearing the same word. Retry stays on the job card that knows `jobWorthRetrying` and
can call the right route.

### Nothing about the add is held in the card

The card is torn down when the pointer leaves *and* by a `MutationObserver` whenever the prose
re-renders, so component state here has the lifetime of a hover — and an ingest is a minute or two.
Three things therefore live in module-level maps in
[`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx), keyed by `urlKey`: an add that has been
pressed and not yet answered (without it, a re-hover offers a second press over a metered action),
the refusal sentence (`lastFailure()` is a ref inside one subscriber and dies with it), and which job
the URL became. Progress is **read** from the `jobEngine` singleton by job id — never by slug, for
the reason [AddPage.tsx](../../src/web/AddPage.tsx) writes up — so re-hovering shows the job wherever
it has got to. All three gaps were named by GPT Sol reviewing the plan, finding P2-1.

**And the terminal status is read, never announced.** `useJobs(onFinished)` tells a subscriber only
about jobs that finish while it is mounted, and the card usually is not: the reader presses and moves
on. So the completion is noticed by whichever card opens next, off the job list.

**The known gap, named rather than fixed.** Reading the job list means a job that has *left* it —
retention is bounded — is indistinguishable from one the engine has not polled for yet, and the card
goes on saying *adding it to your shelf…*. It takes a reader who neither hovers nor reloads between
the ingest finishing and the record ageing out. Closing it properly needs a tab-level observer over
the engine, and the durable home for that is the per-article queue Greg named and this is a
way-station to. GPT Sol, 2026-09-05, finding P2-2.

### The loop: finishing invalidates the shelf

`link-facts.ts`'s shelf map is loaded once per page load and nothing else refreshes it, which is a
harmless stale *absence* right up until this tab is the thing that made it stale. So a job reaching
`done` calls `refreshShelf()`, which re-reads `/api/library`, swaps the map in and wakes every open
card — and the card the reader added from upgrades itself from *add to Spideryarn* to *on your shelf*
and *read it here*. A failed refresh keeps the shelf we had rather than replacing it with an empty
one, **and says it failed**, so the completed job is not remembered as already refreshed and the next
hover asks again.

That is the whole compounding argument: **the measured 1-in-67 shelf hit rate above is exactly what
this grows.** Every add makes the next hover of that link richer.

Measured end to end in a browser on 2026-09-05: press, move the pointer away so the card is torn
down, ingest finishes 55s later with nothing watching, re-hover the same link in the same tab with no
reload — the foot goes from `open in a new tab · add to Spideryarn` to `open in a new tab · read it
here`, and `/api/library` is requested exactly twice in the session, the second 0.8s after the job
was noticed done.

The tests are [`tests/add-to-shelf-from-the-card.test.tsx`](../../tests/add-to-shelf-from-the-card.test.tsx),
which mounts the card for real and asserts the call count on `useJobs` rather than the absent button
— a card that drew nothing and still called the hook would be the bug and would look like the fix —
and [`tests/a-failed-shelf-read-is-not-an-empty-shelf.test.tsx`](../../tests/a-failed-shelf-read-is-not-an-empty-shelf.test.tsx),
which is its own file because "the shelf read failed" is a module state a test file can reach once.

## What our own server can reach

Built 2026-09-05, and it is the answer to the wall above: the general case needs our own server, and
this is it. [`src/link-previews.ts`](../../src/link-previews.ts), behind
`GET /api/link-preview?slug=&url=`.

**Measured before it was built**, ten real destinations from this corpus through `fetchDocument`
called exactly as `readWebPage` calls it. Three results, and the third was not predicted by anything:

- **8 of 10 give something genuinely worth showing** — a real title plus a description or a first
  paragraph. arXiv, plato.stanford, nature, anthropic, paulgraham, wikipedia, noema, gwern.
- **philpapers fails, and so does science.org.** `FetchFailure { code: "forbidden", status: 403 }`,
  confirmed by `curl` with the same user-agent to carry `server: cloudflare` and
  **`cf-mitigated: challenge`**. This doc predicted it from the *client* side
  ([What a browser can and cannot reach](#what-a-browser-can-and-cannot-reach)) and it is **now
  confirmed from a server**: the corpus's commonest destination is behind a bot challenge, and no
  amount of plumbing gets past it. That is a negative-cache row with a week's expiry, not a reason to
  stop.
- **`maxBytes` is all-or-nothing**, which contradicted the research doc and is corrected there.
  `fetchDocument` throws `too-large` before returning anything, so a thrifty cap yields nothing at
  all rather than a partial head. At 64KB only 2 of the 8 successes survive and at 256KB only 4. The
  cap is **1MB**.

Two things shape the extraction rather than the fetch, and both are counter-intuitive enough to be
worth writing down:

- **Three of the eight successes carry no `og:` tags at all** — plato.stanford, paulgraham, gwern —
  so the `og:` → `twitter:` → `<title>` / `<meta name=description>` fallback chain is **load-bearing
  rather than a nicety**. No metadata library: `open-graph-scraper`, `metascraper` and
  `link-preview-js` all accept pre-fetched HTML, but their real value is a hardened fetch layer we
  are deliberately bypassing, and the extraction itself is a `querySelector` chain. (`unfurl.js` is
  archived; do not take it.) If the scope ever grows to JSON-LD and oEmbed, `open-graph-scraper` is
  the one to reach for.
- **Readability's "first paragraph" can be a byline artefact** — noema's comes back as the word
  "Credits" — so it is sanity-checked before it goes on a card (`saneParagraph`: long enough, not a
  label, contains a sentence) and the card falls back to `og:description` when it fails. A word count
  under forty is dropped for the same reason: on a landing page it measures Readability rather than
  the page.

It reuses `fetchDocument` ([fetching.md](fetching.md)) the way `readWebPage` in
[`src/chat-tools.ts`](../../src/chat-tools.ts) does, and it takes that call site's **complete**
envelope: the URL-length and query-length refusals before anything is fetched, the scheme allowlist,
the SSRF address guard re-checked at every redirect hop, the pinned agent, the byte cap, the deadline,
one attempt, and a log line carrying `hostOf(url)` and never the URL. **Do not write new fetch-safety
plumbing for this** — see [security.md](security.md).

### Fetched once, for everybody

Note what this is *not*: a fetch per reader per hover. The first hover of a URL by anyone causes one
fetch from our server's IP, and every hover after that — by that reader or any other — is a cache
hit, so **the destination never learns that a particular reader was reading a particular article at a
particular time**. The sharing is the privacy feature, which is why `link_previews` is the first
ownerless table in this schema; `src/db/schema.ts` § `linkPreviews` carries the argument it had to
answer and the three things that close the parts of it that would not survive:

- the route **never returns a cache timestamp**, because that would say whether and when some prior
  reader caused a fetch;
- ownerless rows have a **defined retention that actually runs**: thirty days past a row's own
  expiry, and the deleting is done fifty rows at a time by the rare path that writes a new one
  (`sweepABatch` in [`pg-link-previews.ts`](../../src/store/pg-link-previews.ts)). *A first version
  left it to a manual script, and a review was right that a retention nobody runs is not a
  retention: `expires_at` stops a row being served, it does not delete it.*
  `npx tsx scripts/link-previews-sweep.ts` is still there for a bigger pass with a report;
- **URLs that look like they carry a credential are refused**, not cached — an exact URL plus its
  content in a shared table is the worst available home for a signed link. It is a **heuristic**,
  said plainly: a name-based check over query parameters, plus `user:pass@`, applied to **every hop
  of the redirect chain** rather than only to what the author published, because a harmless address
  can redirect into a signed one. A capability in a path segment is not caught, and no list of names
  can be complete.

**And the route is article-scoped, which is the load-bearing part.** Being authenticated is not
enough: any signed-in account could otherwise hand the endpoint any URL at all. So it verifies the
caller owns the article *and* that the article's own extracted links really contain that URL, before
it fetches or spends anything — `articleLinks` in [`chat-tools.md`](chat-tools.md), the same parse the
chat tool uses, so there is no second idea of what counts as a link in this article. What is left is
an **accepted limited disclosure**, recorded as accepted rather than argued away
(the plan, § *Where the sharing stops*).

**One part of it is sharper than ordinary cache latency and is worth naming**, because it is not the
kind a timing argument covers: `pending` is a *word*, not a delay. It tells a caller who is eligible
to ask — somebody who owns an article containing that URL — that a fill for that exact address is in
flight right now, within a twenty-second lease. Two readers who both own pieces linking one paper can
learn that the other is hovering it about now. That is accepted: the set of people who can hear it is
the set who could already cause the fetch themselves, and the alternative — making them wait out
somebody else's fetch with no way to tell it from a slow one — is a worse card for a privacy
difference of one bit about somebody they cannot name. GPT Sol raised it, 2026-09-05.

*Consequence, accepted for v1:* a hyperlink in a [chat answer](#the-links-chat-writes) is not in the
article's extracted links, so it gets the free card only — a `refused`, which the client is careful
not to remember under the address, since the same URL may be an ordinary prose link a moment later.

Two more things worth knowing about it:

- **Two simultaneous cold hovers do not both fetch** — a unique row prevents duplicate *storage*,
  never duplicate *traffic*, so there is a claim with a lease: the winner fetches, everybody else is
  told to wait and asks once more. **The promise stops there and it is worth stating exactly**, since
  the first version of this line claimed more than the code delivers: a claimant that stalls past its
  twenty-second lease still comes back and fetches, and nothing can reach into another process and
  stop it. What *is* guaranteed is that **a loser can never destroy a winner** — a release only
  removes the claim it holds a token for, and a write can never turn a live answer into a failure.
  That is the only one of the three a reader would ever have seen.
- **A per-reader limiter, keyed solely on the owner** — never on the article or the URL, which an
  attacker varies freely — and cache hits bypass it entirely. 120 fills an hour at concurrency 4,
  and **those numbers are guesses rather than measurements**, said out loud in
  `PREVIEW_RATE_POLICY` so the next reader tunes them from telemetry.

## What is deliberately not built yet

Two smaller things left on the floor, both cheap, neither obviously worth it yet:

- **Wikipedia's thumbnail.** The summary response carries one. It would be a second request, to
  Wikimedia's image CDN, for decoration on a card whose job is words — so it is skipped rather than
  ruled out.
- **A word count for a Wikipedia article.** The summary endpoint does not give one, and the endpoint
  that would is a second call.

**Ingest-time prefetch of every link was considered and rejected.** An article has dozens of external
links and a reader hovers a handful; fetching them all at ingest multiplies job time for near-zero
payoff, produces stale entries for links nobody visits, and stacks more per-link network calls onto a
queue whose Vercel story is [already an open question](deployment.md). The cache above delivers the
"fetch once, serve everyone" benefit people reach for prefetch to get — lazily instead of eagerly.

**A summary of the destination, relative to the piece in your hands.** Stage 3 of
[the plan](../plans/260905f-external-link-panel-add-to-spideryarn-and-server-side-preview.md), and it
is a different cache with a different key: what the page says about itself is shareable, and what it
means *for this reader reading this piece* is not.

## What a card actually says

Read out of the browser on 2026-08-27, by dispatching a real `pointerover` at each link and reading
`.prose-card` back — the six shapes, verbatim, because a description of a card is not a card:

```
leaves this site          leaves this site          elsewhere on this site
philpapers.org            en.wikipedia.org          noemamag.com
PhilPapers                from wikipedia            this is the piece you are reading
NAGWII                    Antikythera mechanism     The Mythology Of Conscious AI
                          Ancient Greek analogue    Widespread belief in imminent
https://philpapers.org/     astronomical computer      conscious AI stems mainly from
  rec/NAGWII              The Antikythera            psychological bias and a flawed…
open in a new tab           mechanism is an        8,283 words · ~36 min
                            ancient Greek hand-
                            powered orrery…        https://www.noemamag.com/the-
                          https://en.wikipedia.org/  mythology-of-conscious-ai/
                            wiki/Antikythera_…     open in a new tab
                          open in a new tab
```

The philpapers one is the case this feature exists for and the one that shows its limit: the card is
three lines, and two of them the reader could have guessed. The self-link is the case that shows what
it can do when somebody can tell us — and note what it does **not** have, which is a *read it here*
button, because it would go to the page you are on.

Three things were checked rather than assumed in that pass: the Wikipedia request returns 200 from
the page and is not CORS-blocked; **`/api/library` is fetched exactly once per page load** across
many hovers, not once per hover; and the widest card (336×271) sits well inside a 1272×732 viewport.
The older in-article anchor card still reads *"elsewhere in this article / Being broadly ethical /
go there"*, so none of this broke it.

## What is tested, and what is deliberately not

The href half is all string-in, shape-out, so it is tested hard —
[`tests/link-preview.test.ts`](../../tests/link-preview.test.ts), 56 cases, most of them a table of
**real URLs from this corpus** rather than invented ones. That table exists because the first version
of the trail rule was wrong about philpapers and the unit test agreed with it: the test had been
written with an invented numeric id, so both were confidently wrong together. A fixture drawn from
the data cannot do that.

**The server half is tested at four seams**, and each of them was watched go red under a deliberate
mutation rather than merely being green:

- [`tests/link-preview-route.test.ts`](../../tests/link-preview-route.test.ts) — who may cause a
  fetch and of what. `fetchDocument` is replaced so that *"nothing was fetched"* is a call count
  rather than a hope, which is the only assertion that can tell a refusal from a fetch that then
  answered `unavailable`. Deleting the membership check reddens two cases, deleting the credential
  refusal one, and keying the cache on `urlKey` instead of `requestTarget` reddens three.
- [`tests/link-preview-cache.test.ts`](../../tests/link-preview-cache.test.ts) — single-flight, the
  lease, the alias hop, and how long each outcome stands. Making the claim stop refusing a second
  caller reddens one case; taking the expiry out of the read reddens another.
- [`tests/fetch-allowance.test.ts`](../../tests/fetch-allowance.test.ts) — the limiter, including the
  case that would look like a working limiter and is not: `finish` frees the concurrency slot and the
  fill goes on counting against the hour.
- [`tests/link-preview-extract.test.ts`](../../tests/link-preview-extract.test.ts) — the pure half.
  Every case is a real destination's shape, including noema's "Credits".

The asynchronous half has tests only either side of the wire, and **the reason given here for that
has now been wrong twice.** The first version said a test of the hook would be a test of a mock; a
GPT Sol review pointed out that `useLinkFacts` is driven entirely by a prop and two deferred
promises, which is about as testable as a hook gets. The second version said this repo has no React
test harness at all — true when it was written on 2026-08-27, and false since: there are 124
`tests/*.test.tsx` files as of 2026-09-05 (`ls tests/*.test.tsx | wc -l`), mounting components with
`createRoot` under `IS_REACT_ACT_ENVIRONMENT`, and
[`tests/add-to-shelf-from-the-card.test.tsx`](../../tests/add-to-shelf-from-the-card.test.tsx)
mounts this very card. So the three tests named at the foot of
[`tests/link-facts.test.ts`](../../tests/link-facts.test.ts) are now simply unwritten rather than
impossible. A doc that says "this cannot be done here" outlives the reason it was true —
[260903b-facts-that-were-wrong.md](../research/260903b-facts-that-were-wrong.md).

What is tested is the pair of pure functions either side of the wire
([`tests/link-facts.test.ts`](../../tests/link-facts.test.ts)), because those are where somebody
else's bytes become something a React render trusts: `shelfIndex`, where one bad line gives a card
that never matches anything and looks exactly like a card that had nothing to match; and
`readSummary`, the only third-party JSON that reaches this view — where a `title` arriving as an
object would be handed to React, which refuses by throwing, which takes the card down rather than
one line of it.

## The links chat writes

Since 2026-08-27 a hyperlink can also arrive in a **chat answer**, and it gets this same card. Greg:

> Allow chat responses to include hyperlinks to the web (e.g. in response to searching the web if it
> found something useful). These should reuse our tooltips machinery for previewing hyperlinks that
> we use in the main text.

It matters more there than here. Everything above this section is about an address the *author*
chose; a chat link is an address a *model* chose, after reading pages we do not control, with a label
that is also the model's. `[the Anthropic paper](https://not-anthropic.example/)` is a plausible
sentence with a hostile destination and the text gives nothing away.

It also gets **less** than an article's own link does, and that is deliberate for now:
`GET /api/link-preview` proves membership against the *article's* extracted links, and a chat link is
in no article, so it gets the free card and no fetched preview
([What our own server can reach](#what-our-own-server-can-reach)). Widening to chat links means
proving membership against the thread instead.

**The card is not enough on its own**, and saying so is the point rather than a caveat: it takes
320ms of rest to open, a click does not wait for it, and on a touch screen a link navigates on the
first tap by design. So the real host is also printed in the answer itself, beside the label, quiet
and small — the card is the richer version of that check rather than the only version. A GPT Sol
review, 2026-08-27, is why.

What changed here to allow it was one selector. `useHoverCard` is already one delegated listener for
the whole document, so the cost of a second customer is naming it — and naming them is itself the
fix for a wart, because the old selector was a bare `a[href]` and therefore *every* anchor on the
page. [260827ao-chat-web-links.md](../plans/260827ao-chat-web-links.md) has the parsing rules, the ordering constraint
against `splitCitations`, and what happens to a URL that is still being streamed.

## See also

- [tooltips.md](tooltips.md) — the hover machinery, why Floating UI, and why the card is a hook
  rather than one of the component libraries built for exactly this
- [260827ao-chat-web-links.md](../plans/260827ao-chat-web-links.md) — the same card over a link a model wrote, and the
  parsing that had to happen before the citation splitter could see the text
- [chat-tools.md § The links the prompt does not carry](chat-tools.md#the-links-the-prompt-does-not-carry)
  — the same hyperlinks, read by the model instead of by the reader. It parses `block.html` on the
  server, so its count of "how many links are in this article" is a distinct-destination count and
  differs from the raw one in the table above; it is also where a link the reader asks *about* gets
  followed, which this card deliberately never does
- [glossary.md](glossary.md) — the other half of the same card
- [block-ids.md](block-ids.md) — why an in-article anchor points at an id we minted, and what stage 3
  had to do to the author's own ids to make that work
- [security.md](security.md) — the URL is one of the two untrusted parties
