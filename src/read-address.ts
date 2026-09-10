/**
 * **What a `/read/…` address asks for, decided once for both sides.**
 *
 * Two things read these addresses now. `src/web/main.tsx` rewrites the legacy
 * spellings before React mounts, and the serverless function that composes a
 * shared article's `<head>` has to know what the client is about to do — because
 * whatever the two disagree about is a tab that changes in front of the reader,
 * a second after the page lands. docs/project/page-titles.md has the four ways
 * that had already happened.
 *
 * Imports the mode vocabulary and nothing else, so the public function's closed
 * import graph
 * (tests/public-imports.test.ts) and the client's allowlist
 * (tests/client-imports.test.ts) both accept it.
 */

import { DEFAULT_MODE, type Mode, modeFromParam } from "./modes.js";

/**
 * **Which middle-band mode a `/read/` address asked for**, or the default.
 *
 * The rewrite in vercel.json preserves the original query alongside the
 * `__spy_read` capture, so `?mode=glossary` survives to here — and it has to be
 * read, because the client puts the mode in the tab. Without this the server
 * served `Article · Spideryarn` and React replaced it with
 * `Article · Glossary · Spideryarn` a second later, which is the fault
 * src/title-text.ts exists to close. GPT Sol, 2026-08-30.
 *
 * **Unknown values land on the default rather than failing**, which is the rule
 * `modeParam` in src/web/params.ts already keeps: a link naming a mode this
 * version has not got degrades to the article. `modeFromParam` is the one place that
 * decides, so the two cannot answer differently.
 *
 * It is a safety net and no longer a promise about any particular old link — the
 * pre-2026-08-29 `?mode=toc` links rode on it until the default moved to `plain`
 * on 2026-08-31, deliberately. src/modes.ts § DEFAULT_MODE.
 *
 * **A retired mode lands on its successor** — `?mode=outline` is Structure since
 * 2026-09-10 — through `modeFromParam`, the same function `modeParam` calls.
 *
 * **`?text=0` moves Hierarchy to Structure here too** (to Outline from
 * 2026-09-05 until Outline became Structure's narrow face), and this
 * is the second thing in this file that exists only because the client is about
 * to do it. `liftStrandedText` in src/web/router.ts rewrites the address before
 * React mounts; without the same answer here the tab would read
 * `Article · Hierarchy · Spideryarn` and be replaced a second later by
 * `Article · Structure · Spideryarn` — the eleventh of exactly that fault, and the
 * one `tests/address-settling.test.ts` exists to make arithmetic rather than
 * vigilance. `hidesProse` below is the shared predicate, the way `isMetadataPair`
 * is for the other rewrite: one function decides, so the two cannot come apart.
 *
 * Deliberately tolerant of a malformed URL. This runs on a string a stranger
 * controls, and a throw here would be a 500 on an address that only wanted a
 * tab title.
 */
export function readMode(url: string): Mode {
  const query = url.indexOf("?");
  if (query === -1) return DEFAULT_MODE;
  let asked: string | null = null;
  try {
    asked = new URLSearchParams(url.slice(query + 1)).get("mode");
  } catch {
    return DEFAULT_MODE;
  }
  const mode = modeFromParam(asked) ?? DEFAULT_MODE;
  return mode === "hierarchy" && hidesProse(url) ? "structure" : mode;
}

/**
 * The three things a `/read/<slug>` address can be showing.
 *
 * Defined here rather than in src/web/router.ts, which owns the routes but
 * imports React's world. `router.ts` re-exports this name, so nothing that used
 * it knows it moved.
 */
export const ARTICLE_VIEWS = ["article", "metadata", "tweets"] as const;
export type ArticleView = (typeof ARTICLE_VIEWS)[number];

/**
 * **The pairs of a query, with only the first `?` treated as one.**
 *
 * `?add=https://x.test/a?about=1` carries one parameter whose *value* contains a
 * question mark. The old predicate matched on `(^|[?&])`, so it read that inner
 * `?` as a parameter boundary and sent the reader to the metadata page for an
 * article they were trying to add. GPT Sol found it, 2026-08-30 — the tenth of
 * these, and the first that **both sides got wrong in the same way**, which is
 * why the cross-product in tests/address-settling.test.ts could not see it:
 * equality between two halves says nothing when they agree on the wrong answer.
 *
 * Takes either a bare query or a whole URL, which is the contract the two
 * callers need — the client hands over `location.search`, the server the
 * restored URL. A string with no `?` at all is treated as the query itself, so
 * `about=1` works as well as `?about=1`.
 */
export function queryPairs(searchOrUrl: string): string[] {
  const at = searchOrUrl.indexOf("?");
  const query = at === -1 ? searchOrUrl : searchOrUrl.slice(at + 1);
  return query === "" ? [] : query.split("&");
}

/**
 * One half of a `key=value` pair, decoded, or the raw text if it will not
 * decode. A malformed escape is not a match for any plain name, and it must
 * never throw: this runs on a string a stranger controls.
 */
function part(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** A pair split into its decoded key and value. `k` with no `=` has no value. */
function keyValue(pair: string): { key: string; value: string | null } {
  const eq = pair.indexOf("=");
  if (eq === -1) return { key: part(pair), value: null };
  return { key: part(pair.slice(0, eq)), value: part(pair.slice(eq + 1)) };
}

/**
 * **Does this pair ask for the metadata page?**
 *
 * Decoded on both halves, so `%61bout=1`, `about=%31` and `panel=%61bout` are
 * the same request as their literal spellings. That is GPT Sol's rule, and the
 * reason for it is that a decoding *decision* with a literal *removal* is how
 * the ninth bug worked: the client stripped one spelling, kept the other, and
 * acted on a parameter the server had never seen. Here one function answers for
 * both, so they cannot come apart — `liftLegacyAbout` in src/web/router.ts
 * calls this to decide **and** to remove.
 *
 * **`about=1` and `panel=about` only, never `about=0`.** A shut panel is not a
 * reason to send anybody to a different page.
 */
export function isMetadataPair(pair: string): boolean {
  const { key, value } = keyValue(pair);
  return (key === "about" && value === "1") || (key === "panel" && value === "about");
}

/**
 * **Which pairs the metadata rewrite consumes**, which is a wider set than the
 * ones that redirect: `about=0` is stripped from the URL and stays on the
 * article. `panel` is only consumed when it says `about`; any other panel is
 * somebody else's parameter.
 */
export function isLegacyAboutPair(pair: string): boolean {
  const { key } = keyValue(pair);
  return key === "about" || isMetadataPair(pair);
}

/**
 * **Will the client turn this address into the metadata page before it draws
 * anything?**
 *
 * The article's details have been in three places: `?about=1` in the masthead,
 * then `?panel=about` as a drawer, and now `/read/<slug>/metadata`. `main.tsx`
 * rewrites either old spelling on the way in, with `history.replaceState`, so
 * the reader never sees them.
 *
 * The server has to ask the same question, and the reason is exact. `/read/x`
 * with a query is **one path segment**, so it matches vercel.json's
 * `/read/:slug` rewrite and reaches the head composer — while `/read/x/metadata`
 * is two segments and falls to the SPA catch-all, never composed. So
 * `/read/x?about=1` was served with the *article's* title and then rewritten by
 * React to `Article · Metadata · Spideryarn`. With `?mode=glossary` on it as
 * well, the tab went from `Article · Glossary · Spideryarn` to
 * `Article · Metadata · Spideryarn`. GPT Sol found it, 2026-08-30, after I had
 * checked `/read/x/metadata` and concluded the view axis was safe: the direct
 * route is safe and this legacy route into the same view is not.
 *
 * @param search the query with or without its `?`, or a whole URL containing one.
 */
export function redirectsToMetadata(search: string): boolean {
  return queryPairs(search).some(isMetadataPair);
}

export function viewFor(search: string): ArticleView {
  return redirectsToMetadata(search) ? "metadata" : "article";
}

/**
 * **Does this address ask for the article's prose to be hidden?**
 *
 * `?text=0`, and nothing else — `text=1` is the default and `parseAsBit` reads
 * any other value as absent (src/web/params.ts). Decoded on both halves for the
 * reason `isMetadataPair` is: a decoding decision paired with a literal removal
 * is how the ninth address bug worked, and this predicate is used both to
 * *decide* here and to *remove* in src/web/router.ts.
 *
 * **It only ever mattered in Hierarchy.** `inMode` is `mode !== "hierarchy"` and
 * `proseVisible` is `modeBand || showText`, so a mode band shows the article
 * whatever this says; a bare `?text=0` has always landed harmlessly in Plain.
 * That is why `readMode` above asks it only about `hierarchy`, and why the
 * client still drops the pair everywhere — an inert parameter that arms itself
 * the moment the reader presses Hierarchy on the Dock is not tidy, it is a
 * landmine with a delay on it.
 *
 * @param search the query with or without its `?`, or a whole URL containing one.
 */
export function hidesProse(search: string): boolean {
  /* **The FIRST `text` pair decides, and a later one gets no vote.** `nuqs` and
     `URLSearchParams.get` both hand back the first match, so `?text=1&text=0`
     is a reader with the prose on screen — and `.some()` here called them
     stranded and moved them out of Hierarchy on the strength of a pair nothing
     else in the app will ever read. The identical rule is already written out
     for `mode` in `liftStrandedText`; this is the parameter that had not been
     given it. GPT Sol, reviewing stage 3, 2026-09-05.

     The later pair is still *removed* — see that function — because "no
     `text=0` survives boot" is the rule, and an inert one left in the query is
     the landmine this whole rewrite exists to defuse. Deciding and removing are
     two questions, and only the first one is about which pair wins. */
  const first = queryPairs(search).find((pair) => keyValue(pair).key === "text");
  return first !== undefined && isTextOffPair(first);
}

/** The pair `hidesProse` is looking for, exported so the removal decodes too. */
export function isTextOffPair(pair: string): boolean {
  const { key, value } = keyValue(pair);
  return key === "text" && value === "0";
}
