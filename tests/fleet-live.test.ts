/**
 * The SSE subscriber lifecycle — tools/fleet/live.ts.
 *
 * Uses fake `IncomingMessage`/`ServerResponse` stand-ins (an `EventEmitter`
 * plus the handful of methods `live.ts` actually calls) rather than real
 * sockets: what matters here is the subscriber-set bookkeeping — who gets a
 * broadcast, who stops getting one, and that one bad subscriber never takes
 * down the others — not HTTP framing.
 */
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Writable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { broadcast, DRAIN_DEADLINE_MS, startHeartbeat, subscribe, subscriberCount } from "../tools/fleet/live.js";

/**
 * A response double that records every `write` and can be told to throw or to
 * report backpressure.
 *
 * `backpressure: true` is **not "a broken client"** — it is what a real
 * `ServerResponse` does when a 59 KB snapshot meets a 16 KB high-water mark,
 * which is every snapshot to every healthy client. `write` still buffers the
 * bytes (the data is in userspace memory whatever we do) and returns `false`,
 * which is Node saying *stop until `drain`*. `drain()` is the socket emptying,
 * and the difference between a healthy client and a wedged one is nothing but
 * whether that ever happens.
 */
function fakeRes(opts: { throwOnWrite?: boolean; backpressure?: boolean } = {}): {
  res: ServerResponse;
  writes: string[];
  destroyed: () => boolean;
  /** The socket empties. What a working connection does within milliseconds. */
  drain: () => void;
} {
  const writes: string[] = [];
  let destroyed = false;
  const emitter = new EventEmitter();
  const res = Object.assign(emitter, {
    writeHead: () => res,
    flushHeaders: () => {},
    write: (data: string) => {
      if (opts.throwOnWrite) throw new Error("write EPIPE (simulated dead socket)");
      writes.push(data);
      return opts.backpressure !== true;
    },
    end: () => {},
    destroy: () => {
      destroyed = true;
    },
  }) as unknown as ServerResponse;
  return { res, writes, destroyed: () => destroyed, drain: () => emitter.emit("drain") };
}

function fakeReq(): IncomingMessage {
  return new EventEmitter() as unknown as IncomingMessage;
}

describe("subscribe / broadcast lifecycle", () => {
  it("sends the initial snapshot immediately so a new client is never blank", () => {
    const before = subscriberCount();
    const { res, writes } = fakeRes();
    subscribe(fakeReq(), res, JSON.stringify({ rows: [], collectedAt: "t0" }));

    expect(subscriberCount()).toBe(before + 1);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("event: snapshot");
    expect(writes[0]).toContain('"collectedAt":"t0"');
  });

  it("sends no initial frame when the caller has nothing cached yet", () => {
    const { res, writes } = fakeRes();
    subscribe(fakeReq(), res, null);
    expect(writes).toHaveLength(0);
  });

  it("a broadcast reaches two subscribers", () => {
    const before = subscriberCount();
    const a = fakeRes();
    const b = fakeRes();
    subscribe(fakeReq(), a.res, null);
    subscribe(fakeReq(), b.res, null);
    expect(subscriberCount()).toBe(before + 2);

    broadcast(JSON.stringify({ rows: [], collectedAt: "t1" }));

    expect(a.writes).toHaveLength(1);
    expect(b.writes).toHaveLength(1);
    expect(a.writes[0]).toContain("event: snapshot");
    expect(a.writes[0]).toContain('"collectedAt":"t1"');
    expect(b.writes[0]).toContain('"collectedAt":"t1"');
  });

  it("an unsubscribed connection stops receiving, and a closed one is removed from the set", () => {
    const before = subscriberCount();
    const req = fakeReq();
    const { res, writes } = fakeRes();
    subscribe(req, res, null);
    expect(subscriberCount()).toBe(before + 1);

    // Simulate the client closing the tab / the socket going away.
    req.emit("close");
    expect(subscriberCount()).toBe(before);

    broadcast(JSON.stringify({ rows: [], collectedAt: "t2" }));
    expect(writes).toHaveLength(0); // never wrote to a closed connection
  });

  it("removes a subscriber on a request 'error' event too", () => {
    const before = subscriberCount();
    const req = fakeReq();
    const { res } = fakeRes();
    subscribe(req, res, null);
    expect(subscriberCount()).toBe(before + 1);

    req.emit("error", new Error("ECONNRESET"));
    expect(subscriberCount()).toBe(before);
  });

  it("a subscriber whose write throws does not prevent the others receiving", () => {
    const before = subscriberCount();
    const bad = fakeRes({ throwOnWrite: true });
    const good = fakeRes();
    subscribe(fakeReq(), bad.res, null);
    subscribe(fakeReq(), good.res, null);
    expect(subscriberCount()).toBe(before + 2);

    // Must not throw out of broadcast() itself — a bad subscriber must never
    // take down the refresh loop that calls this.
    expect(() => broadcast(JSON.stringify({ rows: [], collectedAt: "t3" }))).not.toThrow();

    expect(good.writes).toHaveLength(1);
    expect(good.writes[0]).toContain('"collectedAt":"t3"');
    // The bad one is dropped from the set entirely (see safeWrite/removeSubscriber),
    // so a leak from a socket that throws instead of closing cleanly is still caught.
    expect(subscriberCount()).toBe(before + 1);

    // A second broadcast must not try the dead one again either.
    expect(() => broadcast(JSON.stringify({ rows: [], collectedAt: "t4" }))).not.toThrow();
    expect(good.writes).toHaveLength(2);
  });

  it("does not double-count or double-remove a subscriber closed twice", () => {
    const before = subscriberCount();
    const req = fakeReq();
    const { res } = fakeRes();
    subscribe(req, res, null);
    expect(subscriberCount()).toBe(before + 1);

    req.emit("close");
    req.emit("close"); // a real socket can fire close more than once in practice
    expect(subscriberCount()).toBe(before);
  });
});

describe("startHeartbeat", () => {
  it("broadcasts a ping frame on the configured interval, and stop() ends it", () => {
    vi.useFakeTimers();
    try {
      const { res, writes } = fakeRes();
      subscribe(fakeReq(), res, null);

      const stop = startHeartbeat(1000);
      try {
        vi.advanceTimersByTime(1000);
        expect(writes.some((w) => w.includes("event: ping"))).toBe(true);

        const countAfterOne = writes.length;
        vi.advanceTimersByTime(1000);
        expect(writes.length).toBeGreaterThan(countAfterOne);
      } finally {
        stop();
      }

      const countAfterStop = writes.length;
      vi.advanceTimersByTime(5000);
      expect(writes.length).toBe(countAfterStop); // no more pings once stopped
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ------------------------------------------------------------------ *
 * Backpressure: wait for `drain`, and destroy only if it never comes.
 *
 * **THE PREMISE THESE TESTS USED TO ENCODE WAS FALSE.** They asserted that a
 * `write` returning `false` meant a client that could not keep up, and drove it
 * with a double that returned `false` because it was told to. A real
 * `ServerResponse` has a 16 KB high-water mark and a fleet snapshot is ~59 KB,
 * so `false` is what a PERFECTLY HEALTHY client returns on its first frame —
 * GPT Sol, against a real response object, 2026-09-08. So the positive control
 * below is the most important test in this block: a big write that returns
 * `false` and then drains must cost the subscriber nothing at all.
 * ------------------------------------------------------------------ */
describe("backpressure — a full buffer pauses a subscriber, it does not condemn it", () => {
  it("writes nothing more to a subscriber whose buffer is full, and keeps it", () => {
    const before = subscriberCount();
    const slow = fakeRes({ backpressure: true });
    subscribe(fakeReq(), slow.res, null);

    broadcast(JSON.stringify({ rows: [], collectedAt: "b1" }));
    broadcast(JSON.stringify({ rows: [], collectedAt: "b2" }));
    broadcast(JSON.stringify({ rows: [], collectedAt: "b3" }));

    // One frame in the buffer, and not a byte more — the memory bound.
    expect(slow.writes).toHaveLength(1);
    // Still a subscriber: `false` said "wait", not "I am dead".
    expect(subscriberCount()).toBe(before + 1);
    expect(slow.destroyed()).toBe(false);
  });

  it("THE POSITIVE CONTROL: a large healthy write returns false, drains, and costs nothing", () => {
    const before = subscriberCount();
    // `drainsAfter: 0` is the ordinary case in production — a 59 KB snapshot
    // over a 16 KB high-water mark, on a socket that is working fine.
    const healthy = fakeRes({ backpressure: true });
    subscribe(fakeReq(), healthy.res, null);

    broadcast(JSON.stringify({ rows: [], collectedAt: "c1" }));
    expect(healthy.writes).toHaveLength(1);

    // The socket empties, as a working socket does.
    healthy.drain();

    broadcast(JSON.stringify({ rows: [], collectedAt: "c2" }));
    expect(healthy.writes).toHaveLength(2);
    expect(healthy.writes[1]).toContain('"collectedAt":"c2"');
    expect(subscriberCount()).toBe(before + 1);
    expect(healthy.destroyed()).toBe(false);
  });

  it("no heartbeat reaches a paused subscriber either, and a drain restores both", () => {
    vi.useFakeTimers();
    try {
      const slow = fakeRes({ backpressure: true });
      subscribe(fakeReq(), slow.res, null);
      broadcast(JSON.stringify({ rows: [], collectedAt: "d1" }));
      expect(slow.writes).toHaveLength(1);

      const stop = startHeartbeat(1000);
      try {
        // Well short of DRAIN_DEADLINE_MS, so nothing is destroyed yet.
        vi.advanceTimersByTime(5_000);
        expect(slow.writes).toHaveLength(1);

        slow.drain();
        vi.advanceTimersByTime(1_000);
        expect(slow.writes.length).toBeGreaterThan(1);
        expect(slow.writes.some((w) => w.includes("event: ping"))).toBe(true);
      } finally {
        stop();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("destroys a subscriber that never drains, once the deadline passes", () => {
    vi.useFakeTimers();
    try {
      const before = subscriberCount();
      const wedged = fakeRes({ backpressure: true });
      subscribe(fakeReq(), wedged.res, null);
      broadcast(JSON.stringify({ rows: [], collectedAt: "e1" }));

      expect(subscriberCount()).toBe(before + 1); // still hoping
      vi.advanceTimersByTime(DRAIN_DEADLINE_MS + 1);

      // Thirty seconds without moving a byte is not a stall, it is a corpse.
      expect(subscriberCount()).toBe(before);
      expect(wedged.destroyed()).toBe(true);
      expect(wedged.writes).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a paused subscriber does not stop a healthy one", () => {
    const slow = fakeRes({ backpressure: true });
    const good = fakeRes();
    subscribe(fakeReq(), slow.res, null);
    subscribe(fakeReq(), good.res, null);

    broadcast(JSON.stringify({ rows: [], collectedAt: "f1" }));
    broadcast(JSON.stringify({ rows: [], collectedAt: "f2" }));

    expect(slow.writes).toHaveLength(1);
    expect(good.writes).toHaveLength(2);
    expect(good.writes[1]).toContain('"collectedAt":"f2"');
  });

  it("a raw node Writable that never drains holds exactly one frame, then is destroyed", () => {
    vi.useFakeTimers();
    try {
      const before = subscriberCount();
      // A REAL `Writable`, not the double: `false` here comes from Node's own
      // `highWaterMark` accounting rather than from a stub deciding to say so.
      const chunks: string[] = [];
      const sink = new Writable({
        highWaterMark: 1,
        write(chunk: Buffer | string, _enc, done) {
          chunks.push(String(chunk));
          // Never call `done`: the buffer stays full, exactly like a phone
          // that has stopped acknowledging packets. No `drain` will ever fire.
          void done;
        },
      });
      const res = Object.assign(sink, {
        writeHead: () => res,
        flushHeaders: () => {},
      }) as unknown as ServerResponse;

      subscribe(fakeReq(), res, null);
      for (let i = 0; i < 200; i += 1) broadcast(JSON.stringify({ rows: [], collectedAt: `g-${i}` }));

      // 200 snapshots later there is still exactly one frame's worth of bytes
      // in this process on behalf of that client. THAT IS THE BOUND.
      expect(chunks).toHaveLength(1);
      expect(sink.writableLength).toBeLessThanOrEqual(String(chunks[0]).length);
      expect(subscriberCount()).toBe(before + 1);

      vi.advanceTimersByTime(DRAIN_DEADLINE_MS + 1);
      expect(subscriberCount()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the next connection gets the latest cached snapshot, which is why pausing is safe", () => {
    const again = fakeRes();
    subscribe(fakeReq(), again.res, JSON.stringify({ rows: [], collectedAt: "h1" }));
    expect(again.writes[0]).toContain('"collectedAt":"h1"');
  });
});
