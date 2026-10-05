/**
 * **What a shared link looks like when somebody pastes it** — one pure
 * function that swaps a document's managed head for one about this article.
 *
 * Until this landed, every `/read/<slug>` was rewritten to the same static
 * `index.html`, whose `<title>` is the bare word *Spideryarn*, and every page
 * title in the app was set by React after mount (src/web/page-title.ts). No
 * unfurler runs our JavaScript, so **every link anybody shared previewed as
 * nothing**. docs/plans/260827ai-public-read-only-access.md § Stage 2, and the design is
 * docs/plans/260828ao-public-read-only-stage2-input-sol.md § 4.
 *
 * ## Pure, and the purity is load-bearing
 *
 * No I/O, no database, no `process.env`, no request. It takes the built client
 * shell (a string, compiled into the function at build time by
 * scripts/client-shell.ts) and a `PublicHead` (read from Postgres by the public
 * reader), and returns a string. That is testable without a build, without a
 * deployment and without a database, which is why the head assertions in
 * tests/page-head.test.ts can be run against mutations of the escaper.
 *
 * ## What it is not
 *
 * **Not a renderer.** It replaces the region between two sentinel comments in
 * the `<head>` and nothing else; everything from `<body` onward is passed
 * through byte for byte, and there is a test that says so. The plan says
 * explicitly that this must not grow into server-side rendering — React still
 * mounts and still draws the page. If you find yourself wanting to reach past
 * the sentinels, that is the moment to stop and ask for a different design.
 *
 * That last sentence used to be the *only* thing standing between this function
 * and the body, which GPT Sol found on review: uniqueness and order were
 * checked, position was not, so a shell whose end sentinel had drifted below
 * `<body>` would have had its body silently deleted by the replacement. It is
 * `requireMarkersInHead` below now, and the build check calls the same function.
 */
import { isLeadImage, publicAssetPath } from "../asset-delivery.js";
import { escapeHtml, headText } from "../html.js";
import { type SitePage, sitePageUrl } from "../site-pages.js";
import { type BandMode, DEFAULT_MODE } from "../modes.js";
import type { ArticleView } from "../read-address.js";
import { APP_NAME, SEP, documentTitle } from "../title-text.js";
import { PUBLIC_ORIGIN, articleUrl, safePublicCanonical } from "../urls.js";
import type { PublicHead } from "../store/public-reader.js";

/* `PUBLIC_ORIGIN` was defined here, with the argument for why it is a constant
   rather than a `Host` header. Both are in src/urls.ts since 2026-09-02, when
   the export bundle became the second caller and a store file had no business
   importing a page renderer to get an address. `articleUrl` composes it. */


/**
 * **The `<title>` and the `og:title` are two different strings, on purpose.**
 *
 * `documentTitle` — imported, not restated — is the tab: the article's title,
 * normalised, clamped at a word boundary with an ellipsis, then ` · Spideryarn`.
 * src/web/page-title.ts assigns that exact string when React mounts a moment
 * later, so the tab does not change under the reader; src/title-text.ts is where
 * both halves come from and why each rule went the way it did.
 *
 * `og:title` below is composed here instead, with `headText` at a larger limit
 * and no suffix. A card is a different sink from a tab: it already carries
 * `og:site_name`, so repeating the app's name spends the visible half of it
 * saying one word twice, and an `…` in published metadata is a claim that the
 * title contained one.
 */

/**
 * The two clamps this file owns, in code points, from the design § 6.
 *
 * They differ because the sinks differ: a link card shows the `og:` pair, and a
 * card's description gets a paragraph's worth. `headText` does the clamping —
 * see src/html.ts for why it is by code point rather than by `.length`.
 *
 * The page title's clamp is not here: it is `CLAMP` in src/title-text.ts,
 * applied by the `documentTitle` this file calls, because the client applies the
 * same one to the same string.
 */
/* Exported since 2026-09-02 for `scripts/check-public-shell.ts`, which compares
   a deployed `og:title` against the article's own and has to clamp it the same
   way. It held a literal `120` until then — a second copy of this number, in
   the one file whose job is to notice when the deployed head is wrong. */
export const CARD_TITLE = 120;
const DESCRIPTION = 240;

/**
 * **The picture on a card that has no other**: one static image, drawn by
 * scripts/make-og-card.ts and committed as `public/og-card.png`.
 *
 * Ours. It is on every card of our own pages, and on a shared article's when we
 * hold no picture of the article fit for one (`leadImageUrl` below).
 * docs/plans/261005f-link-previews-and-seo-for-shared-links.md has the choice.
 *
 * `index.html` writes this address out by hand for the default head, and
 * tests/og-card.test.ts holds the two together, with the file's real size.
 */
export const OG_CARD = {
  path: "/og-card.png",
  url: `${PUBLIC_ORIGIN}/og-card.png`,
  width: 1200,
  height: 630,
} as const;

/**
 * **The one switch for the article's own picture on its card.** `false` puts
 * our brand image back on every card, and nothing else changes.
 *
 * Greg, 2026-10-05, asked whether to use it: *"hmmm, not sure. go with the lead
 * image for now"*. So it is on, and it is one line to take back. The first
 * slice refused it as somebody else's image on a card with our name on it; what
 * is built is the narrow form of it, in `leadImageUrl`.
 */
export const LEAD_IMAGE_ON_CARDS = true;

/**
 * **The address of the article's own picture for its card, or `null` for our
 * brand image.**
 *
 * Always our own origin and the public asset route
 * (`/api/public/asset/<slug>/<hash>.<ext>`, src/public/routes.ts), which serves
 * a copy we stored and re-asks whether the article is shared on every request.
 * **Never the publisher's URL**: `LeadImage` does not carry one. A preview
 * robot that hot-linked would tell the publisher which article of theirs is
 * being shared from here, and an address we did not check would be a stranger's
 * `src` in our head.
 *
 * The hash and the extension come from a `jsonb` manifest, so they are checked
 * for shape here, at the sink, as well as being escaped like every other value:
 * a hash that is not 64 hex digits gets the brand image rather than a guess.
 *
 * `on` is a parameter so the switch can be tested from both sides.
 */
export function leadImageUrl(head: PublicHead, on: boolean = LEAD_IMAGE_ON_CARDS): string | null {
  if (!on || !isLeadImage(head.image)) return null;
  const { sha256, ext } = head.image;
  return `${PUBLIC_ORIGIN}${publicAssetPath(head.slug, sha256, ext)}`;
}

/**
 * **The names a card's title ends with**, or `""` for none: one name, two
 * joined by `and`, or the first and `et al.`
 *
 * A card has room for a title and little else, and a paper's forty authors
 * would be all of it.
 */
export function cardAuthors(names: readonly string[]): string {
  const clean = names.map((n) => headText(n, 60)).filter((n) => n !== "");
  const [first, second] = clean;
  if (first === undefined) return "";
  if (second === undefined) return first;
  return clean.length === 2 ? `${first} and ${second}` : `${first} et al.`;
}

/**
 * **What `og:title` says**: the article's title, then who wrote it.
 *
 * Greg, 2026-10-04: *"Probably the article title and/or authors first in the
 * title"*. On the card only. The tab's `<title>` is `documentTitle`, which the
 * client rewrites a second later and must agree with
 * (docs/project/page-titles.md).
 *
 * **A title the clamp cut gets no names**, and neither does one the names
 * would push past the clamp. `CARD_TITLE` is the budget for the whole string,
 * and scripts/check-public-shell.ts can go on comparing a long title exactly.
 *
 * Exported for that script, which judges a deployed head with it.
 */
export function cardTitle(title: string | null, authors: readonly string[]): string {
  /* "Untitled" rather than an empty tag, matching `articleTitle()` in
     src/title-text.ts. **Effectively unreachable from `loadHead`**, which falls
     back to the slug and so always hands over a string — it is the defence for
     the paths that compose a head without one, and for a title that normalises
     to nothing. `||` and not `??`: a title of `"   "` normalises to `""`, which
     is as titleless as `null`. */
  const clamped = headText(title ?? "", CARD_TITLE) || "Untitled";
  const whole = headText(title ?? "", Number.MAX_SAFE_INTEGER);
  const names = cardAuthors(authors);
  if (names === "" || clamped !== whole) return clamped;
  /* One budget for the whole string: names that do not fit are left off, not
     cut, because half a name is worse than none. */
  const withNames = `${clamped}${SEP}${names}`;
  return [...withNames].length <= CARD_TITLE ? withNames : clamped;
}

/**
 * The boundary markers in index.html. The function replaces everything from the
 * first byte of the start marker to the last byte of the end marker, inclusive,
 * and touches nothing outside that span.
 *
 * Exported because scripts/client-shell.ts asserts the same two strings appear
 * exactly once, at build time, over the same shell. One definition rather than
 * two: a build check looking for a marker the composer has stopped using is a
 * check that passes while the composer throws in production.
 */
export const MANAGED_HEAD_START = "<!-- spideryarn:managed-head:start -->";
export const MANAGED_HEAD_END = "<!-- spideryarn:managed-head:end -->";

/**
 * **The shell with its managed head replaced by one about this article.**
 *
 * `head === null` returns the shell byte for byte — that is the answer for
 * every case that is not a public article: a private slug, an absent one, a
 * malformed one, a storage failure. Those responses carry their own status
 * code and the app's ordinary head, which already says `noindex, nofollow`.
 *
 * Throws if either sentinel is missing or appears twice. That cannot happen in
 * production, because scripts/client-shell.ts asserts the same thing at build
 * time over the same string — but a check that only exists at build time is one
 * refactor away from not existing, and a head assembled from the wrong halves
 * of a duplicated marker is the sort of failure that produces a valid-looking
 * page. It throws on the `null` path too, for the same reason: a shell this
 * function cannot understand is a broken build in every case, not only when
 * somebody happens to share a link.
 */
export function composeShell(
  shell: string,
  head: PublicHead | null,
  mode: BandMode = DEFAULT_MODE,
  view: ArticleView = "article",
): string {
  const start = shell.indexOf(MANAGED_HEAD_START);
  const end = shell.indexOf(MANAGED_HEAD_END);
  requireOnce(shell, MANAGED_HEAD_START, start);
  requireOnce(shell, MANAGED_HEAD_END, end);
  if (start > end) {
    throw new Error("Client shell: the managed-head end sentinel comes before the start.");
  }
  /* **Before the `head === null` return, not after it.** A shell whose markers
     straddle the body is a broken build, and it is broken whether or not this
     particular request happens to have an article to compose. Returning it
     untouched for the default-head cases would leave the one caller that most
     needs the alarm — every 404, 400 and 503 — silently accepting it. */
  requireMarkersInHead(shell, start, end);
  if (head === null) return shell;
  return replaceManagedHead(shell, start, end, tags(head, mode, view));
}

/**
 * **The shell with its managed head replaced by one of our own pages'**: its
 * title, its description, and a canonical and an `og:url` that name itself.
 *
 * The other composer in this file, and the only other one there should be. A
 * shared article's head is composed per request, from the database; this is
 * composed **at build time**, once per page of src/site-pages.ts, by
 * scripts/build-site-pages.ts, and served as a static file.
 *
 * **No robots tag, which is the point of it.** The default head says
 * `noindex, nofollow` and every path not on that list is served the default.
 * Greg, 2026-10-05: *"yes definitely we want those to be visible"*.
 *
 * The same checks as `composeShell`, on the same markers, and the sentinels are
 * left in place.
 */
export function composeSitePage(shell: string, page: SitePage): string {
  const start = shell.indexOf(MANAGED_HEAD_START);
  const end = shell.indexOf(MANAGED_HEAD_END);
  requireOnce(shell, MANAGED_HEAD_START, start);
  requireOnce(shell, MANAGED_HEAD_END, end);
  if (start > end) {
    throw new Error("Client shell: the managed-head end sentinel comes before the start.");
  }
  requireMarkersInHead(shell, start, end);
  return replaceManagedHead(shell, start, end, sitePageTags(page));
}

/** Everything from the start sentinel to the end one, swapped for `lines`. */
function replaceManagedHead(shell: string, start: number, end: number, lines: string[]): string {
  /* Purely cosmetic: match whatever this shell indents its head tags by, so the
     served HTML reads like the file it came from. Falls back to a bare newline
     if the sentinel is not the first thing on its line. */
  const lineStart = shell.lastIndexOf("\n", start) + 1;
  const indent = shell.slice(lineStart, start);
  const gap = /^[ \t]*$/.test(indent) ? `\n${indent}` : "\n";

  return shell.slice(0, start) + lines.join(gap) + shell.slice(end + MANAGED_HEAD_END.length);
}

/**
 * One of our own pages' tags. The title is the tab's, whole, on the card too:
 * these are our pages, so the name in it is not a repeat of somebody else's
 * title, and `Pricing` alone says too little on a card.
 */
function sitePageTags(page: SitePage): string[] {
  const url = sitePageUrl(page);
  return [
    MANAGED_HEAD_START,
    `<title>${escapeHtml(page.title)}</title>`,
    meta("name", "description", page.description),
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    meta("property", "og:type", "website"),
    meta("property", "og:site_name", APP_NAME),
    meta("property", "og:title", page.title),
    meta("property", "og:description", page.description),
    meta("property", "og:url", url),
    meta("property", "og:image", OG_CARD.url),
    meta("property", "og:image:width", String(OG_CARD.width)),
    meta("property", "og:image:height", String(OG_CARD.height)),
    meta("property", "og:image:alt", APP_NAME),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", page.title),
    meta("name", "twitter:description", page.description),
    meta("name", "twitter:image", OG_CARD.url),
    MANAGED_HEAD_END,
  ];
}

/**
 * **Both sentinels are in the `<head>`**, which is the invariant this file's
 * header claims and which uniqueness and ordering do not give you.
 *
 * `composeShell` replaces everything from the first byte of the start marker to
 * the last byte of the end marker. Uniqueness says there is one of each and the
 * order check says they are the right way round, and a shell whose end marker
 * had drifted to `<body><!-- …:end -->` satisfies both while the replacement
 * eats the opening of the body. The claim being made is about *position*, so
 * position is what has to be checked.
 *
 * `<body` rather than `<body>`, because `<body class="…">` is the same body.
 * A shell with no body tag at all is refused too: this function's guarantee is
 * "everything from `<body` onward is untouched", and there is no way to keep a
 * promise about a landmark that is not there — a document with no body is not a
 * client shell, whatever else it is.
 *
 * Exported so scripts/client-shell.ts can make the same assertion at build
 * time, over the same string, from the same code. Two copies of a positional
 * rule is how one of them ends up checking something slightly different, which
 * is the argument `MANAGED_HEAD_START` above already makes about the markers.
 */
export function requireMarkersInHead(shell: string, start: number, end: number): void {
  const body = shell.indexOf("<body");
  if (body === -1) {
    throw new Error(
      "Client shell: no <body tag, so there is no head/body boundary to keep the managed head " +
        "above. src/public/page-head.ts replaces the region between the sentinels and promises to " +
        "touch nothing from <body onward.",
    );
  }
  for (const [name, at] of [
    ["start", start],
    ["end", end],
  ] as const) {
    if (at > body) {
      throw new Error(
        `Client shell: the managed-head ${name} sentinel is at ${at}, below the <body at ${body}. ` +
          "Both sentinels must be inside the <head>, or replacing between them deletes body bytes.",
      );
    }
  }
}

/** One sentinel, exactly once. `at` is the first index, or -1. */
function requireOnce(shell: string, marker: string, at: number): void {
  if (at === -1) throw new Error(`Client shell: no ${marker} sentinel.`);
  const again = shell.indexOf(marker, at + marker.length);
  if (again !== -1) {
    throw new Error(
      `Client shell: the ${marker} sentinel appears more than once (at ${at} and ${again}).`,
    );
  }
}

/**
 * The tags themselves.
 *
 * Every piece of text goes through `headText` and then through `escapeHtml`,
 * in that order and exactly once each — normalise, then escape at the moment it
 * becomes markup. src/html.ts explains why those are two jobs.
 */
function tags(head: PublicHead, mode: BandMode, view: ArticleView): string[] {
  const card = cardTitle(head.title, head.authors);
  /* `head.gist` is already `root_gist` — itself the gist → summary → excerpt
     fallback from src/library-scalars.ts. When there is none, all three
     description tags are omitted rather than filled with the app's strapline: a
     strapline is not a description of this article, and three tags saying the
     wrong thing is worse than none. */
  const description = head.gist === null ? "" : headText(head.gist, DESCRIPTION);

  const out = [MANAGED_HEAD_START, `<title>${escapeHtml(documentTitle(head.title, mode, view))}</title>`];
  if (description) out.push(meta("name", "description", description));
  /* **Unconditional, and decided.** Greg, 2026-10-05, asked whether a shared
     article should ever be listed by a search engine: *"no"*. `robots.txt` lets
     a crawler fetch a `/read/` page precisely so that it reads this and the
     matching `X-Robots-Tag` (vercel.json), since a Disallow alone leaves the
     address listable. Our own pages have no such tag: `sitePageTags`. */
  out.push(meta("name", "robots", "noindex, nofollow"));
  out.push(meta("property", "og:type", "article"));
  out.push(meta("property", "og:site_name", APP_NAME));
  /* Without the ` · Spideryarn` suffix: a card already carries `og:site_name`,
     so repeating it in the title spends the visible half of the card saying the
     same word twice. */
  out.push(meta("property", "og:title", card));
  if (description) out.push(meta("property", "og:description", description));
  /* **Ours, while the canonical below is the original's, and they differ on
     purpose.** Facebook follows an `og:url` that names another address and
     draws that page's card instead, so the original's URL here would mean no
     card of ours at all. docs/research/261005b § `og:url`. */
  out.push(meta("property", "og:url", articleUrl(head.slug)));
  /* The article's own first picture when we hold a copy, and ours otherwise.
     No width or height for the article's: the manifest records neither, and
     the brand image's would be a claim about a different picture. */
  const lead = leadImageUrl(head);
  const image = lead ?? OG_CARD.url;
  out.push(meta("property", "og:image", image));
  if (lead === null) {
    out.push(meta("property", "og:image:width", String(OG_CARD.width)));
    out.push(meta("property", "og:image:height", String(OG_CARD.height)));
  }
  out.push(meta("property", "og:image:alt", lead === null ? APP_NAME : headText(head.title ?? "", CARD_TITLE) || APP_NAME));
  /* The large card, since 2026-10-05 and the image above. Every other platform
     draws a 1200x630 image large whatever X is told, so `summary` would only
     make X the odd one out. Without an image this value draws a broken card:
     the two go together. */
  out.push(meta("name", "twitter:card", "summary_large_image"));
  out.push(meta("name", "twitter:title", card));
  if (description) out.push(meta("name", "twitter:description", description));
  out.push(meta("name", "twitter:image", image));

  /* A canonical is a public statement about a URL we did not write, so
     `safePublicCanonical` gets the last word and its `null` means no tag at
     all — see src/urls.ts for the four things it refuses and why refusing beats
     publishing a guess. */
  const canonical = head.canonical === null ? null : safePublicCanonical(head.canonical);
  if (canonical !== null) out.push(`<link rel="canonical" href="${escapeHtml(canonical)}" />`);

  out.push(MANAGED_HEAD_END);
  return out;
}

/**
 * One `<meta>`. `property` for Open Graph, `name` for everything else — that is
 * what the two specifications say, and a `name="og:title"` is ignored by
 * Facebook while looking perfectly reasonable in the source.
 *
 * The attribute *values* are escaped; the key and the tag name are ours.
 */
function meta(key: "name" | "property", id: string, content: string): string {
  return `<meta ${key}="${id}" content="${escapeHtml(content)}" />`;
}
