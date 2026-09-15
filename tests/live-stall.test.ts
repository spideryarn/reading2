/**
 * **Which stall a live session is in, if any** — the pure rules behind the
 * notice and the Reconnect button. src/web/live/stall.ts.
 *
 * The negative cases matter as much as the positive ones. A notice that fires
 * on an ordinary conversation — a reader who talks for twenty seconds, a slow
 * library search, a long spoken answer — teaches the reader to ignore it, and
 * then it says nothing on the day it is true.
 * docs/plans/260915b-live-conversation-stalls-visible-and-recoverable.md.
 */
import { describe, expect, it } from "vitest";

import { NO_REPLY_MS, OPEN_TURN_MS, RESPONSE_SILENT_MS, stallOf, type StallFacts } from "../src/web/live/stall.js";

const NOW = 1_000_000;

function facts(over: Partial<StallFacts> = {}): StallFacts {
  return {
    now: NOW,
    micMuted: false,
    connection: "connected",
    turnOpenSince: null,
    owedSince: null,
    responseActive: false,
    lastEventAt: NOW,
    speaking: false,
    toolRunning: false,
    ...over,
  };
}

describe("an ordinary conversation is not a stall", () => {
  it("says nothing when nothing is wrong", () => {
    expect(stallOf(facts())).toBeNull();
  });

  it("does not call a reader who has talked for twenty seconds stuck", () => {
    expect(stallOf(facts({ turnOpenSince: NOW - 20_000 }))).toBeNull();
  });

  it("does not call a slow tool a missing reply", () => {
    expect(stallOf(facts({ owedSince: NOW - 5 * NO_REPLY_MS, toolRunning: true }))).toBeNull();
    expect(stallOf(facts({ responseActive: true, lastEventAt: NOW - 5 * RESPONSE_SILENT_MS, toolRunning: true }))).toBeNull();
  });

  it("does not call a long spoken answer silent while it is audibly playing", () => {
    expect(stallOf(facts({ responseActive: true, lastEventAt: NOW - 5 * RESPONSE_SILENT_MS, speaking: true }))).toBeNull();
  });

  it("does not expect a reply while the reader is still mid-sentence", () => {
    expect(stallOf(facts({ owedSince: NOW - 5 * NO_REPLY_MS, turnOpenSince: NOW - 1_000 }))).toBeNull();
  });

  it("gives a reply its full window before calling it missing", () => {
    expect(stallOf(facts({ owedSince: NOW - NO_REPLY_MS + 1 }))).toBeNull();
    expect(stallOf(facts({ responseActive: true, lastEventAt: NOW - RESPONSE_SILENT_MS + 1 }))).toBeNull();
    expect(stallOf(facts({ turnOpenSince: NOW - OPEN_TURN_MS + 1 }))).toBeNull();
  });

  it("does not treat a connection that is still being set up as unstable", () => {
    expect(stallOf(facts({ connection: "connecting" }))).toBeNull();
    expect(stallOf(facts({ connection: "new" }))).toBeNull();
  });
});

describe("each stall, named", () => {
  it("the phone has paused the microphone", () => {
    expect(stallOf(facts({ micMuted: true }))).toBe("microphone-paused");
  });

  it("the connection has dropped out", () => {
    expect(stallOf(facts({ connection: "disconnected" }))).toBe("connection");
  });

  it("a turn has been open far longer than anybody talks", () => {
    expect(stallOf(facts({ turnOpenSince: NOW - OPEN_TURN_MS }))).toBe("open-turn");
  });

  it("a reply was owed and never started", () => {
    expect(stallOf(facts({ owedSince: NOW - NO_REPLY_MS }))).toBe("no-reply");
  });

  it("a reply started and then went silent", () => {
    expect(stallOf(facts({ responseActive: true, lastEventAt: NOW - RESPONSE_SILENT_MS }))).toBe("no-reply");
  });
});

describe("when two are true at once, the one the reader can act on first", () => {
  it("names the microphone before the connection, and both before the turn and the reply", () => {
    const everything = {
      micMuted: true,
      connection: "disconnected",
      turnOpenSince: NOW - OPEN_TURN_MS,
      owedSince: NOW - NO_REPLY_MS,
    } as const;
    expect(stallOf(facts(everything))).toBe("microphone-paused");
    expect(stallOf(facts({ ...everything, micMuted: false }))).toBe("connection");
    expect(stallOf(facts({ ...everything, micMuted: false, connection: "connected" }))).toBe("open-turn");
  });
});
