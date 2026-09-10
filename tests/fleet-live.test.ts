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

  it("an initial write that throws removes the listeners attached before it", () => {
    const before = subscriberCount();
    const req = fakeReq();
    const bad = fakeRes({ throwOnWrite: true });

    expect(() => subscribe(req, bad.res, JSON.stringify({ rows: [], collectedAt: "initial" }))).not.toThrow();

    expect(subscriberCount()).toBe(before);
    expect(bad.destroyed()).toBe(true);
    expect(req.listenerCount("close")).toBe(0);
    expect(req.listenerCount("error")).toBe(0);
    expect(bad.res.listenerCount("error")).toBe(0);
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

/* ------------------------------------------------------------------ *
 * Backpressure, measured against a real `Writable` that DELAYS its callbacks.
 *
 * The block above proves the memory bound with a `Writable` that never calls
 * `done` at all — a corpse. This one is the other half, and it is the half the
 * roadmap asked for (260908f § Bounded transport, checkbox 1): a socket that
 * stalls **and then comes back**, which is what a phone in a lift actually
 * does. `highWaterMark` and `writableLength` are Node's own accounting here;
 * nothing in this block decides for itself what backpressure is.
 * ------------------------------------------------------------------ */

/** A snapshot payload comfortably over the 64-byte high-water mark below. */
function snapshotJson(n: number): string {
  return JSON.stringify({ rows: [], collectedAt: `n${n}`, filler: "x".repeat(120) });
}

/**
 * A real `Writable` whose `write` callback is held until `release()` is called.
 *
 * Not a double: `write()` returns `false` because Node's own buffer passed its
 * high-water mark, and `drain` fires because Node decided the buffer had
 * emptied. The only thing this arranges is *when the underlying sink says it
 * has taken the bytes* — which is exactly what a slow socket varies.
 */
function stallingRes(highWaterMark: number): {
  res: ServerResponse;
  sink: Writable;
  /**
   * What `live.ts` handed to `res.write` — the WRITE COUNT the roadmap asks
   * for. Distinct from `chunks` below, and the difference matters: Node queues
   * a second write internally without calling `_write` again, so counting the
   * sink's callbacks would credit `live.ts` with restraint that was Node's.
   */
  offered: string[];
  /** What Node actually passed down to the sink. */
  chunks: string[];
  /** Let every held write complete. What the radio coming back looks like. */
  release: () => void;
} {
  const chunks: string[] = [];
  const offered: string[] = [];
  const held: (() => void)[] = [];
  const sink = new Writable({
    highWaterMark,
    write(chunk: Buffer | string, _enc, done) {
      chunks.push(String(chunk));
      held.push(() => done());
    },
  });
  const passThrough = sink.write.bind(sink);
  const res = Object.assign(sink, {
    writeHead: () => res,
    flushHeaders: () => {},
    write: (data: string): boolean => {
      offered.push(data);
      return passThrough(data);
    },
  }) as unknown as ServerResponse;
  return {
    res,
    sink,
    offered,
    chunks,
    release: () => {
      for (const done of held.splice(0)) done();
    },
  };
}

describe("backpressure, measured against a real Writable that delays its callbacks", () => {
  it("holds one frame across two hundred snapshots and interleaved pings, and no more", () => {
    vi.useFakeTimers();
    try {
      // 64 bytes: every frame below is larger, so the FIRST write returns
      // `false` from Node's own accounting, exactly as a 59 KB snapshot does
      // against a `ServerResponse`'s 16 KB.
      const phone = stallingRes(64);
      subscribe(fakeReq(), phone.res, null);

      // A ping between every pair of snapshots: the heartbeat goes on beating
      // while a subscriber is stalled, and it must not be a second way to fill
      // the buffer. 200 beats of 1ms is far short of DRAIN_DEADLINE_MS.
      const stop = startHeartbeat(1);
      try {
        for (let i = 0; i < 200; i += 1) {
          broadcast(snapshotJson(i));
          vi.advanceTimersByTime(1);
        }
      } finally {
        stop();
      }

      // Node took ONE chunk from us and is still holding it. Four hundred
      // frames were offered; 399 were never written.
      expect(phone.offered).toHaveLength(1); // ONE write() call for 400 frames
      expect(phone.chunks).toHaveLength(1);
      const oneFrame = Buffer.byteLength(phone.chunks[0] ?? "");
      expect(phone.sink.writableLength).toBeLessThanOrEqual(oneFrame);
      expect(subscriberCount()).toBeGreaterThan(0);
      expect(phone.sink.destroyed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("THE RED ONE: a socket that comes back gets the NEWEST snapshot, not the next one", () => {
    vi.useFakeTimers();
    try {
      const phone = stallingRes(64);
      subscribe(fakeReq(), phone.res, null);

      broadcast(snapshotJson(1)); // taken, and it fills the buffer
      broadcast(snapshotJson(2));
      broadcast(snapshotJson(3)); // the newest thing that is true
      expect(phone.offered).toHaveLength(1);

      // The radio comes back. `drain` fires from Node's own accounting.
      phone.release();
      vi.advanceTimersByTime(1);

      /* **THE POINT OF THE WHOLE STAGE.** Before this change the subscriber
         received nothing here: `drain` cleared the block and sent nothing, so
         n2 and n3 were gone and it sat on n1 until the next publish — up to
         60 seconds later, since server.ts publishes once per refresh.

         Note what is NOT claimed: n1 was not lost. A `false` from `write`
         means Node buffered that frame, not that it withheld it. Only the
         snapshots broadcast WHILE BLOCKED were dropped, which is why this
         test broadcasts three and not one. */
      expect(phone.offered).toHaveLength(2);
      expect(phone.offered[1]).toContain("event: snapshot");
      // The NEWEST, not a replay of the one that was skipped first.
      expect(phone.offered[1]).toContain('"collectedAt":"n3"');
      expect(phone.offered[1]).not.toContain('"collectedAt":"n2"');
    } finally {
      vi.useRealTimers();
    }
  });

  it("and the flush itself blocks again: a second generation, with its own deadline", () => {
    /* **ONE CYCLE IS NOT ENOUGH TO PROVE THIS, and the test above stops one
       transition short** — GPT Sol's review of the plan, 2026-09-10. At this
       high-water mark the retained snapshot's own write returns `false` too, so
       an implementation that delivered the newest frame and then forgot to
       re-arm — leaving the subscriber unblocked, or retaining the frame it had
       just written, or holding the *old* deadline — would pass everything
       above. Four steps, and each one is a different way to get it wrong. */
    vi.useFakeTimers();
    try {
      const before = subscriberCount();
      const phone = stallingRes(64);
      subscribe(fakeReq(), phone.res, null);

      broadcast(snapshotJson(1)); // buffered; blocked; deadline A runs to t=30s
      vi.advanceTimersByTime(10_000);
      broadcast(snapshotJson(2));
      broadcast(snapshotJson(3));

      // 1. The socket empties, and the newest retained snapshot goes out.
      phone.release();
      expect(phone.offered).toHaveLength(2);
      expect(phone.offered[1]).toContain('"collectedAt":"n3"');

      // 2. That flush blocked again. More broadcasts must accumulate nothing —
      //    not a queue, and not a second frame in Node's buffer.
      broadcast(snapshotJson(4));
      broadcast(snapshotJson(5));
      expect(phone.offered).toHaveLength(2);
      expect(phone.sink.writableLength).toBeLessThanOrEqual(Buffer.byteLength(phone.offered[1] ?? ""));

      // 3. Past the ORIGINAL deadline, which fired at t=30s and would have
      //    destroyed this subscriber if the drain had not cleared it.
      vi.advanceTimersByTime(21_000); // t=31s
      expect(subscriberCount()).toBe(before + 1);

      // 4. And the second generation behaves exactly like the first: the
      //    newest, once, and not the one before it.
      phone.release();
      expect(phone.offered).toHaveLength(3);
      expect(phone.offered[2]).toContain('"collectedAt":"n5"');
      expect(phone.offered[2]).not.toContain('"collectedAt":"n4"');

      // The replacement deadline is a real one too: it owns the new blocked
      // period, and it ends the same way.
      vi.advanceTimersByTime(DRAIN_DEADLINE_MS + 1);
      expect(subscriberCount()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a withheld ping is dropped rather than delivered late", () => {
    vi.useFakeTimers();
    try {
      const phone = stallingRes(64);
      subscribe(fakeReq(), phone.res, null);

      broadcast(snapshotJson(1)); // fills the buffer
      const stop = startHeartbeat(1);
      try {
        vi.advanceTimersByTime(3); // three pings, all withheld
      } finally {
        stop();
      }

      phone.release();
      vi.advanceTimersByTime(1);

      /* A ping is a claim about *now*. Delivering one that was true four
         seconds ago tells the client something it already knew — the frame it
         is being handed alongside proves the socket is alive — so a stalled
         ping is dropped, and only the snapshot is worth keeping. */
      const late = phone.offered.slice(1).join("");
      expect(late).not.toContain("event: ping");
    } finally {
      vi.useRealTimers();
    }
  });

  it("nothing is retained when a subscriber stalls with no snapshot behind it", () => {
    vi.useFakeTimers();
    try {
      const phone = stallingRes(64);
      subscribe(fakeReq(), phone.res, null);
      const stop = startHeartbeat(1);
      try {
        // Pings are small — around 33 bytes, comfortably under the 64-byte
        // mark — so it takes two of them to fill this buffer, which is worth
        // knowing rather than assuming: the count below is Node's, not ours.
        vi.advanceTimersByTime(4);
      } finally {
        stop();
      }
      const stalledAfter = phone.offered.length;
      // Small frames can accumulate below Node's byte threshold; the bound is
      // the high-water mark plus the crossing write, not literally one frame.
      // At 33 bytes each against 64 bytes, exactly two writes are offered; a
      // third would mean live.ts kept writing after Node returned false.
      expect(stalledAfter).toBe(2);

      phone.release();
      vi.advanceTimersByTime(1);

      // A drain with nothing worth sending sends nothing. Not an empty frame,
      // not a repeat.
      expect(phone.offered).toHaveLength(stalledAfter);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a stalled subscriber that never returns is dropped, and its retained frame goes with it", () => {
    vi.useFakeTimers();
    try {
      const before = subscriberCount();
      const phone = stallingRes(64);
      subscribe(fakeReq(), phone.res, null);
      broadcast(snapshotJson(1));
      broadcast(snapshotJson(2)); // retained, and about to be discarded

      vi.advanceTimersByTime(DRAIN_DEADLINE_MS + 1);
      expect(subscriberCount()).toBe(before);

      // And a late drain after the drop writes nothing: the retained frame
      // must not resurrect a subscriber the deadline gave up on.
      phone.release();
      vi.advanceTimersByTime(1);
      expect(phone.offered).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a stalled subscriber's teardown leaves the healthy one untouched, and leaves no listeners", () => {
    vi.useFakeTimers();
    try {
      const phone = stallingRes(64);
      const good = fakeRes();
      const phoneReq = fakeReq();
      subscribe(phoneReq, phone.res, null);
      subscribe(fakeReq(), good.res, null);

      broadcast(snapshotJson(1));
      broadcast(snapshotJson(2));
      phoneReq.emit("close"); // the phone's tab goes away mid-stall
      broadcast(snapshotJson(3));

      expect(good.writes).toHaveLength(3);
      expect(good.writes[2]).toContain('"collectedAt":"n3"');
      // And the departed subscriber owns nothing: no listeners left on either
      // half of its connection, so nothing of it survives to be called.
      expect(phoneReq.listenerCount("close")).toBe(0);
      expect(phoneReq.listenerCount("error")).toBe(0);
      expect(phone.sink.listenerCount("error")).toBe(0);
      expect(phone.sink.listenerCount("drain")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
