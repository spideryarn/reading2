/**
 * The half of a link card that has to be **asked for** — a title, a first
 * paragraph, a length.
 *
 * link-preview.ts reads the href and is done in microseconds. This file is the
 * other kind: two lookups that can miss, can be slow, and can arrive after the
 * card is already on screen. Both were named and deferred by the survey on
 * 2026-08-27 (docs/research/260827a-link-previews.md); Greg asked for both the next day.
 *
 * ## The four sources
 *
 * 1. **An article already on this shelf.** Its title, its root gist and its
 *    length are already ours — stage 2 ran Readability over that page at ingest
 *    and stored the result, so this is a *lookup*, not a fetch. It is the
 *    richest thing any of these sources can produce and it costs one request to
 *    our own server, shared by every link in the article.
 *
 * 2. **Wikipedia's summary API.** `…/api/rest_v1/page/summary/<title>` returns
 *    title, description and a real first paragraph, sends
 *    `access-control-allow-origin: *`, and is the API half of Wikipedia's own
 *    Page Previews. A fixed known host, so there is no SSRF surface at all.
 *
 * 3. **Our own server, fetching the destination.** `GET /api/link-preview`,
 *    since 2026-09-05 — the general case, and the only source that can answer
 *    for an arbitrary page. It gives the destination's own title, site name,
 *    description and opening paragraph, plus a word count.
 *
 * 4. **A model, saying how that page stands to the piece being read.** `GET
 *    /api/link-summary`, since 2026-09-05 — the only thing on this card that we
 *    wrote rather than quoted, and the only one that costs money. It **streams**,
 *    and its accumulated text lives at module level rather than in the card, for
 *    the reason `summaryPartial` gives: the card is torn down on pointer-out.
 *    src/link-summary.ts.
 *
 * **The third one is a *server* fetch, and that is not a preference.** The
 * obvious version — fetch the destination from the reader's browser and run
 * Readability on it — cannot work for an ordinary host: a cross-origin `fetch`
 * of `philpapers.org/rec/BUTAAT` is rejected before the response is readable,
 * and a `no-cors` request hands back an opaque body with nothing in it. Verified
 * in a real browser rather than assumed; the numbers are in
 * docs/project/links.md § What a browser can and cannot reach.
 *
 * It also means the **destination never learns which reader hovered it**: the
 * first hover of a URL by anybody causes one fetch from our server, and every
 * hover after that — by that reader or any other — is a cache hit.
 * src/link-previews.ts and src/db/schema.ts § `linkPreviews`.
 *
 * ## What Wikipedia is told, and what it is not
 *
 * This is the first thing in the reading view that contacts a third party on a
 * reader's gesture, so the rules are worth stating rather than assuming:
 *
 * - **It fires on the open card, not on the pointer.** `useLinkFacts` is driven
 *   by what is actually shown, and a card takes 320ms of rest to open — so a
 *   pointer crossing the prose on its way somewhere sends nothing at all. The
 *   honest caveat: once a card *is* open, the hover machine swaps to the next
 *   target after 60ms (`WARM_MS`), so a reader deliberately running along a row
 *   of Wikipedia links with a card up can fire several. Cheap, cached, and a
 *   real reading gesture rather than a stray pointer.
 * - **No cookies.** A cross-origin `fetch` defaults to `credentials: "omit"`,
 *   so a reader with a Wikipedia login is not identified to it here.
 * - **No referrer.** `referrerPolicy: "no-referrer"` — otherwise the request
 *   would carry the address of the article being read, which is the same reason
 *   every outbound link on this card already carries `rel="noreferrer"`.
 * - **Once per title per session.** The cache below is module-level, so
 *   re-hovering the same link is silent.
 *
 * What is left is Wikimedia learning that some IP looked up a title. That is
 * exactly what their own Page Previews does from every reader's browser, and it
 * is the trade the research doc accepted for this one host — not a precedent
 * for fetching arbitrary destinations from the client, which the same doc
 * refuses.
 *
 * See docs/project/links.md.
 */
import { useEffect, useReducer } from "react";
import { urlKey } from "../ingest.js";
import { isWebUrl } from "../urls.js";
import type { LibraryEntry, LinkPreviewResponse, PagePreview } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { readEvents, STREAM_STALL_MS } from "./lib/sse.js";
import type { LinkPreview } from "./link-preview.js";

/** The fields of Wikipedia's summary response this card actually uses. */
export interface WikiSummary {
  /** The article's real title, which is not always the one in the URL. */
  title: string;
  /** Wikidata's one-liner — "Ancient Greek analogue computer". Often absent. */
  description?: string;
  /** The lead paragraph, in plain text. The reason to ask at all. */
  extract: string;
}

export interface LinkFacts {
  /** A lookup for this link is still outstanding. Drives the spinner. */
  loading: boolean;
  library: LibraryMatch | null;
  wiki: WikiSummary | null;
  /**
   * **Have we actually got the shelf, or is `library: null` just ignorance?**
   *
   * `library` is null in three different situations — still loading, the
   * request failed, and the page genuinely is not on the shelf — and until
   * 2026-09-05 nothing here could tell them apart. That was harmless while the
   * only consequence was a section not being drawn. It stopped being harmless
   * when the card grew a button that spends a metered ingest slot: on the first
   * hover of a session, before `/api/library` lands, *every* link looked
   * absent, so the card would offer to add an article the reader already owns —
   * the one you are reading included. GPT Sol, 2026-09-05, finding P1-1.
   *
   * False means **we do not know**, and the honest thing to do with a metered
   * action under uncertainty is not to offer it.
   */
  shelfKnown: boolean;
  /**
   * **What the destination itself says about itself**, fetched by our server —
   * the third source, and the only one that answers for an arbitrary page.
   *
   * Null covers *not asked*, *still asking* and *asked and got nothing*, which
   * the card treats identically: it draws no section, and the free card is left
   * exactly as it was. Unlike `library`, nothing here spends anything or offers
   * the reader an action, so the three do not need telling apart.
   */
  page: PagePreview | null;
  /**
   * **How that destination stands to the piece the reader is holding** — the
   * one thing on this card that we wrote, and the only one that costs money.
   *
   * `text` is what has arrived so far, which is the whole answer once
   * `streaming` is false. **Two fields rather than one string**, because a
   * paragraph that has stopped growing and a paragraph that is still arriving
   * look identical and mean different things: the card draws a cursor for the
   * second and nothing for the first, and without the flag a stream that broke
   * off would read as a summary that ended mid-sentence on purpose.
   *
   * Null covers not asked, nothing to say, and refused — all of which draw no
   * section at all. src/link-summary.ts.
   */
  summary: { text: string; streaming: boolean } | null;
}

export interface LibraryMatch {
  entry: LibraryEntry;
  /** The link points at the article the reader is already reading. */
  self: boolean;
}

const NOTHING: LinkFacts = {
  loading: false,
  library: null,
  wiki: null,
  shelfKnown: false,
  page: null,
  summary: null,
};

/**
 * How long either lookup gets before it counts as having found nothing.
 *
 * **The spinner is the reason this exists.** Neither `fetch` here has any
 * deadline of its own, and a request that never settles is not a slow card —
 * it is `looking it up…` under every external link in the article, for the rest
 * of the session, with nothing coming. A card that gives up says the true thing
 * (we could not find out) and a card that spins forever says a false one.
 *
 * Eight seconds because both of these are meant to be quick — one is our own
 * server on the same machine, the other a CDN-fronted summary — and because
 * anything the reader is still hovering after eight seconds they have stopped
 * waiting for. Raised by a GPT Sol review, 2026-08-27.
 */
const LOOKUP_TIMEOUT_MS = 8_000;

/**
 * A deadline, or nothing where the runtime has no `AbortSignal.timeout`.
 *
 * Every browser this app runs in has it. `undefined` rather than a throw is for
 * anything else that ever imports this file — a test runner, a server render —
 * where the honest fallback is the behaviour we had yesterday rather than a
 * crash on module load.
 */
function deadline(): AbortSignal | undefined {
  return typeof AbortSignal?.timeout === "function"
    ? AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
    : undefined;
}

/* ------------------------------------------------------------ the shelf --- */

/**
 * Every article on the shelf, keyed by `urlKey`, or undefined until asked.
 *
 * **Module-level, and loaded lazily on the first external link a reader
 * actually hovers.** Both halves of that are deliberate. Lazily, because four
 * of the seven articles in this corpus came from PDFs and have no hyperlinks at
 * all — an eager fetch on every article open would be a request that could
 * never pay for itself. Module-level, because the alternative is one shelf per
 * mounted card and the point is that all of an article's links share one
 * request.
 *
 * It is not refreshed **on its own**. An article added in another tab during
 * this reading session will not be matched until reload, which is a stale
 * *absence* — the card falls back to the ordinary one and says nothing wrong.
 *
 * **The one thing that does refresh it is `refreshShelf`**, and it exists
 * because a stale absence stops being harmless the moment this tab is the thing
 * that made it stale: the card's own Add button puts a page on the shelf, and
 * without this the same card would go on saying that page is not on the shelf
 * until a reload. See `refreshShelf`.
 */
let shelf: Map<string, LibraryEntry> | undefined;
let shelfPending: Promise<void> | null = null;

/**
 * The first load asked and could not find out.
 *
 * Kept apart from `shelf` because the two answer different questions and the
 * card now needs both: *should I still be spinning* (no — we asked and failed,
 * and we are not going to re-ask this session) and *do I know what is on the
 * shelf* (no). Before this, a failure installed an empty map, which said "the
 * shelf is empty" to anything that looked — fine for a section that simply
 * isn't drawn, wrong for a button that spends an ingest slot.
 */
let shelfFailed = false;

/**
 * The newest read of the shelf that has actually **installed** one.
 *
 * Two reads can be in flight at once — the lazy first load and a refresh after
 * an add — and the network may answer them in either order. Without a guard the
 * older answer can land second and put the pre-add shelf back, which is a card
 * saying "not on your shelf" about an article the reader watched arrive.
 *
 * **Installed rather than started**, which is the correction to the first
 * version of this: comparing against the newest read *started* meant a refresh
 * that started and then failed permanently silenced an initial load that was
 * still in flight — leaving `shelf` undefined with `shelfPending` already
 * resolved, so `looking it up…` sat under every external link for the rest of
 * the session and nothing would ever ask again. GPT Sol, 2026-09-05, P2-3.
 */
let shelfInstalled = 0;
let shelfRead = 0;

/**
 * Told whenever the shelf map is replaced, so a card already on screen can
 * upgrade itself.
 *
 * A bare listener set rather than a store: the answer is derived during render
 * from the module cache (see `useLinkFacts`), so all a subscriber needs is a
 * poke. `useLinkFacts` is the only subscriber today.
 */
const shelfWatchers = new Set<() => void>();

/** Hear about a new shelf. Returns the unsubscribe. */
function watchShelf(onChange: () => void): () => void {
  shelfWatchers.add(onChange);
  return () => {
    shelfWatchers.delete(onChange);
  };
}

/**
 * The shelf, keyed the way an href will be looked up.
 *
 * Exported and pure so it can be tested: this is where a real decision lives,
 * and it is one bad line away from a card that never matches anything and looks
 * exactly like a card that had nothing to match.
 *
 * **`urlKey`, not the URL** — the same function that decides whether a pasted
 * address is an article we already have, so the card and the shelf cannot
 * disagree about what counts as the same page. It is what makes `http` match
 * `https`, `www.` match the bare host, a trailing slash match none, and a
 * `?utm_source=` be ignored — every one of which an author writes differently
 * from however we happened to fetch it.
 *
 * **First writer wins on a collision.** Two articles keying the same is a
 * duplicate on the shelf, which `urlKey` exists to make rare; when it happens
 * the card names one of them rather than picking cleverly, because there is
 * nothing here that could pick well.
 */
export function shelfIndex(entries: readonly LibraryEntry[]): Map<string, LibraryEntry> {
  const index = new Map<string, LibraryEntry>();
  for (const entry of entries) {
    /* No URL, or one that is not a web address, means the article came from
       somewhere no href can point at — an uploaded PDF. Newer ones simply have
       no `url`; older ones on disk carry the `file:///…` they were read from,
       which `urlKey` would happily key under a path on somebody's laptop. Both
       are skipped, because an entry nothing can ever match is an entry that can
       only be matched by accident. */
    if (!entry.url || !isWebUrl(entry.url)) continue;
    const key = urlKey(entry.url);
    if (!index.has(key)) index.set(key, entry);
  }
  return index;
}

/** `GET /api/library`, indexed — or null for "we could not find out". */
function readShelf(): Promise<Map<string, LibraryEntry> | null> {
  // Spread rather than `{ signal: deadline() }`: `exactOptionalPropertyTypes`
  // is on, so an explicit `undefined` is not the same as an absent key.
  const stop = deadline();
  return apiFetch("/api/library", { ...(stop ? { signal: stop } : {}) })
    .then((r) => readJson<{ articles: LibraryEntry[] }>(r))
    .then((body) => shelfIndex(body.articles))
    /* Null rather than an empty map, so the two callers below can differ on
       what a failure means — and they do. `apiFetch` has already put the
       failure in the console. */
    .catch(() => null);
}

/**
 * Take a read of the shelf, and install it unless a newer read already has.
 *
 * @returns whether this read installed a shelf. False covers both "the request
 *   failed" and "a fresher answer got here first", which are the same thing to
 *   a caller: what it asked for did not happen.
 */
function applyShelf(): Promise<boolean> {
  const read = ++shelfRead;
  return readShelf().then((index) => {
    if (index === null) return false;
    // Strictly older than one already installed — see `shelfInstalled`.
    if (read < shelfInstalled) return false;
    shelfInstalled = read;
    shelf = index;
    shelfFailed = false;
    for (const wake of [...shelfWatchers]) wake();
    return true;
  });
}

function loadShelf(): Promise<void> {
  if (shelf || shelfFailed) return Promise.resolve();
  /* **A failure is recorded rather than dressed up as an empty shelf**, and
     the deadline above is why the record matters: the card has to stop saying
     it is looking, and that used to be done by installing `new Map()` — which
     also told everything downstream that the shelf was empty. `shelfKnown` on
     `LinkFacts` is the honest version.

     **It is not retried for the rest of the session.** A reader who was
     offline for one hover keeps the plain card until they reload, which is
     the cost of not having a card that re-asks on every hover of every
     link in a long article. */
  shelfPending ??= applyShelf().then((ok) => {
    if (!ok && shelf === undefined) shelfFailed = true;
    for (const wake of [...shelfWatchers]) wake();
  });
  return shelfPending;
}

/**
 * **Read the shelf again, because this tab just changed it.**
 *
 * The card's Add button queues an ingest, and when that ingest finishes the
 * page really is on the shelf — but `shelf` above was filled once, on the first
 * hover of the session, and nothing else ever writes to it. Without this the
 * reader watches the job succeed in the card and the very same card goes on
 * offering to add it, for as long as they stay on the page. That is the loop
 * that makes the feature compound, so it is not optional decoration:
 * docs/plans/260905f-external-link-panel-add-to-spideryarn-and-server-side-preview.md § Stage 1.
 *
 * **A failure keeps the shelf we had.** There is a good map in hand by the time
 * anything calls this, and replacing it on a blip would take "on your shelf"
 * away from every other link in the article.
 *
 * **It answers whether it worked**, and that is not decoration: the caller
 * remembers which completed jobs it has already spent a refresh on, so a
 * refresh that failed must not be remembered as one that happened, or the card
 * sits on *added to your shelf* and never becomes *read it here*. GPT Sol,
 * 2026-09-05, P2-1.
 */
export function refreshShelf(): Promise<boolean> {
  return applyShelf();
}

/* -------------------------------------------------------------- wikipedia -- */

/** `en:Antikythera_mechanism` → the summary, or null for "asked, nothing there". */
const wikiCache = new Map<string, WikiSummary | null>();
const wikiPending = new Map<string, Promise<void>>();

function wikiCacheKey(wiki: { lang: string; title: string }): string {
  return `${wiki.lang}:${wiki.title}`;
}

/**
 * What we will believe out of Wikipedia's answer.
 *
 * Exported and pure for the same reason `shelfIndex` is, and with more cause:
 * **this is the one place in the reading view where a third party's JSON
 * reaches a React render.** The shape is stable and documented and none of that
 * is a reason to trust a field's type — a `title` that arrived as an object
 * would be rendered as one, which React declines to do by throwing, which takes
 * the card down. Each field is checked rather than cast.
 *
 * Returns null for anything we could not use, and null means "asked, nothing
 * there" — which is cached, so a page that answers oddly is asked once.
 * **A summary with no lead paragraph counts as nothing**: a section headed
 * "from wikipedia" with a title and no words in it is worse than no section,
 * because it reads as a lookup that broke rather than one that had nothing.
 */
export function readSummary(body: unknown): WikiSummary | null {
  if (typeof body !== "object" || body === null) return null;
  const fields = body as { title?: unknown; description?: unknown; extract?: unknown };
  const title = typeof fields.title === "string" ? fields.title.trim() : "";
  const extract = typeof fields.extract === "string" ? fields.extract.trim() : "";
  if (!title || !extract) return null;
  const description =
    typeof fields.description === "string" && fields.description.trim()
      ? fields.description.trim()
      : undefined;
  return { title, extract, ...(description ? { description } : {}) };
}

function loadWiki(wiki: { lang: string; title: string }): Promise<void> {
  const key = wikiCacheKey(wiki);
  if (wikiCache.has(key)) return Promise.resolve();
  const existing = wikiPending.get(key);
  if (existing) return existing;

  /* `redirect=true` so a link to a redirect title — which is most of the
     interesting ones, since authors link the phrase they used rather than the
     article's canonical name — resolves rather than 404s. The title is
     re-encoded because `wikiOf` decoded it: a title with a `/` in it would
     otherwise look like two path segments. */
  const url =
    `https://${wiki.lang}.wikipedia.org/api/rest_v1/page/summary/` +
    `${encodeURIComponent(wiki.title)}?redirect=true`;

  // One signal, held in a variable: `AbortSignal.timeout` mints a fresh one on
  // every call, so building the init object from two calls would arm two clocks
  // and attach the second.
  const stop = deadline();
  const run = fetch(url, {
    // See the header comment: no cookies, and never the address of the article
    // the reader is looking at.
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: { accept: "application/json" },
    // A deadline, so a request that hangs becomes "nothing there" rather than a
    // spinner with no end. The abort lands in the `.catch` below like any other
    // failure, and is cached as nothing — asked once.
    ...(stop ? { signal: stop } : {}),
  })
    .then(async (res) => {
      // A 404 is an ordinary answer here — the article was renamed or never
      // existed — and is cached as "nothing" so it is asked once, not on every
      // hover.
      if (!res.ok) return null;
      return readSummary(await res.json());
    })
    .catch(() => null)
    .then((summary) => {
      wikiCache.set(key, summary);
      wikiPending.delete(key);
    });

  wikiPending.set(key, run);
  return run;
}

/* ----------------------------------------------------- the destination --- */

/**
 * What the destination itself said, keyed by the **URL as written in the
 * article**, or null for "asked, nothing there".
 *
 * The same shape as `wikiCache` above and for the same three reasons: module
 * level so a re-hover is silent, a `null` entry so a page that answers oddly is
 * asked once rather than on every hover, and a separate `pending` map so two
 * cards over the same link share one request.
 *
 * **Keyed by URL and not by `(slug, url)`.** The answer is a property of the
 * address — the server's row is ownerless and article-less — and the slug is
 * only ever the *permission* to ask. A reader who moves to another article in
 * the same tab and meets the same link should get the answer already in hand.
 */
const pageCache = new Map<string, PagePreview | null>();
const pagePending = new Map<string, Promise<void>>();

/**
 * **How long to wait before asking again after a `pending`.**
 *
 * `pending` means another request holds the server's single-flight claim for
 * this exact URL — somebody else's cold hover, or this reader's own in another
 * tab. It is the one answer worth a second question: treating it as "nothing"
 * would leave that URL blank for the rest of the session for whoever lost a
 * race they never knew about, which looks exactly like the feature not working.
 *
 * **Three seconds, not one**, and the number is chosen against the server's
 * envelope rather than against what feels responsive: the winner's fetch has ten
 * seconds (`PREVIEW_TIMEOUT_MS`), so a retry at 1.2s — the first version —
 * usually arrives while the winner is still out on the network, and asks the
 * same question again to get the same answer. Three seconds covers the median
 * page comfortably. It is a compromise either way, which is why the *other* half
 * matters more.
 *
 * **The other half: a second `pending` is not remembered.** One retry and no
 * more — a loop here would be a card polling a fetch endpoint for as long as a
 * pointer rests on a link — but the result is left out of the cache, so the next
 * hover of that link asks again and by then the winner has almost certainly
 * filled it. GPT Sol, 2026-09-05, P2-2.
 */
const PAGE_RETRY_MS = 3_000;

/** What the server answers with, checked field by field before React sees it. */
function readPage(body: unknown): LinkPreviewResponse | null {
  if (typeof body !== "object" || body === null) return null;
  const state = (body as { state?: unknown }).state;
  if (state === "pending") return { state: "pending" };
  if (state === "unavailable") return { state: "unavailable" };
  if (state === "refused") return { state: "refused" };
  if (state !== "ready") return null;
  const page = (body as { page?: unknown }).page;
  if (typeof page !== "object" || page === null) return null;
  const fields = page as Record<string, unknown>;
  const text = (name: string): string | undefined => {
    const value = fields[name];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  };
  /* Each field checked rather than cast, for `readSummary`'s reason one section
     up: this is our own server, but the *strings in it* came off a stranger's
     page, and a `title` arriving as an object would be handed to React, which
     declines by throwing, which takes the whole card down rather than one line
     of it. Our own API is not a reason to skip the check — it is a reason the
     check is cheap. */
  const title = text("title");
  const siteName = text("siteName");
  const description = text("description");
  const firstParagraph = text("firstParagraph");
  const rawWords = fields.words;
  const words = typeof rawWords === "number" && Number.isFinite(rawWords) && rawWords > 0
    ? Math.round(rawWords)
    : undefined;
  /* A section with a heading and nothing under it reads as a lookup that broke,
     which is worse than no section — the same rule `readSummary` follows. */
  if (!title && !description && !firstParagraph) return null;
  return {
    state: "ready",
    page: {
      ...(title ? { title } : {}),
      ...(siteName ? { siteName } : {}),
      ...(description ? { description } : {}),
      ...(firstParagraph ? { firstParagraph } : {}),
      ...(words === undefined ? {} : { words }),
    },
  };
}

/** One request. Null covers every failure, which is all the card can use. */
async function askServer(slug: string, url: string): Promise<LinkPreviewResponse | null> {
  const stop = deadline();
  const query = `?slug=${encodeURIComponent(slug)}&url=${encodeURIComponent(url)}`;
  try {
    const res = await apiFetch(`/api/link-preview${query}`, { ...(stop ? { signal: stop } : {}) });
    return readPage(await readJson<unknown>(res));
  } catch {
    /* `apiFetch` has already put the failure in the console. Here a failure is
       an absence, and the card is left exactly as it was — see `loadPage`. */
    return null;
  }
}

/**
 * **Ask our server what is on the other side of this link.**
 *
 * The third source, and the only one that can answer for an arbitrary
 * destination: a cross-origin `fetch` of `philpapers.org` from the reader's
 * browser is rejected before the response is readable, so the general case needs
 * our own server (docs/project/links.md § What a browser can and cannot reach).
 *
 * **A failure is cached as nothing and never retried this session**, exactly
 * like Wikipedia's. Two of the ten destinations measured in this corpus are
 * permanently behind a Cloudflare challenge, and that has to look like nothing
 * happening rather than like an error — there is no *"couldn't reach it"* line,
 * because a card that reports every dead link is a card that is mostly apology.
 *
 * The one exception is `pending`, which is not an answer at all: see
 * `PAGE_RETRY_MS`.
 */
function loadPage(slug: string, url: string): Promise<void> {
  if (pageCache.has(url)) return Promise.resolve();
  const existing = pagePending.get(url);
  if (existing) return existing;

  const run = (async () => {
    let answer = await askServer(slug, url);
    if (answer?.state === "pending") {
      await new Promise((wake) => setTimeout(wake, PAGE_RETRY_MS));
      answer = await askServer(slug, url);
    }
    /**
     * **Only an answer about the URL is remembered.**
     *
     * `ready` and `unavailable` are properties of the address, so both are
     * cached — the second as "asked, nothing there", exactly like Wikipedia's.
     *
     * `refused` and a second `pending` are **not** properties of the address,
     * and caching them was a bug in the first version of this. A `refused` is
     * about this request: a chat link (which is in no article, so always
     * refused), or a moment when the reader's allowance was spent. A second
     * `pending` means somebody else was still fetching when we asked twice —
     * their answer is very likely in the cache a few seconds later, and
     * remembering "nothing" would be remembering the one thing that was
     * certainly about to change. Both leave the map empty so a later hover
     * asks again. GPT Sol, 2026-09-05, P2-1 and P2-2.
     *
     * A **transport** failure — the deadline, an offline moment, a malformed
     * body — is `null` here and *is* cached, which is the same trade the other
     * two sources make and for the same reason: the alternative is a card that
     * re-asks on every hover of every link for the rest of a session that
     * started badly.
     */
    if (answer?.state === "ready") pageCache.set(url, answer.page);
    else if (answer === null || answer.state === "unavailable") pageCache.set(url, null);
    pagePending.delete(url);
  })();

  pagePending.set(url, run);
  return run;
}

/* --------------------------------------------------------- the summary --- */

/**
 * **The finished summary for one link in one article**, or null for "asked, and
 * there is nothing to show".
 *
 * **Keyed by `(slug, url)` and not by url alone**, which is the difference
 * between this cache and `pageCache` above and is the whole point of the
 * feature: what the destination *says* is a property of the address, and how it
 * *stands to what you are reading* is not. The same link hovered in two articles
 * is two different answers, and a URL-keyed cache would show the first one under
 * the second article — a sentence about the wrong piece, in a card that looks
 * entirely normal.
 */
const summaryCache = new Map<string, string | null>();

/**
 * **What has arrived so far, for a stream still in flight.**
 *
 * Module level, and that is not tidiness. The card is torn down when the pointer
 * leaves *and* by a `MutationObserver` when the prose re-renders
 * (ProseHoverCard.tsx), so a stream held in component state would start again
 * from nothing on every re-hover — several times a minute, each time paying for
 * a model call that the reader then interrupts. Here the tokens go on
 * accumulating whoever is looking, and a card that comes back picks up whatever
 * has arrived. GPT Sol, 2026-09-05, P1-6.
 */
const summaryPartial = new Map<string, string>();
const summaryPending = new Map<string, Promise<void>>();

/**
 * Told on every token, so a card that is on screen grows as the answer does.
 *
 * A bare listener set rather than a store, for `shelfWatchers`' reason: the
 * answer is derived during render from the maps above, so all a subscriber needs
 * is a poke.
 */
const summaryWatchers = new Set<() => void>();

function watchSummaries(onChange: () => void): () => void {
  summaryWatchers.add(onChange);
  return () => {
    summaryWatchers.delete(onChange);
  };
}

function wakeSummaryWatchers(): void {
  for (const wake of [...summaryWatchers]) wake();
}

/** `(slug, url)`, as one key. The newline cannot appear in either half. */
function summaryKey(slug: string, url: string): string {
  return `${slug}\n${url}`;
}

/**
 * **Throw the summaries away, because the reader just changed one of the things
 * they were written from.**
 *
 * The server compares four fingerprints on every read and a stale row is a miss
 * — but **this map is in front of the server** and knows none of them, so a
 * cache hit here never asks. The reader edits *"why you're reading this one"* on
 * the metadata page, comes back to the article, hovers a link they hovered
 * before, and gets the answer written for the sentence they replaced. Nothing
 * looks wrong: it is a paragraph about the right link. GPT Sol, 2026-09-05.
 *
 * **The whole map, not one article's rows**, because the global half of a
 * profile is true of every article — and because a map of a few dozen strings is
 * not worth a selective delete and the risk of getting the selection wrong.
 *
 * It is deliberately not a subscription to anything: the two places a reader
 * can change these call it directly, which is a line a reviewer sees at the
 * write, where the alternative is a listener somebody has to know exists.
 */
export function forgetSummaries(): void {
  summaryCache.clear();
  wakeSummaryWatchers();
}

/**
 * **Ask our server how this link stands to the piece being read.**
 *
 * A stream rather than a request that answers once, because AGENTS.md says to
 * stream anything a person is waiting on and because the first sentence at two
 * seconds and a spinner for fifteen are the same call — see src/link-summary.ts.
 * A cache hit arrives as a single `ready` frame and looks instantaneous.
 *
 * **What is remembered and what is not** is `loadPage`'s rule one section up,
 * applied to the same four outcomes:
 *
 * - `ready` — the answer. Remembered.
 * - `unavailable` — there is nothing here to summarise: the destination could
 *   not be read, or what came back was navigation furniture. A property of the
 *   pairing, so it is remembered and not asked again.
 * - `refused` and `pending` — about *this moment*, not about this link. A spent
 *   allowance, or a fetch that has not landed yet. **Not** remembered, so the
 *   next hover asks again — and a `pending` in particular is the one answer that
 *   is certainly about to change.
 * - a stream that ends with **no terminal frame at all** — a dropped connection
 *   on our side of the wire, since the route frames `pending` even for its own
 *   failures. Cached as nothing, which is the same trade the other three sources
 *   make: the alternative is a card that re-asks on every hover for the rest of
 *   a session that started badly.
 *
 * **Partial text is discarded when the stream does not finish**, so a reader
 * watching a summary arrive and then break off sees it vanish rather than stop
 * mid-sentence. That is deliberate and it is the lesser of two bad options: half
 * a summary left on the card would be indistinguishable from a summary that
 * chose to be short, and this is a section a reader is meant to be able to
 * trust. It is also rare in the direction that matters — the failure measured on
 * 2026-09-05 was an upstream 429 arriving as the *first* frame, with no text on
 * screen to lose.
 */
function loadSummary(slug: string, url: string): Promise<void> {
  const key = summaryKey(slug, url);
  if (summaryCache.has(key)) return Promise.resolve();
  const existing = summaryPending.get(key);
  if (existing) return existing;

  const run = (async () => {
    /* **No `deadline()` here**, and it is the one lookup in this file without
       one. The eight-second clock is right for a metadata lookup that either
       answers or does not; a model writing a paragraph legitimately takes
       longer, and `readEvents`' own stall clock is the better instrument
       anyway — it measures silence rather than duration, which is the thing
       that actually distinguishes a dead stream from a slow one. */
    try {
      const query = `?slug=${encodeURIComponent(slug)}&url=${encodeURIComponent(url)}`;
      const res = await apiFetch(`/api/link-summary${query}`);
      /**
       * **Checked before it is read as a stream**, and both halves matter.
       *
       * The route does its two throwing reads — the article and the profile —
       * *before* a header is written, so a 400, a 404 or a 500 arrives as an
       * ordinary JSON body. Fed to `readEvents` that produces no frames, no
       * error and no terminal event, which this function would then have cached
       * as "nothing here" for the session: a slug typo or a database blip
       * silencing every link in the article until a reload. Throwing instead
       * lands in the `catch`, which is the same trade the other sources make
       * and at least says so. GPT Sol, 2026-09-05.
       */
      if (!res.ok) throw new Error(`link summary: ${res.status}`);
      if (!res.headers.get("content-type")?.includes("text/event-stream")) {
        throw new Error("link summary: not a stream");
      }
      if (!res.body) throw new Error("no body");
      let text = "";
      let settled = false;
      for await (const event of readEvents(res.body, { stallMs: STREAM_STALL_MS })) {
        if (event.name === "delta") {
          const piece = (event.data as { text?: unknown }).text;
          if (typeof piece === "string" && piece !== "") {
            text += piece;
            summaryPartial.set(key, text);
            wakeSummaryWatchers();
          }
          continue;
        }
        if (event.name === "ready") {
          const whole = (event.data as { summary?: unknown }).summary;
          /* The server's own `summary` rather than the accumulated deltas —
             they are the same string on a healthy stream, and on an unhealthy
             one the terminal frame is the half that was checked. */
          if (typeof whole === "string" && whole.trim() !== "") {
            summaryCache.set(key, whole.trim());
            settled = true;
          }
          break;
        }
        if (event.name === "unavailable") {
          summaryCache.set(key, null);
          settled = true;
          break;
        }
        /* `refused` and `pending` leave the cache empty — see the header. */
        if (event.name === "refused" || event.name === "pending") {
          settled = true;
          break;
        }
      }
      /* No terminal frame: the route hit an error and framed nothing rather
         than manufacturing a fact about this link. Cached as nothing. */
      if (!settled) summaryCache.set(key, null);
    } catch {
      /* A transport failure, a stall, an offline moment. `apiFetch` has already
         put it in the console. */
      summaryCache.set(key, null);
    } finally {
      summaryPartial.delete(key);
      summaryPending.delete(key);
      wakeSummaryWatchers();
    }
  })();

  summaryPending.set(key, run);
  return run;
}

/* ------------------------------------------------------------- the hook --- */

/**
 * What we can find out about where this link goes, beyond what its href says.
 *
 * Answers **synchronously when it already knows** — a second hover of the same
 * link, or any link at all once the shelf has loaded — so the common case shows
 * no spinner and no flash. `loading` is true only while something is genuinely
 * outstanding.
 *
 * `sourceUrl` is where the article being read came from, so a link back to
 * *this* piece can say so rather than offering to open the page the reader is
 * already on. That case is not hypothetical: the one library match in this
 * corpus is the noema essay's link to itself.
 *
 * **The addresses, not the slugs**, and it is worth saying why since comparing
 * slugs is the obvious way. A slug comparison has to go through the shelf
 * index, which keeps the first of two entries that key the same — so if this
 * article were the second of a duplicated pair, its own link would come back as
 * somebody else's article and offer to open it. Comparing addresses asks the
 * question directly and needs no shelf at all. Raised by a GPT Sol review,
 * 2026-08-27; the slug half was tried first and turned out to be redundant as
 * well as weaker, since a match can only ever be found under the very key the
 * article was indexed by.
 */
export function useLinkFacts(
  link: LinkPreview | null,
  sourceUrl: string | null,
  slug: string | null,
): LinkFacts {
  const url = link?.kind === "external" ? link.url : null;
  const wiki = link?.kind === "external" ? link.wiki : null;
  // Primitives, not the object: `describeLink` rebuilds a fresh `LinkPreview`
  // on every `pointerover`, so an object in the dependency list would restart
  // the effect on every mouse move across the same link.
  const lang = wiki?.lang ?? null;
  const title = wiki?.title ?? null;

  /* **Derived during render, not held in state**, and that is the fix for a
     real bug rather than a preference.

     The first version kept the answer in `useState` and wrote it from the
     effect. But an effect runs *after* the render that scheduled it, so on the
     frame where the reader moved from link A to link B, the card rendered B's
     host over A's shelf match — a wrong title under a right address, for one
     frame, which is precisely the shape of mistake nobody reports because it
     looks like a rendering glitch.

     Reading the module caches here instead means the answer is computed from
     the same `url` the rest of the card is drawn from, so the two cannot
     disagree. The state below exists only to *re-render* when a cache fills;
     it carries nothing. */
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!url) return;
    let live = true;
    // `live` guards the re-render rather than the data: the caches are shared
    // and filling them is useful whoever asked, but a card that has gone should
    // not schedule work.
    const wake = () => {
      if (live) bump();
    };
    /* **And when somebody else replaces the shelf**, which since the card grew
       an Add button is something this very card can cause. A subscription
       rather than a second `loadShelf()`: the map is already in memory by
       then, so what is missing is only the render that reads it. */
    const unwatch = watchShelf(wake);
    void loadShelf().then(wake);
    if (lang && title) void loadWiki({ lang, title }).then(wake);
    /**
     * **And ask our own server what is on the other end**, unless somebody
     * better placed can already answer.
     *
     * Three refusals, and each of them is a request the card would have nothing
     * to do with:
     *
     * - **A Wikipedia link.** `link.wiki` is read off the href, so this is known
     *   synchronously, and Wikipedia's own summary API gives a real lead
     *   paragraph written by people. Fetching the article page as well would be
     *   a second request for a worse answer.
     * - **A page already on the shelf.** Its title, gist and length are ours
     *   already — the richest thing any source here produces, and free. Read
     *   from the module cache at effect time rather than from `library`, which
     *   is derived during render: on the very first hover of a session the
     *   shelf has not landed, so this misses and one spare request goes out.
     *   Accepted, because the other order — waiting for the shelf before asking
     *   — would put a network round trip in front of every preview for the sake
     *   of the one hover where it could have been skipped.
     * - **A link to the piece the reader is standing in.** The server refuses
     *   it too (`articleLinks` reports a self-link as pointing nowhere), so this
     *   is only about not making the request; the noema essay links to its own
     *   canonical address in its own prose.
     *
     * `slug` is the *permission* rather than part of the question — the route
     * uses it to prove this reader owns an article that really does point at
     * this URL. Without one there is nothing to ask with, so nothing is asked.
     */
    const shelved = shelf?.get(urlKey(url)) !== undefined;
    const ownLink = sourceUrl !== null && urlKey(sourceUrl) === urlKey(url);
    /**
     * **And then, if the destination could be read, what it has to do with this
     * piece.**
     *
     * *After* the page lookup and never beside it, because the summary is
     * written from the text that lookup stored: asking both at once would put a
     * paid call behind a race it usually loses, and the server would answer
     * `pending` to every one of them. So it is chained, and it is skipped
     * entirely unless the fetched section actually arrived — a destination
     * behind a bot challenge has nothing to summarise, and the whole point of a
     * cheap call is that it is not made for nothing.
     *
     * The same three refusals as the page lookup come for free, because they are
     * refusals to *ask the page*: a Wikipedia link, an article already on the
     * shelf, and a link to the piece the reader is standing in never reach here.
     * That is the right rule for the first and the third; for the second it is a
     * simplification worth naming — an article on your own shelf is exactly the
     * case where *how does it stand to this one* would be interesting, and it is
     * skipped for now because the summariser reads `link_previews.excerpt` and
     * that row is never fetched for a page we already hold. The repair is to
     * summarise from our own stored extraction instead, and it is a follow-up.
     */
    const alsoSummarise = () => {
      if (!live || !slug) return;
      /* **The shelf again, and read *now* rather than from the closure.** The
         `shelved` test below runs before `/api/library` has landed on the first
         hover of a session, and the comment beside it accepts one spare preview
         request for that. It must not also buy a summary: by the time the
         preview is back the shelf usually is too, and this is the paid call the
         next comment says is never made for a page we already hold. GPT Sol,
         2026-09-05. */
      if (shelf?.get(urlKey(url)) !== undefined) return;
      if (pageCache.get(url)) void loadSummary(slug, url).then(wake);
    };
    if (slug && !lang && !title && !shelved && !ownLink) {
      void loadPage(slug, url).then(() => {
        wake();
        alsoSummarise();
      });
    }
    /* **And when somebody else's stream is filling the same summary**, which is
       the ordinary case for a card torn down and re-hovered mid-answer: the
       tokens are accumulating at module level and what is missing is only the
       render that reads them. */
    const unwatchSummaries = watchSummaries(wake);
    return () => {
      live = false;
      unwatch();
      unwatchSummaries();
    };
  }, [url, lang, title, slug, sourceUrl]);

  if (!url) return NOTHING;
  const asked = lang && title ? wikiCacheKey({ lang, title }) : null;
  const said = slug === null ? null : summaryKey(slug, url);
  /* The finished answer if there is one, else whatever has arrived — and the
     order matters only in the moment between the last token and the terminal
     frame, where both are present and the finished one is the checked one. */
  const finished = said === null ? null : summaryCache.get(said) ?? null;
  const arriving = said === null ? null : summaryPartial.get(said) ?? null;
  const key = urlKey(url);
  const found = shelf?.get(key);
  const self = sourceUrl !== null && urlKey(sourceUrl) === key;
  return {
    /* A shelf read that failed stops the spinner exactly as an empty one used
       to — the reader is not left looking at `looking it up…` for ever — but it
       no longer claims the shelf is empty. See `shelfKnown`. */
    loading:
      (shelf === undefined && !shelfFailed) ||
      (asked !== null && !wikiCache.has(asked)) ||
      /* **The destination lookup counts as loading too**, and only while it is
         genuinely outstanding — `pagePending` empties when the answer lands,
         whatever the answer was. It is the slowest of the three by an order of
         magnitude (a real fetch of somebody else's server), so a spinner that
         did not cover it would be a card that says it has finished looking and
         then grows a section. */
      pagePending.has(url),
    library: found ? { entry: found, self } : null,
    wiki: (asked ? wikiCache.get(asked) : null) ?? null,
    shelfKnown: shelf !== undefined,
    page: pageCache.get(url) ?? null,
    /* **The summary does not count towards `loading` above**, deliberately. The
       spinner it would join says *we are still finding out where this goes*, and
       by the time this is outstanding that question has been answered and the
       card is drawn — so a spinner here would say the card was incomplete when
       it is merely growing. What the summary shows while it arrives is its own
       label and the words themselves, which is the point of streaming it. */
    summary: finished
      ? { text: finished, streaming: false }
      : arriving
        ? { text: arriving, streaming: true }
        : null,
  };
}
