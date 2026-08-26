// @vitest-environment jsdom
/**
 * useSearch.ts's streaming half — see src/web/useSearch.ts and
 * docs/project/search.md.
 *
 * No testing-library here — nothing in this repo depends on one (see
 * docs/project/testing.md), and React ships everything a hook test needs on
 * its own: `act` from `react`, `createRoot` from `react-dom/client`. A bare
 * function component calls the hook and reports its return value out through
 * a module-level variable on every render, so the test can drive a stubbed
 * `fetch` and read the hook's state without a rendering library in between.
 *
 * `fetch` is stubbed with real SSE frame text, the same discipline
 * tests/search-stream.test.ts and the route tests in tests/routes.test.ts
 * follow — a mock of the shape the server actually sends is worth having.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSearch, type SearchApi } from "../src/web/useSearch.js";
import type { SearchHit, SearchRun } from "../src/types.js";

let container: HTMLDivElement;
let root: Root;
let latest: SearchApi | undefined;

function Harness({ slug }: { slug: string }) {
  latest = useSearch(slug);
  return null;
}

async function mount(slug: string): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Harness, { slug }));
  });
}

/**
 * Let the pending microtasks of a `fetch().then(...)` chain and a
 * `for await` loop over a stream actually settle. `setTimeout(0)` rather than
 * a bare `Promise.resolve()` because the mocked `ReadableStream`'s `pull`
 * callback and `readEvents`' reader loop both add their own microtask hops,
 * and a macrotask boundary is the cheap way to be sure they have all run.
 */
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function sseBytes(frames: { event: string; data: unknown }[]): Uint8Array {
  const text = frames.map((f) => `event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`).join("");
  return new TextEncoder().encode(text);
}

/** A one-shot stream: the whole frame list, delivered in a single chunk. */
function oneShotStream(frames: { event: string; data: unknown }[]): ReadableStream<Uint8Array> {
  const bytes = sseBytes(frames);
  return new ReadableStream<Uint8Array>({
    pull(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
}

/**
 * Called with the body the hook actually POSTed — `{ id, criterion }` — so a
 * test can set this up *before* calling `ask`/`retry` and still echo back
 * whichever id the hook minted, rather than having to guess it.
 */
let postImpl: ((body: { id: string; criterion: string }) => Promise<Response>) | undefined;

beforeEach(() => {
  // React's `act` refuses to run outside a testing library it recognises
  // unless told this is a real test environment — this is the flag it reads.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  postImpl = undefined;
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    if (!init?.method) {
      // The GET on mount.
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ runs: [] })),
      } as unknown as Response);
    }
    if (init.method === "POST") {
      if (!postImpl) throw new Error("no postImpl set for this test");
      return postImpl(JSON.parse((init.body as string) ?? "{}"));
    }
    if (init.method === "DELETE") {
      return Promise.resolve({ ok: true, text: () => Promise.resolve("") } as unknown as Response);
    }
    throw new Error(`unexpected fetch: ${init.method}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  latest = undefined;
  vi.unstubAllGlobals();
});

describe("hits stream in, and done is authoritative", () => {
  it("accumulates hits in arrival order while pending, then done replaces them with the authoritative set", async () => {
    await mount("a-slug");
    await flush();

    const HIT1: SearchHit = { blockId: "spya-aaaaaa", quote: "one", confidence: 90, reasoning: "r1" };
    const HIT2: SearchHit = { blockId: "spya-bbbbbb", quote: "two", confidence: 70, reasoning: "r2" };
    const HIT3: SearchHit = { blockId: "spya-cccccc", quote: "three", confidence: 60, reasoning: "r3" };
    const createdAt = "2026-01-01T00:00:00.000Z";

    // begin echoes the same id back (no re-mint — see the module docstring),
    // then two hits, then a done whose hits genuinely differ from what
    // streamed: HIT2 dropped, HIT3 added. That is the property under test.
    // Set *before* `ask` runs — `send` calls `fetch` synchronously up to its
    // first `await`, so a `postImpl` assigned after `ask` returns is too late.
    postImpl = ({ id, criterion }) =>
      Promise.resolve({
        ok: true,
        body: oneShotStream([
          { event: "begin", data: { id, criterion, createdAt, status: "pending", hits: [] } },
          { event: "hit", data: { hit: HIT1 } },
          { event: "hit", data: { hit: HIT2 } },
          { event: "done", data: { id, criterion, createdAt, status: "done", hits: [HIT1, HIT3], model: "test-model" } },
        ]),
      } as unknown as Response);

    const id = latest?.ask("arguments against dualism");
    expect(id).toBeTruthy();
    const runId = id as string;

    await flush();

    const run = latest?.runs.find((r) => r.id === runId);
    expect(run?.status).toBe("done");
    expect(run?.hits).toEqual([HIT1, HIT3]);
  });
});

describe("a run deleted while the model is thinking wins", () => {
  it("drops a hit frame, and the done frame, for a run the reader has already removed", async () => {
    await mount("a-slug");
    await flush();

    const HIT: SearchHit = { blockId: "spya-aaaaaa", quote: "one", confidence: 90, reasoning: "r" };
    const createdAt = "2026-01-01T00:00:00.000Z";

    let pulls = 0;
    // Set *before* `ask` — see the note in the test above.
    postImpl = ({ id, criterion }) =>
      Promise.resolve({
        ok: true,
        body: new ReadableStream<Uint8Array>({
          pull(c) {
            pulls++;
            if (pulls === 1) {
              c.enqueue(sseBytes([{ event: "begin", data: { id, criterion, createdAt, status: "pending", hits: [] } }]));
              return;
            }
            if (pulls === 2) {
              // The reader deletes the run right after `begin` lands, before
              // the hit that is about to arrive.
              latest?.remove(id);
              c.enqueue(sseBytes([{ event: "hit", data: { hit: HIT } }]));
              return;
            }
            if (pulls === 3) {
              c.enqueue(
                sseBytes([{ event: "done", data: { id, criterion, createdAt, status: "done", hits: [HIT], model: "m" } }]),
              );
              return;
            }
            c.close();
          },
        }),
      } as unknown as Response);

    const id = latest?.ask("a criterion") as string;

    await flush();

    // Deleted, and it stays deleted — neither the `hit` nor the `done` frame
    // that arrived afterwards put the row back.
    expect(latest?.runs.some((r: SearchRun) => r.id === id)).toBe(false);
  });
});
