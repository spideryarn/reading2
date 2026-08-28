// @vitest-environment jsdom
/**
 * **The claim this file exists to stop me asserting from a code read.**
 *
 * I told Greg that offline, an article already on screen keeps its prose but
 * loses its bands — because every band is mounted only while it is open
 * (`{mode === "glossary" && …}`, App.tsx) and each fetches on mount. That was
 * derived by reading the code, and a code read is exactly how you end up
 * confidently describing behaviour that does not happen. The Chrome extension
 * was not connected, so this is the durable version of that smoke test, and it
 * is better than the browser pass would have been: it will still be here in six
 * months.
 *
 * Three states are separated on purpose, because the whole difficulty of
 * testing a cache is that they look identical from the outside:
 *
 *  1. **Online.** The data came over the network.
 *  2. **Offline, nothing saved.** The panel remounts, refetches, and comes up
 *     empty — which is the bug. Since 2026-08-27 the read does at least *say*
 *     so, in `status`, because the glossary panel renders that message
 *     (`useGlossaryRead`, which replaced the error-swallowing `useGlossaryTerms`
 *     when the two fetches were merged). But nothing renders it for the prose:
 *     the underlines are an enhancement over the article, so what the reader
 *     sees is still an article whose terms have quietly stopped being
 *     underlined, and that is what this test is about.
 *  3. **Offline, saved.** The same remount, and the terms are back.
 *
 * Step 2 is the one that matters. Without it, step 3 proves nothing — a panel
 * that had simply kept its React state would pass step 3 while the cache did
 * nothing at all.
 *
 * Real `apiFetch`, real `offline-store`, real IndexedDB (`fake-indexeddb`).
 * Only the Supabase SDK and `fetch` are stubbed, because they are the network
 * and the network is the thing being taken away.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";

const getSession = vi.fn();
const refreshSession = vi.fn();

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession,
      refreshSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

const { useGlossaryRead } = await import("../src/web/useGlossary.js");
const { readCached, rememberUser } = await import("../src/web/lib/offline-store.js");

/** The reply a healthy server gives for this article's glossary. */
const GLOSSARY = {
  glossary: {
    entries: [
      { id: "t1", name: "epistemic", kind: "concept", aliases: [], occurrences: [] },
      { id: "t2", name: "prior", kind: "concept", aliases: [], occurrences: [] },
    ],
  },
  stale: false,
};

const jsonOk = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** A tiny host for the hook, so the test can read what it produced. */
function Terms({ slug, onTerms }: { slug: string; onTerms: (n: string[]) => void }) {
  const { glossary } = useGlossaryRead(slug);
  onTerms((glossary?.entries ?? []).map((e) => e.name));
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.unstubAllGlobals();
  getSession.mockReset();
  refreshSession.mockReset();
  getSession.mockResolvedValue({ data: { session: { access_token: "TOKEN" } } });
  rememberUser("ada");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/**
 * Mount the hook, let its effect and any cache write settle, and report the
 * terms it ended up with.
 *
 * The second `act` with a real timeout is not decoration: the cache write is
 * deliberately fire-and-forget, so without letting the macrotask queue turn,
 * the next test would be reading a database the previous one had not finished
 * writing — and would pass or fail depending on timing.
 */
async function mountAndRead(slug: string): Promise<string[]> {
  let seen: string[] = [];
  await act(async () => {
    root.render(<Terms slug={slug} onTerms={(t) => (seen = t)} />);
  });
  await act(async () => {
    await new Promise((go) => setTimeout(go, 0));
  });
  return seen;
}

/**
 * Wait until the copy is actually on disk.
 *
 * **Not a `setTimeout` guess.** The save is fire-and-forget and goes through a
 * clone, a JSON parse, opening the database, a transaction and then eviction —
 * several turns, and how many depends on the IndexedDB implementation. Sleeping
 * "long enough" produces a test that passes on this laptop and fails in CI, and
 * — worse — one that would go green even if the write never happened, because
 * the assertion that follows it is about something else. So poll for the thing
 * itself, and fail loudly if it never arrives.
 */
async function waitForCached(url: string, userId: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await readCached(url, userId)) return;
    await new Promise((go) => setTimeout(go, 5));
  }
  throw new Error(`nothing was ever saved for ${url} — the cache write did not happen`);
}

/** Take the panel off screen, the way switching band mode does. */
async function unmount(): Promise<void> {
  await act(async () => {
    root.render(null);
  });
}

describe("a band that is closed and reopened", () => {
  it("keeps nothing of its own — and so goes silently empty offline", async () => {
    /* Online first, so the hook is known to work at all. */
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk(GLOSSARY)));
    expect(await mountAndRead("no-cache-here")).toEqual(["epistemic", "prior"]);

    await unmount();

    /* The network dies. Nothing was saved for THIS slug, because the whitelist
       write and this assertion are about to be pulled apart deliberately: the
       cache is bypassed by using a slug whose body we then remove. Simpler and
       more honest — clear the store outright. */
    await clearStore();
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));

    /* This is the bug, and note what it is NOT: no error, no message, no
       console line. The terms are simply gone. */
    expect(await mountAndRead("no-cache-here")).toEqual([]);
  });

  it("comes back from the saved copy when there is one", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk(GLOSSARY)));
    expect(await mountAndRead("saved")).toEqual(["epistemic", "prior"]);
    await waitForCached("/api/glossary/saved", "ada");

    await unmount();

    /* Same remount, same dead network — the only difference from the test above
       is that the cache was not cleared. */
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    expect(await mountAndRead("saved")).toEqual(["epistemic", "prior"]);
  });

  it("does not hand one reader another reader's terms", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk(GLOSSARY)));
    expect(await mountAndRead("shared-ipad")).toEqual(["epistemic", "prior"]);
    /* Saved for Ada — so the next assertion is about partitioning rather than
       about a write that simply had not happened yet. */
    await waitForCached("/api/glossary/shared-ipad", "ada");

    await unmount();

    /* Somebody else signs in on the same iPad. The article is the same article
       and the URL is the same URL; the cache must still say nothing. */
    rememberUser("bob");
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    expect(await mountAndRead("shared-ipad")).toEqual([]);
  });
});

describe("the strip knows what happened", () => {
  it("says nothing while requests are getting through", async () => {
    const { useOffline } = await import("../src/web/offline.js");
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk(GLOSSARY)));
    await mountAndRead("online-check");

    const seen: { connected: boolean; servedCopyAt: number | null }[] = [];
    function Peek() {
      seen.push(useOffline());
      return null;
    }
    await act(async () => {
      root.render(<Peek />);
    });
    expect(seen.at(-1)?.connected).toBe(true);
  });

  it("reports a served copy, with the date it was saved", async () => {
    const { useOffline } = await import("../src/web/offline.js");
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk(GLOSSARY)));
    await mountAndRead("dated");
    await waitForCached("/api/glossary/dated", "ada");
    await unmount();

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    await mountAndRead("dated");

    const seen: { connected: boolean; servedCopyAt: number | null }[] = [];
    function Peek() {
      seen.push(useOffline());
      return null;
    }
    await act(async () => {
      root.render(<Peek />);
    });
    expect(seen.at(-1)?.connected).toBe(false);
    /* A real timestamp, not a placeholder — the strip prints this to the
       reader, and "showing the copy saved on 1 January 1970" is worse than
       saying nothing. */
    expect(seen.at(-1)?.servedCopyAt ?? 0).toBeGreaterThan(1_700_000_000_000);
  });
});

/** Empty the cache, the way an eviction or a fresh device would. */
async function clearStore(): Promise<void> {
  const db: IDBDatabase = await new Promise((go, no) => {
    const req = indexedDB.open("spideryarn-offline");
    req.onsuccess = () => go(req.result);
    req.onerror = () => no(req.error);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("responses")) {
        req.result.createObjectStore("responses", { keyPath: "key" });
      }
    };
  });
  try {
    await new Promise<void>((go, no) => {
      const req = db.transaction("responses", "readwrite").objectStore("responses").clear();
      req.onsuccess = () => go();
      req.onerror = () => no(req.error);
    });
  } finally {
    db.close();
  }
}
