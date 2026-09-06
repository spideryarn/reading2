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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Cached,
  cachedSlugs,
  forgetUser,
  invalidate,
  lastKnownUser,
  readCached,
  rememberUser,
  reserveTicket,
  writeCached,
} from "../src/web/lib/offline-store.js";

/**
 * Reserve, then write: the two halves api.ts performs either side of a request.
 *
 * Most tests here only need a save to have happened, and this is that. The ones
 * about *which* of two answers is kept reserve their own tickets, in the order
 * the requests went out, and hold them across whatever happens in between —
 * which is the whole subject, and cannot be delegated to a helper that does both
 * in one breath.
 */
async function save(url: string, body: unknown, userId: string, slug = ""): Promise<boolean> {
  return await writeCached(url, body, await reserveTicket(url, userId), slug);
}

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

/* ------------------------------------------------------------------------- *
 *  Version 2, and the tab that will not let go
 *
 *  First in the file on purpose: the database is still on version 1 here — the
 *  raw `open` in `allRows` created it — so this is the only place an upgrade can
 *  be watched happening. Everything below it runs against version 2.
 * ------------------------------------------------------------------------- */

/** A version-1 connection this file holds open, closed even if a test times out. */
let holding: IDBDatabase | null = null;
afterEach(() => {
  holding?.close();
  holding = null;
});

async function rawOpen(): Promise<IDBDatabase> {
  return await new Promise((go, no) => {
    const req = indexedDB.open("spideryarn-offline");
    req.onsuccess = () => go(req.result);
    req.onerror = () => no(req.error);
  });
}

/** Which version the stored database is on, without holding it open. */
async function version(): Promise<number> {
  const db = await rawOpen();
  try {
    return db.version;
  } finally {
    db.close();
  }
}

describe("the upgrade to version 2", () => {
  /**
   * **A tab running yesterday's code can hold the upgrade off indefinitely**,
   * and nothing this page does will make it let go. What this page must not do
   * is wait: `attempt` in api.ts awaits `readCached` when the transport fails,
   * so a blocked open leaves the reader offline with neither their saved copy
   * nor the working no-cache app this module promises. GPT Sol's F3.
   *
   * A freshly imported module instance, because giving up is for the life of the
   * page — the copy every other test in this file uses must not inherit a cache
   * that has been switched off.
   */
  it("settles rather than hanging while an old tab holds it off", async () => {
    /* A row version 1 saved, written raw because the module is the thing under
       test here. */
    await seed([
      {
        key: "ada\n/api/article/legacy",
        userId: "ada",
        url: "/api/article/legacy",
        slug: "legacy",
        body: { from: "version 1" },
        savedAt: 1_000,
        lastOpened: 1_000,
        bytes: 8,
      },
    ]);
    expect(await version()).toBe(1);

    holding = await rawOpen();

    vi.resetModules();
    const fresh = await import("../src/web/lib/offline-store.js");
    const started = realNow();
    expect(await fresh.readCached("/api/article/legacy", "ada")).toBeUndefined();
    /* Not "quick": **bounded**. The number is the module's own deadline plus
       room for a loaded box, and the outcome it rules out is the only other one
       available — never answering at all. */
    expect(realNow() - started).toBeLessThan(8_000);

    /* And now the old tab closes, the upgrade goes through, and what version 1
       saved goes with it. A v1 row carries no ordering metadata, so nothing can
       say whether a response still in flight is older or newer than it (F4); and
       a retirement that could not run while the database was unavailable leaves
       it describing a comment the reader has already deleted (F9). The whole
       argument is in the plan § The upgrade clears what version 1 saved. */
    holding.close();
    holding = null;
    await until("the upgrade to go through", async () => (await version()) === 2);
    expect(await rowFor("/api/article/legacy", "ada")).toBeUndefined();
  }, 10_000);

  it("caches normally once the upgrade has been through", async () => {
    expect(await save("/api/article/after", { fresh: true }, "ada", "after")).toBe(true);
    expect((await readCached("/api/article/after", "ada"))?.body).toEqual({ fresh: true });
  });
});

describe("what one reader saves, another cannot read", () => {
  it("keeps two accounts apart at the same URL", async () => {
    await save("/api/article/x", { whose: "ada" }, "ada", "x");
    await save("/api/article/x", { whose: "bob" }, "bob", "x");

    expect((await readCached("/api/article/x", "ada"))?.body).toEqual({ whose: "ada" });
    expect((await readCached("/api/article/x", "bob"))?.body).toEqual({ whose: "bob" });
  });

  it("returns nothing for a reader who saved nothing", async () => {
    await save("/api/article/x", { whose: "ada" }, "ada", "x");
    expect(await readCached("/api/article/x", "cleo")).toBeUndefined();
  });

  it("returns nothing when nobody is signed in", async () => {
    await save("/api/article/x", { whose: "ada" }, "ada", "x");
    expect(await readCached("/api/article/x", null)).toBeUndefined();
  });

  it("signing out takes that reader's copies and leaves the other's", async () => {
    await save("/api/article/x", { whose: "ada" }, "ada", "x");
    await save("/api/article/x", { whose: "bob" }, "bob", "x");

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
      await save(`/api/article/a${i}`, { i }, "ada", `a${i}`);
      await save(`/api/glossary/a${i}`, { i }, "ada", `a${i}`);
    }

    /* `a0` was written first and never touched again, so it is the oldest. */
    expect(await readCached("/api/article/a0", "ada")).toBeUndefined();
    expect(await readCached("/api/glossary/a0", "ada")).toBeUndefined();

    /* And the newest is entirely present — never half of it. */
    expect(await readCached("/api/article/a100", "ada")).toBeDefined();
    expect(await readCached("/api/glossary/a100", "ada")).toBeDefined();
  });

  it("reading an article keeps it alive", async () => {
    for (let i = 0; i < 60; i++) await save(`/api/article/b${i}`, { i }, "ada", `b${i}`);
    /* Touch the oldest, which should now outrank everything written before the
       ones that follow. */
    await readCached("/api/article/b0", "ada");
    for (let i = 60; i < 101; i++) await save(`/api/article/b${i}`, { i }, "ada", `b${i}`);

    expect(await readCached("/api/article/b0", "ada")).toBeDefined();
    expect(await readCached("/api/article/b1", "ada")).toBeUndefined();
  });

  it("does not evict the shelf, which belongs to no article", async () => {
    await save("/api/library", [{ slug: "x" }], "ada");
    for (let i = 0; i < 120; i++) await save(`/api/article/c${i}`, { i }, "ada", `c${i}`);

    expect((await readCached("/api/library", "ada"))?.body).toEqual([{ slug: "x" }]);
  });
});

describe("a write throws its copy away", () => {
  it("clears everything under the prefix, for that reader only", async () => {
    await save("/api/chat/x", { threads: 2 }, "ada", "x");
    await save("/api/chat/x", { threads: 9 }, "bob", "x");
    await save("/api/article/x", { prose: true }, "ada", "x");

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
    await save("/api/article/whole", { prose: true }, "ada", "whole");
    /* A glossary whose article was never cached, or has since been evicted. */
    await save("/api/glossary/partial", { terms: [] }, "ada", "partial");

    const held = await cachedSlugs("ada");
    expect([...held]).toEqual(["whole"]);
  });

  it("tells one reader nothing about another's", async () => {
    await save("/api/article/hers", { prose: true }, "ada", "hers");
    expect([...(await cachedSlugs("bob"))]).toEqual([]);
  });
});

/**
 * **The same two answers, committed in each order.**
 *
 * This used to forge a `savedAt` sixty seconds in the future onto a stored row
 * and check that `writeCached` declined to overwrite it. Its own docstring said
 * what was wrong with that: a forged future stamp is a *clock* inversion, the
 * defect is a *completion* inversion, and the test could not tell them apart —
 * it pinned the `existing.savedAt > now` comparison, which is the thing the
 * fence replaces. There is no clock in the decision any more, so there is
 * nothing left there to pin.
 *
 * What replaces it is the same promise, made of the mechanism that now keeps it,
 * and **written as a pair on purpose**: the two cases differ in nothing but
 * which ticket commits first, and they come out differently — `false` and the
 * older body refused, `true` and both landing. Neither can be passing because
 * the fence refuses everything, and neither can be passing because it refuses
 * nothing.
 */
describe("an older reply cannot overwrite a newer one", () => {
  it("refuses the older ticket when the newer one has already landed", async () => {
    const older = await reserveTicket("/api/article/x", "ada");
    const newer = await reserveTicket("/api/article/x", "ada");

    expect(await writeCached("/api/article/x", { which: "new" }, newer, "x")).toBe(true);
    /* Answering last does not make it fresher, and `false` is what stops
       anything on screen claiming this copy was kept. */
    expect(await writeCached("/api/article/x", { which: "old" }, older, "x")).toBe(false);

    expect((await readCached("/api/article/x", "ada"))?.body).toEqual({ which: "new" });
  });

  it("takes them both when they land in the order they were asked", async () => {
    const older = await reserveTicket("/api/article/y", "ada");
    const newer = await reserveTicket("/api/article/y", "ada");

    expect(await writeCached("/api/article/y", { which: "old" }, older, "y")).toBe(true);
    expect(await writeCached("/api/article/y", { which: "new" }, newer, "y")).toBe(true);

    expect((await readCached("/api/article/y", "ada"))?.body).toEqual({ which: "new" });
  });

  /**
   * **And the input the removed test used, with the expectation the fence
   * corrects.**
   *
   * The pair above covers both commit orders, but under their ordinary
   * timestamps it would stay green with `existing.savedAt > now` put back
   * alongside the sequence fence — so it does not prove the clock is gone. This
   * is the old setup, a stored row forged sixty seconds into the future, and the
   * answer the old test wanted from it is now the wrong one: a ticket issued
   * later must land, whatever the wall clock has done since. Sol's F17.
   */
  it("takes a later ticket over a row stamped in the future", async () => {
    const first = await reserveTicket("/api/article/w", "ada");
    expect(await writeCached("/api/article/w", { which: "old" }, first, "w")).toBe(true);

    /* A clock adjustment between the two saves, forged straight onto the stored
       row: sixty seconds ahead of anything the next write will stamp. */
    const stored = await rowFor("/api/article/w", "ada");
    expect(stored).toBeDefined();
    await seed([{ ...(stored as Cached), savedAt: Date.now() + 60_000 }]);

    const later = await reserveTicket("/api/article/w", "ada");
    expect(await writeCached("/api/article/w", { which: "new" }, later, "w")).toBe(true);
    expect((await readCached("/api/article/w", "ada"))?.body).toEqual({ which: "new" });
  });

  /** A ticket taken for one URL cannot file a body under another. */
  it("refuses a ticket that was taken for a different URL", async () => {
    const elsewhere = await reserveTicket("/api/article/somewhere-else", "ada");
    expect(await writeCached("/api/article/z", { which: "misfiled" }, elsewhere, "z")).toBe(false);
    expect(await readCached("/api/article/z", "ada")).toBeUndefined();
  });
});

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
  await save("/api/article/__fence__", { n: ++fences }, "fence", "__fence__");
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

/**
 * Take the database to version 2 before anything is seeded into it.
 *
 * **Without this a seeding test can pass having tested nothing.** A raw
 * `indexedDB.open` with no version creates the database at version 1 when there
 * isn't one, and the module's own v1 → v2 upgrade then *clears* the rows we just
 * put there — so a cache seeded full is empty by the time the code under test
 * looks, eviction never triggers, and the assertion is met by an absence. In a
 * whole-file run the upgrade describe above has already been through, which is
 * why this only bites when a test is run alone with `-t`, and why it is worth a
 * helper rather than an ordering everybody has to know about. The same trap is
 * written up in tests/cache-issue-order.test.ts.
 * docs/reusable/silent-success.md.
 *
 * Not folded into `seed` itself: the upgrade describe seeds a version-1 row on
 * purpose, and booting the module there would upgrade the database out from
 * under the thing it is testing.
 */
async function onVersion2(): Promise<void> {
  await readCached("/api/article/__boot__", "boot");
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
   *
   * The response's ticket is taken before either, because that is when its
   * request went out; and it has to be, for the write's transaction to be
   * created between the read's and the touch's rather than behind both.
   */
  it("cannot put an old body back over one saved while it was reading", async () => {
    const stop = tickingClock();
    try {
      await save("/api/article/x", { which: "old" }, "ada", "x");
      const arriving = await reserveTicket("/api/article/x", "ada");

      const reading = readCached("/api/article/x", "ada");
      const saving = writeCached("/api/article/x", { which: "new" }, arriving, "x");
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
    await save("/api/chat/x", { threads: 2 }, "ada", "x");
    /* A second row under the same prefix that nobody reads, so that "the row is
       back" cannot be confused with "the invalidation never happened". */
    await save("/api/chat/x/t-9", { thread: 9 }, "ada", "x");

    const clearing = invalidate("/api/chat/x", "ada");
    const reading = readCached("/api/chat/x", "ada");
    await Promise.all([clearing, reading]);
    await fence();

    expect(await rowFor("/api/chat/x/t-9", "ada")).toBeUndefined();
    expect(await rowFor("/api/chat/x", "ada")).toBeUndefined();
  });

  /** The same, against sign-out, where the row is not ours to keep at all. */
  it("cannot bring back a row a sign-out deleted while it was reading", async () => {
    await save("/api/article/x", { whose: "ada" }, "ada", "x");
    /* Ada's, and unread, for the same reason as above. */
    await save("/api/glossary/x", { whose: "ada" }, "ada", "x");
    await save("/api/article/x", { whose: "bob" }, "bob", "x");

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
    await onVersion2();
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

    /* Both requests went out before any of this: eviction must not be able to
       delete an article on the strength of a list taken while one of them was
       still on its way. */
    const rescuing = await reserveTicket("/api/article/e50", "ada");

    /* One more article takes the count to 151, so the fifty-one oldest are
       doomed: e0 through e50. */
    const evicting = save("/api/article/trigger", { t: 1 }, "ada", "trigger");

    /* e0 is the oldest and goes first, so its absence says the delete loop is
       running — and a hundred deletes short of e50. Watched for, not slept for. */
    await until(
      "eviction to start deleting",
      async () => !(await rowFor("/api/article/e0", "ada")),
    );

    const rescued = writeCached("/api/article/e50", { which: "fresh" }, rescuing, "e50");
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

describe("eviction cannot delete the article it was just given", () => {
  /**
   * A cache at exactly the cap, every row stamped the same, so that the article
   * saved next is the hundred-and-first and precisely one has to go.
   *
   * The slugs sort **after** `a-new` by key, which is what makes the tie case
   * below deterministic: the `lastOpened` index orders equal stamps by primary
   * key, so the row written last is the one ranked oldest.
   */
  async function full(stamped: number): Promise<void> {
    await onVersion2();
    const rows: Cached[] = [];
    for (let i = 0; i < 100; i++) {
      const slug = `f${String(i).padStart(3, "0")}`;
      const url = `/api/article/${slug}`;
      rows.push({
        key: `ada\n${url}`,
        userId: "ada",
        url,
        slug,
        body: { i },
        savedAt: stamped,
        lastOpened: stamped,
        bytes: 8,
      });
    }
    await seed(rows);
  }

  /**
   * **A `true` for a body eviction then deleted**, from the same call.
   *
   * `writeCached` stamps its row with `Date.now()` and eviction ranks by that
   * wall clock, so a clock that has gone backwards — a laptop waking on a
   * corrected time, an NTP step — ranks the article the reader has this second
   * been handed as the least recently used thing on the device. It is deleted by
   * the eviction the same call performs, and the call still answers `true`:
   * *"the one thing this must not do is report a success it did not have"*. F14.
   */
  it("keeps what it just saved when the clock has gone backwards", async () => {
    await full(2_000);

    const spy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      expect(await save("/api/article/a-new", { which: "fresh" }, "ada", "a-new")).toBe(true);
    } finally {
      spy.mockRestore();
    }

    expect((await rowFor("/api/article/a-new", "ada"))?.body).toEqual({ which: "fresh" });
    /* And the cap is still enforced — the next candidate went instead, so this
       cannot be passing because eviction has quietly stopped happening. */
    expect(await rowFor("/api/article/f000", "ada")).toBeUndefined();
  });

  /**
   * **The same, with no clock inversion at all**: a hundred and one rows written
   * inside one millisecond. The index orders equal stamps by primary key, and
   * the sort that ranks them is stable, so which article is "oldest" is decided
   * by a string comparison of URLs. F14.
   */
  it("keeps what it just saved when every stamp is identical", async () => {
    await full(1_000);

    const spy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      expect(await save("/api/article/a-new", { which: "fresh" }, "ada", "a-new")).toBe(true);
    } finally {
      spy.mockRestore();
    }

    expect((await rowFor("/api/article/a-new", "ada"))?.body).toEqual({ which: "fresh" });
    expect(await rowFor("/api/article/f000", "ada")).toBeUndefined();
  });

  /**
   * **The eviction that deletes it is the one running for the write next door.**
   *
   * Sparing our own article closes the two cases above and no more: each
   * eviction is told one slug, its own, so two commits landing together take the
   * cache to a hundred and two and the first eviction to finish drops *two* —
   * and the second write's article is one it is perfectly entitled to choose.
   * That write then answers `true` for a row that has already gone, which is
   * *"the one thing this must not do"*. Sol reproduced it as `secondAccepted:
   * true, secondPresent: false`. F14, second round.
   *
   * **The interleaving is forced, not hoped for.** Both commits are created
   * while `responses` is held by another connection, so they queue in the order
   * they were created; when the lock goes the first commits, and the eviction it
   * then starts is created *after* the second commit's transaction and so runs
   * behind it, over a cache of a hundred and two. IndexedDB runs overlapping
   * `readwrite` transactions in creation order, which makes that an ordering
   * guarantee rather than a race: commit, commit, evict, evict.
   *
   * Both new rows are stamped a second before the seeded hundred, so the second
   * write's article is the least recently used thing the first write's eviction
   * is allowed to take.
   */
  it("does not report a success the write beside it has just evicted", async () => {
    await full(2_000);
    const other = await rawOpen();
    holding = other;
    let release: (() => Promise<void>) | null = null;
    /* Both new rows older than everything seeded, and equal to each other. */
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      /* Both requests went out before either reply came back, which is what
         makes this two writes racing rather than one after the other. */
      const first = await reserveTicket("/api/article/a-first", "ada");
      const second = await reserveTicket("/api/article/a-second", "ada");
      if (!first || !second) throw new Error("no ticket: the cache is off");

      release = lockResponses(other);
      const writingFirst = writeCached("/api/article/a-first", { n: 1 }, first, "a-first");
      /* Waited for the way the deadline test waits: ten macrotask turns is well
         past the two or three `writeCached` needs to reach
         `instance.transaction(...)`, and a turn too few shows up as a red
         assertion below rather than as a green test of nothing. */
      for (let i = 0; i < 10; i++) await new Promise((go) => setTimeout(go, 0));
      const writingSecond = writeCached("/api/article/a-second", { n: 2 }, second, "a-second");
      for (let i = 0; i < 10; i++) await new Promise((go) => setTimeout(go, 0));

      /* Both commits are now queued, in that order. Letting go starts them. */
      await release();
      release = null;
      const [acceptedFirst, acceptedSecond] = await Promise.all([writingFirst, writingSecond]);

      /* The first write is untouched by any of this: its own eviction spares its
         own article, which is what the two tests above pin. */
      expect([acceptedFirst, (await rowFor("/api/article/a-first", "ada"))?.body]).toEqual([
        true,
        { n: 1 },
      ]);
      /* And the second is told what actually happened to it. */
      expect([acceptedSecond, await rowFor("/api/article/a-second", "ada")]).toEqual([
        false,
        undefined,
      ]);
      /* Gone because it was deleted, not because the fence refused it: eviction
         leaves the `commit` row behind, so this says the body did land first.
         Without it, a write that never happened would satisfy the line above. */
      expect(await commitSeq("ada", "/api/article/a-second")).toBe(second.seq);
      /* The other article the same eviction took, and the count it took them
         down to — so this cannot be passing on an eviction that ran wild, or one
         that has quietly stopped running at all. */
      expect(await rowFor("/api/article/f000", "ada")).toBeUndefined();
      expect((await everything()).length).toBe(100);
    } finally {
      clock.mockRestore();
      await release?.();
      other.close();
      holding = null;
    }
  }, 15_000);
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
   * **A note on where the fence is read.** The reply's ticket is taken before
   * `forgetUser` is called, because that is when its request went out, and what
   * refuses it is the epoch the retirement advances.
   *
   * Under the rejected timestamp design this test also pinned *when* that mark
   * was written — the write carried a stamp taken between the call and the
   * deletes, so advancing at the top of `forgetUser` let it through and
   * advancing with the deletes did not. With an epoch it no longer tells those
   * two apart: a ticket taken before the call is refused wherever inside
   * `forgetUser` the epoch moves. The plan's *"one transaction: the deletes,
   * their `commit` rows and the epoch"* is still the right build, for the
   * failure this cannot show — a half-done retirement, where deletes without an
   * advance leave every reply in flight free to refill the cache, and an advance
   * without the deletes leaves bodies a fresh ticket will happily read.
   */
  it("does not let a reply in flight survive the sign-out it arrived after", async () => {
    await save("/api/article/x", { whose: "ada" }, "ada", "x");
    await save("/api/article/x", { whose: "bob" }, "bob", "x");
    const landed = await reserveTicket("/api/glossary/x", "ada");

    /* Sign-out first, and the reply behind it: `forgetUser` takes its list
       before this write commits, so the row it writes is not on it. */
    const gone = forgetUser("ada");
    const landing = writeCached("/api/glossary/x", { whose: "ada" }, landed, "x");
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
    await save("/api/article/x", { whose: "ada" }, "ada", "x");
    await forgetUser("ada");

    expect(await save("/api/article/x", { whose: "ada, again" }, "ada", "x")).toBe(true);
    expect((await readCached("/api/article/x", "ada"))?.body).toEqual({ whose: "ada, again" });
  });

  /**
   * **The control: a direct A→B switch retires nothing.** `forgetUser` runs only
   * on a null session, so signing straight from one account into another never
   * calls it — and both partitions have to survive intact, or the fence has
   * turned an account switch into a cache wipe.
   */
  it("keeps both partitions when one account signs straight into another", async () => {
    await save("/api/article/x", { whose: "ada" }, "ada", "x");
    rememberUser("ada");

    /* No `forgetUser` anywhere in here — that is the whole point. */
    rememberUser("bob");
    await save("/api/article/x", { whose: "bob" }, "bob", "x");

    expect((await readCached("/api/article/x", "ada"))?.body).toEqual({ whose: "ada" });
    expect((await readCached("/api/article/x", "bob"))?.body).toEqual({ whose: "bob" });
    rememberUser(null);
  });
});

/* ------------------------------------------------------------------------- *
 *  The ordering metadata, and the one thing that bounds it
 * ------------------------------------------------------------------------- */

/** `commit` rows straight into the store, to stand in for a long history. */
async function seedCommits(userId: string, howMany: number): Promise<void> {
  const db = await rawOpen();
  try {
    await new Promise<void>((go, no) => {
      const tx = db.transaction("meta", "readwrite");
      for (let i = 0; i < howMany; i++) {
        tx.objectStore("meta").put({
          key: `commit\n${userId}\n/api/article/old-${i}`,
          kind: "commit",
          seq: i + 1,
        });
      }
      tx.oncomplete = () => go();
      tx.onerror = () => no(tx.error);
    });
  } finally {
    db.close();
  }
}

async function commitKeys(userId: string): Promise<string[]> {
  const db = await rawOpen();
  try {
    const keys = await new Promise<IDBValidKey[]>((go, no) => {
      const req = db.transaction("meta").objectStore("meta").getAllKeys();
      req.onsuccess = () => go(req.result);
      req.onerror = () => no(req.error);
    });
    return keys.filter((k): k is string => typeof k === "string" && k.startsWith(`commit\n${userId}\n`));
  } finally {
    db.close();
  }
}

describe("commit rows do not accumulate forever", () => {
  /**
   * **The sweep, and the cost that decides where its threshold goes.**
   *
   * Eviction deletes a body and leaves its `commit` row, on purpose — that row
   * is the ordering baseline, and resetting it would let an old response win an
   * empty slot. So something has to bound them, and the bound is: on crossing
   * the threshold, *all* of that owner's commit rows go, and the epoch advances
   * once to make that safe.
   *
   * What that costs is asserted here rather than left to be discovered: every
   * ticket outstanding for that owner is refused, so an article half-fetched at
   * that moment ends up half-cached. Sweeping only the rows whose article has
   * gone would avoid it and is not a bound at all — it can delete nothing, stay
   * over the threshold, and repeat on every later commit. F11.
   */
  it("drops them all at once, and refuses the tickets they were the baseline for", async () => {
    const inFlight = await reserveTicket("/api/article/mid-air", "ada");
    /* Up to the threshold exactly, counting what the tests above left behind —
       `beforeEach` clears the bodies and not the ordering metadata, which is
       itself the point: these rows outlive the rows they order. */
    await seedCommits("ada", 2_000 - (await commitKeys("ada")).length);
    expect((await commitKeys("ada")).length).toBe(2_000);

    /* The commit that crosses the threshold succeeds — the sweep is not a
       refusal, it is what happens afterwards. */
    expect(await save("/api/article/crossing", { t: 1 }, "ada", "crossing")).toBe(true);
    expect(await commitKeys("ada")).toEqual([]);

    expect(await writeCached("/api/article/mid-air", { late: true }, inFlight, "mid-air")).toBe(
      false,
    );
    /* And the reader's next request caches normally: the epoch moved on, it did
       not switch anything off. */
    expect(await save("/api/article/mid-air", { late: true }, "ada", "mid-air")).toBe(true);
  });
});

/* ------------------------------------------------------------------------- *
 *  A retirement that cannot be shown to have happened
 *
 *  `invalidate` and `forgetUser` both go through `retire`, and `retire` fails
 *  closed: no database, a throw, or a transaction that outlives `DEADLINE_MS`
 *  and is aborted, and it calls `abandon` — the cache off for the rest of the
 *  page, and the database deleted. F9. A body that should have been deleted and
 *  was not is one we go on serving offline as a synthetic 200, so this is the
 *  branch that stops the reader being shown a comment they deleted.
 *
 *  **Last in the file, and it has to be.** `abandon` deletes the database, and
 *  `deleteDatabase` fires `versionchange` at every open connection — including
 *  the one held by the static import at the top of this file, whose `blocking`
 *  handler closes it and switches *that* copy of the module off. Measured, not
 *  assumed: once the deletion has been through, the statically imported
 *  `reserveTicket` answers `null` and `writeCached` answers `false` for ever
 *  after. So the last test here would poison anything that followed it, and the
 *  answer is to have nothing follow rather than to be careful.
 *
 *  Within the block the order is deliberate too: the control first, while the
 *  database is whole; then the one that never touches it; then the one that
 *  deletes it.
 *
 *  Each test takes **its own module instance**, because giving up is for the
 *  life of a page and these tests end three of them.
 * ------------------------------------------------------------------------- */

/** A freshly loaded copy of the module: its own `off`, its own handle, no history. */
async function freshStore(): Promise<typeof import("../src/web/lib/offline-store.js")> {
  vi.resetModules();
  return await import("../src/web/lib/offline-store.js");
}

/**
 * Hold `responses` locked from a second connection, the way another tab does.
 *
 * A `readwrite` transaction commits the moment it runs out of requests, so
 * holding one open means keeping it busy: each `get` schedules the next from its
 * own success handler. Every transaction the module opens over that store
 * afterwards — `retire`'s included — queues behind this one and never starts,
 * which is exactly the state F10 is about and the one an open deadline cannot
 * see. Releasing resolves when the transaction has actually finished, so nothing
 * here has to guess with a sleep.
 */
function lockResponses(db: IDBDatabase): () => Promise<void> {
  const tx = db.transaction("responses", "readwrite");
  const store = tx.objectStore("responses");
  const finished = new Promise<void>((go) => {
    tx.oncomplete = () => go();
    tx.onabort = () => go();
  });
  let keep = true;
  const spin = () => {
    if (!keep) return;
    store.get("nobody").onsuccess = spin;
  };
  spin();
  return async () => {
    keep = false;
    await finished;
  };
}


describe("a public call gets one deadline, not one per transaction", () => {
  /**
   * **`writeCached` opens three things in a row**, and each of them used to
   * start its own three-second clock: the open, the commit, and the eviction
   * afterwards. Sol measured a single call at 5004 ms, and the deadline test
   * below it permitted anything under ten seconds, so nothing said otherwise.
   *
   * Two locks, from two connections, and the order they are created in is what
   * makes the measurement mean something. The first holds `responses` while the
   * commit's transaction is created and queues behind it; the second is created
   * *after* that transaction, so it queues behind the commit and is holding the
   * store by the time eviction wants it. Let the first go at two seconds and the
   * call spends two waiting to commit and then meets a store it will never get:
   * one budget says it gives up at three seconds, one budget per transaction
   * says five. F15.
   */
  it("bounds the whole of a write, not each transaction inside it", async () => {
    /* Before the raw connections, or they are version-1 ones holding the
       upgrade off and this measures that instead of the locks it means to.
       Run alone it did exactly that. F19. */
    await onVersion2();
    const first = await rawOpen();
    const second = await rawOpen();
    holding = first;
    let releaseFirst: (() => Promise<void>) | null = null;
    let releaseSecond: (() => Promise<void>) | null = null;
    let letGo: ReturnType<typeof setTimeout> | undefined;
    try {
      const ticket = await reserveTicket("/api/article/slow", "ada");
      releaseFirst = lockResponses(first);

      const began = realNow();
      const writing = writeCached("/api/article/slow", { slow: true }, ticket, "slow");

      /* Waited for rather than guessed at: the commit's transaction is created a
         few turns into the call, and the second lock has to be created after it
         to queue behind it. Ten macrotask turns is well past the two or three
         `writeCached` needs to reach `instance.transaction(...)`. */
      for (let i = 0; i < 10; i++) await new Promise((go) => setTimeout(go, 0));
      releaseSecond = lockResponses(second);
      letGo = setTimeout(() => void releaseFirst?.(), 2_000);

      const kept = await writing;
      const took = realNow() - began;

      /* It did commit — eviction failing on its own is F7's promise, and if this
         were `false` the call would have been bounded by giving up early. */
      expect(kept).toBe(true);
      /* And it waited, so this is the blocked path and not some other refusal. */
      expect(took).toBeGreaterThanOrEqual(2_000);
      /* One budget. Two would be a shade over five seconds. */
      expect(took).toBeLessThan(4_200);
    } finally {
      clearTimeout(letGo);
      await releaseFirst?.();
      await releaseSecond?.();
      first.close();
      second.close();
      holding = null;
    }
  }, 25_000);
});

/**
 * Make one `put` throw where the code has no reason to expect it to.
 *
 * **Synchronously, which is the whole point.** A request that fails fires an
 * error event and aborts its own transaction; a `put` that throws on the way in
 * — a value the structured clone refuses, a store that has gone away — leaves
 * the transaction alive with nothing pending, and a transaction with nothing
 * pending **commits**. So this is not "IndexedDB errors are handled"; it is the
 * one failure shape that reaches the auto-commit. F16.
 */
function faultOn(store: string, kind: string): () => void {
  const real = IDBObjectStore.prototype.put;
  const spy = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === store && (value as { kind?: string } | null)?.kind === kind) {
        throw new Error(`injected: ${store} refused a ${kind} row`);
      }
      return real.call(this, value, key);
    });
  return () => spy.mockRestore();
}

/** The sequence the `commit` row for one URL holds, read raw. */
async function commitSeq(userId: string, url: string): Promise<number | undefined> {
  const db = await rawOpen();
  try {
    const row = await new Promise<{ seq?: number } | undefined>((go, no) => {
      const req = db.transaction("meta").objectStore("meta").get(`commit\n${userId}\n${url}`);
      req.onsuccess = () => go(req.result as { seq?: number } | undefined);
      req.onerror = () => no(req.error);
    });
    return row?.seq;
  } finally {
    db.close();
  }
}

describe("a transaction that fails half-way keeps none of it", () => {
  /**
   * **A body without the `commit` row that orders it is worse than no body.**
   *
   * `bounded` turned a rejected `work` straight into `{ ok: false }` and only the
   * *timer* aborted anything, so a throw after the response `put` had landed left
   * a transaction with nothing pending — which commits. The cache then held the
   * new body under an ordering row that still named the older ticket, and the
   * older reply, arriving afterwards, was accepted and overwrote it. Sol's F16,
   * reproduced by injecting a failure on the `meta` commit row.
   */
  it("does not keep a body whose commit row could not be written", async () => {
    const first = await reserveTicket("/api/article/partial", "ada");
    expect(await writeCached("/api/article/partial", { which: "old" }, first, "partial")).toBe(
      true,
    );

    const newer = await reserveTicket("/api/article/partial", "ada");
    const stop = faultOn("meta", "commit");
    try {
      expect(
        await writeCached("/api/article/partial", { which: "new" }, newer, "partial"),
      ).toBe(false);
    } finally {
      stop();
    }

    /* Both stores as they were: the response the failed write had already put ... */
    expect((await rowFor("/api/article/partial", "ada"))?.body).toEqual({ which: "old" });
    /* ... and the ordering row it never got to move. */
    expect(await commitSeq("ada", "/api/article/partial")).toBe(first?.seq);
  });

  /**
   * **And the same shape in a retirement, where it is the containment itself.**
   *
   * `retire` deletes the bodies, deletes their `commit` rows and advances the
   * epoch in one transaction, because a half-done retirement is deletes without
   * an advance — every reply in flight free to refill the cache — or an advance
   * without the deletes. A throw on the epoch `put` is exactly that half, and
   * without the abort it commits.
   *
   * `deleteDatabase` is stubbed so there is something left to look at:
   * `retire` cannot tell this from any other failure and gives the cache up, F9,
   * which is asserted here too rather than merely tolerated.
   */
  it("does not delete a retirement's rows when its epoch cannot be advanced", async () => {
    const store = await freshStore();
    const ticket = await store.reserveTicket("/api/chat/keep", "ada");
    expect(await store.writeCached("/api/chat/keep", { threads: 2 }, ticket, "keep")).toBe(true);
    const before = await commitKeys("ada");
    expect(before).toContain("commit\nada\n/api/chat/keep");

    const asked: string[] = [];
    const deleting = vi
      .spyOn(indexedDB, "deleteDatabase")
      .mockImplementation(((name: string) => {
        asked.push(name);
        return {} as IDBOpenDBRequest;
      }) as typeof indexedDB.deleteDatabase);
    const stop = faultOn("meta", "epoch");
    try {
      await store.forgetUser("ada");
    } finally {
      stop();
      deleting.mockRestore();
    }

    /* Both stores, and it has to be both: the bodies the deletes had already
       taken ... */
    expect((await rowFor("/api/chat/keep", "ada"))?.body).toEqual({ threads: 2 });
    /* ... and every `commit` row that went with them. */
    expect(await commitKeys("ada")).toEqual(before);
    /* And the cache is given up all the same — a retirement that cannot be shown
       to have happened is F9's failure whether or not it rolled back cleanly. */
    await until("the database to be given up", async () => asked.length > 0);
  });
});

describe("a retirement that cannot be shown to have happened takes the cache with it", () => {
  /**
   * **The control, and it comes first on purpose.**
   *
   * Everything below asserts that the cache is off, and *the cache is off* is
   * what a cache that was never on says too. This is the same recipe — a fresh
   * module instance, a real database, a retirement — with nothing forced to
   * fail, and it has to come out the other way: the rows under the prefix gone,
   * and the cache still there to be written to afterwards.
   */
  it("goes on caching when the retirement goes through", async () => {
    const store = await freshStore();

    const ticket = await store.reserveTicket("/api/chat/x", "ada");
    expect(ticket).not.toBeNull();
    expect(await store.writeCached("/api/chat/x", { threads: 2 }, ticket, "x")).toBe(true);

    await store.invalidate("/api/chat/x", "ada");
    /* The other entry point into `retire`, on an owner who has nothing: a
       retirement with no rows to delete is still a retirement that happened. */
    await store.forgetUser("bob");

    /* It did retire — the row is gone ... */
    expect(await store.readCached("/api/chat/x", "ada")).toBeUndefined();
    /* ... and it did not abandon. */
    const after = await store.reserveTicket("/api/article/x", "ada");
    expect(after).not.toBeNull();
    expect(await store.writeCached("/api/article/x", { prose: true }, after, "x")).toBe(true);
    expect((await store.readCached("/api/article/x", "ada"))?.body).toEqual({ prose: true });
    expect((await indexedDB.databases()).map((d) => d.name)).toContain("spideryarn-offline");
  });

  /**
   * **No database is not a reason to carry on.**
   *
   * `retire` opens, gets `null`, and cannot show that anything was deleted — so
   * it abandons, and the deletion request is what says so. A Safari private
   * window is the shape used here because it is the one the module documents:
   * `indexedDB` is present and *throws on use*, which `start` catches and turns
   * into the same `null` a missing `indexedDB` gives. Present rather than
   * missing also leaves something for `abandon` to call, and **that call is the
   * load-bearing assertion**: with no database there was never a working cache
   * to watch stop working, so "the cache is off" would be true here whatever
   * `retire` did.
   */
  it("abandons when there is no database to retire anything in", async () => {
    const asked: string[] = [];
    const store = await (async () => {
      vi.stubGlobal("indexedDB", {
        open() {
          throw new Error("SecurityError");
        },
        deleteDatabase(name: string) {
          asked.push(name);
        },
      });
      try {
        const fresh = await freshStore();
        await fresh.forgetUser("ada");
        /* `abandon` does its closing and deleting in an async block it does not
           await, so this is watched for rather than assumed to have happened by
           the time `forgetUser` returned. */
        await until("the database to be deleted", async () => asked.length > 0);
        return fresh;
      } finally {
        vi.unstubAllGlobals();
      }
    })();

    expect(asked).toEqual(["spideryarn-offline"]);
    /* Storage is back, and it makes no difference: giving up is for the page.
       Not a discriminating assertion on its own — the memoised handle would
       answer `null` here too — but it is the promise the module makes. */
    expect(await store.reserveTicket("/api/article/x", "ada")).toBeNull();
  });

  /**
   * **And a retirement still waiting when the deadline passes.**
   *
   * The one F10 is about: a handle exists, so nothing about opening is in
   * question, and the transaction simply queues behind a `readwrite` another tab
   * is holding open. `bounded` aborts it at three seconds and `retire` cannot
   * tell that from any other failure, which is the point — it did not delete the
   * bodies, so it gives the cache up.
   *
   * Three real seconds, and they are not negotiable: shortening this with a
   * test-only deadline or a mock of the module's internals would leave the
   * actual path — a real abort of a real queued transaction — unexercised, which
   * is the state this test exists to end.
   *
   * The cache is proved **on** immediately beforehand, with the same three calls
   * that are asserted off afterwards, so what is observed is the transition.
   */
  it("abandons when the retirement runs past its deadline", async () => {
    /* Assigned to the file's `holding` so that its `afterEach` closes this
       connection even if an assertion below throws first. */
    const holder = await rawOpen();
    holding = holder;
    let release: (() => Promise<void>) | null = null;
    try {
      const store = await freshStore();

      const before = await store.reserveTicket("/api/chat/x", "ada");
      expect(before).not.toBeNull();
      expect(await store.writeCached("/api/chat/x", { threads: 2 }, before, "x")).toBe(true);
      expect((await store.readCached("/api/chat/x", "ada"))?.body).toEqual({ threads: 2 });

      release = lockResponses(holder);

      const began = realNow();
      await store.invalidate("/api/chat/x", "ada");
      const took = realNow() - began;
      /* It waited the deadline out rather than failing on the spot — so this is
         the timeout branch and not some other refusal ... */
      expect(took).toBeGreaterThanOrEqual(2_500);
      /* ... and it did settle **within one budget**, which is the other half of
         F10: a reader whose network has just failed is waiting behind this. Ten
         seconds was the old bound and it asserted nothing — three transactions'
         worth of deadline fits inside it, which is the shape F15 turned out to
         be. */
      expect(took).toBeLessThan(4_500);

      /* Let go, so the deletion `abandon` has already asked for can proceed. */
      await release();
      release = null;
      holder.close();
      holding = null;

      /* Off — the same three calls that worked a moment ago. */
      expect(await store.reserveTicket("/api/chat/x", "ada")).toBeNull();
      expect(await store.writeCached("/api/chat/x", { threads: 3 }, before, "x")).toBe(false);
      expect(await store.readCached("/api/chat/x", "ada")).toBeUndefined();

      /* And gone, not merely flagged. That is the half a page-scoped flag cannot
         cover: a copy we failed to clear would otherwise still be there on the
         next page load, with nothing left that remembers it should not be. */
      await until("the database to be deleted", async () =>
        (await indexedDB.databases()).every((d) => d.name !== "spideryarn-offline"),
      );
    } finally {
      await release?.();
      holder.close();
      holding = null;
    }
  }, 25_000);
});
