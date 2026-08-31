# Links — what the article's own hyperlinks say about where they go

Hover a hyperlink in the prose and a card says something about the destination. Greg, 2026-08-27:

> add hover-tooltips for hyperlinks (including anchor links) that show something about the
> destination

and, the same day, once the first version was on screen:

> Can you make the tooltips richer, e.g. show the title, full url, and/or anything else that you
> might think would be useful. Perhaps we could quickly run Mozilla Readability on it and show the
> first paragraph and number of words with a loading spinner while that's happening?

Most of that is now there. The one part that is not is the general case of *running Readability on
the destination*, and the reason is a hard wall rather than a decision —
[What a browser can and cannot reach](#what-a-browser-can-and-cannot-reach) below. Where the card
does show a title, a first paragraph and a word count, it is because **Readability already ran** —
at ingest, on our own server, over a page that is now on the shelf.

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
exists to state. The general case therefore needs **our own server**, which is the source below that
is still unbuilt.

Three things fall out of that table that are worth keeping, and two of them are not about CORS:

- **philpapers is not refusing our origin, it is refusing a robot.** The 403 carries
  `cf-mitigated: challenge` and comes back for any Origin and any user-agent, browser strings
  included. So the corpus's commonest destination will fail the *server-side* version too, and
  whoever builds that should find that out on day one rather than after the plumbing.
- **Wikipedia's permissive CORS does not extend to its article pages** — only to the REST API paths.
  Worth stating because "just fetch the Wikipedia page and run Readability on it" is the obvious next
  idea, and it was checked and it does not work.
- **The summary endpoint is the exception, and deliberately so** — it is the API half of Wikipedia's
  own Page Previews, published for exactly this.

One incidental trap, for anyone debugging this later: `response.headers.get("access-control-allow-origin")`
returns **null even on the call that succeeded**, because that header is not CORS-safelisted and
script cannot read it back. The browser used it and will not show it to you. Diagnose with `curl -I
-H "Origin: …"` rather than from the page.

## The two things somebody can tell us

[`link-facts.ts`](../../src/web/link-facts.ts) is the asynchronous half of the card. Two sources, and
the section it adds appears *under* a card that was already complete — nothing above it waits,
nothing moves, and a lookup that finds nothing leaves the free card exactly as it was. That is what
lets these be allowed to be slow, and why the spinner is a line rather than a state.

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

## What is deliberately not built yet

**Our own server fetching the page once, and caching it for everybody.** The general case, and the
only one that needs real engineering. Note what it is *not*: a fetch per reader per hover. The first
hover of a URL by anyone causes one fetch from our server's IP, and every hover after that — by that
reader or any other — is a cache hit, so the destination never learns that a particular reader was
reading a particular article at a particular time. It is also the only route to the thing Greg
actually asked for in the general case, since the table above rules the client out.

Two smaller things left on the floor, both cheap, neither obviously worth it yet:

- **Wikipedia's thumbnail.** The summary response carries one. It would be a second request, to
  Wikimedia's image CDN, for decoration on a card whose job is words — so it is skipped rather than
  ruled out.
- **A word count for a Wikipedia article.** The summary endpoint does not give one, and the endpoint
  that would is a second call.

**Ingest-time prefetch of every link was considered and rejected.** An article has dozens of external
links and a reader hovers a handful; fetching them all at ingest multiplies job time for near-zero
payoff, produces stale entries for links nobody visits, and stacks more per-link network calls onto a
queue whose Vercel story is [already an open question](deployment.md). Once (3) exists with a
URL-keyed cache, the "fetch once, serve everyone" benefit is already there — lazily instead of eagerly.

When (3) is built, it must reuse `fetchDocument` ([fetching.md](fetching.md)) the way `readWebPage`
in [`src/chat-tools.ts`](../../src/chat-tools.ts) already does. That call site is the worked example:
the scheme allowlist, the SSRF address guard, the redirect-hop cap with a per-hop re-check, the
byte-counted size cap, and a log line carrying `hostOf(url)` and never the URL. **Do not write new
fetch-safety plumbing for this** — see [security.md](security.md) for what it is guarding against.

No metadata library is needed for the extraction when that day comes. `open-graph-scraper`,
`metascraper` and `link-preview-js` are all alive and all accept pre-fetched HTML, but their real
value is a hardened fetch layer we would be bypassing, and the extraction itself is a `querySelector`
chain over `og:` / `twitter:` / `<title>` / `<meta name=description>` against the jsdom we already
own. (`unfurl.js` is archived; do not take it.) If the scope ever grows to JSON-LD and oEmbed
fallbacks, `open-graph-scraper` is the one to reach for.

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

The asynchronous half has tests only either side of the wire, and **the reason the hook itself has
none is not the one first written here.** The first version of this paragraph said a test of it would
be a test of a mock; a GPT Sol review pointed out that `useLinkFacts` is driven entirely by a prop
and two deferred promises, which is about as testable as a hook gets. The real reason is that this
repo has no React test harness at all, and adding one is a dependency decision bigger than this
feature. The three tests worth writing the day it exists are named at the foot of
[`tests/link-facts.test.ts`](../../tests/link-facts.test.ts).

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
