// @vitest-environment jsdom
/**
 * **The metadata page says how long you have spent reading the article** —
 * Greg, 2026-10-24 (spya-db7w6f):
 * docs/plans/261024t-metadata-shows-time-spent-reading.md.
 *
 * The total is the sum of every stored block's seconds from
 * `GET /api/reading-time/:slug`, in the gutter card's words; nothing stored and
 * a failed read each have a sentence of their own.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "../src/types.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: false,
}));

/* The same two stubs as tests/metadata-relative-times.test.tsx, for its reasons. */
vi.mock("nuqs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("nuqs")>()),
  useQueryState: () => [null, () => {}],
}));
vi.mock("../src/web/Dock.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/web/Dock.js")>()),
  Dock: () => null,
}));

/* Viewing as another reader, when a test sets it. */
const viewAs = vi.hoisted(() => ({ nonce: null as string | null }));
vi.mock("../src/web/lib/view-as.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/web/lib/view-as.js")>()),
  viewAsNonce: () => viewAs.nonce,
}));

const { Metadata } = await import("../src/web/Metadata.js");
const { useReadingTime } = await import("../src/web/useReadingTime.js");

const SLUG = "temporal-context-reinstatement-spya-dhqkf9";

function article(): Article {
  return {
    meta: { slug: SLUG, title: "Temporal context reinstatement" },
    blocks: [
      { id: "spya-aaaaaa", tag: "p", kind: "text", text: "A paragraph.", words: 2, html: "<p>A paragraph.</p>", gistable: true },
    ],
    assets: undefined,
    navLabelStatus: "ready",
    highPowerSince: null,
    titleOverridden: false,
    sourceGuess: undefined,
    tree: {
      version: "t",
      generator: "t",
      slug: SLUG,
      rootId: "n0",
      nodes: {
        n0: { id: "n0", depth: 0, parent: null, children: [], range: ["spya-aaaaaa", "spya-aaaaaa"], title: "T" },
      },
    },
  } as Article;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let host: HTMLDivElement;
let root: Root;
let recording: ReturnType<typeof useReadingTime>;

function RecordingReader() {
  recording = useReadingTime(SLUG, new Map([["spya-aaaaaa", 230]]), true);
  return null;
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  viewAs.nonce = null;
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.useRealTimers();
});

/** Mount with the reading-time GET answering `readingTime`; every other GET gets an empty metadata body. */
const asked: string[] = [];

async function mount(readingTime: () => Response): Promise<string> {
  asked.length = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    asked.push(url);
    if (url.includes("/api/reading-time/")) return Promise.resolve(readingTime());
    return Promise.resolve(
      json({ slug: SLUG, dir: "d", stages: [], comments: 0, profile: null, purpose: null, archivedAt: null }),
    );
  });
  await act(async () => {
    root.render(
      createElement(Metadata, { slug: SLUG, article: article(), onRenamed: () => {}, onVisibility: () => {} }),
    );
  });
  /* The row's own read settles on later microtasks. */
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  const row = [...host.querySelectorAll("div")].find(
    (d) => d.children.length >= 3 && d.children[1]?.textContent === "Time spent reading",
  );
  expect(row, "no Time spent reading row in Your reading").toBeTruthy();
  return row?.lastElementChild?.textContent ?? "";
}

describe("Metadata › Your reading › Time spent reading", () => {
  it("sums every stored block, including one today's body no longer has", async () => {
    const said = await mount(() => json({ seconds: { "spya-aaaaaa": 500, "spya-retird": 340.4 } }));
    expect(said).toContain("about 14 min");
  });

  it("says so when nothing is stored yet", async () => {
    const said = await mount(() => json({ seconds: {} }));
    expect(said).toContain("None recorded yet");
  });

  it("says so when the read failed, rather than claiming none", async () => {
    const said = await mount(() => json({ error: "nope" }, 500));
    expect(said).toContain("could not be read");
    expect(said).not.toContain("None recorded");
  });

  it("reads nothing while an administrator views as another reader, as the spine draws nothing", async () => {
    viewAs.nonce = "nonce";
    const said = await mount(() => json({ seconds: { "spya-aaaaaa": 500 } }));
    expect(said).toContain("Not shown while viewing as another reader");
    expect(asked.some((u) => u.includes("/api/reading-time/"))).toBe(false);
  });

  it("waits for the reader's cleanup POST before reading the total", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });

    const table = document.createElement("table");
    const tbody = document.createElement("tbody");
    const row = document.createElement("tr");
    row.dataset.block = "spya-aaaaaa";
    row.getBoundingClientRect = () => ({ top: 0, bottom: 800, height: 800 }) as DOMRect;
    tbody.append(row);
    table.append(tbody);
    document.body.append(table);

    let stored = 0;
    let readingGets = 0;
    let releasePost: (() => void) | null = null;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.includes("/api/reading-time/")) {
        return Promise.resolve(
          json({ slug: SLUG, dir: "d", stages: [], comments: 0, profile: null, purpose: null, archivedAt: null }),
        );
      }
      if (init.method === "POST") {
        const sent = JSON.parse(String(init.body)) as { seconds: Record<string, number> };
        return new Promise<Response>((resolve) => {
          releasePost = () => {
            stored += sent.seconds["spya-aaaaaa"] ?? 0;
            resolve(new Response(null, { status: 204 }));
          };
        });
      }
      readingGets += 1;
      return Promise.resolve(json({ seconds: stored > 0 ? { "spya-aaaaaa": stored } : {} }));
    });

    await act(async () => {
      root.render(createElement(RecordingReader));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(readingGets).toBe(1);
    recording.setCounting(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    await act(async () => {
      root.render(
        createElement(Metadata, { slug: SLUG, article: article(), onRenamed: () => {}, onVisibility: () => {} }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(releasePost, "the reading view did not send its cleanup POST").not.toBeNull();
    expect(readingGets, "Metadata's GET overtook the cleanup POST").toBe(1);

    await act(async () => {
      releasePost?.();
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(readingGets).toBe(2);
    expect(host.textContent).toContain("about 5 s");
    table.remove();
  });
});
