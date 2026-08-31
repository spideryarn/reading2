/**
 * The copies we keep, so a reader who loses their connection keeps their article.
 *
 * One IndexedDB store of JSON bodies we have already been given, written on the
 * way past in [api.ts](./api.ts) and read back only when the network fails at
 * the transport layer. See
 * docs/plans/260827r-offline-reading.md for the whole
 * design and for what is deliberately not here — no write queue, no sync
 * engine, no service worker.
 *
 * ## Why `idb` rather than the smaller one
 *
 * We need exactly one query beyond get and put: **the least recently opened
 * record**, so the cache can be capped. That needs a real index, which
 * `idb-keyval` does not have — evicting there would mean loading every stored
 * article body into memory to sort them, which is the opposite of a size cap.
 * `idb` is 1.4KB and promisifies IndexedDB without hiding it. Dexie would do
 * this and much more, and the much more is 31KB we would not use. See
 * docs/plans/260827r-offline-reading.md § Libraries.
 *
 * ## The key is the user and the URL, in that order
 *
 * IndexedDB is per-origin, not per-account, and a shared iPad is a real thing.
 * Every record carries the id of the reader it was fetched for, and a read for
 * one account cannot see another's rows. Signing out drops that account's rows
 * rather than the database, because the other account's copies are not ours to
 * throw away.
 *
 * **Nothing here holds a token.** The stored user id is an identifier for
 * partitioning a cache, and it grants nothing: every request still has to be
 * authorised by the server. "This device was signed in as somebody" is not
 * "this request is allowed", and the two must never be confused.
 */
import { type DBSchema, type IDBPDatabase, openDB } from "idb";

/** One saved response. `body` is the parsed JSON, not the text. */
export interface Cached {
  /** `${userId}\n${url}` — see the module docstring. */
  key: string;
  userId: string;
  url: string;
  /**
   * The article this belongs to, or `""` for the shelf and the profile.
   *
   * **Eviction is by article, not by URL**, and this field is why. An article
   * is not one response: it is the prose, and then the glossary, the summaries,
   * the ideas and the tweets that were computed from it. Dropping the
   * least-recently-used *record* would happily evict the prose of one article
   * while keeping its glossary — leaving an entry that says it is available
   * offline and opens to nothing. GPT Sol, 2026-08-27.
   */
  slug: string;
  body: unknown;
  /** When we were given this, which is what the reader is told. */
  savedAt: number;
  /** When it was last handed to anybody, which is what eviction sorts on. */
  lastOpened: number;
  /** Roughly, for the cap. The serialised length, not the stored size. */
  bytes: number;
}

interface Schema extends DBSchema {
  responses: {
    key: string;
    value: Cached;
    indexes: { lastOpened: number; slug: string };
  };
}

const DB_NAME = "spideryarn-offline";
const DB_VERSION = 1;
const STORE = "responses";

/**
 * How much we keep: **one rule, counted in articles.**
 *
 * There were two caps here — a record count and a byte total — and Sol's review
 * was right that two rules is one more than this needs. A reader thinks in
 * articles, eviction happens in articles, and so the cap is articles. At around
 * 150KB of prose plus its artefacts, a hundred of them is comfortably inside
 * any modern quota; the seven-day wipe on an iPad will take them long before
 * the disk does.
 */
const MAX_ARTICLES = 100;

/** The user id we last saw sign in, for partitioning the cache. */
const USER_KEY = "spideryarn.lastUser";

let db: Promise<IDBPDatabase<Schema>> | null = null;

/**
 * The database, opened once, or `null` where there isn't one.
 *
 * **Every caller has to cope with `null`.** IndexedDB is missing in Node (the
 * tests), and it *throws on access* in a Safari private window rather than
 * being absent — so this is a `try` around a feature check rather than a
 * feature check. A reader with no storage should get an app that works and no
 * saved copies, never an error.
 */
function open(): Promise<IDBPDatabase<Schema>> | null {
  if (db) return db;
  try {
    if (typeof indexedDB === "undefined") return null;
    db = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(instance) {
        const store = instance.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("lastOpened", "lastOpened");
        store.createIndex("slug", "slug");
      },
    });
    return db;
  } catch {
    return null;
  }
}

const keyFor = (userId: string, url: string) => `${userId}\n${url}`;

/**
 * The saved copy of `url` for this reader, or `undefined`.
 *
 * Touches `lastOpened` on the way out, which is what makes eviction
 * least-recently-*used* rather than least-recently-written. That write is
 * deliberately not awaited by the caller's critical path — a reader waiting on
 * their article should not also wait on our bookkeeping.
 */
export async function readCached(
  url: string,
  userId: string | null,
): Promise<{ body: unknown; savedAt: number } | undefined> {
  if (!userId) return undefined;
  const handle = open();
  if (!handle) return undefined;
  try {
    const instance = await handle;
    const row = await instance.get(STORE, keyFor(userId, url));
    if (!row) return undefined;
    void instance
      .put(STORE, { ...row, lastOpened: Date.now() })
      .catch(() => {});
    return { body: row.body, savedAt: row.savedAt };
  } catch {
    return undefined;
  }
}

/**
 * Keep `body` as this reader's copy of `url`.
 *
 * Never throws. A cache that cannot be written is a feature that quietly does
 * not happen; a cache that throws is a reader who cannot read. The one thing
 * this must not do is report a success it did not have, so callers get `false`
 * and can decline to claim the article is saved.
 */
export async function writeCached(
  url: string,
  body: unknown,
  userId: string | null,
  slug = "",
): Promise<boolean> {
  if (!userId) return false;
  const handle = open();
  if (!handle) return false;
  try {
    const instance = await handle;
    const now = Date.now();
    const key = keyFor(userId, url);

    /* **A slow reply must not overwrite a fast one.** Two GETs for the same URL
       can be in flight at once — a panel remounting while the first is still
       going — and the loser landing last would put older data on top of newer.
       The existing row's `savedAt` is the guard, read and written inside one
       transaction so nothing can slip between the check and the put. */
    const tx = instance.transaction(STORE, "readwrite");
    const existing = await tx.store.get(key);
    if (existing && existing.savedAt > now) {
      await tx.done;
      return false;
    }
    /* Measured from the serialised form because that is the number we can get
       cheaply. It is not the bytes IndexedDB spends, and nothing here pretends
       otherwise — it is kept for diagnosis, not for the cap. */
    const bytes = JSON.stringify(body)?.length ?? 0;
    await tx.store.put({ key, userId, url, slug, body, savedAt: now, lastOpened: now, bytes });
    await tx.done;

    await evict(instance);
    return true;
  } catch {
    /* Includes `QuotaExceededError`. Any previous copy is untouched — a `put`
       that throws replaces nothing — and `false` tells the caller not to claim
       this one was kept. */
    return false;
  }
}

/**
 * Drop whole articles, least recently used first, until we are under the cap.
 *
 * **The unit is the article, not the response**, which is the correction that
 * matters here. An article is its prose plus everything computed from it, and
 * evicting by individual record would cheerfully drop the prose while keeping
 * the glossary — leaving a shelf entry that says "available offline" and opens
 * to nothing. Half an article is worse than none. GPT Sol, 2026-08-27.
 *
 * Walks every account's rows, not just the current reader's: the cap is on this
 * device's storage, and partitioning reads by user does not entitle one account
 * to fill the disk.
 */
async function evict(instance: IDBPDatabase<Schema>): Promise<void> {
  try {
    const all = await instance.getAllFromIndex(STORE, "lastOpened");

    /* Rank articles by the most recent touch of *any* of their parts — reading
       the prose should keep its glossary alive. */
    const freshest = new Map<string, number>();
    for (const row of all) {
      if (!row.slug) continue; // the shelf and the profile belong to no article
      freshest.set(row.slug, Math.max(freshest.get(row.slug) ?? 0, row.lastOpened));
    }
    if (freshest.size <= MAX_ARTICLES) return;

    const doomed = new Set(
      [...freshest.entries()]
        .sort((a, b) => a[1] - b[1])
        .slice(0, freshest.size - MAX_ARTICLES)
        .map(([slug]) => slug),
    );
    for (const row of all) {
      if (doomed.has(row.slug)) await instance.delete(STORE, row.key);
    }
  } catch {
    /* An eviction that fails leaves a cache that is too big, which is a great
       deal better than a write that fails because eviction did. */
  }
}

/**
 * Throw away everything cached under one URL prefix, for this reader.
 *
 * **Called after a successful write, and this is the whole of how mutable
 * things stay honest.** Chat threads, comments and saved searches are lists the
 * reader edits. A cached copy of such a list, kept past a delete, would show
 * them a thread they had just removed — which looks exactly like the delete
 * having failed. Rather than build an invalidation graph, any successful
 * non-GET drops the cached reads under the same prefix and the next online GET
 * fills them back in.
 *
 * The cost is real and is stated in the plan: delete a comment and then lose
 * your connection, and you have no cached comments for that article until you
 * are back online. A worse offline experience, and a correct one.
 */
export async function invalidate(prefix: string, userId: string | null): Promise<void> {
  if (!userId) return;
  const handle = open();
  if (!handle) return;
  try {
    const instance = await handle;
    for (const row of await instance.getAll(STORE)) {
      if (row.userId === userId && row.url.startsWith(prefix)) {
        await instance.delete(STORE, row.key);
      }
    }
  } catch {
    /* The write succeeded. A cache we failed to clear is not worth failing it. */
  }
}

/**
 * Every article this reader has the *prose* of.
 *
 * For the shelf, which must not offer an article that cannot be opened. The
 * prose specifically: an article whose glossary survived but whose blocks were
 * evicted is not something anybody can read. See `offlineLibrary` in
 * [api.ts](./api.ts).
 */
export async function cachedSlugs(userId: string | null): Promise<Set<string>> {
  const found = new Set<string>();
  if (!userId) return found;
  const handle = open();
  if (!handle) return found;
  try {
    const instance = await handle;
    for (const row of await instance.getAll(STORE)) {
      if (row.userId === userId && row.url.startsWith("/api/article/")) found.add(row.slug);
    }
  } catch {
    /* An empty set offers nothing, which is the safe direction to fail in. */
  }
  return found;
}

/** Forget every copy saved for one reader. For sign-out and account switches. */
export async function forgetUser(userId: string): Promise<void> {
  const handle = open();
  if (!handle) return;
  try {
    const instance = await handle;
    for (const row of await instance.getAll(STORE)) {
      if (row.userId === userId) await instance.delete(STORE, row.key);
    }
  } catch {
    /* Nothing to tell anybody. Sign-out has already happened. */
  }
}

/**
 * Remember who is signed in, so a cache read has a partition to look in.
 *
 * **Two places, and the memory is the one that matters.** `localStorage` is
 * written so the partition survives a reload, but the module-level variable is
 * what is actually read first — because `localStorage` is not always there. It
 * is absent under Node (which now shadows jsdom's own and refuses to enable it
 * without `--localstorage-file`), and in a Safari private window it exists and
 * *throws on write*.
 *
 * Without the in-memory copy, either of those turns the whole cache off in
 * total silence: nothing would be saved, nothing would be read back, no error
 * would be raised, and the feature would simply not exist while looking exactly
 * like a feature that did. Found by a test that polled for the write instead of
 * sleeping past it. See docs/reusable/silent-success.md.
 *
 * The trade is explicit: where `localStorage` is unavailable the partition
 * lasts as long as the page does, which covers the case this whole feature is
 * for — a tab that stays open while the connection goes — and loses the one
 * that needs a service worker anyway.
 */
let remembered: string | null = null;

export function rememberUser(userId: string | null): void {
  remembered = userId;
  try {
    if (typeof localStorage === "undefined") return;
    if (userId) localStorage.setItem(USER_KEY, userId);
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* A private window throws on write. The in-memory copy above still stands,
       so the cache works for this page rather than not at all. */
  }
}

/**
 * The last reader we saw signed in on this device, or `null`.
 *
 * This is **not** an authorisation. It says which drawer to look in, and every
 * request it accompanies is still checked by the server. See the module
 * docstring, and `docs/plans/260827r-offline-reading.md` on why an offline-known-user
 * *gate* is deliberately not built here.
 */
export function lastKnownUser(): string | null {
  if (remembered) return remembered;
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}
