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
 *
 * ## Which of two answers is fresher is decided before either was asked
 *
 * A cacheable GET reserves a **ticket** here before it is sent —
 * `reserveTicket`, an owner's epoch plus the next number in their sequence — and
 * `writeCached` accepts a body only if that ticket still beats what has
 * committed for the URL. So freshness follows **issue order**, which is the
 * order the reader's questions were asked in, rather than completion order,
 * which is a fact about the network. Ordering by a clock was the cheaper design
 * and is wrong in a way that restores data the reader deleted: see
 * docs/plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md
 * § The mechanism, and GPT Sol's F1 and F2.
 *
 * Mutations and sign-out **retire** an owner: they advance the epoch in the same
 * transaction that deletes the bodies, so every ticket taken before them is
 * refused for good. And where a retirement cannot be shown to have happened, the
 * cache is switched off and the database deleted — a copy we failed to clear is
 * a copy we would go on serving. F9.
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

/**
 * A place in the queue, taken before a request is sent.
 *
 * Opaque to its holder on purpose: [api.ts](./api.ts) carries one from the
 * reservation down to the write and never reads a field of it. The `url` and
 * `userId` travel inside it so that a body cannot be filed under a drawer its
 * ticket was not taken for — the cross-account slip `apiFetch` already carries a
 * long comment about having fixed.
 */
export interface Ticket {
  readonly userId: string;
  readonly url: string;
  readonly epoch: number;
  readonly seq: number;
}

/**
 * The ordering metadata: two kinds of row in one store, told apart by `kind`.
 *
 * The committed sequence lives here rather than on the response row, and that
 * separation is what makes eviction safe — deleting a body does not reset the
 * ordering baseline, so eviction needs no retirement of its own and cannot
 * discard an unrelated response that is still in flight.
 */
type Meta =
  /** `epoch\n<userId>` — the owner's mutation epoch, and their sequence allocator. */
  | { key: string; kind: "epoch"; epoch: number; nextSeq: number }
  /** `commit\n<userId>\n<url>` — the last sequence that actually landed a body. */
  | { key: string; kind: "commit"; seq: number };

interface Schema extends DBSchema {
  responses: {
    key: string;
    value: Cached;
    indexes: { lastOpened: number; slug: string };
  };
  meta: { key: string; value: Meta };
}

const DB_NAME = "spideryarn-offline";
const DB_VERSION = 2;
const STORE = "responses";
const META = "meta";

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

/**
 * How many `commit` rows one owner may accumulate before they all go.
 *
 * Eviction deletes bodies and leaves their `commit` rows behind — deliberately,
 * see `Meta` — so this is the only thing that bounds them. Set well above a full
 * cache (a hundred articles, a handful of artefacts each) because the sweep's
 * cost is real: it retires every outstanding ticket for that owner, so an
 * article half-fetched at that moment ends up half-cached. Sweeping only the
 * rows whose article has gone would be gentler and is not bounded at all — it
 * can delete nothing, stay over the threshold, and do the same again on every
 * later commit. F11.
 */
const MAX_COMMITS = 2_000;

/**
 * How long any one operation may take before we stop waiting for it.
 *
 * **On every public operation, not only on opening**, which is Sol's F10: once a
 * handle exists, a transaction can still wait forever behind a `readwrite`
 * transaction locked open in another tab — a suspended background tab on a
 * phone is enough — and the open deadline is never consulted in that state. A
 * reader whose network has just failed is waiting on `readCached` while this
 * runs, so the number is chosen to be survivable rather than generous.
 *
 * **One budget for the whole call, not one per transaction.** `writeCached`
 * opens three things in a row — the database, the commit, then eviction — and
 * with a clock each it took nine seconds' worth of "three". Sol measured 5004 ms
 * for a single call. The number here is what the reader waits, so it has to be
 * spent by the operation rather than by its pieces. F15.
 */
const DEADLINE_MS = 3_000;

/**
 * Milliseconds on a clock that only goes forwards, for measuring a budget.
 *
 * Not `Date.now`: an NTP correction moves wall time, and a deadline measured
 * against a clock that can jump backwards is not a deadline — the same reason
 * the freshness decision has no clock in it (F1, F2). `performance` is absent in
 * a few old environments and everything here has to survive that, so it falls
 * back rather than assuming.
 */
const since = (): number => (typeof performance === "undefined" ? Date.now() : performance.now());

/**
 * The moment one public call must be finished by.
 *
 * Taken once at the top of each exported function and threaded down into every
 * transaction it opens, so what is bounded is the thing the reader is waiting
 * for. F15.
 */
type Deadline = number;

const deadline = (): Deadline => since() + DEADLINE_MS;

/** What is left of a budget, never negative. */
const left = (by: Deadline): number => Math.max(0, by - since());

/** The user id we last saw sign in, for partitioning the cache. */
const USER_KEY = "spideryarn.lastUser";

let handle: Promise<IDBPDatabase<Schema> | null> | null = null;

/**
 * **The cache is off for the rest of this page.**
 *
 * Set when we could not open the database in time, when another tab needs to
 * upgrade it, and when a retirement failed. There is deliberately no way back:
 * an earlier draft had a cooldown so that caching resumed once the blocking tab
 * closed, and Sol's F9 showed that is not a missed cache write but wrong data —
 * a mutation's `invalidate` silently cannot run while the database is
 * unavailable, and the recovered cache then serves a comment the reader has
 * already deleted. Giving up is for the page, not for the moment.
 */
let off = false;

/**
 * The database, opened once, or `null` where there isn't one.
 *
 * **Every caller has to cope with `null`.** IndexedDB is missing in Node (the
 * tests), and it *throws on access* in a Safari private window rather than
 * being absent — so this is a `try` around a feature check rather than a
 * feature check. A reader with no storage should get an app that works and no
 * saved copies, never an error.
 */
async function open(by: Deadline): Promise<IDBPDatabase<Schema> | null> {
  if (off) return null;
  handle ??= start();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    /* The caller's budget, not a fresh one. `start` keeps its own deadline
       because it is shared between callers and owns the decision to switch the
       cache off; this only decides how long *this* call waits for it. F15. */
    return await Promise.race([
      handle,
      new Promise<null>((go) => {
        timer = setTimeout(() => go(null), left(by));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function start(): Promise<IDBPDatabase<Schema> | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (typeof indexedDB === "undefined") return null;
    const wanted = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(instance, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const store = instance.createObjectStore(STORE, { keyPath: "key" });
          store.createIndex("lastOpened", "lastOpened");
          store.createIndex("slug", "slug");
        } else {
          /* **Version 1 saved bodies with no ordering metadata**, so nothing can
             say whether a response still in flight is older or newer than one of
             them (F4) — and a retirement that could not run while the database
             was unavailable leaves one describing something the reader has since
             deleted (F9). There is no service worker, so this code only ever
             runs on a page loaded online: what the reader loses is the backlog
             they do not reopen before their next disconnection, and it comes
             back on its own. Argued out in the plan § The upgrade clears what
             version 1 saved. */
          void tx.objectStore(STORE).clear();
        }
        instance.createObjectStore(META, { keyPath: "key" });
      },
      blocking(_current, _blocked, event) {
        /* A later version wants in and we are the one in the way. Let go, so our
           tabs never do to the next upgrade what version 1's tabs do to this
           one. It costs this page its cache, which is the cheaper half. */
        (event.target as IDBDatabase | null)?.close();
        off = true;
      },
      terminated() {
        off = true;
      },
    });
    const landed = await Promise.race([
      wanted.then((instance) => ({ instance })),
      new Promise<null>((go) => {
        timer = setTimeout(() => go(null), DEADLINE_MS);
      }),
    ]);
    if (!landed) {
      /* A tab on the old version is holding the upgrade off and will not be
         hurried. Close the connection if it ever does arrive, so that we are not
         the next tab's blocker. */
      off = true;
      void wanted.then((instance) => instance.close()).catch(() => {});
      return null;
    }
    return landed.instance;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Switch the cache off, and take the database with it.
 *
 * For a retirement that failed: a body that should have been deleted and was
 * not is a body we would serve. Switching caching off stops that happening now;
 * deleting the database stops it happening on the next page load, which is the
 * half a page-scoped flag cannot cover. Deleting is always safe — every row is a
 * copy of something the server still has — and it needs no record of
 * outstanding debt and no replay. F9.
 */
function abandon(): void {
  off = true;
  const dying = handle;
  handle = null;
  void (async () => {
    try {
      (await dying)?.close();
    } catch {
      /* Never opened, or already closed. Either way there is nothing to shut. */
    }
    try {
      if (typeof indexedDB !== "undefined") indexedDB.deleteDatabase(DB_NAME);
    } catch {
      /* A Safari private window throws on access, and stored nothing to delete. */
    }
  })();
}

/** What an operation came back with, or the fact that it did not come back. */
type Done<T> = { ok: true; value: T } | { ok: false };

/**
 * Wait for `work`, and abort its transaction if it takes too long.
 *
 * **Aborting rather than merely walking away**, because an abandoned
 * transaction can still commit — racing `tx.done` and returning early would
 * leave behind a write we had decided not to make. F10.
 *
 * A rejected `work` and an expired one are the same answer here (`{ ok: false }`)
 * because every caller treats them the same way: return the ordinary no-cache
 * result, or — for a retirement — give the cache up altogether. **Both paths
 * abort**, and the rejected one is not the obvious case: a request that fails
 * fires an error event and takes its transaction down with it, but a call that
 * throws on the way *in* — a value the structured clone refuses, a store that
 * has gone — leaves the transaction alive with nothing pending, and a
 * transaction with nothing pending commits. Sol reproduced that as a body filed
 * without the `commit` row that orders it, which an older reply then overwrote;
 * the same shape leaves a retirement's deletes standing without the epoch
 * advance that is the whole of its failure containment. F16.
 *
 * **`tx.done` is claimed here rather than left to whoever gets round to it.**
 * `idb` builds that promise when the transaction is created, not when the
 * property is first read — so aborting rejects it while the work is still
 * somewhere before its own `await tx.done`, and it lands as an unhandled
 * rejection. In a browser that is a console error and a Sentry issue for
 * something we did on purpose; under vitest it fails the whole run with every
 * assertion passing. Found by the test for the deadline itself.
 */
async function bounded<T>(
  tx: { abort: () => void; done: Promise<unknown> },
  work: Promise<T>,
  by: Deadline,
): Promise<Done<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  tx.done.catch(() => {});
  const give = (): Done<T> => {
    try {
      tx.abort();
    } catch {
      /* Already finished, or already aborted. */
    }
    return { ok: false };
  };
  const outcome: Promise<Done<T>> = work.then((value) => ({ ok: true, value }), give);
  try {
    return await Promise.race([
      outcome,
      new Promise<Done<T>>((go) => {
        /* What is left of the **call's** budget. Zero means it is already spent,
           and the transaction goes on the next turn rather than getting a
           consolation three seconds of its own. */
        timer = setTimeout(() => go(give()), left(by));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const keyFor = (userId: string, url: string) => `${userId}\n${url}`;
const epochKey = (userId: string) => `epoch\n${userId}`;
const commitKey = (userId: string, url: string) => `commit\n${userId}\n${url}`;

/**
 * Every `commit` key for one owner, or for one owner under one URL prefix.
 *
 * A key range rather than a scan and a filter, and `\uffff` as its upper bound
 * because IndexedDB orders strings by code unit and nothing sorts above that.
 * Written as an escape: the character itself is invisible in a source file, and
 * a reader cannot grep for what they cannot see.
 */
function commitsUnder(userId: string, prefix = ""): IDBKeyRange {
  const from = commitKey(userId, prefix);
  return IDBKeyRange.bound(from, `${from}\uffff`);
}

/**
 * Take this request's place in its owner's queue, before it goes out.
 *
 * The number is allocated here rather than stamped from a clock because two tabs
 * share no monotonic source, and because a clock can go backwards — and a
 * retirement compared against a backwards-adjusted stamp restores data the
 * reader deleted. F1, F2.
 *
 * `null` — no database, a throw, or the deadline — means this request
 * **irrevocably does not cache**. Nothing can restore its eligibility later,
 * because the ticket is a value passed down the call chain rather than a flag
 * somebody could set.
 */
export async function reserveTicket(url: string, userId: string | null): Promise<Ticket | null> {
  if (!userId) return null;
  const by = deadline();
  const instance = await open(by);
  if (!instance) return null;
  try {
    const tx = instance.transaction(META, "readwrite");
    const got = await bounded(
      tx,
      (async () => {
        const key = epochKey(userId);
        const row = await tx.store.get(key);
        const epoch = row?.kind === "epoch" ? row.epoch : 0;
        const seq = (row?.kind === "epoch" ? row.nextSeq : 0) + 1;
        await tx.store.put({ key, kind: "epoch", epoch, nextSeq: seq });
        await tx.done;
        return { userId, url, epoch, seq } satisfies Ticket;
      })(),
      by,
    );
    return got.ok ? got.value : null;
  } catch {
    return null;
  }
}

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
  const by = deadline();
  const instance = await open(by);
  if (!instance) return undefined;
  try {
    const key = keyFor(userId, url);
    const tx = instance.transaction(STORE, "readonly");
    const got = await bounded(tx, tx.store.get(key), by);
    if (!got.ok || !got.value) return undefined;
    /* Started here and not awaited — but its transaction is created before this
       function returns, which is what lets a caller fence on it. */
    touch(instance, key);
    return { body: got.value.body, savedAt: got.value.savedAt };
  } catch {
    return undefined;
  }
}

/**
 * Mark the row under `key` as opened just now, if it is still there.
 *
 * **One transaction, and it re-reads.** This used to put back the row the read
 * above had already returned, from outside that read's transaction — so a save
 * that committed in between was overwritten by the very body it had replaced,
 * and a row `invalidate` or `forgetUser` had deleted came back. Neither is
 * exotic: `useShelf.ts` calls `readCachedShelf` and `apiFetch("/api/library")`
 * together on every mount, so the paint-from-cache read always races the
 * response that replaces it.
 */
function touch(instance: IDBPDatabase<Schema>, key: string): void {
  const tx = instance.transaction(STORE, "readwrite");
  void bounded(
    tx,
    (async () => {
      const row = await tx.store.get(key);
      /* Gone since the read. Putting it back is the bug this rewrite is for. */
      if (row) await tx.store.put({ ...row, lastOpened: Date.now() });
      await tx.done;
    })(),
    /* Its own budget, because nobody is waiting on it: `readCached` has already
       answered by the time this runs. */
    deadline(),
  );
}

/**
 * Keep `body` as this reader's copy of `url`, if its ticket still beats what has
 * landed.
 *
 * Never throws. A cache that cannot be written is a feature that quietly does
 * not happen; a cache that throws is a reader who cannot read. The one thing
 * this must not do is report a success it did not have, so callers get `false`
 * and can decline to claim the article is saved.
 *
 * The ticket is compared against the **last committed** sequence, never the last
 * issued one: a newer request that failed leaves no mark, so an earlier
 * successful response still fills an empty cache. That is the case a fence
 * written the other way round would quietly break.
 */
export async function writeCached(
  url: string,
  body: unknown,
  ticket: Ticket | null,
  slug = "",
): Promise<boolean> {
  /* No ticket means the reservation failed, and that decision is final. A ticket
     for another URL is a threading mistake rather than a race, and it is the one
     way this fence could file a body in the wrong drawer. */
  if (!ticket || ticket.url !== url) return false;
  const by = deadline();
  const instance = await open(by);
  if (!instance) return false;
  try {
    const tx = instance.transaction([STORE, META], "readwrite");
    const meta = tx.objectStore(META);
    const kept = await bounded(
      tx,
      (async () => {
        const owner = await meta.get(epochKey(ticket.userId));
        /* Retired: a mutation or a sign-out has happened since this request went
           out, so what it carries describes a world the reader has left. A
           missing epoch row means the database was rebuilt underneath us, which
           is the same answer. */
        if (owner?.kind !== "epoch" || owner.epoch !== ticket.epoch) return false;
        const landed = await meta.get(commitKey(ticket.userId, url));
        if (landed?.kind === "commit" && landed.seq >= ticket.seq) return false;

        const now = Date.now();
        /* Measured from the serialised form because that is the number we can
           get cheaply. It is not the bytes IndexedDB spends, and nothing here
           pretends otherwise — it is kept for diagnosis, not for the cap. */
        const bytes = JSON.stringify(body)?.length ?? 0;
        await tx.objectStore(STORE).put({
          key: keyFor(ticket.userId, url),
          userId: ticket.userId,
          url,
          slug,
          body,
          savedAt: now,
          lastOpened: now,
          bytes,
        });
        await meta.put({ key: commitKey(ticket.userId, url), kind: "commit", seq: ticket.seq });
        await sweep(meta, ticket.userId, owner);
        await tx.done;
        return true;
      })(),
      by,
    );
    if (!kept.ok || !kept.value) return false;

    /* **Its own transaction, after the commit**, so an eviction that fails
       leaves a successful cache write successful — and so that a scan of every
       row is not inside the transaction a reader is waiting on. F7. On this
       call's remaining budget rather than a fresh one (F15), and told to spare
       the article it has just been handed (F14). */
    /* **And then, if anything was deleted, we look.** Sparing our own article
       stops *this* eviction taking it; it does nothing about the one running for
       the write beside it, which spares its own slug and is entitled to choose
       ours. Two commits landing together take the cache to 102, and the first
       eviction to finish drops two — of which the second write's article can be
       one, whichever timestamps they carry. F14, second round.

       The answer is not a cleverer ranking but a cheaper question: is the row
       actually there? An exact key, on what is left of the budget.

       **Only when eviction ran**, which is the part worth reading twice. An
       eviction that failed or timed out aborted its transaction and therefore
       deleted nothing, so the row it did not touch is still ours and the write
       is still a success — that is F7's promise and this must not quietly
       withdraw it. And a check we cannot complete answers `false`, because the
       promise here is never to *claim* a success we did not have; declining one
       we did is the direction this module is allowed to be wrong in. */
    if (!(await evict(instance, by, slug))) return true;
    const there = instance.transaction(STORE, "readonly");
    const survived = await bounded(there, there.store.get(keyFor(ticket.userId, url)), by);
    return survived.ok && !!survived.value;
  } catch {
    /* Includes `QuotaExceededError`. Any previous copy is untouched — a `put`
       that throws replaces nothing — and `false` tells the caller not to claim
       this one was kept. */
    return false;
  }
}

/**
 * Keep one owner's `commit` rows bounded, inside the transaction that crossed
 * the threshold.
 *
 * All of them at once, with the epoch advanced once and `nextSeq` kept: that is
 * what makes the bound real, because the new epoch retires every ticket the
 * deleted rows were the baseline for. The cost is stated at `MAX_COMMITS`.
 */
async function sweep(
  meta: {
    getAllKeys: (range: IDBKeyRange, count?: number) => Promise<string[]>;
    delete: (key: string) => Promise<void>;
    put: (value: Meta) => Promise<string>;
  },
  userId: string,
  owner: { epoch: number; nextSeq: number },
): Promise<void> {
  const range = commitsUnder(userId);
  /* Counted with a limit, because this runs on every commit and the only answer
     it needs is "more than the threshold". */
  if ((await meta.getAllKeys(range, MAX_COMMITS + 1)).length <= MAX_COMMITS) return;
  for (const key of await meta.getAllKeys(range)) await meta.delete(key);
  await meta.put({
    key: epochKey(userId),
    kind: "epoch",
    epoch: owner.epoch + 1,
    nextSeq: owner.nextSeq,
  });
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
 *
 * **Choosing and deleting are one transaction.** They used to be many, so a
 * response that landed in between was deleted by a decision taken before it
 * arrived: the reader was handed an article and had it taken away again, with
 * nothing anywhere reporting a failure.
 *
 * **And `spare` is never a candidate**: the article the call that invoked this
 * has just committed. Ranking is by a wall clock, and a wall clock that has gone
 * backwards — a laptop waking on a corrected time — makes the newest row the
 * oldest thing on the device; so do a hundred and one rows written inside one
 * millisecond, where the tie is broken by primary key. Either way `writeCached`
 * returned `true` for a body it deleted on its way out, which is the one thing
 * its own docstring says it must not do. The next candidate goes instead, so the
 * cap is enforced just as hard. F14.
 */
async function evict(instance: IDBPDatabase<Schema>, by: Deadline, spare: string): Promise<boolean> {
  try {
    const tx = instance.transaction(STORE, "readwrite");
    const ran = await bounded(
      tx,
      (async () => {
        const all = await tx.store.index("lastOpened").getAll();

        /* Rank articles by the most recent touch of *any* of their parts —
           reading the prose should keep its glossary alive. */
        const freshest = new Map<string, number>();
        for (const row of all) {
          if (!row.slug) continue; // the shelf and the profile belong to no article
          freshest.set(row.slug, Math.max(freshest.get(row.slug) ?? 0, row.lastOpened));
        }
        if (freshest.size <= MAX_ARTICLES) return;

        /* Still `freshest.size - MAX_ARTICLES` articles, counted before `spare`
           is taken out of the running: the cap is on what is stored, and the one
           article held back is always one the count is over by. */
        const doomed = new Set(
          [...freshest.entries()]
            .filter(([slug]) => slug !== spare)
            .sort((a, b) => a[1] - b[1])
            .slice(0, freshest.size - MAX_ARTICLES)
            .map(([slug]) => slug),
        );
        for (const row of all) {
          if (doomed.has(row.slug)) await tx.store.delete(row.key);
        }
        await tx.done;
      })(),
      by,
    );
    return ran.ok;
  } catch {
    /* An eviction that fails leaves a cache that is too big, which is a great
       deal better than a write that fails because eviction did. */
    return false;
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
  await retire(userId, prefix);
}

/** Forget every copy saved for one reader. For sign-out and account switches. */
export async function forgetUser(userId: string): Promise<void> {
  await retire(userId, "");
}

/**
 * Delete one owner's bodies under `prefix`, and retire every request already in
 * flight for them.
 *
 * **One transaction: the deletes, their `commit` rows, and the epoch.** A
 * response issued before this can still be on its way, and the epoch is what
 * refuses it — so advancing the epoch anywhere but alongside the deletes leaves
 * a window in which half a retirement has happened. The epoch row is kept rather
 * than deleted, `nextSeq` and all, so that the reader who signs back in caches
 * normally from their next request onwards; the `commit` rows can go precisely
 * *because* the epoch moved in the same breath, and that is what keeps this
 * metadata bounded without a scheduler.
 *
 * A mutation retires the whole owner, so an article still loading when the
 * reader posts a comment can end up **partially** cached — what committed before
 * the mutation stays, the rest is refused. Accepted: only eviction promises
 * whole articles.
 *
 * **A retirement that fails takes the cache with it.** This used to swallow the
 * failure — *"the write succeeded, a cache we failed to clear is not worth
 * failing it"* — which was written without noticing that a copy we failed to
 * clear is a copy we then serve, offline, as a synthetic 200. F9.
 */
async function retire(userId: string, prefix: string): Promise<void> {
  const by = deadline();
  const instance = await open(by);
  /* No database, or a cache we have already given up on. Either way we cannot
     show the retirement happened, so we make sure there is nothing left to be
     wrong. */
  if (!instance) return abandon();
  try {
    const tx = instance.transaction([STORE, META], "readwrite");
    const responses = tx.objectStore(STORE);
    const meta = tx.objectStore(META);
    const done = await bounded(
      tx,
      (async () => {
        for (const row of await responses.getAll()) {
          if (row.userId === userId && row.url.startsWith(prefix)) await responses.delete(row.key);
        }
        /* By key range rather than from the rows above, because eviction leaves
           a `commit` row behind when it deletes a body — and one of those is
           exactly the baseline a later response would be measured against. */
        for (const key of await meta.getAllKeys(commitsUnder(userId, prefix))) {
          await meta.delete(key);
        }
        const owner = await meta.get(epochKey(userId));
        await meta.put({
          key: epochKey(userId),
          kind: "epoch",
          epoch: (owner?.kind === "epoch" ? owner.epoch : 0) + 1,
          nextSeq: owner?.kind === "epoch" ? owner.nextSeq : 0,
        });
        await tx.done;
      })(),
      by,
    );
    if (!done.ok) abandon();
  } catch {
    abandon();
  }
}

/**
 * Every article this reader has the *prose* of.
 *
 * For the shelf, which must not offer an article that cannot be opened. The
 * prose specifically: an article whose glossary survived but whose blocks were
 * evicted is not something anybody can read. See `onlyWhatWeHave` in
 * [api.ts](./api.ts).
 */
export async function cachedSlugs(userId: string | null): Promise<Set<string>> {
  const found = new Set<string>();
  if (!userId) return found;
  const by = deadline();
  const instance = await open(by);
  if (!instance) return found;
  try {
    const tx = instance.transaction(STORE, "readonly");
    const got = await bounded(tx, tx.store.getAll(), by);
    if (!got.ok) return found;
    for (const row of got.value) {
      if (row.userId === userId && row.url.startsWith("/api/article/")) found.add(row.slug);
    }
  } catch {
    /* An empty set offers nothing, which is the safe direction to fail in. */
  }
  return found;
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
