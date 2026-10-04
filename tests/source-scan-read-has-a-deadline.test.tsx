// @vitest-environment jsdom
/**
 * **The Referee band's scan read ends, even when the request never answers.**
 *
 * `useSourceScan` reads `GET /api/referee/scan/:slug` once, on mount, and until
 * 2026-10-04 it did so with no deadline of its own: `apiFetch` has none, so a
 * request that never answered left the notice saying it was checking the
 * document for ever. docs/plans/261004c-sweep-cluster-5-a-failed-read-can-be-retried-and-says-a-readers-sentence.md § 2b.
 *
 * Three things are asked of the hook:
 *
 * - **A read that never settles becomes `failed` at the deadline**, with the
 *   scan's own sentence (`[rd-scan-timeout]` — matched on the code, not the
 *   prose, per docs/project/copy.md § The bracketed code), and the request's
 *   signal is aborted. One tick *before* the deadline it is still `loading`,
 *   which is the positive control that the clock is the scan's and not the
 *   saved lists' much shorter one.
 * - **An answer before the deadline is still `ready`** — the deadline must not
 *   cost the ordinary case anything, including the nine-second scan of a large
 *   paper, which is past nothing but would be most of the lists' 15 s.
 * - **Going away aborts the request.** The hook has no retry, so an unmounted
 *   band's read is nobody's.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SourceScan } from "../src/injection-scan-types.js";
import type { SourceScanState } from "../src/web/useSourceScan.js";

/** One reply per request, decided by the case that is running. */
let answer: (url: string, init: RequestInit) => Promise<Response>;
/** Every request the hook sent, with the signal it carried. */
let sent: { url: string; signal: AbortSignal | null | undefined }[] = [];

/* The signal is honoured, as real `fetch` honours it — the same shape as
   tests/opening-read-gates-writes.test.tsx § the mock. `readJson` stays real. */
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  const apiFetch = (url: string, init: RequestInit = {}) => {
    sent.push({ url, signal: init.signal });
    const reply = answer(url, init);
    const signal = init.signal;
    if (!signal) return reply;
    return new Promise<Response>((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException("aborted", "AbortError"));
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      reply.then(resolve, reject);
    });
  };
  return { ...real, apiFetch };
});

const { useSourceScan, SOURCE_SCAN_DEADLINE_MS } = await import("../src/web/useSourceScan.js");
const { OPENING_READ_DEADLINE_MS } = await import("../src/web/lib/opening-read.js");
const { SCAN_TIMED_OUT, kindOfMessage } = await import("../src/messages.js");

const SLUG = "a-paper";

let host: HTMLDivElement;
let root: Root;
let seen: SourceScanState;

function Probe({ slug }: { slug: string }) {
  seen = useSourceScan(slug);
  return null;
}

async function mount(slug = SLUG) {
  await act(async () => {
    root.render(createElement(Probe, { slug }));
  });
}

/** A promise that never settles: the request that vanished. */
const never = () => new Promise<Response>(() => {});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  sent = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("useSourceScan — the read has an end", () => {
  it("a request that never answers is `failed` at the scan's deadline, and is aborted", async () => {
    answer = never;
    await mount();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`/api/referee/scan/${SLUG}`);
    expect(seen).toEqual({ state: "loading" });

    /* Not the lists' deadline: a nine-second scan needs more room than that. */
    expect(SOURCE_SCAN_DEADLINE_MS).toBe(60_000);
    expect(SOURCE_SCAN_DEADLINE_MS).toBeGreaterThan(OPENING_READ_DEADLINE_MS);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SOURCE_SCAN_DEADLINE_MS - 1);
    });
    expect(seen).toEqual({ state: "loading" });
    expect(sent[0]?.signal?.aborted).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(seen.state).toBe("failed");
    if (seen.state !== "failed") throw new Error("unreachable");
    expect(seen.error).toMatch(/\[rd-scan-timeout\]/);
    expect(seen.error).toBe(SCAN_TIMED_OUT.message);
    expect(kindOfMessage(seen.error)).toBe("retry");
    expect(sent[0]?.signal?.aborted).toBe(true);
  });

  it("an answer before the deadline is still `ready`, and the deadline does nothing later", async () => {
    const scan = { examined: false, reason: "pdf" } as unknown as SourceScan;
    let release!: (r: Response) => void;
    answer = () => new Promise<Response>((resolve) => (release = resolve));
    await mount();

    /* Past the lists' fifteen seconds, which is the whole reason for the option. */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OPENING_READ_DEADLINE_MS + 5_000);
    });
    expect(seen).toEqual({ state: "loading" });

    await act(async () => {
      release(json({ scan }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen).toEqual({ state: "ready", scan });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SOURCE_SCAN_DEADLINE_MS * 2);
    });
    expect(seen).toEqual({ state: "ready", scan });
  });

  it("keeps the `no-source` and `body.error` arms", async () => {
    answer = async () => json({ scan: null });
    await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen).toEqual({ state: "no-source" });

    answer = async () => json({ error: "The server's own sentence." });
    await mount("another-paper");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen).toEqual({ state: "failed", error: "The server's own sentence." });
  });

  it("unmounting aborts the request", async () => {
    answer = never;
    await mount();
    expect(sent[0]?.signal?.aborted).toBe(false);
    await act(async () => root.unmount());
    expect(sent[0]?.signal?.aborted).toBe(true);
    root = createRoot(host);
  });

  it("a new slug aborts the old request and the old deadline says nothing", async () => {
    answer = never;
    await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SOURCE_SCAN_DEADLINE_MS - 10_000);
    });
    await mount("another-paper");
    expect(sent).toHaveLength(2);
    expect(sent[0]?.signal?.aborted).toBe(true);
    expect(sent[1]?.signal?.aborted).toBe(false);

    /* Past the first read's deadline, short of the second's. */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(seen).toEqual({ state: "loading" });
  });
});
