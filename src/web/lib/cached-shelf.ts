/**
 * The shelf we already had, painted while the live one is fetched.
 *
 * `apiFetch` has been saving every `GET /api/library` body to IndexedDB since
 * 2026-08-27 ([offline-store.ts](./offline-store.ts)), and until now it read
 * one back **only when the transport failed**. So a reader on a perfectly good
 * connection, opening the homepage for the tenth time, still watched a blank
 * page for as long as the serverless cold start took — and then got
 * *"Reading the shelf…"*, which is the thing Greg actually noticed:
 *
 * > it was the delay "Reading the shelf" for a logged-in user with fewer than a
 * > dozen articles that I noticed most.
 * >
 * > — Greg, 2026-09-03
 *
 * This module is the read half of stale-while-revalidate: hand `useShelf` the
 * saved copy so it has something to draw, and let the live answer replace it.
 * See docs/plans/260903g-faster-shelf-load-and-tidier-homepage-controls.md
 * § Stage 5 for the contract this is half of; the other half — which of the two
 * answers wins — is the `issued`/`settled` pair in [useShelf.ts](../useShelf.ts)
 * and cannot live here.
 *
 * ## Deliberately not `onlyWhatWeHave`
 *
 * The offline path filters the saved shelf down to the articles whose prose is
 * still held locally, because offline every card is a promise and one that opens
 * to an error is a promise broken. **That is exactly wrong here.** We are online
 * — the live answer is in flight as this is read — so an article whose blocks
 * happened to be evicted is still perfectly openable, and filtering it out would
 * make cards vanish and then reappear a moment later. Online, the cache is a
 * *head start*; offline it is *everything we have*, and the two want different
 * answers. GPT Sol agreed when the plan was reviewed.
 *
 * ## And it is stale, which is the price
 *
 * A rename or an archive patches the React list, not the saved body — so the
 * first paint after either can show the old title, or a card the reader deleted,
 * for as long as the live answer takes. Counts and order can jump for the same
 * reason. That is accepted rather than overlooked: renames are cosmetic. Said
 * out loud in the plan too, because "it flickered an old title at me" should be
 * a known price and not a bug report.
 *
 * ## "Delete is archive, so nothing here can lose anything" — no longer true
 *
 * That sentence stood here until 2026-09-07 and was the whole reason staleness
 * was cheap: every card named something that still existed, so the worst a
 * stale one could do was be out of date about it. `DELETE /api/library/:slug`
 * ends that (docs/plans/260906h-delete-an-article-permanently.md). A card
 * painted from a body saved before a delete names an article that is **gone**,
 * and it opens a 404 — which, per `offline-store.ts` § `invalidate`, looks
 * exactly like a delete that failed.
 *
 * `forgetCachedReader` below is the answer, and it is deliberately blunt: the
 * one control that destroys an article calls it on a confirmed deletion and
 * retires this reader's whole cached set, rather than trying to name the seven
 * or eight prefixes an article's data is spread across. Per-article
 * invalidation can replace it later; nothing here may go on promising an
 * article that has been destroyed.
 */
import type { LibraryEntry } from "../../types.js";
import { forgetUser, lastKnownUser, readCached } from "./offline-store.js";

/**
 * Throw away **everything** this device has cached for the signed-in reader.
 *
 * For the one caller that has destroyed something for good — `DeletePermanently`
 * in [Metadata.tsx](../Metadata.tsx). Invalidating `/api/library` and
 * `/api/article/<slug>` is not enough: metadata, comments, chat, search,
 * glossary and illustrated are all cacheable too (`api.ts` § `cacheable`), and
 * any one of them left behind is this app telling a reader that an article they
 * destroyed is still here.
 *
 * **Never throws.** `forgetUser` already gives up quietly where IndexedDB is
 * missing or refuses (a private window, Node), and a cache we could not clear
 * must not stop the reader being taken to their library — the delete has
 * happened either way, and the live answer is one request behind.
 *
 * Signed out, there is no drawer to empty and this does nothing. `lastKnownUser`
 * is an id and authorises nothing; it selects which drawer, exactly as it does
 * for every read and write in `api.ts`.
 */
export async function forgetCachedReader(): Promise<void> {
  const reader = lastKnownUser();
  if (!reader) return;
  try {
    await forgetUser(reader);
  } catch {
    /* Deliberately swallowed — see above. */
  }
}

/** The one URL this module is about. Kept in step with `useShelf`'s own fetch. */
const SHELF_URL = "/api/library";

/**
 * The saved shelf for this reader, or `null` if there isn't a usable one.
 *
 * Never throws and never rejects: this is an optimisation, and an optimisation
 * that can break the homepage is not one. `readCached` already swallows
 * everything IndexedDB can do (missing in Node, throwing in a Safari private
 * window), and the validation below turns anything surprising into `null`.
 */
export async function readCachedShelf(readerId: string | null): Promise<LibraryEntry[] | null> {
  if (!readerId) return null;
  try {
    const saved = await readCached(SHELF_URL, readerId);
    if (!saved) return null;
    return shelfFromCachedBody(saved.body);
  } catch {
    return null;
  }
}

/**
 * The entries inside a saved body, or `null` if it is not a shape we can draw.
 *
 * **This is the check that stops an old deployment crashing today's homepage.**
 * The body comes back off IndexedDB as `unknown` and it was written by whatever
 * version of the app was deployed on the day it was saved — a month ago, or
 * before a field existed. Until now that risk lived only on the offline path,
 * where a reader with no network was already having a bad time; this stage runs
 * the same body through the same components on **every repeat visit**, so an
 * entry missing `words` would take the whole shelf down with
 * `entry.words.toLocaleString is not a function` (ShelfEntry.tsx).
 *
 * So: every field the card and the table actually read is checked, and one bad
 * entry discards the whole body rather than being dropped on its own. A shelf
 * silently missing an article is the failure mode this app writes postmortems
 * about; a shelf that simply loads a beat later is not a failure at all.
 * `null` means *paint nothing yet*, which is precisely where we were before.
 */
export function shelfFromCachedBody(body: unknown): LibraryEntry[] | null {
  if (!isRecord(body)) return null;
  const { articles } = body;
  if (!Array.isArray(articles)) return null;
  if (!articles.every(isDrawableEntry)) return null;
  return articles as LibraryEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Present and a string. */
const str = (v: unknown): boolean => typeof v === "string";
/** A real number — `NaN` and `Infinity` both print as themselves on a card. */
const num = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);
/** Absent, or the right type. Optional fields are still fields somebody renders. */
const maybe = (v: unknown, is: (x: unknown) => boolean): boolean => v === undefined || is(v);

/**
 * Everything `ShelfEntry.tsx` and `library-columns.tsx` read off one entry.
 *
 * Derived by reading both files rather than by copying `LibraryEntry`, because
 * the compiler cannot help at this seam and the question is not "is this the
 * current type" but "will drawing this throw". A field the type has gained
 * since the body was saved matters only if something renders it.
 */
function isDrawableEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const e = value;
  const has = e.has;
  return (
    str(e.slug) &&
    str(e.title) &&
    str(e.addedAt) &&
    num(e.words) &&
    num(e.minutes) &&
    num(e.blocks) &&
    num(e.parts) &&
    num(e.sections) &&
    num(e.comments) &&
    num(e.opens) &&
    isRecord(has) &&
    typeof has.arc === "boolean" &&
    typeof has.tweets === "boolean" &&
    typeof has.glossary === "boolean" &&
    maybe(e.byline, str) &&
    maybe(e.siteName, str) &&
    maybe(e.url, str) &&
    maybe(e.gist, str) &&
    maybe(e.lastOpenedAt, str) &&
    maybe(e.archivedAt, str) &&
    maybe(e.fixture, (v) => typeof v === "boolean") &&
    maybe(e.titleOverridden, (v) => typeof v === "boolean") &&
    maybe(e.visibility, (v) => v === "public")
  );
}
