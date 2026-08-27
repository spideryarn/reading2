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
  it("round-trips an id and forgets it", () => {
    const held = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => held.get(k) ?? null,
      setItem: (k: string, v: string) => held.set(k, v),
      removeItem: (k: string) => held.delete(k),
    });

    rememberUser("ada");
    expect(lastKnownUser()).toBe("ada");
    rememberUser(null);
    expect(lastKnownUser()).toBeNull();
    vi.unstubAllGlobals();
  });

  it("says nobody, rather than throwing, where there is no localStorage", () => {
    /* Node has none, and a Safari private window *throws on access* rather than
       being absent — so this is the shape both failures take. A reader with no
       storage must get an app that works and no saved copies. */
    expect(lastKnownUser()).toBeNull();
    expect(() => rememberUser("ada")).not.toThrow();
  });
});
