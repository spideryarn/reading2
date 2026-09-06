/**
 * The server half of the stall clock — `heartbeat` in src/routes.ts.
 *
 * A heartbeat that silently never fires is the worst kind of bug this repo
 * knows about (docs/reusable/silent-success.md): every answer still arrives,
 * nothing looks wrong, and the only symptom is that a dead connection takes
 * `STREAM_STALL_MS` longer to notice than it should — on the far side of a
 * browser, where nobody is looking. So this drives a real socket and counts the
 * bytes on it, rather than asserting that a timer was scheduled.
 */
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { heartbeat } from "../src/routes.js";
import { readEvents } from "../src/web/lib/sse.js";

let server: Server | undefined;

afterEach(async () => {
  const s = server;
  server = undefined;
  if (s) await new Promise<void>((r) => s.close(() => r()));
});

/**
 * A response that beats every 15ms until `heartbeat` has written `wantedBeats`
 * pings, and then finishes with `after` on the end.
 *
 * **The end of the beating is a condition, not a clock.** This used to run for
 * a fixed 120ms — eight beats' worth on an idle box — and assert that three
 * arrived, which turned a perfectly live heartbeat red inside `npm run check`:
 * a saturated event loop fires `setInterval` far fewer times per millisecond,
 * so the count fell to two. Waiting for the writes themselves means a loaded
 * box merely takes longer. A heartbeat that never fires — the failure this
 * whole file exists for — still fails, now by hanging until vitest's own
 * timeout, which is the right way for that one to break.
 */
async function beatUntil(wantedBeats: number, after: string): Promise<string> {
  let enoughBeats: () => void = () => {};
  const beaten = new Promise<void>((resolve) => {
    enoughBeats = resolve;
  });
  server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
    /* Count the pings at the point `heartbeat` hands them to `res.write`, so
       "enough beats" is a fact about what the code did rather than about the
       clock. This counter decides only when to stop; it is not the assertion,
       and it is deliberately weaker than one — it proves the frame was
       attempted, not that it arrived. What proves arrival is the client
       counting the pings back out of the response body below. */
    let beats = 0;
    const original = res.write.bind(res);
    res.write = ((chunk: string) => {
      if (chunk.startsWith(": ping") && ++beats === wantedBeats) enoughBeats();
      return original(chunk);
    }) as typeof res.write;
    const stop = heartbeat(res, () => !res.writableEnded && !res.destroyed, 15);
    // A microtask later, so the response is never ended from inside its own write.
    void beaten.then(() => {
      stop();
      res.write(after);
      res.end();
    });
  });
  await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/`);
  return await response.text();
}

describe("heartbeat", () => {
  it("puts bytes on the wire while there is nothing to say", async () => {
    const body = await beatUntil(3, 'event: done\ndata: {"n":1}\n\n');
    const beats = body.split("\n\n").filter((f) => f.startsWith(": ping")).length;
    expect(beats).toBeGreaterThanOrEqual(3);
    expect(body.endsWith('event: done\ndata: {"n":1}\n\n')).toBe(true);
  });

  it("writes frames the client can still read, with the beats dropped", async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
      const stop = heartbeat(res, () => !res.writableEnded && !res.destroyed, 15);
      res.write('event: begin\ndata: {"id":"a"}\n\n');
      setTimeout(() => {
        res.write('event: delta\ndata: {"text":"hi"}\n\n');
      }, 40);
      setTimeout(() => {
        stop();
        res.write('event: done\ndata: {"ok":true}\n\n');
        res.end();
      }, 90);
    });
    await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/`);
    const seen: string[] = [];
    for await (const e of readEvents(response.body as ReadableStream<Uint8Array>, {
      stallMs: 2_000,
    })) {
      seen.push(e.name);
    }
    // The heartbeats between them are bytes and nothing else.
    expect(seen).toEqual(["begin", "delta", "done"]);
  });

  it("stops when the response closes, without being told", async () => {
    let writes = 0;
    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
      const original = res.write.bind(res);
      res.write = ((chunk: string) => {
        writes++;
        return original(chunk);
      }) as typeof res.write;
      // Deliberately never call the returned stop function: `close` has to be
      // enough on its own, because that is the path a reader who shuts their
      // tab takes.
      heartbeat(res, () => !res.writableEnded && !res.destroyed, 15);
    });
    await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 60));
    controller.abort();
    await response.body?.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, 20));
    const atClose = writes;
    await new Promise((r) => setTimeout(r, 120));
    expect(writes).toBe(atClose);
  });
});

/**
 * The one case a real socket cannot produce: the reader was already gone
 * *before* `heartbeat` was called.
 *
 * A server handler runs after the connection is accepted, so a client cannot
 * reliably be made to disappear in the gap between `writeHead` and `heartbeat`
 * from out here — a delayed callback could get there, but only by racing, and a
 * racing test is worse than a mocked one. And the claim under test is about the timer itself — "no interval
 * exists" — not about bytes, so counting timers is the right instrument rather
 * than the shortcut the header warns against. `vi.getTimerCount()` goes to 1
 * the moment the guard in `heartbeat` is removed.
 */
describe("a heartbeat for a reader who has already left", () => {
  /** Enough of a `ServerResponse` for `heartbeat`, with `close` already past. */
  function closedResponse(): ServerResponse {
    return {
      destroyed: true,
      writableEnded: false,
      // The listener a live response would call. Nothing ever will.
      on() {},
      write() {
        throw new Error("wrote to a destroyed response");
      },
    } as unknown as ServerResponse;
  }

  it("starts no interval, rather than one that runs until the process exits", () => {
    vi.useFakeTimers();
    try {
      const before = vi.getTimerCount();
      const stop = heartbeat(closedResponse(), () => false, 15);
      expect(vi.getTimerCount()).toBe(before);
      // The returned function is still safe to call, because every caller does.
      stop();
      expect(vi.getTimerCount()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still starts one for a response that is merely quiet", () => {
    /* The negative control. Without it the test above passes on a `heartbeat`
       that never schedules anything, which is the bug this file exists for. */
    vi.useFakeTimers();
    try {
      const live = {
        destroyed: false,
        writableEnded: false,
        on() {},
        write() {
          return true;
        },
      } as unknown as ServerResponse;
      const before = vi.getTimerCount();
      const stop = heartbeat(live, () => true, 15);
      expect(vi.getTimerCount()).toBe(before + 1);
      stop();
      expect(vi.getTimerCount()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
