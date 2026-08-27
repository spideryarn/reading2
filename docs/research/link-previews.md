# Link previews — what to show, and what to build it with

Research behind the hover cards on the article's own hyperlinks, done 2026-08-27 before any of it was
built. Two surveys, run in parallel, following
[third-party-library-selection.md](../reusable/third-party-library-selection.md). The feature itself,
and what shipped first, is [links.md](../project/links.md).

Two separate questions, and they have opposite-looking answers for the same underlying reason:

1. **The UI** — is there a library for "hover a link, see a card"? *No, and the reason is structural.*
2. **The data** — where does "something about the destination" come from, and is there a library for
   extracting it? *Four sources in a definite order, and no library, because we already own the parts.*

## One — the UI

**Verdict: roll our own, by extending the machinery already in the tree.**

Every component library that does this — Radix `HoverCard`, Base UI `PreviewCard`, Ariakit
`Hovercard` — is built the same way, and it is the same way `Tooltip.tsx` is built: a `Trigger` that
clones a ref and handlers onto **one React element**.

That is fatal here, and it is the identical objection [tooltips.md](../project/tooltips.md) already
recorded against Radix Tooltip. The prose is injected with `dangerouslySetInnerHTML`, so a link is
not a React element and there is no ref to hand anybody; and a long article has hundreds of them, so
one `<Trigger>` each is hundreds of library instances mounted for the one under the pointer.

| Candidate | Verdict |
|---|---|
| **Extend the existing hover machine** | **Chosen.** Already proven on hundreds of injected glossary marks. Zero new dependencies. Extracted to `useHoverCard.ts` at this, its second customer. |
| `@radix-ui/react-hover-card` | Rejected. ~2M downloads/week, MIT, actively released — a fine library, wrong shape. Its virtual-anchor escape hatch exists, but using it means driving `open` state and positioning by hand, at which point you have reimplemented the hover intent yourself and are borrowing only `Content`/`Portal` — which Floating UI, underneath both, already gives directly. |
| `@base-ui/react` `PreviewCard` | Rejected, despite being *literally named* for this (the hover-a-link-see-a-card pattern). Same Trigger-per-element architecture, and young — still stabilising out of beta through 2025 — which is short of this repo's loudest criterion, *lots of pretraining data*. Rejected on two independent grounds. |
| `@ariakit/react` `Hovercard` | Rejected. Same composition pattern; ~34K downloads/week against Floating UI's ~6M, so a much thinner training-data footprint. |
| `react-laag` | Rejected outright. No release in 12+ months, flagged inactive. Fails the longevity criterion before architecture is considered. |
| `react-tooltip` | Rejected, consistent with the existing call in tooltips.md: attribute-shaped API, poor fit for rich content computed at hover time. |
| `react-link-preview`, Microlink Hover | Rejected — wrong problem. These fetch OG metadata from a third-party service per link, which is a *data* concern with cost, latency and an outbound call to a stranger on every hover. See part two. |
| `wikipedia-preview` (Wikimedia) | Rejected as a component; **its API is taken** as a data source. Hard-wired to Wikipedia, which is right for Wikipedia links and useless for the rest. |

**The one thing a library was hoped to solve and did not:** keyboard access to a card over hundreds of
non-React targets. Nothing in the survey handles it, because it is inherent to the injected-HTML
shape and a library's `Trigger` cannot reach inside.

But the survey turned up something better than a library — a fact we had wrong. Links are in a
*better* position than glossary marks: **an `<a href>` is natively focusable and already a tab stop**,
where a `<mark>` is not. So keyboard parity here needs no tabindex hack at all, just a delegated
`focusin` listener beside the `pointerover` one — `focusin`, not `focus`, because only the first
bubbles. That is why `useHoverCard` takes a `focusable` flag that is true for links and false for
terms; it is a real difference between the two, not a preference.

## Two — the data

**Verdict: four sources, in this order. No library.**

1. **Read the href.** Zero network. Has to render instantly, and is the whole card for every link we
   choose not to fetch. What it can honestly say is in [links.md](../project/links.md). **Built.**
2. **An article already in this library.** We have the title and the gist locally. Cheap and richer
   than anything scraped. **Built, 2026-08-27** — and the blocker this line recorded was not one:
   `urlKey` does live in `src/ingest.ts`, but `ingest.js` has been on the client's import allowlist
   since the Add box needed to show the slug the server would mint. Worth the note, because "blocked
   on X" survives in a doc long after X stops being true.
3. **Wikipedia.** `/api/rest_v1/page/summary/<title>` is free, returns title/description/extract, and
   sends `access-control-allow-origin: *` — verified by `curl` during the survey. Fixed known host,
   so no SSRF surface at all. This is the API half of Wikipedia's own Page Previews. **Built,
   2026-08-27.**
4. **Our own server, fetching once and caching for everybody.** The general case, and the only piece
   needing real engineering. **Still not built**, and the section below is why nothing else will do.

### The client cannot do (4)'s job, and this is the measurement

Greg's follow-up on 2026-08-27 was to fetch the destination and run Readability on it. From the
reader's browser that is not possible for an ordinary host, and the numbers belong here rather than
in a sentence of assertion — checked with an `Origin:` header set to the app's own:

| Destination | `access-control-allow-origin` |
|---|---|
| `philpapers.org/rec/BUTAAT` | none — and the request is a **403 `cf-mitigated: challenge`** |
| `arxiv.org`, `nature.com`, `plato.stanford.edu` | none (200 or 303 to a server) |
| `en.wikipedia.org/wiki/<Article>` | none — **article pages are not covered** |
| `en.wikipedia.org/api/rest_v1/page/summary/…` | **`*`** |

Without that header a cross-origin `fetch` is rejected before the body is readable, and `no-cors`
returns an opaque response with no status, headers or text in it. So Readability-in-the-browser is
not a thing that was weighed and rejected; it is a thing the platform does not offer.

The philpapers row is the more useful half of that table, and it is not a CORS row at all: **the
corpus's commonest destination is behind a Cloudflare bot challenge**, returning 403 for any Origin
and any user-agent including real browser strings. A bare `fetchDocument` will fail there, so
whoever builds (4) should establish what they intend to do about it before designing around the
happy path.

Wikipedia's own article pages being uncovered is worth recording too, because "fetch the Wikipedia
page and run Readability on it" is the obvious next idea after the summary API and it does not work.

**Rejected: prefetching every link at ingest.** Dozens of links per article, a handful ever hovered.
It multiplies job time for near-zero payoff, produces stale entries for links nobody visits, and
stacks per-link network calls onto a queue whose Vercel story is already an open question. Once (4)
exists with a URL-keyed cache, the "fetch once, serve everyone" benefit people reach for prefetch to
get is already delivered, lazily.

### On timing, which is a privacy question

Server-side-lazy-with-cache is not a compromise between the two extremes, it is better than both. A
client fetch leaks the reader's IP, cookies and fingerprint to the destination on every hover. Ingest
prefetch fetches once but wastes most of the fetches. Lazy-and-cached means the first hover of a URL
by *anyone* causes one fetch from our server's IP, and every hover after that is a cache hit — so the
destination sees "Spideryarn asked once", never "reader X hovered link Z at time T".

**One exception was taken, knowingly**: the Wikipedia summary call in (3) *is* a client fetch, and
the paragraph above is the argument against it. It was accepted for one host because Wikimedia
publish that endpoint for exactly this and run the same thing themselves from every reader's browser
(Page Previews), and because the four mitigations in
[links.md § What Wikipedia is told](../project/links.md#what-wikipedia-is-told-and-what-it-is-not)
remove most of what the sentence above is worried about — no cookies, no referrer, nothing sent
until a card is actually open, once per title per session. It is not a precedent for a second host.

That is the shape Slack and Discord use. The difference is only *when* "once" happens: at post time
for them (one deliberately-posted link), at first hover for us (fifty citations, mostly never
followed). Notion is the other useful precedent — inline links get **no** preview until you explicitly
convert one to a bookmark, and Obsidian's community plugins are lazy and cached for exactly the
reason above.

### The metadata libraries

All four accept pre-fetched HTML, which is the crux: `fetchDocument` already owns safe fetching, so a
library's own fetch layer is dead weight *and* a second unaudited path to the SSRF surface we already
closed.

| Library | Downloads/wk | Last release | Licence | Status |
|---|---|---|---|---|
| `open-graph-scraper` | 312k | 2026-06-26 | MIT | Active. Cheerio + undici + chardet + iconv-lite — the last pair being exactly what [fetching.md](../project/fetching.md) rejected for the fetch stage. |
| `metascraper` | 158k core | 2026-08-17 | MIT | Active. Most thorough (JSON-LD, Twitter Cards, oEmbed) and the heaviest to wire up — a separate package per field. |
| `link-preview-js` | 180k | 2026-07-31 | MIT | Active. Same dependency shape; built for React Native share cards. |
| `unfurl.js` | 42k | 2024-02-13 | ISC | **Archived.** Do not take. |

**Take none of them.** The extraction is a `querySelector` chain — `og:title` → `twitter:title` →
`<title>`, and the same for description — over the jsdom we already use in three places. That is
bookkeeping, not an algorithm, and an algorithm is what makes a library worth taking. If the scope
ever grows to JSON-LD and oEmbed fallbacks, `open-graph-scraper` is the one to reach for: best
documented, most current, accepts pre-fetched HTML cleanly.

### The thing worth knowing before building (4)

`readWebPage` in [`src/chat-tools.ts`](../../src/chat-tools.ts) already is a link-preview endpoint
with a bigger extractor on the end. It calls `fetchDocument` with the scheme allowlist, the SSRF
address guard, the redirect-hop cap, the byte-counted size cap and a single attempt, and it logs
`hostOf(url)` and never the URL. A preview route is that call with a smaller `maxBytes` — OG tags
live near the top of `<head>`, and jsdom parses truncated HTML fine — and a cheaper extraction.

The logging rule deserves a note of its own here: a hovered URL is arguably *more* sensitive than
`read_web_page`'s case, because the reader did not type it or ask about it. They just moved a mouse
while reading.
