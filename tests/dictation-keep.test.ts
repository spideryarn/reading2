/**
 * **The product's keeper: a dictation on this device until its words are in the
 * box.** docs/plans/260929h-dictation-that-survives-a-closed-tab.md.
 *
 * `fake-indexeddb` for the storage, and a hand-written lock manager for Web
 * Locks — which is the part that decides *which page* may recover a tape, so
 * it is modelled on the spec's two behaviours that matter here: a lock is held
 * for as long as the callback's promise is pending, and `ifAvailable` calls
 * back with `null` rather than waiting.
 *
 * Every test loads the module fresh against a fresh database, so the cached
 * connection inside it cannot carry one test's rows into the next.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Keep = typeof import("../src/web/dictation-keep.js");

/** Web Locks, the two behaviours we rely on. */
class FakeLocks {
  held = new Set<string>();
  private waiting = new Map<string, Array<() => void>>();
  async request(
    name: string,
    opts: { ifAvailable?: boolean },
    cb: (lock: { name: string } | null) => unknown,
  ): Promise<unknown> {
    if (this.held.has(name)) {
      if (opts.ifAvailable) return cb(null);
      await new Promise<void>((go) => this.waiting.set(name, [...(this.waiting.get(name) ?? []), go]));
    }
    this.held.add(name);
    try {
      return await cb({ name });
    } finally {
      this.held.delete(name);
      const next = this.waiting.get(name)?.shift();
      next?.();
    }
  }
  /** The browser releasing a dead tab's locks. */
  dropAll() {
    this.held.clear();
  }
}

let locks: FakeLocks;
let keep: Keep;

async function load(user: string | null = "reader-a") {
  vi.resetModules();
  const store = await import("../src/web/lib/offline-store.js");
  store.rememberUser(user);
  keep = await import("../src/web/dictation-keep.js");
}

/** Let the fire-and-forget writes land. */
async function flush() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

const where = { kind: "article", slug: "the-piece" } as const;
const bytes = (s: string) => new Blob([s], { type: "audio/webm" });
const text = (b: Blob) => b.text();

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  locks = new FakeLocks();
  vi.stubGlobal("navigator", { locks });
  await load();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Record a tape of two parts, and leave it as a page that died would: held, then dropped. */
async function deadPage(box = "feedback", complete = false) {
  const tape = keep.keepDictation(box).begin(where);
  if (!tape) throw new Error("the keeper refused to keep");
  tape.chunk(0, bytes("a1"), "audio/webm");
  tape.chunk(0, bytes("a2"), "audio/webm");
  tape.chunk(1, bytes("b1"), "audio/webm");
  if (complete) tape.complete();
  await flush();
  return tape;
}

describe("keeping a tape", () => {
  it("offers back what a page that died was holding, part by part, in order", async () => {
    await deadPage();
    locks.dropAll();
    await load();
    const found = await keep.keepDictation("feedback").recover();
    expect(found).not.toBeNull();
    expect(found?.where).toEqual(where);
    expect(found?.parts.map((p) => p.mimeType)).toEqual(["audio/webm", "audio/webm"]);
    expect(await Promise.all((found?.parts ?? []).map((p) => text(p.blob)))).toEqual(["a1a2", "b1"]);
    // Never told it finished: the page died mid-sentence.
    expect(found?.complete).toBe(false);
    expect(found?.broken).toBe(false);
  });

  it("says complete only once every recorder finished", async () => {
    await deadPage("feedback", true);
    locks.dropAll();
    const found = await keep.keepDictation("feedback").recover();
    expect(found?.complete).toBe(true);
  });

  it("does not offer a tape another page is still holding", async () => {
    await deadPage();
    // No dropAll: the page that is recording it is alive.
    expect(await keep.keepDictation("feedback").recover()).toBeNull();
  });

  it("offers one tape to one page only", async () => {
    await deadPage();
    locks.dropAll();
    const first = await keep.keepDictation("feedback").recover();
    const second = await keep.keepDictation("feedback").recover();
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    // And once the first lets go without delivering it, it is back.
    first?.tape.release();
    await flush();
    expect(await keep.keepDictation("feedback").recover()).not.toBeNull();
  });

  it("offers a tape only to the box and the reader it was made by", async () => {
    await deadPage("chat:one");
    locks.dropAll();
    expect(await keep.keepDictation("chat:two").recover()).toBeNull();
    await load("reader-b");
    expect(await keep.keepDictation("chat:one").recover()).toBeNull();
    await load("reader-a");
    expect(await keep.keepDictation("chat:one").recover()).not.toBeNull();
  });

  it("keeps nothing without a signed-in reader, or without Web Locks", async () => {
    await load(null);
    expect(keep.keepDictation("feedback").begin(where)).toBeNull();
    await load();
    vi.stubGlobal("navigator", {});
    expect(keep.keepDictation("feedback").begin(where)).toBeNull();
  });

  it("forgets: a delivered tape is never offered again", async () => {
    const tape = await deadPage();
    tape.forget();
    await flush();
    locks.dropAll();
    expect(await keep.keepDictation("feedback").recover()).toBeNull();
  });

  it("marks a tape broken, and recovers it as broken", async () => {
    const tape = await deadPage();
    tape.broken();
    await flush();
    locks.dropAll();
    expect((await keep.keepDictation("feedback").recover())?.broken).toBe(true);
  });

  it("says a part with a missing chunk is not complete", async () => {
    const tape = keep.keepDictation("feedback").begin(where);
    tape?.chunk(0, bytes("a1"), "audio/webm");
    tape?.chunk(0, bytes("a2"), "audio/webm");
    tape?.complete();
    await flush();
    // A write that never landed, simulated by deleting it.
    const db = await new Promise<IDBDatabase>((ok) => {
      const r = indexedDB.open("spideryarn-dictation");
      r.onsuccess = () => ok(r.result);
    });
    await new Promise<void>((ok) => {
      const tx = db.transaction("chunks", "readwrite");
      const store = tx.objectStore("chunks");
      store.openCursor().onsuccess = (e) => {
        (e.target as IDBRequest<IDBCursorWithValue>).result?.delete();
      };
      tx.oncomplete = () => ok();
    });
    db.close();
    locks.dropAll();
    const found = await keep.keepDictation("feedback").recover();
    expect(await text(found?.parts[0]?.blob ?? new Blob())).toBe("a2");
    expect(found?.complete).toBe(false);
  });

  it("reports intact while its writes land", async () => {
    const tape = await deadPage();
    expect(tape.intact()).toBe(true);
    tape.release();
    // Released: no longer this page's to describe as kept.
    expect(tape.intact()).toBe(false);
  });

  it("reports not intact when the database never opens", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("private window");
      },
    });
    await load();
    const tape = keep.keepDictation("feedback").begin(where);
    tape?.chunk(0, bytes("a1"), "audio/webm");
    await flush();
    expect(tape?.intact()).toBe(false);
  });
});

describe("how long a tape stays", () => {
  it("sweeps anybody's tape older than a week, and nothing younger", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now - keep.MAX_AGE_MS - 60_000);
    await deadPage("feedback");
    clock.mockReturnValue(now - 60_000);
    await deadPage("chat:x");
    clock.mockReturnValue(now);
    locks.dropAll();
    await keep.sweepDictations();
    expect(await keep.keepDictation("feedback").recover()).toBeNull();
    expect(await keep.keepDictation("chat:x").recover()).not.toBeNull();
  });

  it("does not sweep an old tape a page is still holding", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now - keep.MAX_AGE_MS - 60_000);
    await deadPage("feedback");
    clock.mockReturnValue(now);
    await keep.sweepDictations();
    locks.dropAll();
    /* Wind the clock back so recovery will look at it at all: it is still
       there, because the sweep left a held tape alone. */
    clock.mockReturnValue(now - 60_000);
    expect(await keep.keepDictation("feedback").recover()).not.toBeNull();
    clock.mockRestore();
  });

  it("a deliberate sign-out deletes that reader's tapes, even one this page holds", async () => {
    await deadPage("feedback");
    await load("reader-b");
    await deadPage("feedback");
    await keep.forgetDictationsOf("reader-a");
    locks.dropAll();
    expect(await keep.keepDictation("feedback").recover()).not.toBeNull();
    await load("reader-a");
    expect(await keep.keepDictation("feedback").recover()).toBeNull();
  });
});
