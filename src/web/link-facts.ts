/**
 * The half of a link card that has to be **asked for** — a title, a first
 * paragraph, a length.
 *
 * link-preview.ts reads the href and is done in microseconds. This file is the
 * other kind: two lookups that can miss, can be slow, and can arrive after the
 * card is already on screen. Both were named and deferred by the survey on
 * 2026-08-27 (docs/research/260827a-link-previews.md); Greg asked for both the next day.
 *
 * ## The two sources, and why only these two
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
 * **And that is the whole list, because of CORS.** The obvious third idea —
 * fetch the destination from the reader's browser and run Readability on it —
 * cannot work for an ordinary host: a cross-origin `fetch` of
 * `philpapers.org/rec/BUTAAT` is rejected before the response is readable, and
 * a `no-cors` request hands back an opaque body with nothing in it. Verified in
 * a real browser rather than assumed; the numbers are in
 * docs/project/links.md § What a browser can and cannot reach. The general case
 * needs our own server, which is the one source still unbuilt.
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
import type { LibraryEntry } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
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
}

export interface LibraryMatch {
  entry: LibraryEntry;
  /** The link points at the article the reader is already reading. */
  self: boolean;
}

const NOTHING: LinkFacts = { loading: false, library: null, wiki: null, shelfKnown: false };

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
export function useLinkFacts(link: LinkPreview | null, sourceUrl: string | null): LinkFacts {
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
    return () => {
      live = false;
      unwatch();
    };
  }, [url, lang, title]);

  if (!url) return NOTHING;
  const asked = lang && title ? wikiCacheKey({ lang, title }) : null;
  const key = urlKey(url);
  const found = shelf?.get(key);
  const self = sourceUrl !== null && urlKey(sourceUrl) === key;
  return {
    /* A shelf read that failed stops the spinner exactly as an empty one used
       to — the reader is not left looking at `looking it up…` for ever — but it
       no longer claims the shelf is empty. See `shelfKnown`. */
    loading: (shelf === undefined && !shelfFailed) || (asked !== null && !wikiCache.has(asked)),
    library: found ? { entry: found, self } : null,
    wiki: (asked ? wikiCache.get(asked) : null) ?? null,
    shelfKnown: shelf !== undefined,
  };
}
