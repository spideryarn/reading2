/**
 * **Our own server fetching the destination — once, for everybody.**
 *
 * *"Once" is the design and very nearly the behaviour; `LinkPreviewStore` in
 * src/store/contracts.ts says exactly where it stops.*
 *
 * Hover an external hyperlink in the prose and a card appears. Everything on it
 * used to be read off the href, plus two lookups that can only answer for a
 * minority of links: an article already on this shelf (measured hit rate 1 in
 * 67) and Wikipedia (1 link in 62 on this corpus). For the
 * philpapers/arXiv/nature majority the card was three lines and two of them the
 * reader could have guessed. This file is the fourth source
 * ([docs/project/links.md](../docs/project/links.md)), and the whole of it is
 * *what the page says about itself* — the title, the author's own opening, a
 * word count. No model call: that is stage 3, and this stage has to be good on
 * its own.
 * docs/plans/260905f-external-link-panel-add-to-spideryarn-and-server-side-preview.md
 * § Stage 2.
 *
 * ## The route is article-scoped, and that is the load-bearing decision
 *
 * `GET /api/link-preview?slug=…&url=…`, in the authenticated table. Being
 * authenticated is not enough on its own: any signed-in account could then call
 * it with any URL at all, which is an open proxy and an open wallet with a login
 * page in front of it. The `WithLinkFacts` seam hides the card from a visitor
 * and **is not route authorization**.
 *
 * So the route proves two things before it fetches or spends anything:
 *
 * 1. the caller **owns that article** — `loadArticle` is owner-scoped, so a slug
 *    belonging to somebody else is simply not found; and
 * 2. the requested URL **actually appears in that article's extracted links** —
 *    `articleLinks` in src/chat-tools.ts, the same parse the chat tool uses, so
 *    there is no second implementation to disagree with the first about what
 *    counts as a link in this article.
 *
 * That turns an arbitrary-URL fetch endpoint into one that can only ever fetch
 * things an author already published in a piece this reader owns, which closes
 * most of the probing surface in one move. GPT Sol, 2026-09-05, finding P1-1.
 *
 * **Accepted consequence:** a hyperlink in a *chat answer* is not in the
 * article's extracted links, so it gets the free card only. Widening to those
 * means proving membership against the thread instead, and that is a follow-up.
 *
 * ## Two URL identities, and conflating them is the bug this file must not have
 *
 * The cache and the single-flight claim are keyed on `requestTarget` — scheme,
 * host, port, path, query, ignoring only the fragment. `urlKey` is for
 * reader-facing equivalence and nothing else. src/urls.ts § `requestTarget` has
 * the argument; GPT Sol, P1-2.
 *
 * ## The fetch is `fetchDocument`'s, envelope and all
 *
 * No new fetch-safety plumbing — links.md is emphatic and security.md says why.
 * `readWebPage` in src/chat-tools.ts is the worked example and this copies its
 * *complete* envelope: the URL-length and query-length refusals before anything
 * is fetched, the scheme allowlist, `isBlockedAddress` against resolved
 * addresses re-checked at every redirect hop, the pinned agent against DNS
 * rebinding, the byte cap, the deadline, and one attempt rather than three
 * because a reader is waiting.
 *
 * ## What may be logged from this file
 *
 * `hostOf(url)`, a status, a byte count, a duration, an outcome — `readWebPage`'s
 * line exactly. **Never the URL.** A hovered URL is arguably more sensitive than
 * one the reader typed: they just moved a mouse while reading, and the path of
 * one can carry what they were reading about. docs/project/logging.md.
 */

import { Readability } from "@mozilla/readability";

import {
  type ArticleLink,
  articleLinks,
  MAX_URL_CHARS,
  MAX_URL_QUERY_CHARS,
} from "./chat-tools.js";
import { FetchFailure, fetchDocument, type FetchFailureCode } from "./fetch.js";
import { jsdom } from "./jsdom-lazy.js";
import { log, since } from "./log.js";
import { fetchAllowanceStore, linkPreviewStore, loadArticle } from "./store/index.js";
import type { CachedPreview, PreviewToStore, RatePolicy } from "./store/contracts.js";
import type { LinkPreviewResponse, PagePreview } from "./types.js";
import { carriesCredential, hostOf, isWebUrl, requestTarget } from "./urls.js";

const logger = log("store");

/* ------------------------------------------------------------- the knobs -- */

/**
 * **1 MB, and the number was measured rather than guessed.**
 *
 * docs/research/260827a-link-previews.md used to say a preview route is
 * `readWebPage`'s call *"with a smaller `maxBytes` — OG tags live near the top
 * of `<head>`, and jsdom parses truncated HTML fine"*. That is **false of this
 * fetch layer**: over the cap `fetchDocument` throws `code: "too-large"` before
 * returning anything, so there is no partial head to parse and a thrifty cap
 * yields nothing at all rather than a little.
 *
 * Measured over ten real destinations from this corpus on 2026-09-05: at 64 KB
 * only 2 of the 8 successes survive, at 256 KB only 4 — and nature, anthropic
 * and gwern all sit at 260–300 KB, just over that line, which makes 256 KB
 * fragile rather than thrifty. 1,048,576 is the smallest tested cap that loses
 * nothing; Wikipedia's 917,843 bytes is the largest in the sample.
 *
 * **Deliberately not doing:** changing `fetchDocument` to return truncated text
 * instead of throwing. That is a real change to a shared safety-critical file to
 * save a few hundred KB per URL fetched once ever.
 */
export const PREVIEW_MAX_BYTES = 1_048_576;

/**
 * How long the fetch gets.
 *
 * Shorter than `readWebPage`'s twenty seconds, because the thing waiting is a
 * hover card rather than a model mid-answer, and longer than the client's own
 * eight-second `LOOKUP_TIMEOUT_MS`, because a fetch that outlives the card still
 * fills the cache — the reader who gave up sees it on their next hover.
 */
export const PREVIEW_TIMEOUT_MS = 10_000;

/**
 * How long the single-flight claim is good for.
 *
 * Longer than the fetch deadline plus extraction and the write, so a healthy
 * request never has its claim taken out from under it; short enough that a
 * process killed mid-fetch costs one URL twenty seconds rather than for ever.
 */
export const PREVIEW_CLAIM_LEASE_MS = 20_000;

/**
 * **How long each outcome is an answer for.**
 *
 * *"Cache the failure"* with no clock is what lets one transient timeout or 429
 * poison a global row for ever, and lets a good preview go stale for ever. So
 * every row has an expiry and the class decides how long. GPT Sol, P2-2.
 *
 * - `ok` — fourteen days. A title and an opening paragraph do not change often,
 *   and the cost of being a fortnight behind on one is nil.
 * - `transient` — ten minutes, or whatever `Retry-After` asked for, capped.
 *   Short, because the whole point is that the next reader gets a real answer.
 * - `permanent` — seven days. A 404 or a Cloudflare challenge is stable, and
 *   *stable* is not *for ever*: philpapers could put its pages back tomorrow.
 */
export const PREVIEW_LIFETIMES = {
  ok: 14 * 24 * 60 * 60 * 1000,
  transient: 10 * 60 * 1000,
  permanent: 7 * 24 * 60 * 60 * 1000,
  /** The longest a `Retry-After` may push a transient row out. */
  maxRetryAfter: 6 * 60 * 60 * 1000,
} as const;

/**
 * **Sol's numbers, and they are explicitly guesses rather than measurements.**
 *
 * From the review verbatim: *"these are starting limits, not numbers established
 * by repository evidence; tune them from telemetry and the maximum acceptable
 * daily loss."* Nothing here has measured how many distinct links a reader
 * hovers in an hour. For scale: the noema essay has 62 distinct destinations and
 * both caches absorb every hover after the first, so 120 cold fills in an hour
 * is roughly two whole unread articles' worth of links — a reader nobody has
 * observed. **Tune from telemetry; do not treat these as established.**
 */
export const PREVIEW_RATE_POLICY: RatePolicy = {
  fills: 120,
  windowMs: 60 * 60 * 1000,
  concurrency: 4,
  leaseMs: PREVIEW_CLAIM_LEASE_MS,
};

/* ------------------------------------------------------------ extraction -- */

/** How much of each field is kept. Generous — a card clips again on the way out. */
const MAX_TITLE_CHARS = 300;
const MAX_SITE_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 600;
const MAX_PARAGRAPH_CHARS = 600;

/**
 * **Below this, Readability's "first paragraph" is not a paragraph.**
 *
 * Measured 2026-09-05: noema's comes back as the word "Credits" — a byline
 * artefact rather than an opening — and a card headed with the destination's own
 * words that then says "Credits" is worse than one that says nothing, because it
 * reads as a lookup that half worked. Eighty characters is comfortably below any
 * real opening sentence and comfortably above every label seen.
 */
const MIN_PARAGRAPH_CHARS = 80;

/**
 * **Below this, a word count is noise rather than a fact about the page.**
 *
 * Readability answers with *something* for almost any document, and on a
 * landing page or a JavaScript shell that something is a handful of words off a
 * button. *"3 words · ~1 min"* under a title is worse than no line at all: it
 * reads as a measurement of the destination when it is a measurement of what
 * Readability could find. Forty is far below the shortest real piece — the
 * shortest thing in this corpus is thousands — and far above every stub.
 *
 * The *paragraph* has its own, sharper check (`saneParagraph`); this is the
 * count's, and they are separate because a page can fail one and pass the other.
 */
const MIN_COUNTABLE_WORDS = 40;

/**
 * Openings that are furniture rather than prose, for the case a label is long
 * enough to pass the length test. A belt to the brace above.
 */
const LABEL_LIKE =
  /^(credits?|share this|share|subscribe|newsletter|advertis|related|tags?|contents?|menu|skip to|sign in|log ?in|cookie)\b/i;

/**
 * The destination's opening paragraph, or `null` when what came back is not one.
 *
 * Exported and pure because this is where a real decision lives and it is one
 * bad line away from putting furniture on a card. Three tests, cheapest first:
 * long enough to be a paragraph, not a label, and containing at least one
 * sentence's worth of punctuation — a wall of words with no full stop in it is
 * a navigation bar far more often than it is prose.
 */
export function saneParagraph(text: string | null | undefined): string | null {
  const trimmed = (text ?? "").replace(/\s+/g, " ").trim();
  if (trimmed.length < MIN_PARAGRAPH_CHARS) return null;
  if (LABEL_LIKE.test(trimmed)) return null;
  if (!/[.!?]/.test(trimmed)) return null;
  return trimmed.slice(0, MAX_PARAGRAPH_CHARS);
}

/** The first `<meta>` in the chain that has anything in it. */
function metaContent(doc: Document, selectors: readonly string[]): string | null {
  for (const selector of selectors) {
    const found = doc.querySelector(selector)?.getAttribute("content")?.trim();
    if (found) return found;
  }
  return null;
}

function tidy(value: string | null, max: number): string | null {
  const trimmed = (value ?? "").replace(/\s+/g, " ").trim();
  return trimmed === "" ? null : trimmed.slice(0, max);
}

/**
 * **What a page says about itself**, out of the jsdom we already own.
 *
 * A `querySelector` chain and **no metadata library**. `open-graph-scraper`,
 * `metascraper` and `link-preview-js` are all alive and all accept pre-fetched
 * HTML, but their real value is a hardened fetch layer we are deliberately
 * bypassing, and the extraction itself is this function.
 * docs/research/260827a-link-previews.md weighed all four.
 *
 * **The fallback chain is load-bearing rather than a nicety.** Three of the
 * eight successes measured on 2026-09-05 — plato.stanford, paulgraham, gwern —
 * carry no `og:` tags at all, so a version that read only Open Graph would have
 * lost more than a third of what works.
 *
 * `twitter:` is matched on both `name` and `property` because pages spell it
 * both ways and neither is rare.
 *
 * Returns `null` when the page said nothing worth a card. That is an outcome,
 * not an error: a landing page, a paywall, or a page that builds itself with
 * JavaScript is a real and stable answer, and caching it as such is what stops
 * every hover re-asking.
 */
/**
 * **How much of the destination's text is kept for the summariser.**
 *
 * Eight thousand characters — a little over the 6,000 the prompt actually sends
 * (`SUMMARY_DEST_CHARS` in src/link-summary.ts), so that a modest change to the
 * prompt's appetite does not need every cached page refetched. It is the only
 * field in this table that no card ever shows.
 *
 * The store is the ownerless one, so the size question is a retention question
 * as well as a cost one: src/db/schema.ts § `linkPreviews.excerpt` is where the
 * argument for keeping it at all lives.
 */
export const PREVIEW_EXCERPT_CHARS = 8_000;

/**
 * What Readability made of the page, as plain text — the summariser's input, and
 * nothing a reader sees.
 *
 * Returned beside the card fields rather than folded into them, because
 * `PagePreview` is the wire type and this must never reach it. `answerFrom`
 * hands the client `page` alone.
 */
export interface Extracted {
  page: PagePreview;
  excerpt: string | null;
}

export function extractPreview(html: string, url: string): Extracted | null {
  const { JSDOM } = jsdom();
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  const title = tidy(
    metaContent(doc, [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[property="twitter:title"]',
    ]) ?? doc.title,
    MAX_TITLE_CHARS,
  );
  const siteName = tidy(metaContent(doc, ['meta[property="og:site_name"]']), MAX_SITE_CHARS);
  const description = tidy(
    metaContent(doc, [
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
      'meta[property="twitter:description"]',
      'meta[name="description"]',
    ]),
    MAX_DESCRIPTION_CHARS,
  );

  /* Readability, the same parser stage 2 runs at ingest, so a page previewed
     here and a page ingested read the same. It mutates the document it is given,
     which is why everything above is read first. */
  let firstParagraph: string | null = null;
  let words: number | null = null;
  let excerpt: string | null = null;
  try {
    const parsed = new Readability(doc).parse();
    const body = parsed?.textContent?.trim() ?? "";
    if (body) {
      const counted = body.split(/\s+/).length;
      words = counted >= MIN_COUNTABLE_WORDS ? counted : null;
      /* **The opening of the text, for the summariser and for nobody else.**
         Gated on the same word count as `words` above, and for the same reason:
         under forty words what Readability found is a button and a cookie
         notice, and handing that to a model buys a paid call whose honest
         answer is "this page could not be read". */
      excerpt = words === null ? null : body.slice(0, PREVIEW_EXCERPT_CHARS);
      /* The first block of text, not the first line: Readability's output wraps
         a paragraph across newlines on some pages and not on others, so
         splitting on a single newline gives half a sentence about as often as
         it gives a paragraph. */
      const first = body.split(/\n\s*\n/).map((part) => part.trim()).find((part) => part !== "");
      firstParagraph = saneParagraph(first);
    }
  } catch {
    /* Readability throws on documents it cannot make sense of, and that is not
       a failure of the preview: the `og:` half above may already be everything
       worth showing. */
  }

  if (title === null && description === null && firstParagraph === null) return null;
  return {
    page: {
      ...(title === null ? {} : { title }),
      ...(siteName === null ? {} : { siteName }),
      ...(description === null ? {} : { description }),
      ...(firstParagraph === null ? {} : { firstParagraph }),
      ...(words === null ? {} : { words }),
    },
    excerpt,
  };
}

/* -------------------------------------------------------- classification -- */

/**
 * Failures worth trying again soon, and everything else is stable.
 *
 * The interesting entry is what is **not** here: `forbidden`. philpapers and
 * science.org answer 403 with `cf-mitigated: challenge`, confirmed by `curl`
 * with the same user-agent on 2026-09-05 — the corpus's commonest destination is
 * behind a bot challenge and no amount of plumbing gets past it. Retrying that
 * every ten minutes for every reader would be a lot of traffic to learn the same
 * thing, so it takes the long expiry and gets asked again next week.
 */
const TRANSIENT_CODES: ReadonlySet<FetchFailureCode> = new Set([
  "timeout",
  "connection",
  "dns",
  "rate-limited",
  "server-error",
]);

/** A failure, as a row: which class, why, and how long it stands. */
export function classifyFailure(
  err: unknown,
  now: number,
): { entry: CachedPreview; expiresAt: Date } {
  const failure = err instanceof FetchFailure ? err : null;
  const why = failure?.code ?? "failed";
  const transient = failure !== null && TRANSIENT_CODES.has(failure.code);
  if (!transient) {
    return {
      entry: { kind: "permanent", why },
      expiresAt: new Date(now + PREVIEW_LIFETIMES.permanent),
    };
  }
  /* **`Retry-After` where the response carried one**, capped: a server asking
     us to come back in a month is asking for something a shared cache should
     not promise, and a server asking for zero is asking for a retry loop. */
  const asked = failure?.retryAfterMs ?? null;
  const wait =
    asked === null
      ? PREVIEW_LIFETIMES.transient
      : Math.min(Math.max(asked, PREVIEW_LIFETIMES.transient), PREVIEW_LIFETIMES.maxRetryAfter);
  return { entry: { kind: "transient", why }, expiresAt: new Date(now + wait) };
}

/* ------------------------------------------------------------- the route -- */

/** We asked the destination and there is nothing to show. A URL property. */
const UNAVAILABLE: LinkPreviewResponse = { state: "unavailable" };

/**
 * We did not ask, and why is about this request rather than about the URL.
 *
 * The client must not cache this under the address — see the header of
 * `linkPreview` below, and `LinkPreviewResponse` in src/types.ts.
 */
const REFUSED: LinkPreviewResponse = { state: "refused" };

/**
 * Does this article really point at this address?
 *
 * `articleLinks` rather than a second parse of `block.html`, and the comment on
 * that function says why at length: an allowlist built on a *different* idea of
 * what counts as a link in this article is an allowlist that disagrees with the
 * one the model gets. Measured at ~8 ms over the noema essay's 72 links.
 *
 * The comparison is `requestTarget`, so `…/x` and `…/x#section` are the same
 * membership — a fragment is never sent, so fetching one is fetching the other.
 *
 * **What this costs, said out loud rather than optimised away.** The check needs
 * the article, so every *distinct* URL a reader hovers loads one — a ~150 KB
 * payload and a jsdom parse of its blocks. Bounded by distinct URLs and not by
 * hovers, because the client caches per URL for the session, so the worst case
 * on this corpus is the noema essay's 62 destinations spread across a reading.
 * The obvious repair is a per-`(slug, revision)` memo of `articleLinks`, and it
 * is deliberately not here: it is a cache with an invalidation question in front
 * of it, and nothing has yet shown that this is slow. Revisit when something
 * measures it rather than when somebody reads this paragraph.
 *
 * **It answers with the link rather than with a yes**, since stage 3. The row
 * carries the anchor's own words and the ids of the blocks it appears in, which
 * is exactly what the summary needs in order to say how the destination stands
 * to the passage the reader is in (src/link-summary.ts § `readerContext`) — and
 * it costs nothing extra, because the walk was already happening.
 *
 * **First match wins, and that is a known defect rather than a nicety.** The
 * same URL linked twice in one article is ordinary — the noema essay has two
 * such pairs in sixty-two links — and hovering the *second* mention gets, and
 * caches, the paragraph the *first* one sits in. The summary is then fluent,
 * about a real relationship in this piece, and about the wrong sentence, which
 * is worse than saying nothing. Membership is unaffected: the yes/no answer is
 * the same either way.
 *
 * The fix is the card sending the hovered anchor's **block id**, this function
 * checking that occurrence against the target, and the id joining the summary's
 * identity so two mentions are two rows. It is a change to what the client
 * sends rather than a tweak here, which is why it is written down instead of
 * done. GPT Sol, 2026-09-05; docs/project/links.md § Two known limitations.
 */
export function linkInArticle(
  blocks: Parameters<typeof articleLinks>[0],
  baseUrl: string | undefined,
  target: string,
): ArticleLink | null {
  for (const link of articleLinks(blocks, baseUrl)) {
    if (link.url !== null && requestTarget(link.url) === target) return link;
  }
  return null;
}

/** The membership question on its own, for the route that only needs the yes. */
function articlePointsAt(
  blocks: Parameters<typeof articleLinks>[0],
  baseUrl: string | undefined,
  target: string,
): boolean {
  return linkInArticle(blocks, baseUrl, target) !== null;
}

/**
 * `GET /api/link-preview?slug=…&url=…`.
 *
 * Every road out of here is one of the four `LinkPreviewResponse` members, and
 * none of them is an HTTP status: the card's rule is that a failure leaves it
 * exactly as it was.
 *
 * **`refused` and `unavailable` are different**, and the difference is not
 * decoration. `unavailable` is a fact about the *destination* — we asked and got
 * nothing — and the client is right to cache it and stop asking. `refused` is a
 * fact about *this request*: the URL is not in this article, or it looks like it
 * carries a key, or the reader's allowance is spent. Caching that under the URL
 * would let one hover of a chat link, or one rate-limited moment, silence an
 * ordinary prose link for the rest of the session — the same URL, refused for a
 * reason that was never about the URL. GPT Sol, 2026-09-05, P2-1.
 *
 * It tells a caller nothing they did not have: they supplied the slug and the
 * URL, and they own the article, so *"is this URL in this article"* is a
 * question they can already answer by reading it.
 *
 * The order of the steps is the design, and every check that can refuse without
 * spending anything comes first:
 *
 * 1. the URL is a web URL, is not absurdly long, and carries no credential;
 * 2. the caller owns the article, and the article points at that URL;
 * 3. the cache — **and a hit stops here**, taking no lock and no allowance;
 * 4. the single-flight claim;
 * 5. the reader's allowance, spent only by the request that won the claim;
 * 6. the fetch.
 */
export async function linkPreview(slug: string, url: unknown): Promise<LinkPreviewResponse> {
  if (typeof url !== "string" || !isWebUrl(url)) return REFUSED;

  /* **Refused before anything is fetched** — `readWebPage`'s pair of refusals,
     taken whole. A GET's URL is a channel, and here the URL comes from an
     author's HTML, which is untrusted party #1 (docs/project/security-map.md).
     The refusal names no numbers and the log line carries the host and the
     length but never the URL. */
  const host = hostOf(url) || "unknown";
  const bulky = (() => {
    try {
      const parsed = new URL(url);
      return parsed.search.length + parsed.hash.length > MAX_URL_QUERY_CHARS;
    } catch {
      return true;
    }
  })();
  if (url.length > MAX_URL_CHARS || bulky) {
    logger.warn({ host, chars: url.length }, "link preview: refused a URL carrying too much");
    return REFUSED;
  }
  /* **A capability in a query string must not reach an ownerless table.** The
     row would hold the exact URL *and* what came back from it, readable by
     anybody who hovers the same address. src/urls.ts § `carriesCredential`;
     GPT Sol, P1-7. The redirect chain is checked too, after the fetch — see
     `fetchAndStore`. */
  if (carriesCredential(url)) {
    logger.warn({ host }, "link preview: refused a URL that carries a credential");
    return REFUSED;
  }

  const target = requestTarget(url);
  if (target === null) return REFUSED;

  /* **Ownership**, and it is `loadArticle` doing it rather than a check beside
     it: the Postgres reader is owner-scoped (`ownedSlug` in src/store/pg.ts), so
     another reader's slug is not found at all — 404 rather than a 403 that
     confirms the article exists. **The throw becomes the route's own 404**, so
     an article that is not this reader's never reaches any response member. */
  const article = await loadArticle(slug);

  /* **Membership.** Without this the route is an arbitrary-URL fetch endpoint
     with a login page in front of it. See the header, finding P1-1. */
  if (!articlePointsAt(article.blocks, article.meta.url ?? undefined, target)) {
    logger.warn({ slug, host }, "link preview: that URL is not in that article");
    return REFUSED;
  }

  /* 3. The cache. A hit takes no lock and no allowance — the steady state must
     not queue behind anything, and it is the overwhelming majority of calls. */
  const known = await linkPreviewStore.read(target);
  if (known) return answerFrom(known);

  /* 4. The claim. Only the winner goes on to spend. */
  const claim = await linkPreviewStore.claim(target, PREVIEW_CLAIM_LEASE_MS);
  if (claim.kind === "hit") return answerFrom(claim.entry);
  if (claim.kind === "pending") return { state: "pending" };

  /* 5. The allowance, and **the claim is given back if it is refused** — a
     reader who has spent their hour must not leave a `pending` row wedging that
     URL for everybody else until the lease runs out. */
  const allowance = await fetchAllowanceStore.take("link-preview-fetch", PREVIEW_RATE_POLICY);
  if (allowance.kind !== "allowed") {
    await linkPreviewStore.release(target, claim.claimId);
    logger.warn({ why: allowance.kind }, "link preview: allowance spent");
    return REFUSED;
  }

  try {
    return await fetchAndStore(url, target, host, claim.claimId);
  } finally {
    /* Whatever happened. A caller that keeps its concurrency slot on the way out
       of an error path is a limiter that tightens by itself until nothing works
       — and it would do it silently. */
    await fetchAllowanceStore.finish(allowance.id);
  }
}

/** A stored row, as the answer a client gets. */
function answerFrom(entry: CachedPreview): LinkPreviewResponse {
  if (entry.kind === "ok") return { state: "ready", page: entry.page };
  if (entry.kind === "pending") return { state: "pending" };
  return UNAVAILABLE;
}

/**
 * The half that touches the network, split out so the route above reads as the
 * sequence of refusals it is.
 *
 * **A destination's failures are cached; ours are not.** A page behind a bot
 * challenge must be asked once a week rather than once a hover, and the reader
 * must see the card unchanged either way — so a `FetchFailure` is classified and
 * written down. Everything else gives the claim back and **throws**, which the
 * route turns into a 500 and `captureFailure` reports.
 *
 * That split is a correction rather than a nicety. The first version wrapped the
 * fetch, the extraction and the database write in one `try`, so an extraction bug
 * or a failed write became a seven-day `permanent` row about somebody else's page
 * — a fact about *our* defect, written down globally as a fact about *their*
 * site, and answered to every reader for a week. Worse: if the write had
 * committed and only its acknowledgement failed, the catch could have replaced
 * the good row it had just written. GPT Sol, 2026-09-05, P1-5. A bug should be
 * loud.
 */
async function fetchAndStore(
  url: string,
  target: string,
  host: string,
  claimId: string,
): Promise<LinkPreviewResponse> {
  const started = Date.now();

  let doc: Awaited<ReturnType<typeof fetchDocument>>;
  try {
    doc = await fetchDocument(url, {
      timeoutMs: PREVIEW_TIMEOUT_MS,
      maxBytes: PREVIEW_MAX_BYTES,
      /* One try, not three. Ingest can afford to be patient because nobody is
         watching it; a reader is hovering this. */
      attempts: 1,
    });
  } catch (err) {
    if (!(err instanceof FetchFailure)) {
      /* Not the destination's doing, so nothing about the destination is
         written down. The claim goes back so the next reader may try at once
         rather than waiting out a lease. */
      await linkPreviewStore.release(target, claimId);
      throw err;
    }
    /* `FetchFailure.code` is the classified reason — the whole point of that
       class is that every network failure in Node otherwise arrives as the same
       `TypeError: fetch failed` (src/fetch.ts). */
    const { entry, expiresAt } = classifyFailure(err, Date.now());
    logger.info(
      { host, code: err.code, why: entry.kind, ms: since(started) },
      "link preview: could not read a destination",
    );
    await linkPreviewStore.fill([{ target, entry, expiresAt }]);
    return UNAVAILABLE;
  }

  try {
    /* **The whole redirect chain, not only what the author published.** A
       harmless address can redirect into a signed one, and it is the *final*
       URL plus its content that would go into the ownerless table. `doc.chain`
       carries every hop, requested first and final last. GPT Sol, P1-3. */
    if (doc.chain.some((hop) => carriesCredential(hop))) {
      logger.warn(
        { host, hops: doc.chain.length },
        "link preview: a redirect landed on a URL that carries a credential",
      );
      /* A row under the **requested** target only. That address was vetted
         before the fetch, so writing it down adds nothing new, and nothing
         about where it went is stored — which is the whole point. A short
         expiry, because a redirect is a thing a site changes. */
      await linkPreviewStore.fill([
        {
          target,
          entry: { kind: "transient", why: "credential-redirect" },
          expiresAt: new Date(started + PREVIEW_LIFETIMES.transient),
        },
      ]);
      return UNAVAILABLE;
    }

    /* A PDF is a real and stable answer, and it is not one this can read: the
       page's own metadata is in the file rather than in a `<head>`. Long
       expiry, and the card is left as it was. */
    if (doc.kind === "pdf" || doc.text === null) {
      return await store(target, doc.url, {
        entry: { kind: "permanent", why: `not-html:${doc.kind}` },
        expiresAt: new Date(started + PREVIEW_LIFETIMES.permanent),
      });
    }

    /* `doc.url` and not the requested one: it is the base relative links resolve
       against, and a `doi.org` address is not where the piece lives. */
    const extracted = extractPreview(doc.text, doc.url);
    if (extracted === null) {
      logger.info(
        { host, status: doc.status, bytes: doc.bytes.length, ms: since(started) },
        "link preview: nothing to show",
      );
      return await store(target, doc.url, {
        entry: { kind: "permanent", why: "no-content" },
        expiresAt: new Date(started + PREVIEW_LIFETIMES.permanent),
      });
    }

    logger.info(
      {
        host,
        status: doc.status,
        bytes: doc.bytes.length,
        words: extracted.page.words ?? 0,
        /* Whether the summariser will have anything to read, as a boolean and
           never as the text. A run of `false` here means every card on this
           corpus is the free one, and nothing else would say so. */
        excerpt: extracted.excerpt !== null,
        ms: since(started),
      },
      "link preview: fetched a destination",
    );
    return await store(target, doc.url, {
      entry: { kind: "ok", page: extracted.page, excerpt: extracted.excerpt },
      expiresAt: new Date(started + PREVIEW_LIFETIMES.ok),
    });
  } catch (err) {
    /* Extraction or the write, and neither is a fact about the destination.
       Hand the claim back and let it be a 500 — see the header. `release` only
       removes a `pending` row carrying **this claim's own token**, so if the
       write did in fact land, it is left exactly as it is. */
    await linkPreviewStore.release(target, claimId).catch(() => {
      /* Already failing. A second failure here would replace a useful error
         with a less useful one. */
    });
    throw err;
  }
}

/**
 * Write the answer, and the alias when the fetch was redirected.
 *
 * **The alias is not decoration.** Without it, `doi.org/10.x`, a `t.co` and
 * every other redirecting spelling of one address go on producing independent
 * misses for ever — the content lands under the final target and the requested
 * one is never found again. GPT Sol, P1-2.
 *
 * The requested row is the alias and the final row holds the content, rather
 * than the other way round, because the *content* is what a second reader
 * arriving by a different redirecting address should find.
 */
async function store(
  target: string,
  finalUrl: string,
  result: { entry: CachedPreview; expiresAt: Date },
): Promise<LinkPreviewResponse> {
  const finalTarget = requestTarget(finalUrl);
  const rows: PreviewToStore[] = [];
  if (finalTarget === null || finalTarget === target) {
    rows.push({ target, entry: result.entry, expiresAt: result.expiresAt });
  } else {
    rows.push({ target: finalTarget, entry: result.entry, expiresAt: result.expiresAt });
    rows.push({ target, entry: { kind: "alias", finalTarget }, expiresAt: result.expiresAt });
  }
  await linkPreviewStore.fill(rows);
  return answerFrom(result.entry);
}
