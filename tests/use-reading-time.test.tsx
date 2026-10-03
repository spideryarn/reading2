// @vitest-environment jsdom
/**
 * The recorder — src/web/useReadingTime.ts. What earns a second, what is sent,
 * and what is never sent twice.
 * docs/plans/260916c-show-where-you-have-spent-time-reading-in-the-spine-and-gutter.md.
 *
 * Rows are real `tbody tr[data-block]` elements with `getBoundingClientRect`
 * stubbed, so the hook's own selector, binary search and sharing are what run.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Every POST body, parsed, and how it was sent. */
let posts: { via: "apiFetch" | "leavingFetch"; seconds: Record<string, number> }[] = [];
/** What the opening GET answers. */
let serverSeconds: Record<string, number> = {};
/** When set, the next POST through `apiFetch` rejects, as a lost connection does. */
let failNextPost = false;
/** Hold the opening GET or next POST to exercise request ordering. */
let holdGet = false;
let releaseGet: (() => void) | null = null;
let holdNextPost = false;
let releasePost: (() => void) | null = null;
let gets = 0;
/** When set, the opening GET rejects. */
let failGet = false;
/** A server refusal reaches `readJson`, which rejects it even when its body is JSON. */
let getStatus = 200;
let postCommitsToServer = false;

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push({ via: "apiFetch", ...JSON.parse(String(init.body)) });
      if (postCommitsToServer) {
        for (const [id, seconds] of Object.entries(posts.at(-1)?.seconds ?? {})) {
          serverSeconds[id] = (serverSeconds[id] ?? 0) + seconds;
        }
      }
      if (failNextPost) {
        failNextPost = false;
        throw new TypeError("Failed to fetch");
      }
      if (holdNextPost) {
        holdNextPost = false;
        await new Promise<void>((resolve) => {
          releasePost = resolve;
        });
      }
      return new Response(null, { status: 204 });
    }
    gets += 1;
    if (failGet) throw new TypeError("Failed to fetch");
    if (holdGet) {
      await new Promise<void>((resolve) => {
        releaseGet = resolve;
      });
    }
    return new Response(JSON.stringify({ seconds: serverSeconds }), { status: getStatus });
  },
  readJson: async (r: Response) => {
    if (!r.ok) throw new Error(`Request failed (${r.status})`);
    return r.json();
  },
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

function Harness({
  words,
  enabled,
  slug = "my-article",
}: {
  words: Map<string, number>;
  enabled: boolean;
  slug?: string;
}) {
  latest = useReadingTime(slug, words, enabled);
  return null;
}

async function render(
  enabled = true,
  words = new Map([[A, 230], [B, 230], [C, 230]]),
  slug = "my-article",
) {
  await act(async () => {
    root.render(createElement(Harness, { words, enabled, slug }));
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
  holdGet = false;
  releaseGet = null;
  holdNextPost = false;
  releasePost = null;
  gets = 0;
  failGet = false;
  getStatus = 200;
  postCommitsToServer = false;
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

  it("does not let a flush land before the opening GET and double the displayed seconds", async () => {
    mountRows([[A, 0, 800]]);
    holdGet = true;
    postCommitsToServer = true;
    await render(true, new Map([[A, 100]]));
    latest.setCounting(true);
    await seconds(15);
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));

    /* Before the fix this POST went out while the GET was held. A real delayed
       GET could then include it, while `local` kept the same seconds. A
       bfcache pagehide must not bypass the same ordering on the way to Back. */
    expect(posts).toHaveLength(0);
    releaseGet?.();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(posts).toHaveLength(1);
    expect(latest.levels.get(A)).toBe(1);
  });

  it("waits for the preceding mount's cleanup POST before opening the same article again", async () => {
    mountRows([[A, 0, 800]]);
    await render(true, new Map([[A, 100]]));
    latest.setCounting(true);
    await seconds(15);

    holdNextPost = true;
    await render(false, new Map([[A, 100]]));
    await act(async () => {
      await Promise.resolve();
    });
    expect(posts).toHaveLength(1);

    await render(true, new Map([[A, 100]]));
    expect(gets, "the second opening read waits behind the cleanup write").toBe(1);

    const saved = posts[0]?.seconds[A] ?? 0;
    serverSeconds = { [A]: saved };
    releasePost?.();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(gets).toBe(2);
    expect(latest.levels.get(A)).toBe(1);
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
    /* 230 words is 60 expected seconds; the server already has 25 (level 1). */
    serverSeconds = { [A]: 25, [C]: 170 };
    await render();
    expect(latest.levels.get(A)).toBe(1);
    expect(latest.levels.get(C)).toBe(4);
    expect(latest.levels.has(B)).toBe(false);

    latest.setCounting(true);
    const before = latest.levels;
    await seconds(1);
    /* 26 seconds is still level 1: the same map, so nothing re-renders. */
    expect(latest.levels).toBe(before);
    await seconds(20);
    expect(latest.levels.get(A)).toBe(2);
  });

  /* The spine's area chart — reach in sixteenths, finer than a level.
     docs/plans/261003j-reading-time-on-the-spine-drawn-as-an-area-chart.md, F4. */
  it("moves reach inside an unchanged level, and levels keeps its identity while it does", async () => {
    mountRows([[A, 0, 800]]);
    /* 230 words is 60 expected seconds. 43 s is level 2, reach 8; 51 s is
       still level 2 and reach 9 (60 × 0.7 × 2^¼ ≈ 49.9). */
    serverSeconds = { [A]: 43 };
    await render();
    expect(latest.levels.get(A)).toBe(2);
    expect(latest.reach.get(A)).toBe(8);

    latest.setCounting(true);
    const levels = latest.levels;
    const reach = latest.reach;
    await seconds(1);
    /* 44 s: neither moved, so neither map is a new one. */
    expect(latest.reach).toBe(reach);
    expect(latest.levels).toBe(levels);

    await seconds(7);
    expect(latest.reach.get(A)).toBe(9);
    expect(latest.reach).not.toBe(reach);
    expect(latest.levels, "a reach step inside a level must not wake the gutter or the quiz").toBe(levels);
    expect(latest.levels.get(A)).toBe(2);
  });

  it("combines the opening GET with what this page credited before it answered, in reach too", async () => {
    mountRows([[A, 0, 800]]);
    serverSeconds = { [A]: 40, [C]: 170 };
    holdGet = true;
    await render();
    latest.setCounting(true);
    await seconds(4);
    /* 4 local seconds alone are under 0.35 of 60. */
    expect(latest.reach.size).toBe(0);
    releaseGet?.();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    /* 40 + 4 = 44 s: level 2, reach 8. Neither total alone reaches 42. */
    expect(latest.reach.get(A)).toBe(8);
    expect(latest.reach.get(C)).toBe(16);
    expect(latest.reach.has(B)).toBe(false);
  });

  it("clears reach when switched off and for a new article", async () => {
    mountRows([[A, 0, 800]]);
    serverSeconds = { [A]: 100 };
    await render();
    expect(latest.reach.get(A)).toBe(13);

    serverSeconds = {};
    await render(true, undefined, "another-article");
    expect(latest.reach.size).toBe(0);

    serverSeconds = { [A]: 100 };
    await render(true, undefined, "my-article");
    expect(latest.reach.get(A)).toBe(13);
    await render(false);
    expect(latest.reach.size).toBe(0);
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
    expect(latest.reach.size).toBe(0);
  });
});

describe("useReadingTime's status — whether an empty map means read nothing", () => {
  it("is loading until the opening read answers, then loaded", async () => {
    mountRows([[A, 0, 800]]);
    holdGet = true;
    await render();
    expect(latest.status).toBe("loading");
    expect(latest.levels.size).toBe(0);
    await act(async () => {
      releaseGet?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(latest.status).toBe("loaded");
  });

  it("says failed, not loaded, when the opening read fails — an empty map is not read nothing", async () => {
    mountRows([[A, 0, 800]]);
    serverSeconds = { [A]: 1000 };
    failGet = true;
    await render();
    expect(latest.status).toBe("failed");
  });

  it("says failed when the opening GET answers with a non-OK response", async () => {
    mountRows([[A, 0, 800]]);
    getStatus = 503;
    await render();
    expect(latest.status).toBe("failed");
  });

  it("is off when switched off, and loading again when switched back on", async () => {
    mountRows([[A, 0, 800]]);
    await render();
    expect(latest.status).toBe("loaded");
    await render(false);
    expect(latest.status).toBe("off");
    holdGet = true;
    await render(true);
    /* A new run: the old run's "loaded" must not carry over into it. */
    expect(latest.status).toBe("loading");
  });

  it("is loading synchronously for a different article, not loaded from the preceding slug", async () => {
    mountRows([[A, 0, 800]]);
    await render();
    expect(latest.status).toBe("loaded");

    holdGet = true;
    await render(true, new Map([[A, 230]]), "another-article");
    expect(latest.status).toBe("loading");
  });

  it("makes one opening GET and settles under StrictMode's effect replay", async () => {
    mountRows([[A, 0, 800]]);
    holdGet = true;
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(Harness, { words: new Map([[A, 230]]), enabled: true }),
        ),
      );
    });
    expect(gets).toBe(1);
    expect(latest.status).toBe("loading");

    await act(async () => {
      releaseGet?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(latest.status).toBe("loaded");
  });
});

describe("useReadingTime's timeFor — the seconds behind the card (261002e)", () => {
  it("answers the server's total plus this page's, live, under one stable function", async () => {
    mountRows([[A, 0, 800]]);
    serverSeconds = { [A]: 25 };
    await render();
    const timeFor = latest.timeFor;
    expect(timeFor(A)).toEqual({ seconds: 25, expected: 60 });
    expect(timeFor(B)).toEqual({ seconds: 0, expected: 60 });

    latest.setCounting(true);
    await seconds(3);
    expect(latest.timeFor).toBe(timeFor);
    expect(timeFor(A)?.seconds).toBeCloseTo(28, 5);
  });

  it("answers nothing once the switch is off, and nothing from the previous article", async () => {
    mountRows([[A, 0, 800]]);
    serverSeconds = { [A]: 25 };
    await render();
    const timeFor = latest.timeFor;
    expect(timeFor(A)?.seconds).toBe(25);

    await render(false);
    expect(timeFor(A)).toBeNull();

    await render(true);
    expect(timeFor(A)?.seconds).toBe(25);

    serverSeconds = {};
    holdGet = true;
    await render(true, new Map([[A, 230]]), "another-article");
    expect(timeFor(A)?.seconds).toBe(0);
  });

  it("still answers after StrictMode's effect replay", async () => {
    mountRows([[A, 0, 800]]);
    serverSeconds = { [A]: 25 };
    await act(async () => {
      root.render(
        createElement(StrictMode, null, createElement(Harness, { words: new Map([[A, 230]]), enabled: true })),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(latest.timeFor(A)?.seconds).toBe(25);
  });

  it("makes a retained lookup inert on unmount", async () => {
    mountRows([[A, 0, 800]]);
    serverSeconds = { [A]: 25 };
    await render();
    const timeFor = latest.timeFor;
    expect(timeFor(A)?.seconds).toBe(25);

    await act(async () => root.unmount());
    expect(timeFor(A)).toBeNull();
    /* Give afterEach a live root; React roots cannot be rendered again after
       unmounting, and the shared teardown owns the ordinary cleanup. */
    root = createRoot(host);
  });
});
