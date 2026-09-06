/**
 * **Which stored object an asset URL names**, and how that URL is spelled.
 *
 * The pure half of *delivery* — stage C of
 * docs/plans/260829b-hosting-the-articles-images.md and stage D of
 * docs/plans/260906a-figures-from-a-pdf-are-placeholders-with-no-image.md. No
 * store, no HTTP, no DOM, so both routes, the public reader and the browser can
 * share it rather than spelling the same URL four times.
 *
 * ## It is about *an article's images*, not about PDF figures
 *
 * PDF figures are simply the first kind to flow through it. GPT Sol, I-1:
 *
 * > Build a generic article-asset route and `rehostImages`; do not create a
 * > PDF-only parallel delivery mechanism.
 *
 * So `storedAssetFor` searches **both** collections in the manifest —
 * `Assets.entries`, which is the article's own `<img src>`s, and
 * `Assets.pdfFigures`, which is what a PDF came with. Only the second has
 * anything in it today; stage E of the figures plan turns the first on, and
 * when it does, this file needs no edit at all.
 *
 * ## The rule this file exists to make unavoidable
 *
 * > **The storage key is rebuilt from the manifest entry, never from the
 * > caller's string.**
 *
 * Assets live in a content-addressed bucket shared by every article and every
 * reader (`canonicalKey`, src/source.ts), so a route that concatenated a
 * caller's hash into a key would be an arbitrary-object read: name any hash you
 * can guess or have seen and get the object, whoever owns the article it
 * belongs to. `sendPlate` in src/routes.ts states the same rule for Illustrated
 * plates and was the model for it. GPT Sol, I-5.
 *
 * That is why this function returns the **entry** rather than a boolean or a
 * key: the caller has to hold the stored record in its hand to build anything,
 * and the hash it was given is never used again after the lookup.
 */

import type { AssetEntry, AssetExt, Assets, PdfFigureEntry } from "./assets.js";

/**
 * One asset this article really holds, whichever collection it came out of.
 *
 * A narrow structural type rather than `AssetEntry | PdfFigureEntry`, because
 * the four fields below are the whole of what serving the bytes needs — and
 * because the two unions carry things delivery must not accidentally start
 * depending on (a publisher's URL on one, a page number on the other).
 */
export interface StoredArticleAsset {
  sha256: string;
  ext: AssetExt;
  contentType: string;
  bytes: number;
}

/** Is this entry one that actually has bytes behind it? */
function stored(entry: AssetEntry | PdfFigureEntry): StoredArticleAsset | null {
  if (entry.status !== "stored") return null;
  return {
    sha256: entry.sha256,
    ext: entry.ext,
    contentType: entry.contentType,
    bytes: entry.bytes,
  };
}

/**
 * The stored entry this `(sha256, ext)` names in **this article's own current
 * manifest**, or `null`.
 *
 * `null` covers four different situations and they are deliberately one answer
 * to the caller: the article has no manifest, the hash is not in it, the hash
 * is in it as a *failure*, or the hash is there under a different extension.
 * Every one of them means *this article does not hold that object* and every
 * one of them must be a 404 — **including for the article's owner**, which is
 * the case worth stating because it is the one that feels wrong and is the
 * point: owning an article entitles you to the objects in its manifest, not to
 * the shared bucket.
 *
 * **The extension has to match rather than be ignored**, for `sendPlate`'s
 * reason: the URL is a promise about the bytes exactly as the storage key is,
 * so serving a `.jpeg` URL from a PNG record would be the route telling a cache
 * one thing and the `Content-Type` header another.
 *
 * `ext` is a plain `string` on purpose. It arrives off a URL, so it is the
 * caller's text until this comparison; typing the parameter as `AssetExt` would
 * push a cast up to the route, which is exactly where a cast should not be.
 */
export function storedAssetFor(
  assets: Assets | undefined,
  sha256: string,
  ext: string,
): StoredArticleAsset | null {
  if (!assets) return null;
  for (const entry of [...(assets.entries ?? []), ...(assets.pdfFigures ?? [])]) {
    if (entry.status !== "stored" || entry.sha256 !== sha256 || entry.ext !== ext) continue;
    return stored(entry);
  }
  return null;
}

/**
 * The path an owner's browser fetches one asset from.
 *
 * **Spelled here rather than in the route and again in the client**, because
 * the two have to agree and a URL built twice is built differently once. The
 * route's pattern in src/routes.ts is the regex form of this line.
 *
 * The `<hash>.<ext>` tail rather than a query parameter so that the URL reads as
 * a file and a cache keys on it whole — the shape
 * `/api/illustrated/:slug/:hash.:ext` already uses.
 */
export function assetPath(slug: string, sha256: string, ext: AssetExt): string {
  return `/api/asset/${encodeURIComponent(slug)}/${sha256}.${ext}`;
}

/**
 * The same asset, for somebody who is not signed in.
 *
 * **A second path rather than a flag on the first**, and that is the closed
 * room's own rule rather than a preference: everything a stranger can reach
 * lives under `/api/public/` and is dispatched before the auth gate
 * (src/public/routes.ts). The two routes also answer different questions — one
 * asks *is this yours*, the other asks *is this shared right now* — and a
 * single route taking both answers is the fallthrough that namespace exists to
 * prevent.
 *
 * **This is a second spelling of a URL `src/public/route-names.ts` also
 * spells**, which that file's header is right to warn about — and it is written
 * out here anyway, for a reason worth stating rather than apologising for.
 * This module has to stay a leaf: `tests/client-imports.test.ts` allows a
 * browser-side shared module to import other *flat* shared modules and nothing
 * else, so `./public/route-names.js` is refused by construction. Importing it
 * was tried on 2026-09-06 and the guard said no.
 *
 * So the two are tied by a **test** instead of by an import, which is the
 * stronger of the two: `tests/rehost.test.ts` § the public path asserts that
 * what this builds is matched by the inventory's own pattern — which delegation
 * would not have checked, since a builder and a regex can disagree while both
 * come from one file.
 */
export function publicAssetPath(slug: string, sha256: string, ext: AssetExt): string {
  return `/api/public/asset/${encodeURIComponent(slug)}/${sha256}.${ext}`;
}
