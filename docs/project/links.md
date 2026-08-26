# Links — what the article's own hyperlinks say about where they go

Hover a hyperlink in the prose and a card says something about the destination. Greg, 2026-08-27:

> add hover-tooltips for hyperlinks (including anchor links) that show something about the
> destination

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

## What is deliberately not built yet

A survey on 2026-08-27 (`docs/research/link-previews.md`) put four sources of card content in order.
The first is above. The other three, in the order they are worth building:

1. **An article already in this library.** If a hovered href normalises to something on the shelf, we
   have its real title and its root gist — richer than anything scraped, and no network. Blocked on a
   small thing: `normaliseUrl` and `urlKey` live in `src/ingest.ts`, which is not on the client's
   import allowlist, so either they move to a module that imports nothing (the fix
   `tests/client-imports.test.ts` names) or the match happens server-side.
2. **Wikipedia.** `en.wikipedia.org/api/rest_v1/page/summary/<title>` is free, sends
   `access-control-allow-origin: *`, and returns exactly title/description/extract — it is the API
   half of Wikipedia's own Page Previews. Callable straight from the client, and with a fixed known
   host there is no SSRF surface at all.
3. **Our own server fetching the page once, and caching it for everybody.** The general case, and the
   only one that needs real engineering. Note what it is *not*: a fetch per reader per hover. The
   first hover of a URL by anyone causes one fetch from our server's IP, and every hover after that —
   by that reader or any other — is a cache hit, so the destination never learns that a particular
   reader was reading a particular article at a particular time.

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

## See also

- [tooltips.md](tooltips.md) — the hover machinery, why Floating UI, and why the card is a hook
  rather than one of the component libraries built for exactly this
- [glossary.md](glossary.md) — the other half of the same card
- [block-ids.md](block-ids.md) — why an in-article anchor points at an id we minted, and what stage 3
  had to do to the author's own ids to make that work
- [security.md](security.md) — the URL is one of the two untrusted parties
