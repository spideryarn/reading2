/**
 * **The Chrome extension hands a captured page only to the tab it opened for
 * it, and our page only takes one from an extension it trusts, for the reader
 * it was opened for** — extension/src/handoff.ts, extension/manifest.ts,
 * src/web/extension-handoff.ts, src/web/AddFromExtension.tsx § `receive`.
 * docs/plans/261024q-chrome-extension-one-click-add-the-page.md, and GPT Sol's
 * plan review (F1, F3, F4, F5) for the cases below.
 *
 * Each refusal has its positive control beside it: the same message from the
 * right sender, which does get the page, so a refusal here is the check and
 * not a store that was empty anyway.
 */
import { createHash } from "node:crypto";

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEV_EXTENSION_ID,
  DEV_KEY,
  manifestFor,
  originsFor,
  PRODUCTION_ORIGINS,
} from "../extension/manifest.js";
import {
  type Chromeish,
  KEEP_MS,
  type Opened,
  pressed,
  RECEIVE_PATH,
  type Sender,
  TAKE,
  take,
  type Waiting,
  type WaitingStore,
} from "../extension/src/handoff.js";
import { HANDOFF_DB_NAME, indexedDbStore } from "../extension/src/store.js";
import type { PageCapture } from "../src/web/save-page-bookmarklet.js";
import { receive, uploadInFlight } from "../src/web/AddFromExtension.js";
import * as web from "../src/web/extension-handoff.js";
import { EXTENSION_RECEIVE_HREF, parseRoute } from "../src/web/router.js";
import { MAX_UPLOAD_BYTES } from "../src/uploads.js";
import {
  polledUploadOutcome,
  publishMode,
  storeVersion,
  uploadOutcome,
  versionAbove,
} from "../scripts/publish-extension.js";

const ORIGIN = "https://www.spideryarn.com";
const ORIGINS = [ORIGIN];

/** A store whose every call is one step, as an IndexedDB transaction is. */
function memoryStore(): WaitingStore & { waiting: Map<number, Waiting>; opened: Map<string, Opened> } {
  const waiting = new Map<number, Waiting>();
  const opened = new Map<string, Opened>();
  return {
    waiting,
    opened,
    async put(entry, o) {
      waiting.set(entry.tabId, entry);
      opened.set(o.source, o);
    },
    async take(tabId, nonce) {
      const found = waiting.get(tabId);
      if (found?.nonce !== nonce) return undefined;
      waiting.delete(tabId);
      return found;
    },
    async openedFor(source) {
      return opened.get(source);
    },
    async forgetTab(tabId) {
      waiting.delete(tabId);
      for (const [source, o] of opened) if (o.tabId === tabId) opened.delete(source);
    },
    async forgetAll() {
      waiting.clear();
      opened.clear();
    },
    async dropOlderThan(before) {
      for (const [k, w] of waiting) if (w.at < before) waiting.delete(k);
      for (const [k, o] of opened) if (o.at < before) opened.delete(k);
    },
  };
}

function deleteHandoffDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(HANDOFF_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("The handoff database was left open"));
  });
}

describe.sequential("the real IndexedDB handoff store", () => {
  beforeEach(deleteHandoffDatabase);

  it("creates both stores, commits writes, closes the database, and takes once", async () => {
    const close = vi.spyOn(IDBDatabase.prototype, "close");
    const waiting: Waiting = {
      tabId: 7,
      nonce: "0123456789abcdef0123456789abcdef",
      html: "<!doctype html><p>hi</p>",
      filename: "Hi.html",
      at: 10,
    };
    const opened: Opened = { source: "https://example.test/a", tabId: 7, at: 10 };

    try {
      await indexedDbStore.put(waiting, opened);
      expect(await indexedDbStore.openedFor(opened.source)).toEqual(opened);
      expect(await indexedDbStore.take(7, "wrong")).toBeUndefined();
      expect(await indexedDbStore.take(7, waiting.nonce)).toEqual(waiting);
      expect(await indexedDbStore.take(7, waiting.nonce)).toBeUndefined();

      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(HANDOFF_DB_NAME, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      expect([...database.objectStoreNames]).toEqual(["opened", "waiting"]);
      database.close();
      expect(close).toHaveBeenCalledTimes(6);
    } finally {
      close.mockRestore();
    }
  });

  it("makes simultaneous takes atomic", async () => {
    const waiting: Waiting = {
      tabId: 8,
      nonce: "1123456789abcdef0123456789abcdef",
      html: "<!doctype html><p>hi</p>",
      filename: "Hi.html",
      at: 10,
    };
    await indexedDbStore.put(waiting, { source: "https://example.test/b", tabId: 8, at: 10 });

    const results = await Promise.all([
      indexedDbStore.take(8, waiting.nonce),
      indexedDbStore.take(8, waiting.nonce),
    ]);
    expect(results.filter((result) => result !== undefined)).toEqual([waiting]);
  });

  it("deletes every opened record for a closed tab without deleting another tab's capture", async () => {
    const first: Waiting = {
      tabId: 9,
      nonce: "2123456789abcdef0123456789abcdef",
      html: "<!doctype html><p>hi</p>",
      filename: "Hi.html",
      at: 10,
    };
    const other: Waiting = {
      tabId: 10,
      nonce: "3123456789abcdef0123456789abcdef",
      html: "<!doctype html><p>hi</p>",
      filename: "Hi.html",
      at: 10,
    };
    await indexedDbStore.put(first, { source: "https://example.test/c", tabId: 9, at: 10 });
    await indexedDbStore.put(other, { source: "https://example.test/d", tabId: 9, at: 10 });

    await indexedDbStore.forgetTab(9);
    expect(await indexedDbStore.openedFor("https://example.test/c")).toBeUndefined();
    expect(await indexedDbStore.openedFor("https://example.test/d")).toBeUndefined();
    expect(await indexedDbStore.take(9, first.nonce)).toBeUndefined();
    expect(await indexedDbStore.take(10, other.nonce)).toEqual(other);
  });

  it("expires strictly older records and can clear everything", async () => {
    const old: Waiting = {
      tabId: 11,
      nonce: "4123456789abcdef0123456789abcdef",
      html: "<!doctype html><p>hi</p>",
      filename: "Hi.html",
      at: 19,
    };
    const boundary: Waiting = {
      tabId: 12,
      nonce: "5123456789abcdef0123456789abcdef",
      html: "<!doctype html><p>hi</p>",
      filename: "Hi.html",
      at: 20,
    };
    await indexedDbStore.put(old, { source: "https://example.test/e", tabId: 11, at: 19 });
    await indexedDbStore.put(boundary, { source: "https://example.test/f", tabId: 12, at: 20 });

    await indexedDbStore.dropOlderThan(20);
    expect(await indexedDbStore.openedFor("https://example.test/e")).toBeUndefined();
    expect(await indexedDbStore.take(11, old.nonce)).toBeUndefined();
    expect(await indexedDbStore.openedFor("https://example.test/f")).toBeDefined();
    expect(await indexedDbStore.take(12, boundary.nonce)).toEqual(boundary);

    await indexedDbStore.forgetAll();
    expect(await indexedDbStore.openedFor("https://example.test/f")).toBeUndefined();
  });
});

const page: PageCapture = { kind: "page", html: "<!doctype html><p>hi</p>", filename: "Hi.html", bytes: 24 };

/** A browser that records what was asked of it, in order. */
function fakeChrome(capture: () => Promise<PageCapture> = async () => page) {
  const calls: string[] = [];
  let next = 100;
  const live = new Set<number>();
  const chrome: Chromeish = {
    nonce: () => "0123456789abcdef0123456789abcdef",
    async capture(tabId) {
      calls.push(`capture ${tabId}`);
      return capture();
    },
    async openTab(url, beside) {
      const id = next++;
      live.add(id);
      calls.push(`open ${url} beside ${beside} -> ${id}`);
      return id;
    },
    async navigate(tabId, url) {
      calls.push(`navigate ${tabId} ${url}`);
    },
    async focus(tabId) {
      calls.push(`focus ${tabId}`);
      return live.has(tabId);
    },
    async say(tabId, badge, title) {
      calls.push(`say ${tabId} ${JSON.stringify(badge)} ${title}`);
    },
  };
  return { chrome, calls, live };
}

const ask = { type: TAKE };
const fromReceiver = (tabId: number, extra: Partial<Sender> = {}): Sender => ({
  origin: ORIGIN,
  url: `${ORIGIN}${RECEIVE_PATH}?handoff=0123456789abcdef0123456789abcdef`,
  frameId: 0,
  tab: { id: tabId },
  ...extra,
});

async function stored(): Promise<{ store: ReturnType<typeof memoryStore>; tabId: number }> {
  const store = memoryStore();
  const { chrome } = fakeChrome();
  await pressed({ id: 7, url: "https://www.cell.com/a" }, ORIGIN, chrome, store, () => 1000);
  return { store, tabId: 100 };
}

describe("take: who gets the page", () => {
  it("the top frame of the tab opened for it, at our receiving page, gets it once", async () => {
    const { store, tabId } = await stored();
    expect(await take(ask, fromReceiver(tabId), ORIGINS, store, () => 2000)).toEqual({
      kind: "page",
      html: page.kind === "page" ? page.html : "",
      filename: "Hi.html",
    });
    expect(await take(ask, fromReceiver(tabId), ORIGINS, store, () => 2000)).toEqual({ kind: "nothing" });
  });

  const refusals: [string, Sender | null, unknown?][] = [
    ["another tab, even on our origin", fromReceiver(101)],
    ["a frame inside the tab (F3)", fromReceiver(100, { frameId: 3 })],
    ["another path on our origin", fromReceiver(100, { url: `${ORIGIN}/read/x` })],
    ["another origin", fromReceiver(100, { origin: "https://evil.example", url: `https://evil.example${RECEIVE_PATH}` })],
    [
      "an origin that only starts with ours",
      fromReceiver(100, {
        origin: "https://www.spideryarn.com.evil.example",
        url: `https://www.spideryarn.com.evil.example${RECEIVE_PATH}`,
      }),
    ],
    ["an origin that disagrees with the url", fromReceiver(100, { origin: "https://evil.example" })],
    ["no tab", fromReceiver(100, { tab: {} })],
    ["no url", fromReceiver(100, { url: undefined as unknown as string })],
    ["a message of another type", null, { type: "something-else" }],
  ];
  for (const [what, sender, message] of refusals) {
    it(`refuses ${what}, and the right asker still gets it after`, async () => {
      const { store, tabId } = await stored();
      expect(await take(message ?? ask, sender ?? fromReceiver(tabId), ORIGINS, store, () => 2000)).toEqual({
        kind: "nothing",
      });
      expect((await take(ask, fromReceiver(tabId), ORIGINS, store, () => 2000)).kind).toBe("page");
    });
  }

  it("two asks at once: one gets it (F4)", async () => {
    const { store, tabId } = await stored();
    const both = await Promise.all([
      take(ask, fromReceiver(tabId), ORIGINS, store, () => 2000),
      take(ask, fromReceiver(tabId), ORIGINS, store, () => 2000),
    ]);
    expect(both.map((r) => r.kind).sort()).toEqual(["nothing", "page"]);
  });

  it("a different or missing handoff nonce cannot take a stale tab id's page", async () => {
    for (const url of [
      `${ORIGIN}${RECEIVE_PATH}?handoff=ffffffffffffffffffffffffffffffff`,
      `${ORIGIN}${RECEIVE_PATH}`,
    ]) {
      const { store, tabId } = await stored();
      expect(await take(ask, fromReceiver(tabId, { url }), ORIGINS, store, () => 2000)).toEqual({ kind: "nothing" });
      expect((await take(ask, fromReceiver(tabId), ORIGINS, store, () => 2000)).kind).toBe("page");
    }
  });

  it("not after KEEP_MS, and just before it", async () => {
    const late = await stored();
    expect((await take(ask, fromReceiver(late.tabId), ORIGINS, late.store, () => 1000 + KEEP_MS + 1)).kind).toBe(
      "nothing",
    );
    const inTime = await stored();
    expect((await take(ask, fromReceiver(inTime.tabId), ORIGINS, inTime.store, () => 1000 + KEEP_MS)).kind).toBe(
      "page",
    );
  });

  it("not once the tab it was opened for has closed", async () => {
    const { store, tabId } = await stored();
    await store.forgetTab(tabId);
    expect((await take(ask, fromReceiver(tabId), ORIGINS, store, () => 2000)).kind).toBe("nothing");
  });
});

describe("pressed: what one press does", () => {
  it("opens a blank tab, stores the page under it, and only then sends it to our page (F4)", async () => {
    const store = memoryStore();
    const { chrome, calls } = fakeChrome();
    await pressed({ id: 7, url: "https://www.cell.com/a#sec1" }, ORIGIN, chrome, store, () => 1000);
    expect(calls).toEqual([
      "capture 7",
      "open about:blank beside 7 -> 100",
      `navigate 100 ${ORIGIN}${RECEIVE_PATH}?handoff=0123456789abcdef0123456789abcdef`,
      'say 7 "" Add this page to Spideryarn',
    ]);
    expect(store.waiting.get(100)?.html).toBe(page.kind === "page" ? page.html : "");
    expect(store.opened.get("https://www.cell.com/a")?.tabId).toBe(100);
  });

  it("a second press on the same page goes to that tab and captures nothing (F5)", async () => {
    const store = memoryStore();
    const { chrome, calls } = fakeChrome();
    await pressed({ id: 7, url: "https://www.cell.com/a" }, ORIGIN, chrome, store, () => 1000);
    calls.length = 0;
    await pressed({ id: 7, url: "https://www.cell.com/a#again" }, ORIGIN, chrome, store, () => 2000);
    expect(calls).toEqual(["focus 100"]);
  });

  it("two presses arriving together still open only one receiving tab", async () => {
    const store = memoryStore();
    let release!: () => void;
    const firstCaptureMayFinish = new Promise<void>((resolve) => {
      release = resolve;
    });
    let captures = 0;
    const { chrome, calls } = fakeChrome(async () => {
      captures += 1;
      if (captures === 1) await firstCaptureMayFinish;
      return page;
    });

    const first = pressed({ id: 7, url: "https://www.cell.com/a" }, ORIGIN, chrome, store, () => 1000);
    const second = pressed({ id: 7, url: "https://www.cell.com/a" }, ORIGIN, chrome, store, () => 1000);
    await Promise.resolve();
    release();
    await Promise.all([first, second]);

    expect(calls.filter((call) => call.startsWith("capture "))).toHaveLength(1);
    expect(calls.filter((call) => call.startsWith("open "))).toHaveLength(1);
    expect(calls).toContain("focus 100");
  });

  it("…unless that tab has closed, or KEEP_MS has passed", async () => {
    const store = memoryStore();
    const { chrome, calls, live } = fakeChrome();
    await pressed({ id: 7, url: "https://www.cell.com/a" }, ORIGIN, chrome, store, () => 1000);
    live.delete(100);
    calls.length = 0;
    await pressed({ id: 7, url: "https://www.cell.com/a" }, ORIGIN, chrome, store, () => 2000);
    expect(calls).toContain("capture 7");
    calls.length = 0;
    await pressed({ id: 7, url: "https://www.cell.com/a" }, ORIGIN, chrome, store, () => 2000 + KEEP_MS + 1);
    expect(calls[0]).toBe("capture 7");
  });

  it("a PDF goes to the add page by its address, for our server to fetch", async () => {
    const { chrome, calls } = fakeChrome(async () => ({ kind: "pdf" }));
    await pressed({ id: 7, url: "https://x.org/p.pdf" }, ORIGIN, chrome, memoryStore(), () => 1000);
    expect(calls).toContain(`open ${ORIGIN}/add/${encodeURIComponent("https://x.org/p.pdf")} beside 7 -> 100`);
  });

  it("a page Chrome will not let us read, a non-web page, and a page too big each say so and open nothing", async () => {
    for (const [url, capture] of [
      ["https://chromewebstore.google.com/", async () => Promise.reject(new Error("Cannot access"))],
      ["chrome://settings", async () => page],
      ["https://x.org/big", async () => ({ kind: "too-big", bytes: 70 * 1048576 }) as PageCapture],
    ] as const) {
      const store = memoryStore();
      const { chrome, calls } = fakeChrome(capture);
      await pressed({ id: 7, url }, ORIGIN, chrome, store, () => 1000);
      expect(calls.some((c) => c.startsWith("open"))).toBe(false);
      expect(calls.at(-1)).toMatch(/^say 7 "!" /);
      expect(store.waiting.size).toBe(0);
    }
  });
});

describe("the manifest asks for nothing it does not use", () => {
  for (const flavour of ["production", "dev"] as const) {
    it(`${flavour}: activeTab and scripting, no hosts, no content scripts`, () => {
      const m = manifestFor(flavour);
      expect(m.permissions).toEqual(["activeTab", "scripting"]);
      expect(m).not.toHaveProperty("host_permissions");
      expect(m).not.toHaveProperty("content_scripts");
      expect(m).not.toHaveProperty("optional_permissions");
      expect((m.externally_connectable as { ids?: unknown }).ids).toBeUndefined();
    });
  }

  it("production talks to production only, and carries no key", () => {
    const m = manifestFor("production");
    expect(m.externally_connectable).toEqual({ matches: ["https://www.spideryarn.com/*"] });
    expect(m).not.toHaveProperty("key");
    expect(originsFor("production")).toEqual([...PRODUCTION_ORIGINS]);
  });

  it("dev talks to localhost only", () => {
    expect(manifestFor("dev").externally_connectable).toEqual({ matches: ["http://localhost/*"] });
    expect(originsFor("dev", "http://localhost:5275")).toEqual(["http://localhost:5275"]);
  });

  it("DEV_KEY gives DEV_EXTENSION_ID, the id the web app's dev build trusts", () => {
    const hex = createHash("sha256").update(Buffer.from(DEV_KEY, "base64")).digest("hex").slice(0, 32);
    const id = [...hex].map((h) => String.fromCharCode(97 + Number.parseInt(h, 16))).join("");
    expect(id).toBe(DEV_EXTENSION_ID);
    expect(web.DEV_EXTENSION_ID).toBe(DEV_EXTENSION_ID);
  });

  it("the two halves agree on the message and the address", () => {
    expect(web.TAKE).toBe(TAKE);
    expect(EXTENSION_RECEIVE_HREF).toBe(RECEIVE_PATH);
    expect(parseRoute(RECEIVE_PATH)).toEqual({ kind: "add-from-extension" });
  });
});

describe("the page: which extensions it asks, and what it accepts", () => {
  it("a production build never trusts the dev id, whose key is public", () => {
    expect(web.trustedExtensionIds(false)).not.toContain(DEV_EXTENSION_ID);
    expect(web.trustedExtensionIds(true)).toContain(DEV_EXTENSION_ID);
  });

  it("no extension API at all is no-extension", async () => {
    expect(await web.takeFromExtension(["a"], undefined)).toEqual({ kind: "no-extension" });
  });

  it("an id that is not installed is skipped, and the next one answers", async () => {
    const asked: string[] = [];
    const got = await web.takeFromExtension(["gone", "here"], async (id) => {
      asked.push(id);
      if (id === "gone") throw new Error("Could not establish connection. Receiving end does not exist.");
      return { kind: "page", html: "<p>x</p>", filename: "X.html" };
    });
    expect(asked).toEqual(["gone", "here"]);
    expect(got.kind).toBe("page");
    if (got.kind === "page") {
      expect(got.file.name).toBe("X.html");
      expect(got.file.type).toBe("text/html");
      expect(await got.file.text()).toBe("<p>x</p>");
    }
  });

  it("a reply of the wrong shape, empty, or over the cap is nothing", () => {
    for (const reply of [
      null,
      "x",
      { kind: "page" },
      { kind: "page", html: 1, filename: "a.html" },
      { kind: "page", html: "", filename: "a.html" },
      { kind: "page", html: "x".repeat(MAX_UPLOAD_BYTES + 1), filename: "a.html" },
    ]) {
      expect(web.asTaken(reply)).toEqual({ kind: "nothing" });
    }
  });

  it("the file name is tidied: no path, always .html", () => {
    const got = web.asTaken({ kind: "page", html: "<p>x</p>", filename: "../../etc/pass\u0000wd.htm" });
    expect(got.kind === "page" && got.file.name).toBe(".. .. etc pass wd.htm.html");
  });
});

describe("publishing refuses rather than guesses (F7)", () => {
  it("compares versions as numbers, part by part", () => {
    expect(versionAbove("0.1.10", "0.1.9")).toBe(true);
    expect(versionAbove("0.1.0", "0.1.0")).toBe(false);
    expect(versionAbove("0.1", "0.1.0")).toBe(false);
    expect(versionAbove("0.2.0", undefined)).toBe(true);
    expect(versionAbove("0.1.0", "1.0")).toBe(false);
  });

  it("the store's version is the highest published or submitted", () => {
    expect(
      storeVersion({
        publishedItemRevisionStatus: { distributionChannels: [{ crxVersion: "0.1.0" }] },
        submittedItemRevisionStatus: { distributionChannels: [{ crxVersion: "0.1.2" }] },
      }),
    ).toBe("0.1.2");
    expect(storeVersion({})).toBeUndefined();
  });

  it("an upload is done only when it succeeded with exactly our version", () => {
    expect(uploadOutcome({ uploadState: "SUCCEEDED", crxVersion: "0.1.0" }, "0.1.0")).toBe("done");
    expect(uploadOutcome({ uploadState: "IN_PROGRESS" }, "0.1.0")).toBe("wait");
    expect(uploadOutcome({ uploadState: "UPLOAD_IN_PROGRESS" }, "0.1.0")).toBe("wait");
    expect(uploadOutcome({ uploadState: "SUCCEEDED", crxVersion: "0.0.9" }, "0.1.0")).toHaveProperty("failed");
    expect(uploadOutcome({ uploadState: "FAILED" }, "0.1.0")).toHaveProperty("failed");
    expect(uploadOutcome({}, "0.1.0")).toHaveProperty("failed");
  });

  it("does not treat an item-wide polled success as proof that our upload succeeded", () => {
    expect(polledUploadOutcome({ lastAsyncUploadState: "SUCCEEDED" }, "0.1.0")).toHaveProperty("failed");
  });

  it("rejects unknown and incompatible command-line options", () => {
    expect(publishMode(["--upload-onyl"])).toHaveProperty("failed");
    expect(publishMode(["--status", "--upload-only"])).toHaveProperty("failed");
    expect(publishMode([])).toBe("publish");
    expect(publishMode(["--status"])).toBe("status");
    expect(publishMode(["--upload-only"])).toBe("upload-only");
  });
});

describe("receive: the page is sent only for the reader it was opened for (F1)", () => {
  const file = new File(["<p>x</p>"], "X.html", { type: "text/html" });

  it("sends, then goes to the upload's add page", async () => {
    const went: string[] = [];
    const sent: File[] = [];
    const r = await receive({
      take: async () => ({ kind: "page", file }),
      stillFor: () => true,
      send: async (f) => (sent.push(f), "11111111-1111-4111-8111-111111111111"),
      go: (h) => went.push(h),
    });
    expect(r).toEqual({ kind: "sent" });
    expect(sent).toEqual([file]);
    expect(went).toEqual(["/add/upload/11111111-1111-4111-8111-111111111111"]);
  });

  it("a reply that arrives after the reader changed sends nothing", async () => {
    let reader = "A";
    const sent: File[] = [];
    const r = await receive({
      take: async () => {
        reader = "B"; // another tab signed in as B while the extension answered
        return { kind: "page", file };
      },
      stillFor: () => reader === "A",
      send: async (f) => (sent.push(f), "id"),
      go: () => {},
    });
    expect(r).toBeNull();
    expect(sent).toEqual([]);
  });

  it("…and after a sign-out", async () => {
    let reader: string | null = "A";
    const sent: File[] = [];
    await receive({
      take: async () => {
        reader = null;
        return { kind: "page", file };
      },
      stillFor: () => reader === "A",
      send: async (f) => (sent.push(f), "id"),
      go: () => {},
    });
    expect(sent).toEqual([]);
  });

  it("an upload the engine refuses says so, and goes nowhere", async () => {
    const went: string[] = [];
    expect(
      await receive({
        take: async () => ({ kind: "page", file }),
        stillFor: () => true,
        send: async () => {
          throw new Error("That upload is still going. Wait for it, or stop it first.");
        },
        go: (h) => went.push(h),
      }),
    ).toEqual({ kind: "refused", reason: "That upload is still going. Wait for it, or stop it first." });
    expect(went).toEqual([]);
  });

  it("waits to take the capture while another upload still owns the engine", () => {
    for (const kind of ["hashing", "granting", "sending", "queueing"] as const) {
      expect(
        uploadInFlight({
          uploadId: null,
          filename: "earlier.pdf",
          bytes: 10,
          phase: kind === "sending" ? { kind, sent: 1 } : { kind },
        }),
      ).toBe(true);
    }
    expect(uploadInFlight(null)).toBe(false);
    expect(
      uploadInFlight({
        uploadId: null,
        filename: "earlier.pdf",
        bytes: 10,
        phase: { kind: "cancelled" },
      }),
    ).toBe(false);
  });

  it("no extension, or nothing waiting, is said as such", async () => {
    for (const kind of ["no-extension", "nothing"] as const) {
      expect(await receive({ take: async () => ({ kind }), stillFor: () => true, send: async () => "x", go: () => {} })).toEqual({ kind });
    }
  });
});
