// @vitest-environment jsdom
/**
 * The recorder — src/web/useReadingTime.ts. What earns a second, what is sent,
 * and what is never sent twice.
 * docs/plans/260916c-show-where-you-have-spent-time-reading-in-the-spine-and-gutter.md.
 *
 * Rows are real `tbody tr[data-block]` elements with `getBoundingClientRect`
 * stubbed, so the hook's own selector, binary search and sharing are what run.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Every POST body, parsed, and how it was sent. */
let posts: { via: "apiFetch" | "leavingFetch"; seconds: Record<string, number> }[] = [];
/** What the opening GET answers. */
let serverSeconds: Record<string, number> = {};
/** When set, the next POST through `apiFetch` rejects, as a lost connection does. */
let failNextPost = false;

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push({ via: "apiFetch", ...JSON.parse(String(init.body)) });
      if (failNextPost) {
        failNextPost = false;
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ seconds: serverSeconds }), { status: 200 }));
  },
  readJson: async (r: Response) => r.json(),
  leavingFetch: (_url: string, init: RequestInit) => {
    posts.push({ via: "leavingFetch", ...JSON.parse(String(init.body)) });
  },
}));

vi.mock("../src/web/scroll.js", () => ({ stickyOffset: () => 0 }));

const { useReadingTime, FLUSH_MS, IDLE_MS } = await import("../src/web/useReadingTime.js");
type ReadingTime = ReturnType<typeof useReadingTime>;

const A = "spya-aaaaaa";
const B = "spya-bbbbbb";
const C = "spya-cccccc";

let root: Root;
let host: HTMLDivElement;
let latest: ReadingTime;
let visibility: DocumentVisibilityState = "visible";

/** Rows at fixed viewport positions; `innerHeight` is 800. */
function mountRows(boxes: [string, number, number][]) {
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  for (const [id, top, bottom] of boxes) {
    const tr = document.createElement("tr");
    tr.dataset.block = id;
    tr.getBoundingClientRect = () => ({ top, bottom, height: bottom - top }) as DOMRect;
    tbody.append(tr);
  }
  table.append(tbody);
  document.body.append(table);
}

function Harness({ words, enabled }: { words: Map<string, number>; enabled: boolean }) {
  latest = useReadingTime("my-article", words, enabled);
  return null;
}

async function render(enabled = true, words = new Map([[A, 230], [B, 230], [C, 230]])) {
  await act(async () => {
    root.render(createElement(Harness, { words, enabled }));
  });
  /* Let the opening GET land. */
  await act(async () => {
    await Promise.resolve();
  });
}

async function seconds(n: number) {
  await act(async () => {
    vi.advanceTimersByTime(n * 1000);
  });
}

/** Everything sent so far, summed per block. */
function sent(): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of posts) for (const [id, s] of Object.entries(p.seconds)) out.set(id, (out.get(id) ?? 0) + s);
  return out;
}

beforeEach(() => {
  vi.useFakeTimers();
  posts = [];
  serverSeconds = {};
  failNextPost = false;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("useReadingTime", () => {
  it("counts the first screen of an article read without touching anything", async () => {
    mountRows([
      [A, 0, 400],
      [B, 400, 800],
      [C, 800, 1200],
    ]);
    await render();
    latest.setCounting(true);
    await seconds(10);
    await seconds(FLUSH_MS / 1000 - 10);

    expect(posts).toHaveLength(1);
    expect(posts[0]?.via).toBe("apiFetch");
    const total = sent();
    /* A minute shared between the two rows on screen, and nothing for the one below it. */
    expect(total.get(A)).toBeCloseTo(30, 0);
    expect(total.get(B)).toBeCloseTo(30, 0);
    expect(total.has(C)).toBe(false);
  });

  it("earns nothing until Reader says the prose is on screen", async () => {
    mountRows([[A, 0, 800]]);
    await render();
    await seconds(FLUSH_MS / 1000);
    expect(posts).toHaveLength(0);
  });

  it("earns nothing while the page is hidden", async () => {
    mountRows([[A, 0, 800]]);
    await render();
    latest.setCounting(true);
    visibility = "hidden";
    await seconds(FLUSH_MS / 1000);
    expect(posts).toHaveLength(0);
  });

  it("stops after the reader has been idle, and starts again when they come back", async () => {
    mountRows([[A, 0, 800]]);
    await render();
    latest.setCounting(true);
    await seconds(IDLE_MS / 1000 + 120);
    const idleTotal = sent().get(A) ?? 0;
    /* Up to the idle limit, and not the two minutes after it. */
    expect(idleTotal).toBeLessThanOrEqual(IDLE_MS / 1000 + 1);
    expect(idleTotal).toBeGreaterThan(IDLE_MS / 1000 - 60);

    posts = [];
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await seconds(3600);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await seconds(FLUSH_MS / 1000);
    const back = sent().get(A) ?? 0;
    /* Returning counts as activity, and the hour away is not credited. */
    expect(back).toBeGreaterThan(30);
    expect(back).toBeLessThanOrEqual(FLUSH_MS / 1000 + 2);
  });

  it("never re-sends a batch that failed", async () => {
    mountRows([[A, 0, 800]]);
    await render();
    latest.setCounting(true);
    failNextPost = true;
    await seconds(FLUSH_MS / 1000);
    expect(posts).toHaveLength(1);
    const lost = posts[0]?.seconds[A] ?? 0;
    expect(lost).toBeGreaterThan(50);

    await seconds(FLUSH_MS / 1000);
    expect(posts).toHaveLength(2);
    /* The second batch is the second minute only, not the first one again. */
    expect(posts[1]?.seconds[A]).toBeLessThanOrEqual(FLUSH_MS / 1000 + 1);
  });

  it("sends on hidden, and a pagehide straight after does not send the same seconds again", async () => {
    mountRows([[A, 0, 800]]);
    await render();
    latest.setCounting(true);
    await seconds(20);
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));

    expect(posts).toHaveLength(1);
    expect(posts[0]?.via).toBe("apiFetch");
    expect(posts[0]?.seconds[A]).toBeCloseTo(20, 0);
  });

  it("sends what is pending on pagehide with the keepalive fetch", async () => {
    mountRows([[A, 0, 800]]);
    await render();
    latest.setCounting(true);
    await seconds(15);
    window.dispatchEvent(new Event("pagehide"));
    expect(posts).toEqual([{ via: "leavingFetch", seconds: { [A]: expect.closeTo(15, 0) } }]);
  });

  it("draws the server's totals plus this page's, and changes levels only when a step is crossed", async () => {
    mountRows([[A, 0, 800]]);
    /* 230 words is 60 expected seconds; the server already has 15 (level 1). */
    serverSeconds = { [A]: 15, [C]: 60 };
    await render();
    expect(latest.levels.get(A)).toBe(1);
    expect(latest.levels.get(C)).toBe(4);
    expect(latest.levels.has(B)).toBe(false);

    latest.setCounting(true);
    const before = latest.levels;
    await seconds(1);
    /* 16 seconds is still level 1: the same map, so nothing re-renders. */
    expect(latest.levels).toBe(before);
    await seconds(10);
    expect(latest.levels.get(A)).toBe(2);
  });

  it("does nothing at all when switched off", async () => {
    mountRows([[A, 0, 800]]);
    serverSeconds = { [A]: 1000 };
    await render(false);
    latest.setCounting(true);
    await seconds(FLUSH_MS / 1000);
    window.dispatchEvent(new Event("pagehide"));
    expect(posts).toHaveLength(0);
    expect(latest.levels.size).toBe(0);
  });
});
