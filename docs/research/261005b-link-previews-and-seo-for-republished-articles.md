# Link previews and SEO for republished articles

Up: [research.md](../project/research.md)

The working behind [261005f](../plans/261005f-link-previews-and-seo-for-shared-links.md). Two
reports from Greg, 2026-10-04 (`spya-jwepsa`, `spya-qfu4uz`): make a shared Spideryarn link look
good when pasted into X, WhatsApp, Facebook and the rest, and improve SEO for public articles while
keeping the original article as the canonical. The web research was done by a Sonnet subagent on
2026-10-05, as Greg asked.

**How far to trust each line.** **[V]** means read on the platform's or Google's own page.
**[S]** means a secondary blog or tool site only. **[?]** means not verified. A good half of what
"everybody knows" about link previews turned out to be [S] or [?], and is marked so.

## What we already had

Before this work a shared `/read/<slug>` already had a server-written head with the title, the gist
as the description, `og:` and `twitter:` tags, and a canonical pointing at the original
([page-titles.md § The server writes the title first now](../project/page-titles.md#the-server-writes-the-title-first-now-and-both-sides-use-one-function)).
It had no image and no author. Every other page (the homepage, `/changelog`, `/features`) previewed
as the bare word *Spideryarn*, and only Meta's and X's preview robots were let in by `robots.txt`.

The whole site is also out of search engines on purpose: `robots.txt` says `Disallow: /`, every
response carries `X-Robots-Tag: noindex, nofollow`, and `/features/public-readable-sharing` tells
authors so ([public-readable-sharing.md](../project/public-readable-sharing.md)). So today's
canonical is true and, for a crawler that obeys `robots.txt`, unread: the page is never fetched.
That one fact shapes the whole SEO half. (Blocking the crawl is not a guarantee either. Google can
list an address it was never allowed to fetch, from links to it, with no snippet; `noindex` is only
seen by a crawler that is let in to read it. **[V]**
[Google](https://developers.google.com/search/docs/crawling-indexing/block-indexing))

## Link previews

### Which tags, and where

- **The minimum set that covers every platform** is `og:title`, `og:description`, `og:image`
  (absolute HTTPS), `og:url`, `og:type`, `og:site_name`, plus `twitter:card`. Facebook, LinkedIn and
  WhatsApp each list the first four as required. **[V]**
  [Facebook](https://developers.facebook.com/docs/sharing/webmasters/),
  [LinkedIn](https://www.linkedin.com/help/linkedin/answer/a521928),
  [WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/link-previews/)
- X falls back from `twitter:title`, `twitter:description` and `twitter:image` to the `og:` ones;
  `twitter:card` is the one thing only it reads, and the large card has to be asked for by name.
  **[S]** (X's own docs refused the fetch.)
- Telegram and Slack read `og:` and Twitter tags. **[S]** Discord and iMessage: nothing
  authoritative; in practice the same three `og:` tags. **[?]**
- Facebook recommends `og:image:width` and `og:image:height`. **[V]**
- **None of these robots is documented as running JavaScript**, so the tags have to be in the HTML
  the server sends. **[S]** WhatsApp reads only the first 300KB **[V]** and Slack about the first
  32KB **[S]**. Our built shell is under 9KB.

### The title

- WhatsApp's own page says `og:title` is "the title of the content without any branding". **[V]**
  The brand goes in `og:site_name`. That is what we already did, and the reason `og:title` has no
  ` · Spideryarn` on the end while the tab does.
- No platform documents a place for authors in the title. **[?]** `article:author` is meant to be a
  profile URL, which we do not have.
- Length limits (60 to 70 characters, a cut near 90 on Facebook) are folklore. **[?]** WhatsApp
  shows two lines at most. **[V]**

### The description

- WhatsApp shows one or two lines and says "80 characters will suffice". **[V]** Facebook says two
  to four sentences. **[V]** Around 150 to 160 characters is the usual safe length. **[?]**
- So the first 80 characters carry the card on a phone. A tagline at the front would spend them on
  us; at the end it is cut off on exactly the platforms where it would matter.

### The image

- WhatsApp: under 600KB, at least 300px wide. **[V]** Testers report the thumbnail silently
  disappearing above about 300KB, so 300KB is the ceiling to design for. **[S]** JPEG or PNG, an
  absolute HTTPS address, no redirect. **[S]**
- LinkedIn: at least 1200x627, 1.91:1; under 401px wide it is drawn as a small thumbnail. **[V]**
- X: 2:1 or 1200x675 recommended, 300x157 at least. **[S]**
- Facebook's page gives no size; 1200x630 is the convention. **[V]** that it gives none.
- One site-wide brand image against one image per article: no source compares them. **[?]** Most
  previews use the article's own lead picture.

### `og:url` when the canonical is somebody else's site

- Facebook follows `og:url`: if it names a different address, Facebook fetches *that* and takes the
  card from it, and counts the share there. **[V]**
  [Facebook](https://developers.facebook.com/docs/sharing/webmasters/getting-started/versioned-link/)
- So `og:url` must stay our own `/read/<slug>`, and `<link rel="canonical">` the original. The two
  differ on purpose. SEO audit tools flag the mismatch; here it is intended. **[S]**

### Where a reading tool puts its own name

Not researched per product. **[?]** The only primary source is WhatsApp's "without any branding".

## SEO

### What a cross-domain canonical does

- A canonical is "a hint, not a rule". **[V]**
  [Google](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- In May 2023 Google stopped recommending a canonical for syndicated copies, "because the pages are
  often very different", and recommended that the copy **block indexing** instead. **[V,
  second-hand]**, from
  [Search Engine Roundtable](https://www.seroundtable.com/google-updates-canonicalization-help-documentation-35329.html);
  the live Google page fetched on 2026-10-05 did not mention syndication at all. **[?]**
- Bing still prefers the canonical. **[S]**
- A page whose canonical is honoured is folded into the original and does not appear in results
  itself. Its description, keywords and structured data are then read by nobody. Whether Google
  honours ours is not knowable in advance: our page has a glossary, summaries and a timeline the
  original lacks, which is the "very different" case Google names. **[?]**

So for a republished article the two outcomes are: Google honours the canonical and our page is
invisible, which is today's `noindex` with more steps; or Google ignores it and lists our copy
beside the author's, which is the thing Greg's ethical line exists to prevent. **`noindex` is what
Google itself asks a republisher for, and it is what we already do.**

### What else is worth anything

- **Meta keywords**: ignored by Google since 2009, a possible spam signal to Bing. **[S]** Skip.
- **Meta description**: cheap, already there, shown only if the page is indexed.
- **Sitemap**: Google says it is for "the URLs that you want to see in Google's search results …
  the canonical URLs". **[V]** A republished article does not belong in one.
- **Article structured data**: Google's page wants `author`, `datePublished`, `headline`, `image`,
  and a `publisher` that is the organisation. **[V]** On a republished copy the honest values are
  all the original's, and naming ourselves publisher would be false. The lowest-risk choice is to
  emit none.
- **`robots.txt` and `noindex` do not stack**: a crawler that obeys `Disallow` never fetches the
  page, so never sees `noindex`. **[V]**
  [Google](https://developers.google.com/search/docs/crawling-indexing/block-indexing)
- **`llms.txt`**: not worth it. Google has said it is not used, and a 2026 Ahrefs count found 97% of
  them are never requested. **[S]**

### An uploaded file with no address

- A canonical could be found only from something explicit in the file: a `<link rel="canonical">`
  or `og:url` inside an uploaded HTML page, a DOI in a PDF's metadata, an arXiv id. **[?]** (This
  follows from how those identifiers work; it was not researched.)
- A wrong guess publishes a false statement about where a piece came from. So never from the title.
- With no canonical known, `noindex` is the ethical default; a self-canonical would tell a search
  engine that ours is the address to prefer for a piece somebody else wrote. (A canonical states a
  preferred address, not who owns the work.)

### Where the SEO value actually is

Spideryarn's **own** pages: the homepage, `/features`, `/pricing`, `/help`, `/changelog`,
`/privacy`. They are ours, they say what the product is, and they are what somebody searching for
"AI-assisted reading" should find. Today they are shut out with everything else. The basics for
them are a title and description each, a self-canonical, a `sitemap.xml`, and `robots.txt` letting
crawlers in. Titles are set by React after load; Google runs JavaScript, other engines mostly do
not. **[?]**

## What we concluded

**Built** (plan [261005f](../plans/261005f-link-previews-and-seo-for-shared-links.md)): a brand
image on every card, the authors after the title, a card for every page and not only shared
articles, and the other preview robots let in.

**Not built, and put to Greg**: opening Spideryarn's own pages to search engines, since it reverses
a standing decision and changes a sentence we publish to authors; and whether shared articles
should ever be indexed, where the research says no.

**Rejected**: meta keywords, `llms.txt`, a tagline in the title or description, `og:url` pointing
at the original, structured data naming us as publisher, a canonical guessed from a title.

## Not verified

X's own documentation; Discord and iMessage; whether LinkedIn follows `og:url`; how Readwise,
Instapaper, Medium and the like brand a shared link; per-platform truncation lengths; the live
wording of Google's syndication advice; whether Google would in practice index one of our pages.
