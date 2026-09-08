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

import { describe, expect, it, vi } from "vitest";

import { broadcast, startHeartbeat, subscribe, subscriberCount } from "../tools/fleet/live.js";

/** A response double that records every `write` and can be told to throw. */
function fakeRes(opts: { throwOnWrite?: boolean } = {}): {
  res: ServerResponse;
  writes: string[];
} {
  const writes: string[] = [];
  const emitter = new EventEmitter();
  const res = Object.assign(emitter, {
    writeHead: () => res,
    flushHeaders: () => {},
    write: (data: string) => {
      if (opts.throwOnWrite) throw new Error("write EPIPE (simulated dead socket)");
      writes.push(data);
      return true;
    },
    end: () => {},
  }) as unknown as ServerResponse;
  return { res, writes };
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
