/**
 * The cache itself, against a real IndexedDB.
 *
 * `fake-indexeddb` rather than a hand-written stub, and the difference matters:
 * the two behaviours most worth testing here — that an index sorts the way we
 * think, and that a `readwrite` transaction serialises the way we think — are
 * exactly the behaviours a stub would simply agree with us about. A stub proves
 * the code calls the API; this proves the API does what the code assumed.
 *
 * The other half of the offline work is in api-fetch-offline.test.ts, which
 * mocks this module because what it tests is the order of operations in
 * `apiFetch`. Nothing tests both at once on purpose — that test would fail for
 * two unrelated reasons and tell you neither.
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Cached,
  cachedSlugs,
  forgetUser,
  invalidate,
  lastKnownUser,
  readCached,
  rememberUser,
  writeCached,
} from "../src/web/lib/offline-store.js";

/**
 * A fresh database per test.
 *
 * The module memoises its handle, so the database is deleted and the module's
 * cached promise is left pointing at a closed connection — which is why every
 * test writes before it reads rather than assuming an empty store.
 */
beforeEach(async () => {
  for (const row of await allRows()) await drop(row);
});

/* Small helpers that go around the module's own API, so a test can look at what
   is actually stored rather than at what the module says is stored. */
async function allRows(): Promise<{ key: string; userId: string; url: string }[]> {
  const db: IDBDatabase = await new Promise((go, no) => {
    const req = indexedDB.open("spideryarn-offline");
    req.onsuccess = () => go(req.result);
    req.onerror = () => no(req.error);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("responses")) {
        req.result.createObjectStore("responses", { keyPath: "key" }).createIndex(
          "lastOpened",
          "lastOpened",
        );
      }
    };
  });
  try {
    return await new Promise((go, no) => {
      const req = db.transaction("responses").objectStore("responses").getAll();
      req.onsuccess = () => go(req.result);
      req.onerror = () => no(req.error);
    });
  } finally {
    db.close();
  }
}

async function drop(row: { key: string }): Promise<void> {
  const db: IDBDatabase = await new Promise((go, no) => {
    const req = indexedDB.open("spideryarn-offline");
    req.onsuccess = () => go(req.result);
    req.onerror = () => no(req.error);
  });
  try {
    await new Promise<void>((go, no) => {
      const req = db
        .transaction("responses", "readwrite")
        .objectStore("responses")
        .delete(row.key);
      req.onsuccess = () => go();
      req.onerror = () => no(req.error);
    });
  } finally {
    db.close();
  }
}

describe("what one reader saves, another cannot read", () => {
  it("keeps two accounts apart at the same URL", async () => {
    await writeCached("/api/article/x", { whose: "ada" }, "ada", "x");
    await writeCached("/api/article/x", { whose: "bob" }, "bob", "x");

    expect((await readCached("/api/article/x", "ada"))?.body).toEqual({ whose: "ada" });
    expect((await readCached("/api/article/x", "bob"))?.body).toEqual({ whose: "bob" });
  });

  it("returns nothing for a reader who saved nothing", async () => {
    await writeCached("/api/article/x", { whose: "ada" }, "ada", "x");
    expect(await readCached("/api/article/x", "cleo")).toBeUndefined();
  });

  it("returns nothing when nobody is signed in", async () => {
    await writeCached("/api/article/x", { whose: "ada" }, "ada", "x");
    expect(await readCached("/api/article/x", null)).toBeUndefined();
  });

  it("signing out takes that reader's copies and leaves the other's", async () => {
    await writeCached("/api/article/x", { whose: "ada" }, "ada", "x");
    await writeCached("/api/article/x", { whose: "bob" }, "bob", "x");

    await forgetUser("ada");

    expect(await readCached("/api/article/x", "ada")).toBeUndefined();
    /* The other account shares this iPad. Their articles are not ours to throw
       away just because somebody else signed out. */
    expect((await readCached("/api/article/x", "bob"))?.body).toEqual({ whose: "bob" });
  });
});

describe("eviction works in whole articles", () => {
  it("drops the prose and its artefacts together", async () => {
    /* One over the cap of 100, so exactly one article should go. */
    for (let i = 0; i < 101; i++) {
      await writeCached(`/api/article/a${i}`, { i }, "ada", `a${i}`);
      await writeCached(`/api/glossary/a${i}`, { i }, "ada", `a${i}`);
    }

    /* `a0` was written first and never touched again, so it is the oldest. */
    expect(await readCached("/api/article/a0", "ada")).toBeUndefined();
    expect(await readCached("/api/glossary/a0", "ada")).toBeUndefined();

    /* And the newest is entirely present — never half of it. */
    expect(await readCached("/api/article/a100", "ada")).toBeDefined();
    expect(await readCached("/api/glossary/a100", "ada")).toBeDefined();
  });

  it("reading an article keeps it alive", async () => {
    for (let i = 0; i < 60; i++) await writeCached(`/api/article/b${i}`, { i }, "ada", `b${i}`);
    /* Touch the oldest, which should now outrank everything written before the
       ones that follow. */
    await readCached("/api/article/b0", "ada");
    for (let i = 60; i < 101; i++) await writeCached(`/api/article/b${i}`, { i }, "ada", `b${i}`);

    expect(await readCached("/api/article/b0", "ada")).toBeDefined();
    expect(await readCached("/api/article/b1", "ada")).toBeUndefined();
  });

  it("does not evict the shelf, which belongs to no article", async () => {
    await writeCached("/api/library", [{ slug: "x" }], "ada");
    for (let i = 0; i < 120; i++) await writeCached(`/api/article/c${i}`, { i }, "ada", `c${i}`);

    expect((await readCached("/api/library", "ada"))?.body).toEqual([{ slug: "x" }]);
  });
});

describe("a write throws its copy away", () => {
  it("clears everything under the prefix, for that reader only", async () => {
    await writeCached("/api/chat/x", { threads: 2 }, "ada", "x");
    await writeCached("/api/chat/x", { threads: 9 }, "bob", "x");
    await writeCached("/api/article/x", { prose: true }, "ada", "x");

    await invalidate("/api/chat/x", "ada");

    expect(await readCached("/api/chat/x", "ada")).toBeUndefined();
    /* Same prefix, different reader. */
    expect(await readCached("/api/chat/x", "bob")).toBeDefined();
    /* Same reader, same article, different resource — the prose is untouched. */
    expect(await readCached("/api/article/x", "ada")).toBeDefined();
  });
});

describe("the shelf can only offer what it can open", () => {
  it("names articles we have the prose of, not merely the artefacts of", async () => {
    await writeCached("/api/article/whole", { prose: true }, "ada", "whole");
    /* A glossary whose article was never cached, or has since been evicted. */
    await writeCached("/api/glossary/partial", { terms: [] }, "ada", "partial");

    const held = await cachedSlugs("ada");
    expect([...held]).toEqual(["whole"]);
  });

  it("tells one reader nothing about another's", async () => {
    await writeCached("/api/article/hers", { prose: true }, "ada", "hers");
    expect([...(await cachedSlugs("bob"))]).toEqual([]);
  });
});

/**
 * **What this proves, and what it does not.**
 *
 * It forges a `savedAt` sixty seconds in the future onto a stored row and then
 * checks that `writeCached` declines to overwrite it. That is a test of the
 * comparison operator, and the operator is fine. What it never does is run two
 * real writes and let them finish in the wrong order — so it agrees with the
 * code about the thing the code is wrong about: `writeCached` takes its
 * timestamp when the write *begins*, which means the reply that answers last
 * carries the later stamp and wins, however early it was asked for. A forged
 * future stamp is a *clock* inversion; the defect is a *completion* inversion,
 * and this test cannot tell them apart.
 *
 * Kept, because the operator is still worth pinning. The race it looks like it
 * covers is covered in tests/cache-issue-order.test.ts, which drives two real
 * requests through `apiFetch` and settles them by hand.
 */
describe("an older reply cannot overwrite a newer one", () => {
  it("keeps the newer body", async () => {
    await writeCached("/api/article/x", { which: "new" }, "ada", "x");
    const row = (await allRows()).find((r) => r.url === "/api/article/x") as
      | { key: string; savedAt: number }
      | undefined;
    expect(row).toBeDefined();

    /* Pretend the stored copy arrived from the future — which is what a slow
       first request landing after a fast second one looks like from here. */
    await stampFuture(row!.key);
    await writeCached("/api/article/x", { which: "old" }, "ada", "x");

    expect((await readCached("/api/article/x", "ada"))?.body).toEqual({ which: "new" });
  });
});

async function stampFuture(key: string): Promise<void> {
  const db: IDBDatabase = await new Promise((go, no) => {
    const req = indexedDB.open("spideryarn-offline");
    req.onsuccess = () => go(req.result);
    req.onerror = () => no(req.error);
  });
  try {
    await new Promise<void>((go, no) => {
      const store = db.transaction("responses", "readwrite").objectStore("responses");
      const read = store.get(key);
      read.onsuccess = () => {
        const put = store.put({ ...read.result, savedAt: Date.now() + 60_000 });
        put.onsuccess = () => go();
        put.onerror = () => no(put.error);
      };
      read.onerror = () => no(read.error);
    });
  } finally {
    db.close();
  }
}

describe("remembering who is signed in", () => {
  it("round-trips an id through localStorage and forgets it", () => {
    const held = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => held.get(k) ?? null,
      setItem: (k: string, v: string) => held.set(k, v),
      removeItem: (k: string) => held.delete(k),
    });

    rememberUser("ada");
    expect(held.get("spideryarn.lastUser")).toBe("ada");
    expect(lastKnownUser()).toBe("ada");

    rememberUser(null);
    expect(lastKnownUser()).toBeNull();
    vi.unstubAllGlobals();
  });

  /**
   * **The cache must not switch itself off in silence.**
   *
   * `localStorage` is missing under Node — which now shadows jsdom's own and
   * refuses to enable it without `--localstorage-file` — and in a Safari
   * private window it exists and throws on write. Either way, a `lastKnownUser`
   * that could only answer from `localStorage` would return `null`, every cache
   * read and write would decline, and the whole feature would quietly not exist
   * while looking exactly like a feature that did. That is precisely how it
   * behaved until a test polled for the write instead of sleeping past it.
   */
  it("still knows the reader when localStorage is absent", () => {
    vi.stubGlobal("localStorage", undefined);
    rememberUser("ada");
    expect(lastKnownUser()).toBe("ada");
    rememberUser(null);
    vi.unstubAllGlobals();
  });

  it("still knows the reader when localStorage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(() => rememberUser("ada")).not.toThrow();
    expect(lastKnownUser()).toBe("ada");
    rememberUser(null);
    vi.unstubAllGlobals();
  });

  it("says nobody before anyone has signed in", () => {
    vi.stubGlobal("localStorage", undefined);
    rememberUser(null);
    expect(lastKnownUser()).toBeNull();
    vi.unstubAllGlobals();
  });
});

/* ------------------------------------------------------------------------- *
 *  Two things happening to one cache at once
 *
 *  Everything below drives two of the module's own operations concurrently,
 *  because four of them read a snapshot and then write outside the transaction
 *  that produced it — the LRU touch, eviction, invalidation and sign-out. None
 *  of those is visible from a test that does one thing at a time, which is why
 *  none of the tests above finds any of them.
 *  docs/plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md.
 * ------------------------------------------------------------------------- */

/**
 * `Date.now`, before anything in this file mocks it.
 *
 * Captured at module load so that a poll waiting for a mocked clock's effect
 * still measures its own patience against real time.
 */
const realNow = Date.now.bind(Date);

/** Every row, typed. `allRows` is deliberately narrow; these tests read bodies. */
async function everything(): Promise<Cached[]> {
  return (await allRows()) as unknown as Cached[];
}

async function rowFor(url: string, userId: string): Promise<Cached | undefined> {
  return (await everything()).find((r) => r.url === url && r.userId === userId);
}

/**
 * Poll until something is true, and say what we were waiting for if it never is.
 *
 * A fixed sleep would pass whether or not the thing it waits for ever happens,
 * which is the failure this whole section is about — a check that agrees with
 * the code because it shares an assumption with it.
 * docs/reusable/silent-success.md.
 */
async function until(what: string, ready: () => Promise<boolean>): Promise<void> {
  const deadline = realNow() + 5_000;
  while (realNow() < deadline) {
    if (await ready()) return;
    await new Promise((go) => setTimeout(go, 1));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

/**
 * Wait for work already under way to reach the database.
 *
 * **Not a sleep, and the difference is the whole point.** `readCached` opens the
 * transaction for its `lastOpened` write before it returns, and then does not
 * await it — so asking a question straight afterwards asks it of a database the
 * answer has not arrived in yet. IndexedDB commits transactions over one store
 * in the order they were **created**, so a write started here, after the call
 * under test has returned, cannot commit before one started earlier: when this
 * resolves, that one has committed. A guarantee rather than a guess.
 */
let fences = 0;
async function fence(): Promise<void> {
  await writeCached("/api/article/__fence__", { n: ++fences }, "fence", "__fence__");
}

/**
 * `Date.now`, forced strictly increasing for the duration of one test.
 *
 * All of this happens inside a millisecond, and two events stamped with the same
 * number cannot be told apart — which is the difference between *the touch
 * landed and did no harm* and *the touch never landed at all*. The defect does
 * not depend on the clock's granularity; a test's ability to see it does.
 */
function tickingClock(): () => void {
  const start = realNow();
  let ticks = 0;
  const spy = vi.spyOn(Date, "now").mockImplementation(() => start + ++ticks);
  return () => spy.mockRestore();
}

/** Rows straight into the store, so a test can start from a full cache. */
async function seed(rows: Cached[]): Promise<void> {
  const db: IDBDatabase = await new Promise((go, no) => {
    const req = indexedDB.open("spideryarn-offline");
    req.onsuccess = () => go(req.result);
    req.onerror = () => no(req.error);
  });
  try {
    await new Promise<void>((go, no) => {
      const tx = db.transaction("responses", "readwrite");
      for (const row of rows) tx.objectStore("responses").put(row);
      tx.oncomplete = () => go();
      tx.onerror = () => no(tx.error);
    });
  } finally {
    db.close();
  }
}

describe("the touch that keeps an article alive must not rewrite it", () => {
  /**
   * **A read and a fresh response at the same moment is the ordinary case, not
   * an exotic one.** `src/web/useShelf.ts` calls `readCachedShelf` — which is
   * `readCached` — and `apiFetch("/api/library")` together on every mount, so
   * the paint-from-cache read is always racing the request that will replace it.
   *
   * `readCached` reads the row in one transaction and writes `lastOpened` back
   * in another, opened only after the read has answered. A save that opened its
   * own transaction in between therefore commits **first**, and the touch then
   * puts the whole row it read — old body and all — back on top of it.
   */
  it("cannot put an old body back over one saved while it was reading", async () => {
    const stop = tickingClock();
    try {
      await writeCached("/api/article/x", { which: "old" }, "ada", "x");

      const reading = readCached("/api/article/x", "ada");
      const saving = writeCached("/api/article/x", { which: "new" }, "ada", "x");
      await Promise.all([reading, saving]);

      /* Waited for by its own signature rather than slept past: `lastOpened`
         ahead of `savedAt` is the one thing only the touch does. If the touch
         ever stopped happening this would time out — so the assertion below
         cannot pass by the race simply never having been run. */
      await until("the touch to land", async () => {
        const row = await rowFor("/api/article/x", "ada");
        return !!row && row.lastOpened > row.savedAt;
      });

      expect((await rowFor("/api/article/x", "ada"))?.body).toEqual({ which: "new" });
    } finally {
      stop();
    }
  });

  /**
   * **And it must not bring back a row somebody deleted while it was reading.**
   *
   * The reader deletes a comment; `saving` in api.ts invalidates that article's
   * comments; a panel reads its cached copy in the same moment. `invalidate`
   * takes its list of rows before it deletes any of them, and the touch's write
   * is queued behind that delete — so the row it puts back is one the reader has
   * just been told is gone.
   */
  it("cannot bring back a row invalidated while it was reading", async () => {
    await writeCached("/api/chat/x", { threads: 2 }, "ada", "x");
    /* A second row under the same prefix that nobody reads, so that "the row is
       back" cannot be confused with "the invalidation never happened". */
    await writeCached("/api/chat/x/t-9", { thread: 9 }, "ada", "x");

    const clearing = invalidate("/api/chat/x", "ada");
    const reading = readCached("/api/chat/x", "ada");
    await Promise.all([clearing, reading]);
    await fence();

    expect(await rowFor("/api/chat/x/t-9", "ada")).toBeUndefined();
    expect(await rowFor("/api/chat/x", "ada")).toBeUndefined();
  });

  /** The same, against sign-out, where the row is not ours to keep at all. */
  it("cannot bring back a row a sign-out deleted while it was reading", async () => {
    await writeCached("/api/article/x", { whose: "ada" }, "ada", "x");
    /* Ada's, and unread, for the same reason as above. */
    await writeCached("/api/glossary/x", { whose: "ada" }, "ada", "x");
    await writeCached("/api/article/x", { whose: "bob" }, "bob", "x");

    const gone = forgetUser("ada");
    const reading = readCached("/api/article/x", "ada");
    await Promise.all([gone, reading]);
    await fence();

    expect(await rowFor("/api/glossary/x", "ada")).toBeUndefined();
    expect(await rowFor("/api/article/x", "ada")).toBeUndefined();
    /* The other account shares this iPad and had nothing to do with any of it. */
    expect((await rowFor("/api/article/x", "bob"))?.body).toEqual({ whose: "bob" });
  });
});

describe("eviction decides who dies before it starts killing", () => {
  /**
   * A cache well over the cap, seeded straight in so that the ranking is exact
   * rather than whatever the clock happened to do. Fifty-one articles are
   * doomed, which makes the delete loop long enough to watch something land in
   * the middle of it — in production the window is one response arriving, and
   * the point is that the window exists at all.
   */
  async function crowded(): Promise<void> {
    const rows: Cached[] = [];
    for (let i = 0; i < 150; i++) {
      for (const url of [`/api/article/e${i}`, `/api/glossary/e${i}`]) {
        rows.push({
          key: `ada\n${url}`,
          userId: "ada",
          url,
          slug: `e${i}`,
          body: { i },
          savedAt: 1_000 + i,
          lastOpened: 1_000 + i,
          bytes: 8,
        });
      }
    }
    await seed(rows);
  }

  /**
   * **A response the reader is waiting for, deleted by a decision taken before
   * it arrived.** `evict` lists every row, works out which articles to drop, and
   * then deletes them one transaction at a time. A save that commits between the
   * list and the delete is deleted by key all the same — so the article the
   * reader has this second asked for, and been given, is gone before they see
   * it, and nothing anywhere reports a failure.
   */
  it("does not delete an article that was saved while it was choosing", async () => {
    await crowded();

    /* One more article takes the count to 151, so the fifty-one oldest are
       doomed: e0 through e50. */
    const evicting = writeCached("/api/article/trigger", { t: 1 }, "ada", "trigger");

    /* e0 is the oldest and goes first, so its absence says the delete loop is
       running — and a hundred deletes short of e50. Watched for, not slept for. */
    await until(
      "eviction to start deleting",
      async () => !(await rowFor("/api/article/e0", "ada")),
    );

    const rescued = writeCached("/api/article/e50", { which: "fresh" }, "ada", "e50");
    const [, saved] = await Promise.all([evicting, rescued]);
    const row = await rowFor("/api/article/e50", "ada");

    /* **A `true` it then deletes is the one thing this module says it must never
       do** — *"the one thing this must not do is report a success it did not
       have, so callers get `false` and can decline to claim the article is
       saved"*. Written as that invariant rather than as a flat *the row is
       there*, because a fence that refuses the write outright and answers
       `false` is a different and honest outcome: nothing on screen then claims
       the article is saved. Today it answers `true` and the row is gone a
       hundred deletes later. */
    expect([saved, row?.body]).toEqual([saved, saved ? { which: "fresh" } : undefined]);
    /* And an article nobody chose is untouched, so the assertion above cannot be
       satisfied by an eviction that has simply stopped working. */
    expect(await rowFor("/api/article/e120", "ada")).toBeDefined();
  });
});

describe("signing out is a fence, not a sweep", () => {
  /**
   * **A response for a reader who has signed out must not land after them.**
   *
   * `forgetUser` lists that reader's rows and then deletes them one at a time. A
   * response already in flight when they signed out commits into the gap and is
   * not on the list, so their article is back on a device they have just left —
   * which is the one thing the per-account partition exists to stop.
   *
   * **A note for whoever builds the fence.** This write cannot be stamped by
   * this test, because there is no parameter to stamp it with yet — so it
   * carries whatever stamp `writeCached` gives a caller that names none, taken
   * after `forgetUser` was called and before `forgetUser` writes anything. It
   * therefore says something about *when* the retirement mark is read: take it
   * at the top of `forgetUser` and this write is stamped later and survives;
   * take it with the deletes, in the transaction that does them, and it does
   * not. The second is the plan's *"one transaction each, deleting matched rows
   * and setting `retiredAt` together"*, and it is what this asks for.
   */
  it("does not let a reply in flight survive the sign-out it arrived after", async () => {
    await writeCached("/api/article/x", { whose: "ada" }, "ada", "x");
    await writeCached("/api/article/x", { whose: "bob" }, "bob", "x");

    /* Sign-out first, and the reply behind it: `forgetUser` takes its list
       before this write commits, so the row it writes is not on it. */
    const gone = forgetUser("ada");
    const landing = writeCached("/api/glossary/x", { whose: "ada" }, "ada", "x");
    await Promise.all([gone, landing]);
    await fence();

    expect((await everything()).filter((r) => r.userId === "ada")).toEqual([]);
    /* Somebody else's copies on the same iPad, which were never in question. */
    expect((await rowFor("/api/article/x", "bob"))?.body).toEqual({ whose: "bob" });
  });

  /**
   * **And signing out does not switch the cache off for good.** A fence that
   * retires everything stamped before the sign-out has to let what comes after
   * it through, or the reader who signs back in has an app that silently never
   * saves anything again.
   */
  it("caches normally for the same reader once they sign back in", async () => {
    await writeCached("/api/article/x", { whose: "ada" }, "ada", "x");
    await forgetUser("ada");

    expect(await writeCached("/api/article/x", { whose: "ada, again" }, "ada", "x")).toBe(true);
    expect((await readCached("/api/article/x", "ada"))?.body).toEqual({ whose: "ada, again" });
  });

  /**
   * **The control: a direct A→B switch retires nothing.** `forgetUser` runs only
   * on a null session, so signing straight from one account into another never
   * calls it — and both partitions have to survive intact, or the fence has
   * turned an account switch into a cache wipe.
   */
  it("keeps both partitions when one account signs straight into another", async () => {
    await writeCached("/api/article/x", { whose: "ada" }, "ada", "x");
    rememberUser("ada");

    /* No `forgetUser` anywhere in here — that is the whole point. */
    rememberUser("bob");
    await writeCached("/api/article/x", { whose: "bob" }, "bob", "x");

    expect((await readCached("/api/article/x", "ada"))?.body).toEqual({ whose: "ada" });
    expect((await readCached("/api/article/x", "bob"))?.body).toEqual({ whose: "bob" });
    rememberUser(null);
  });
});
