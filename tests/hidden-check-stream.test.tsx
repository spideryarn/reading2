// @vitest-environment jsdom
/**
 * **`useHiddenCheck`: the terminal contract, one run at a time, nothing spent
 * without a press, and a run that ends with the article.** The hook behind
 * Hidden text's *Ask Opus about these* (src/web/useHiddenCheck.ts), held by
 * `RefereeBand` beside the scan. Harness and reasoning copied from
 * tests/referee-mirror-stream.test.tsx, which is the same argument for Mirror.
 *
 * And since 2026-10-09 (plan 261009a) **the kept answer comes back on load**:
 * a `GET` the hook makes itself, which a press overtakes and a failed run does
 * not wipe.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type HiddenCheckApi, useHiddenCheck } from "../src/web/useHiddenCheck.js";

let container: HTMLDivElement;
let root: Root;
let latest: HiddenCheckApi | undefined;

function Harness({ slug }: { slug: string }) {
  latest = useHiddenCheck(slug);
  return null;
}

const enc = new TextEncoder();
const frame = (event: string, data: unknown) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

const DONE = { judgments: [], unanswered: 2, notSent: 0, model: "m", checkedAt: "2026-10-08T12:00:00.000Z" };

let runBody: () => ReadableStream<Uint8Array>;
let posts: { url: string; signal: AbortSignal | undefined }[] = [];
/** What `GET` answers with: the kept check, or `null`. */
let keptCheck: unknown = null;
/** Held until released, so a test can make the read land late. */
let keptGate: Promise<void> = Promise.resolve();

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render(slug: string): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness, { slug }));
  });
  await settle();
}

async function ask(): Promise<void> {
  await act(async () => {
    latest?.ask();
  });
  await settle();
}

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  posts = [];
  keptCheck = null;
  keptGate = Promise.resolve();
  runBody = () =>
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(frame("delta", { chars: 12 }));
        c.close();
      },
    });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.startsWith("/api/referee/hidden-check/")) {
        posts.push({ url, signal: init.signal ?? undefined });
        return Promise.resolve({ ok: true, status: 200, body: runBody() } as unknown as Response);
      }
      if (!init?.method && url.startsWith("/api/referee/hidden-check/")) {
        const check = keptCheck;
        return keptGate.then(() => ({ ok: true, status: 200, json: async () => ({ check }) }) as unknown as Response);
      }
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await render("a-paper");
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  latest = undefined;
});

describe("nothing is spent without a press", () => {
  it("makes no request on mount", () => {
    expect(posts).toHaveLength(0);
    expect(latest?.status).toBe("idle");
  });

  it("will not start a second run while one is in the air", async () => {
    runBody = () => new ReadableStream<Uint8Array>({ start() {} });
    await ask();
    await ask();
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe("/api/referee/hidden-check/a-paper");
  });
});

describe("the terminal contract", () => {
  it("files a body that stops without a done frame as a failure, not an empty answer", async () => {
    await ask();
    expect(latest?.status).toBe("failed");
    expect(latest?.result).toBeNull();
    expect(latest?.error).toMatch(/stopped arriving before it was finished/);
  });

  it("takes a real done frame as the answer, and counts characters on the way", async () => {
    let chars = 0;
    runBody = () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(frame("delta", { chars: 40 }));
          c.enqueue(frame("done", DONE));
          c.close();
        },
      });
    await ask();
    chars = latest?.chars ?? -1;
    expect(latest?.status).toBe("done");
    expect(latest?.result).toEqual(DONE);
    expect(chars).toBe(40);
  });

  it("accepts a completed judgment with its checked inputs intact", async () => {
    const data = {
      ...DONE,
      judgments: [{ row: { key: "k", count: 39, totalPaths: 39, paths: ["p1", "p2", "p3", "p4", "p5"] },
        verdict: "worth-a-look", reason: "Hidden words addressed to a reviewer." }],
    };
    runBody = () => new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(frame("done", data));
        c.close();
      },
    });
    await ask();
    expect(latest?.status).toBe("done");
    expect(latest?.result).toEqual(data);
  });

  it("refuses a done frame without the date it was kept", async () => {
    const { checkedAt: _checkedAt, ...undated } = DONE;
    runBody = () => new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(frame("done", undated));
        c.close();
      },
    });
    await ask();
    expect(latest?.status).toBe("failed");
  });

  it("accepts a paid answer whose save failed, including its not-saved marker", async () => {
    const notSaved = { ...DONE, saved: false as const };
    runBody = () => new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(frame("done", notSaved));
        c.close();
      },
    });
    await ask();
    expect(latest?.status).toBe("done");
    expect(latest?.result).toEqual(notSaved);
  });

  it("refuses a done frame it cannot read", async () => {
    runBody = () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(frame("done", { judgments: "no" }));
          c.close();
        },
      });
    await ask();
    expect(latest?.status).toBe("failed");
  });

  it.each([
    { ...DONE, judgments: [null] },
    { ...DONE, judgments: [{ row: null, verdict: "worth-a-look", reason: "x" }] },
    { ...DONE, judgments: [{ row: { key: "k", count: 1, totalPaths: 1, paths: [null] }, verdict: "worth-a-look", reason: "x" }] },
    { ...DONE, judgments: [{ row: { key: "k", count: 1, totalPaths: 1, paths: ["p"] }, verdict: "harmless", reason: "x" }] },
    { ...DONE, judgments: [{ row: { key: "k", count: 1, totalPaths: 1, paths: ["p"] }, verdict: "worth-a-look", reason: 42 }] },
    { ...DONE, unanswered: -1 },
    { ...DONE, notSent: "0" },
    { judgments: [], unanswered: 0 },
  ])("refuses malformed completed results before the panel can read them: %j", async (data) => {
    runBody = () => new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(frame("done", data));
        c.close();
      },
    });
    await ask();
    expect(latest?.status).toBe("failed");
    expect(latest?.result).toBeNull();
    expect(latest?.error).toMatch(/answer this page could not read/);
  });

  it("carries the reason from an error frame", async () => {
    runBody = () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(frame("error", { error: "The AI service is busy." }));
          c.close();
        },
      });
    await ask();
    expect(latest?.error).toContain("The AI service is busy.");
  });
});

describe("a run belongs to its article", () => {
  it("is aborted, and its answer forgotten, when the article changes", async () => {
    runBody = () => new ReadableStream<Uint8Array>({ start() {} });
    await ask();
    expect(posts[0]?.signal?.aborted).toBe(false);
    await render("another-paper");
    expect(posts[0]?.signal?.aborted).toBe(true);
    expect(latest?.status).toBe("idle");
    expect(latest?.result).toBeNull();
  });
});

describe("the kept answer (plan 261009a)", () => {
  it("comes back on load, as a finished check, with no paid call", async () => {
    keptCheck = DONE;
    await render("a-kept-paper");
    expect(latest?.status).toBe("done");
    expect(latest?.result).toEqual(DONE);
    expect(posts).toHaveLength(0);
  });

  it("is ignored when it cannot be read", async () => {
    keptCheck = { judgments: "no", checkedAt: "2026-10-08T12:00:00.000Z" };
    await render("a-garbled-paper");
    expect(latest?.status).toBe("idle");
    expect(latest?.result).toBeNull();
  });

  it("does not land over a run the referee started while it was arriving", async () => {
    let release = () => {};
    keptGate = new Promise((r) => {
      release = r;
    });
    keptCheck = { ...DONE, model: "the-kept-one" };
    await render("a-slow-paper");
    runBody = () => new ReadableStream<Uint8Array>({ start() {} });
    await ask();
    release();
    await settle();
    expect(latest?.status).toBe("running");
    expect(latest?.result).toBeNull();
  });

  it("stays on screen when a later run fails", async () => {
    keptCheck = DONE;
    await render("a-retried-paper");
    await ask();
    expect(latest?.status).toBe("failed");
    expect(latest?.result).toEqual(DONE);
  });

  it("stays on screen while a later run is still arriving", async () => {
    keptCheck = DONE;
    await render("a-running-retry");
    runBody = () => new ReadableStream<Uint8Array>({ start() {} });
    await ask();
    expect(latest?.status).toBe("running");
    expect(latest?.result).toEqual(DONE);
  });
});
