// @vitest-environment jsdom
/**
 * **The saved shelf paints first, and the live one always wins.**
 *
 * `useShelf` draws the copy of `GET /api/library` that `apiFetch` has been
 * saving to IndexedDB since 2026-08-27, so a repeat visit is not a blank page
 * for the length of a serverless cold start
 * (docs/plans/260903g-faster-shelf-load-and-tidier-homepage-controls.md § Stage 5).
 * Eager painting is a race, and the tests here are that race in both directions:
 *
 * - the copy arrives first and is replaced by the live answer;
 * - **the live answer arrives first and a late copy must not overwrite it** —
 *   the one an implementation with a boolean gets wrong, because `reload` is
 *   public and job-driven reloads overlap;
 * - the reader changes mid-flight, and the previous reader's copy must not land
 *   on the new reader's shelf;
 * - a final 401 clears, a 5xx keeps;
 * - a body saved by an older deployment is discarded rather than drawn.
 *
 * The API module is mocked because what is under test is the order of
 * operations in `useShelf`, not HTTP. The **cache module is not**: `readCached`
 * is mocked one layer lower, so `shelfFromCachedBody`'s real validation runs —
 * that is the half a stub would simply have agreed with.
 */
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryEntry, LibraryResponse } from "../src/types.js";

/** What each URL answers with, posed per test. */
const answers = new Map<string, () => Promise<unknown>>();

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: (url: string) =>
    Promise.resolve(new Response(null, { status: 200, headers: { "x-url": url } })),
  readJson: (r: Response) => {
    const url = r.headers.get("x-url") ?? "";
    const answer = answers.get(url);
    if (!answer) throw new Error(`nothing posed for ${url}`);
    return answer();
  },
  /* The real one, duck-typed, for the same reason the real one is duck-typed:
     a mocked module is a second copy, and `instanceof` across two copies is
     false for an object that is an `HttpError` in every way that matters. */
  statusOf: (err: unknown) => {
    const status = (err as { status?: unknown } | null)?.status;
    return typeof status === "number" ? status : null;
  },
}));

const readCache = vi.fn();
vi.mock("../src/web/lib/offline-store.js", () => ({
  readCached: readCache,
  writeCached: vi.fn(),
  reserveTicket: vi.fn(async () => null),
  invalidate: vi.fn(),
  cachedSlugs: vi.fn(),
  rememberUser: vi.fn(),
  lastKnownUser: () => "reader-a",
  forgetUser: vi.fn(),
}));

const { useShelf } = await import("../src/web/useShelf.js");
type Shelf = ReturnType<typeof useShelf>;
const { shelfFromCachedBody } = await import("../src/web/lib/cached-shelf.js");

/** A promise the test resolves when it wants to, which is the whole point. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
}

function entry(over: Partial<LibraryEntry> & { slug: string }): LibraryEntry {
  return {
    title: over.slug,
    addedAt: "2026-08-20T10:00:00.000Z",
    words: 2400,
    minutes: 11,
    blocks: 60,
    parts: 3,
    sections: 9,
    comments: 0,
    opens: 0,
    has: { arc: false, tweets: false, glossary: false },
    ...over,
  };
}

const shelfOf = (...slugs: string[]): LibraryResponse => ({
  articles: slugs.map((slug) => entry({ slug })),
});

/** Everything the probe has been rendered with, oldest first. */
let seen: (string[] | null)[] = [];
let renders = 0;
let errors: string[] = [];

/** The live hook, so a test can call `reload()` the way `useJobs` does. */
let shelfNow_: Shelf | null = null;

function Probe({ readerId }: { readerId: string }) {
  const shelf = useShelf(readerId);
  shelfNow_ = shelf;
  renders += 1;
  /* Recorded in an effect rather than during render, so a `null` seen mid-render
     of a batched update is not mistaken for a state the reader saw. */
  useEffect(() => {
    seen.push(shelf.articles?.map((a) => a.slug) ?? null);
    errors.push(shelf.error ?? "");
  });
  return null;
}

/* React only complains about an update outside `act` when it has been told it
   is in an act environment; without this it complains about `root.unmount()`
   instead, which is noise and would have made the assertion below fire
   whatever the code did. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function paint(readerId = "reader-a"): void {
  act(() => {
    root.render(createElement(Probe, { readerId }));
  });
}

/** Let every pending microtask and the promise chains behind them land. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((go) => setTimeout(go, 0));
    await new Promise((go) => setTimeout(go, 0));
  });
}

/** What is on the shelf right now. */
const shelfNow = (): string[] | null => seen[seen.length - 1] ?? null;
const errorNow = (): string => errors[errors.length - 1] ?? "";

beforeEach(() => {
  answers.clear();
  readCache.mockReset();
  readCache.mockResolvedValue(undefined);
  seen = [];
  errors = [];
  renders = 0;
  shelfNow_ = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the saved shelf and the live one", () => {
  it("paints the saved copy first, and the live answer replaces it", async () => {
    const cache = deferred<{ body: unknown; savedAt: number }>();
    const live = deferred<LibraryResponse>();
    readCache.mockReturnValue(cache.promise);
    answers.set("/api/library", () => live.promise);

    paint();
    await settle();
    /* Nothing yet, and that is the state Greg was looking at for 600ms. */
    expect(shelfNow()).toBeNull();

    cache.resolve({ body: shelfOf("saved-piece"), savedAt: 1 });
    await settle();
    expect(shelfNow()).toEqual(["saved-piece"]);

    live.resolve(shelfOf("live-piece", "another-live-piece"));
    await settle();
    expect(shelfNow()).toEqual(["live-piece", "another-live-piece"]);
  });

  /**
   * **The direction a boolean gets wrong.**
   *
   * A flag set inside the mount effect cannot see a reload that `useJobs`
   * started, so an implementation carrying one has the cached body land on top
   * of a newer live answer — the reader watches an article they just imported
   * disappear again.
   */
  it("does not let a late saved copy overwrite the live answer", async () => {
    const cache = deferred<{ body: unknown; savedAt: number }>();
    readCache.mockReturnValue(cache.promise);
    answers.set("/api/library", () => Promise.resolve(shelfOf("live-piece")));

    paint();
    await settle();
    expect(shelfNow()).toEqual(["live-piece"]);

    cache.resolve({ body: shelfOf("stale-piece"), savedAt: 1 });
    await settle();
    expect(shelfNow()).toEqual(["live-piece"]);
    /* And it never flickered through on the way, either. */
    expect(seen).not.toContainEqual(["stale-piece"]);
  });

  /**
   * The same thing again with a **second, real** reload in between — the shape
   * `useJobs` produces while an import is running, and the one a flag set inside
   * the mount effect cannot see at all.
   *
   * The first version of this test only looked like it did that: it posed two
   * answers but never called `reload()`, so its counter never reached two and it
   * was a duplicate of the case above wearing a different name. Caught by GPT
   * Sol, and the corrected version fails against a build without the guard.
   */
  it("does not let a late saved copy overwrite a live answer from a second reload", async () => {
    const cache = deferred<{ body: unknown; savedAt: number }>();
    readCache.mockReturnValue(cache.promise);
    let nth = 0;
    answers.set("/api/library", () => Promise.resolve(shelfOf(`live-${++nth}`)));

    paint();
    await settle();
    expect(shelfNow()).toEqual(["live-1"]);

    await act(async () => {
      await shelfNow_?.reload();
    });
    await settle();
    expect(shelfNow()).toEqual(["live-2"]);

    cache.resolve({ body: shelfOf("stale-piece"), savedAt: 1 });
    await settle();
    expect(shelfNow()).toEqual(["live-2"]);
  });

  /**
   * **Two reloads in flight, finishing in the other order.**
   *
   * `useJobs` fires a reload whenever an import moves, so a slow first request
   * and a fast second one is ordinary rather than exotic — and the first one
   * landing last used to write its older shelf over the newer one, which the
   * reader sees as an article they have just imported disappearing again.
   */
  it("does not let an older live answer land on top of a newer one", async () => {
    readCache.mockResolvedValue(undefined);
    const slow = deferred<LibraryResponse>();
    const fast = deferred<LibraryResponse>();
    let nth = 0;
    answers.set("/api/library", () => (++nth === 1 ? slow.promise : fast.promise));

    paint();
    await settle();
    expect(shelfNow()).toBeNull();

    const second = shelfNow_?.reload();
    fast.resolve(shelfOf("newer-piece"));
    await act(async () => {
      await second;
    });
    expect(shelfNow()).toEqual(["newer-piece"]);

    slow.resolve(shelfOf("older-piece"));
    await settle();
    expect(shelfNow()).toEqual(["newer-piece"]);
    expect(seen).not.toContainEqual(["older-piece"]);
  });

  /**
   * **The same overlap, with the loser failing rather than succeeding.**
   *
   * A newer reload paints, then the older one fails. Its message must not go up
   * over a shelf that is perfectly current — and it must not *reject* either,
   * because `undo` awaits `reload()` and clears the Undo strip only if that
   * resolves. Left rejecting, an overtaken failure leaves the strip and an
   * action error on screen for an article that has already been restored and
   * drawn. GPT Sol asked for exactly this test.
   */
  it("does not report a failure a newer answer has already overtaken", async () => {
    readCache.mockResolvedValue(undefined);
    const first = deferred<LibraryResponse>();
    const second = deferred<LibraryResponse>();
    let nth = 0;
    answers.set("/api/library", () => {
      nth += 1;
      if (nth === 1) return Promise.resolve(shelfOf("mounted-piece"));
      return nth === 2 ? first.promise : second.promise;
    });

    paint();
    await settle();
    expect(shelfNow()).toEqual(["mounted-piece"]);

    /* Two more, overlapping, held: the older one is going to fail and the newer
       one is going to succeed, in that order of *finishing*. Both promises are
       kept, because whether the older one rejects is half of what is under
       test — it is what `undo` reads. */
    const older = shelfNow_?.reload();
    const newer = shelfNow_?.reload();

    second.resolve(shelfOf("newer-piece"));
    await act(async () => {
      await newer;
    });
    expect(shelfNow()).toEqual(["newer-piece"]);

    let rejected = false;
    first.reject(Object.assign(new Error("Request failed (503)"), { status: 503 }));
    await act(async () => {
      await older?.catch(() => {
        rejected = true;
      });
    });

    expect(rejected).toBe(false);
    expect(shelfNow()).toEqual(["newer-piece"]);
    expect(errorNow()).toBe("");
  });

  /**
   * `<Library>` keeps its instance across an account switch — same element,
   * same position — so nothing else takes the previous reader's titles off the
   * screen, and nothing else stops their in-flight copy landing on the new
   * reader's shelf. Rows are partitioned in IndexedDB, so this is not a
   * *leak* through the store; it is this hook's continuation, and only the
   * cleanup stops it.
   */
  it("drops the previous reader's copy when the reader changes", async () => {
    const first = deferred<{ body: unknown; savedAt: number }>();
    const second = deferred<{ body: unknown; savedAt: number }>();
    readCache.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const live = deferred<LibraryResponse>();
    answers.set("/api/library", () => live.promise);

    paint("reader-a");
    await settle();
    paint("reader-b");
    await settle();

    first.resolve({ body: shelfOf("readers-a-piece"), savedAt: 1 });
    await settle();
    expect(seen).not.toContainEqual(["readers-a-piece"]);

    second.resolve({ body: shelfOf("readers-b-piece"), savedAt: 1 });
    await settle();
    expect(shelfNow()).toEqual(["readers-b-piece"]);
  });

  /**
   * Clearing on the switch is not enough on its own. The previous reader's
   * `GET /api/library` is still in flight, and its answer would put their
   * titles back on screen one frame after we took them down — which is the
   * whole thing the clear exists to prevent.
   */
  it("drops the previous reader's live answer when it lands late", async () => {
    const readerA = deferred<LibraryResponse>();
    const readerB = deferred<LibraryResponse>();
    let nth = 0;
    answers.set("/api/library", () => (++nth === 1 ? readerA.promise : readerB.promise));

    paint("reader-a");
    await settle();
    paint("reader-b");
    await settle();

    readerA.resolve(shelfOf("readers-a-piece"));
    await settle();
    expect(seen).not.toContainEqual(["readers-a-piece"]);
    expect(shelfNow()).toBeNull();

    readerB.resolve(shelfOf("readers-b-piece"));
    await settle();
    expect(shelfNow()).toEqual(["readers-b-piece"]);
  });

  it("clears a shelf already on screen when the reader changes", async () => {
    readCache.mockResolvedValue(undefined);
    answers.set("/api/library", () => Promise.resolve(shelfOf("readers-a-piece")));

    paint("reader-a");
    await settle();
    expect(shelfNow()).toEqual(["readers-a-piece"]);

    /* Held open, so the new reader's shelf is genuinely "not asked yet" rather
       than answered in the same tick. */
    const held = deferred<LibraryResponse>();
    answers.set("/api/library", () => held.promise);
    paint("reader-b");
    expect(shelfNow()).toBeNull();
  });

  /**
   * **And this one is honest about what it cannot prove.**
   *
   * Run against a build with the cleanup's `cancelled` flag taken out, it still
   * passes — measured, not assumed. React silently drops a `setState` aimed at
   * an unmounted root: no render, no warning, nothing a test can see. So the
   * *guard* is proved by the reader-change test above, which exercises the same
   * cleanup on the same line and does go red without it; what is left here is
   * the other half of the promise — that unmounting mid-read throws nothing,
   * schedules nothing, and leaves no unhandled rejection behind.
   *
   * The `console.error` assertion is worth its line only because
   * `IS_REACT_ACT_ENVIRONMENT` is set above: without that, `root.unmount()`
   * itself logs and the assertion would have fired whatever the code did. That
   * is what it looked like on the first run.
   */
  it("commits nothing after unmount", async () => {
    const cache = deferred<{ body: unknown; savedAt: number }>();
    readCache.mockReturnValue(cache.promise);
    answers.set("/api/library", () => new Promise<LibraryResponse>(() => {}));

    paint();
    await settle();
    const before = renders;
    const complaints = vi.spyOn(console, "error").mockImplementation(() => {});

    act(() => root.unmount());
    cache.resolve({ body: shelfOf("saved-piece"), savedAt: 1 });
    await settle();

    expect(renders).toBe(before);
    expect(seen).not.toContainEqual(["saved-piece"]);
    expect(complaints.mock.calls.map((c) => String(c[0]))).toEqual([]);
    complaints.mockRestore();
    /* Re-created so `afterEach`'s unmount has something to unmount. */
    root = createRoot(host);
  });
});

describe("what a failure does to a shelf that is already painted", () => {
  it("keeps the stale shelf and says so when the server returns a 500", async () => {
    readCache.mockResolvedValue({ body: shelfOf("saved-piece"), savedAt: 1 });
    answers.set("/api/library", () =>
      Promise.reject(Object.assign(new Error("Request failed (500)"), { status: 500 })),
    );

    paint();
    await settle();
    expect(shelfNow()).toEqual(["saved-piece"]);
    expect(errorNow()).toContain("500");
  });

  it("keeps the stale shelf when the transport fails", async () => {
    readCache.mockResolvedValue({ body: shelfOf("saved-piece"), savedAt: 1 });
    answers.set("/api/library", () => Promise.reject(new Error("Failed to fetch")));

    paint();
    await settle();
    expect(shelfNow()).toEqual(["saved-piece"]);
    expect(errorNow()).toContain("Couldn't reach the server");
  });

  /**
   * A 401 that survived `apiFetch`'s own refresh means this session is nobody,
   * and titles are reader data. The shelf comes down — and a copy still in
   * flight must not put it back up.
   */
  it("clears the shelf on a final 401, and locks out a copy still in flight", async () => {
    const cache = deferred<{ body: unknown; savedAt: number }>();
    readCache.mockReturnValue(cache.promise);
    answers.set("/api/library", () =>
      Promise.reject(Object.assign(new Error("Not signed in"), { status: 401 })),
    );

    paint();
    await settle();
    expect(shelfNow()).toBeNull();

    cache.resolve({ body: shelfOf("saved-piece"), savedAt: 1 });
    await settle();
    expect(shelfNow()).toBeNull();
    expect(seen).not.toContainEqual(["saved-piece"]);
  });
});

describe("a body saved by an older deployment", () => {
  /**
   * The risk this stage adds. Until now the saved body was only ever drawn by a
   * reader with no network; now it is drawn on every repeat visit, and
   * `entry.words.toLocaleString()` (ShelfEntry.tsx) throws on an entry that
   * predates the field.
   */
  it("is discarded rather than painted", async () => {
    const old = { articles: [{ slug: "a-piece", title: "Something", addedAt: "2026-08-20" }] };
    readCache.mockResolvedValue({ body: old, savedAt: 1 });
    const live = deferred<LibraryResponse>();
    answers.set("/api/library", () => live.promise);

    paint();
    await settle();
    expect(shelfNow()).toBeNull();

    live.resolve(shelfOf("live-piece"));
    await settle();
    expect(shelfNow()).toEqual(["live-piece"]);
  });

  it("is discarded whole rather than a card at a time", () => {
    const good = entry({ slug: "good-piece" });
    const bad = { ...entry({ slug: "bad-piece" }), words: undefined };
    expect(shelfFromCachedBody({ articles: [good, bad] })).toBeNull();
    expect(shelfFromCachedBody({ articles: [good] })).toEqual([good]);
  });

  /* The envelope, and the shape the offline filter spent a fortnight testing
     for instead — docs/postmortems/260903e-offline-shelf-filter-never-ran.md. */
  it("is discarded when it is not the envelope at all", () => {
    expect(shelfFromCachedBody([entry({ slug: "a-piece" })])).toBeNull();
    expect(shelfFromCachedBody({ entries: "surprise" })).toBeNull();
    expect(shelfFromCachedBody(null)).toBeNull();
    expect(shelfFromCachedBody("nothing like it")).toBeNull();
  });

  it("accepts the optional fields the card draws, and rejects a wrong one", () => {
    const rich = entry({
      slug: "a-piece",
      byline: "Somebody",
      siteName: "A site",
      gist: "In one sentence",
      lastOpenedAt: "2026-08-29T09:00:00.000Z",
      fixture: true,
      visibility: "public",
    });
    expect(shelfFromCachedBody({ articles: [rich] })).toEqual([rich]);
    expect(shelfFromCachedBody({ articles: [{ ...rich, visibility: "private" }] })).toBeNull();
    expect(shelfFromCachedBody({ articles: [{ ...rich, lastOpenedAt: 17 }] })).toBeNull();
  });
});
