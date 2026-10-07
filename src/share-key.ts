/**
 * **What a private link's key looks like, and the one name it travels under.**
 *
 * A private link is `/read/<slug>?key=<key>`
 * (docs/plans/261005e-share-an-article-with-some-people-a-private-link-first.md).
 * The key is 128 random bits written as base64url, which is always 22
 * characters. This file says that once, for the three places that have to
 * agree: the public routes, which bound a caller's `?key=` before it reaches a
 * query; the owner's store, which mints one; and feedback, which removes one
 * from a report's address.
 *
 * ## It imports nothing
 *
 * It is in the public import graph (tests/public-imports.test.ts) and the
 * browser will want the parameter's name, so it stays a leaf: no `node:crypto`,
 * no schema, no store. Minting is in src/store/pg-share-link.ts, which is the
 * only place that may make one.
 *
 * ## A key is a secret
 *
 * Nothing here logs one or puts one in an error message, and nothing that
 * calls this may either. docs/project/logging.md.
 */

/** The query parameter a private link carries its key in. */
export const SHARE_KEY_PARAM = "key";

/** 16 bytes as base64url, unpadded: 22 characters of `A-Z a-z 0-9 - _`. */
export const SHARE_KEY_CHARS = 22;

const SHARE_KEY = /^[A-Za-z0-9_-]{22}$/;

/**
 * **A string that has the shape of a key.** Branded, so the predicate that
 * compares one with `articles.share_token` cannot be handed a raw query value:
 * `parseShareKey` is the only way to make one from a request, and it refuses
 * the empty string along with everything else that is not 22 characters.
 *
 * It says nothing about whether the key opens anything. Only the database
 * knows that, and it is asked in the `where`.
 */
export type ShareKey = string & { readonly __shareKey: unique symbol };

/**
 * The caller's `?key=`, or `null` when there is none worth asking about.
 *
 * `null` for an absent key, an empty one, one of the wrong length and one with
 * a character base64url does not have. All four then read exactly as a request
 * with no key does, which is the point: a malformed key gets no answer of its
 * own for anybody to tell apart from a wrong one.
 */
export function parseShareKey(raw: unknown): ShareKey | null {
  if (typeof raw !== "string") return null;
  return SHARE_KEY.test(raw) ? (raw as ShareKey) : null;
}

/**
 * **The key in a query string, for the browser**: `location.search` in, a
 * parsed key or `null` out.
 *
 * The first `key` only, as the server reads it. Anything that is not a key is
 * `null`, so the page asks exactly what a page with no key asks and a
 * malformed value is never sent anywhere.
 */
export function shareKeyIn(search: string): ShareKey | null {
  return parseShareKey(new URLSearchParams(search).get(SHARE_KEY_PARAM));
}

/**
 * **A path of ours with the key on it**, or the same path when there is none.
 *
 * Takes a `ShareKey`, so only a value `parseShareKey` passed can be forwarded.
 * For the two public requests a visitor's page makes for one article: its
 * payload and its pictures (src/web/public-api.ts, src/web/rehost.ts); and for
 * the whole private link a gift voucher's email carries, built on `articleUrl`
 * (src/store/voucher-starter.ts, plan 261007j). The path must have no query
 * string of its own; none of those does.
 */
export function withShareKey(path: string, key: ShareKey | null): string {
  return key === null ? path : `${path}?${SHARE_KEY_PARAM}=${encodeURIComponent(key)}`;
}

/**
 * **An address with its `key` parameter removed**, for anything that stores or
 * forwards where a reader was. Every other part of it is kept.
 *
 * The Feedback button records the page's whole address, and on a private link
 * that address is the credential. Sol's F1 on the plan: the report's URL goes
 * into our table, a Sentry tag and the admin email, none of which the reader's
 * friend agreed to hand a key to.
 *
 * **By name, whatever the value looks like.** A key that has been cut short or
 * mistyped is still most of a key, so this does not ask `parseShareKey` first.
 *
 * Returned unchanged when there is no such parameter, so an ordinary address
 * is stored byte for byte as it was sent. An address `URL` cannot parse is
 * returned unchanged too: the caller has its own check for that.
 */
export function withoutShareKey(address: string): string {
  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    return address;
  }
  if (!parsed.searchParams.has(SHARE_KEY_PARAM)) return address;
  parsed.searchParams.delete(SHARE_KEY_PARAM);
  return parsed.href;
}
