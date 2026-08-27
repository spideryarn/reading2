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
    if (init.method === "PATCH") {
      return Promise.resolve({ ok: true, text: () => Promise.resolve("{}") } as unknown as Response);
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

describe("the reader's colour choice beats a frame that predates it", () => {
  it("keeps a colour picked mid-search when the done frame carries the old one", async () => {
    /* The race the `chosen` ref exists for. A meaning search takes half a
       minute and the row is on screen the whole time, so recolouring one that
       is still running is an ordinary thing to do — and the `done` frame is a
       snapshot of the row as the server finished writing it, which can predate
       the PATCH. Without the ref, the colour the reader just picked is painted
       back to the old one and stays wrong until a reload, while the disk is
       correct the whole time.

       The stream is split so that the recolour happens *between* `begin` and
       `done`, which is the only way to reproduce it. */
    await mount("a-slug");
    await flush();

    const createdAt = "2026-01-01T00:00:00.000Z";
    let release: (() => void) | undefined;
    postImpl = ({ id, criterion }) =>
      Promise.resolve({
        ok: true,
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(
              sseBytes([
                { event: "begin", data: { id, criterion, createdAt, status: "pending", hits: [], colour: 1 } },
              ]),
            );
            release = () => {
              // The row as the server had it *before* the PATCH landed.
              c.enqueue(
                sseBytes([
                  { event: "done", data: { id, criterion, createdAt, status: "done", hits: [], colour: 1 } },
                ]),
              );
              c.close();
            };
          },
        }),
      } as unknown as Response);

    const runId = latest?.ask("arguments against dualism") as string;
    await flush();
    expect(latest?.runs.find((r) => r.id === runId)?.colour).toBe(1);

    await act(async () => {
      latest?.recolour(runId, 6);
    });
    expect(latest?.runs.find((r) => r.id === runId)?.colour).toBe(6);

    await act(async () => release?.());
    await flush();

    const run = latest?.runs.find((r) => r.id === runId);
    expect(run?.status).toBe("done");
    expect(run?.colour).toBe(6);
  });

  it("keeps 'automatic' too, which is a choice rather than the absence of one", async () => {
    await mount("a-slug");
    await flush();

    const createdAt = "2026-01-01T00:00:00.000Z";
    let release: (() => void) | undefined;
    postImpl = ({ id, criterion }) =>
      Promise.resolve({
        ok: true,
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(
              sseBytes([
                { event: "begin", data: { id, criterion, createdAt, status: "pending", hits: [], colour: 4 } },
              ]),
            );
            release = () => {
              c.enqueue(
                sseBytes([
                  { event: "done", data: { id, criterion, createdAt, status: "done", hits: [], colour: 4 } },
                ]),
              );
              c.close();
            };
          },
        }),
      } as unknown as Response);

    const runId = latest?.ask("arguments against dualism") as string;
    await flush();

    await act(async () => {
      latest?.recolour(runId, null);
    });
    await act(async () => release?.());
    await flush();

    const run = latest?.runs.find((r) => r.id === runId);
    // Absent, not `undefined` sitting in the object — see `withChoice`.
    expect(run && "colour" in run).toBe(false);
  });
});

describe("two colour choices in quick succession", () => {
  it("reaches the server in the order the reader made them", async () => {
    /* Two independent PATCHes have no ordering, and the failure is the quiet
       kind: the screen follows the reader (via `chosen`) while the store
       finishes on whichever request happened to land last. Nothing looks wrong
       until a reload — which is the reader being told their choice took when
       it did not.

       The mock holds the first PATCH open until the second has been asked for,
       so a hook that fires them in parallel sends both and this test sees two
       in flight at once; one that chains them cannot get past the first. */
    await mount("a-slug");
    await flush();

    const sent: (number | null)[] = [];
    let inFlight = 0;
    let peak = 0;
    let releaseFirst: (() => void) | undefined;
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_url: string, init?: RequestInit) => {
        if (init?.method !== "PATCH") {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(JSON.stringify({ runs: [] })),
          } as unknown as Response);
        }
        const { colour } = JSON.parse((init.body as string) ?? "{}") as { colour: number | null };
        sent.push(colour);
        inFlight++;
        peak = Math.max(peak, inFlight);
        const done = { ok: true, text: () => Promise.resolve("{}") } as unknown as Response;
        if (sent.length === 1) {
          return new Promise<Response>((resolve) => {
            releaseFirst = () => {
              inFlight--;
              resolve(done);
            };
          });
        }
        inFlight--;
        return Promise.resolve(done);
      },
    );

    await act(async () => {
      latest?.recolour("spya-aaaaaa", 2);
      latest?.recolour("spya-aaaaaa", 4);
    });
    await flush(2);

    // The second has not been sent while the first is still out.
    expect(sent).toEqual([2]);
    expect(peak).toBe(1);

    await act(async () => releaseFirst?.());
    await flush();

    expect(sent).toEqual([2, 4]);
    expect(peak).toBe(1);
  });

  it("does not wedge the row when one of them fails", async () => {
    /* **Two things keep the chain alive and this pins the outcome, not either
       of them** — which is worth saying, because it means the test does not go
       red if you remove one. `send` catches its own failure, so the promise it
       returns never rejects; and the chain hands the tail `.then(send, send)`
       rather than `.then(send)`. Either alone is enough today. Both are kept
       because the cost is nothing and the failure they prevent is the worst
       shape there is: one dropped connection wedging that row's colour for the
       rest of the session, silently. */
    await mount("a-slug");
    await flush();

    const sent: (number | null)[] = [];
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_url: string, init?: RequestInit) => {
        if (init?.method !== "PATCH") {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(JSON.stringify({ runs: [] })),
          } as unknown as Response);
        }
        const { colour } = JSON.parse((init.body as string) ?? "{}") as { colour: number | null };
        sent.push(colour);
        return sent.length === 1
          ? Promise.reject(new Error("the connection dropped"))
          : Promise.resolve({ ok: true, text: () => Promise.resolve("{}") } as unknown as Response);
      },
    );

    await act(async () => latest?.recolour("spya-aaaaaa", 2));
    await flush();
    await act(async () => latest?.recolour("spya-aaaaaa", 5));
    await flush();

    expect(sent).toEqual([2, 5]);
  });

  it("does not make one run's colour wait for another's", async () => {
    // One chain per run: two different searches have no ordering to keep, and
    // making the second wait would be a stall for nothing.
    await mount("a-slug");
    await flush();

    let inFlight = 0;
    let peak = 0;
    const held: (() => void)[] = [];
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_url: string, init?: RequestInit) => {
        if (init?.method !== "PATCH") {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(JSON.stringify({ runs: [] })),
          } as unknown as Response);
        }
        inFlight++;
        peak = Math.max(peak, inFlight);
        return new Promise<Response>((resolve) => {
          held.push(() => {
            inFlight--;
            resolve({ ok: true, text: () => Promise.resolve("{}") } as unknown as Response);
          });
        });
      },
    );

    await act(async () => {
      latest?.recolour("spya-aaaaaa", 2);
      latest?.recolour("spya-bbbbbb", 4);
    });
    await flush(2);
    expect(peak).toBe(2);
    await act(async () => {
      for (const release of held) release();
    });
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

describe("a stream that stops without ending", () => {
  /**
   * The failure this exists for is not a stream that *closes* early — that one
   * has always been handled, and the hook's own "The search stopped arriving"
   * covers it. It is a stream that simply goes quiet: no bytes, no close, no
   * error, so `reader.read()` never settles and a `for await` over it waits for
   * ever. Before `stallMs` was passed here, this test hung until vitest's own
   * timeout, which is exactly what the reader saw.
   *
   * Fake timers because the clock is 60 seconds long and a test should not be.
   */
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Let promise chains settle without letting the stall clock run. */
  async function settle(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 8; i++) {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
      }
    });
  }

  it("gives up after the stall window and tells the reader, instead of spinning for ever", async () => {
    await mount("a-slug");
    await settle();

    const createdAt = "2026-01-01T00:00:00.000Z";
    let pulls = 0;
    postImpl = ({ id, criterion }) =>
      Promise.resolve({
        ok: true,
        body: new ReadableStream<Uint8Array>({
          pull(c) {
            pulls++;
            if (pulls === 1) {
              // One frame, so the clock arms — it deliberately does not run
              // before the first byte, or a buffering proxy would be killed.
              c.enqueue(
                sseBytes([{ event: "begin", data: { id, criterion, createdAt, status: "pending", hits: [] } }]),
              );
              return;
            }
            // And then nothing, for ever. Not `close()` — that is the other
            // failure, and it is the one that already worked.
            return new Promise<void>(() => {});
          },
        }),
      } as unknown as Response);

    const id = latest?.ask("a criterion") as string;
    await settle();
    expect(latest?.runs.find((r) => r.id === id)?.status).toBe("pending");

    // Just short of the window: still believed in.
    await act(async () => vi.advanceTimersByTimeAsync(59_000));
    await settle();
    expect(latest?.runs.find((r) => r.id === id)?.status).toBe("pending");

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    await settle();

    const run = latest?.runs.find((r) => r.id === id);
    expect(run?.status).toBe("error");
    // The reader's words, not the class's — see `describeFetchFailure`.
    expect(run?.error).toContain("[ai-stalled]");
    expect(run?.error).not.toContain("StreamStalled");
  });
});
