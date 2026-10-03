/**
 * **What a GPT-Live call reports spending**, read off the wire and handed to
 * the server's own parser. src/web/live/gpt-live/meter.ts.
 *
 * As in tests/live-meter.test.ts, the seam is the point: the browser builds a
 * report, and `parseLiveUsage` in src/live.ts (the real one, imported and run)
 * has to accept it unchanged. A copy of the server's rules here would agree
 * with itself and prove nothing.
 *
 * The events are the shapes in evals/live/gpt-live-spike/spike-out-allow.json.
 */
import { describe, expect, it } from "vitest";

import { parseLiveUsage, type GptLiveUsage } from "../src/live.js";
import {
  GptLiveMeter,
  backendReport,
  voiceReport,
  type GptLiveUsageReport,
} from "../src/web/live/gpt-live/meter.js";
import type { PostOutcome } from "../src/web/live/meter.js";

/* **The two declarations are one type, checked both ways.** The browser's is
   declared in src/web because nothing there may import a server module; these
   two lines are what stop the copies drifting. A field added to one and not
   the other fails the typecheck here, in either direction. Only a typecheck
   can redden them: `npm run typecheck` covers tests/. */
const _clientIsServer: GptLiveUsage = {} as GptLiveUsageReport;
const _serverIsClient: GptLiveUsageReport = {} as GptLiveUsage;
void _clientIsServer;
void _serverIsClient;

const usageUpdated = {
  type: "session.usage.updated",
  usage: { seconds: 15 },
  context_window: { usage_ratio: 0.01 },
  event_id: "event_EUrRRgaxColV7zAAuPdSe",
};

const closed = {
  type: "session.closed",
  reason: "close_requested",
  session: { id: "live_u1" },
  usage: { seconds: 32 },
  event_id: "event_EUrRSYlS9bUa46EL9DdqK",
};

/** The `usage` on a nested `response.completed`, as the Responses API sends it. */
const backendUsage = {
  input_tokens: 31_204,
  input_tokens_details: { cached_tokens: 30_720 },
  output_tokens: 58,
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: 31_262,
};

describe("voice seconds", () => {
  it("reads the running total off session.usage.updated, and the server takes it as built", () => {
    const built = voiceReport(usageUpdated);
    expect(built).toEqual({ kind: "voice", seconds: 15, eventId: "event_EUrRRgaxColV7zAAuPdSe" });
    expect(parseLiveUsage(built)).toEqual(built);
  });

  it("reads the final figure off session.closed the same way", () => {
    const built = voiceReport(closed);
    expect(built).toEqual({ kind: "voice", seconds: 32, eventId: "event_EUrRSYlS9bUa46EL9DdqK" });
    expect(parseLiveUsage(built)).toEqual(built);
  });

  it("builds nothing from a figure the server would refuse", () => {
    expect(voiceReport({ ...usageUpdated, usage: { seconds: 15.5 } })).toBeNull();
    expect(voiceReport({ ...usageUpdated, usage: { seconds: -1 } })).toBeNull();
    expect(voiceReport({ ...usageUpdated, usage: {} })).toBeNull();
    expect(voiceReport({ type: "session.closed", reason: "expired" })).toBeNull();
  });

  it("still reports when the event carries no id, with one the server accepts", () => {
    const built = voiceReport({ type: "session.usage.updated", usage: { seconds: 30 } });
    expect(built).toEqual({ kind: "voice", seconds: 30, eventId: "seconds-30" });
    expect(parseLiveUsage(built)).toEqual(built);
  });
});

describe("backend tokens", () => {
  it("reads input, cached input and output, and the server takes it as built", () => {
    const built = backendReport("resp_023cf341", backendUsage);
    expect(built).toEqual({
      kind: "backend",
      responseId: "resp_023cf341",
      inputTokens: 31_204,
      cachedInputTokens: 30_720,
      outputTokens: 58,
    });
    expect(parseLiveUsage(built)).toEqual(built);
  });

  it("reads an absent cached count as none, which can only overstate the cost", () => {
    const built = backendReport("resp_1", { input_tokens: 900, output_tokens: 20 });
    expect(built).toMatchObject({ inputTokens: 900, cachedInputTokens: 0 });
    expect(parseLiveUsage(built)).toEqual(built);
  });

  it("never reports more cached input than input, which the server refuses", () => {
    const built = backendReport("resp_1", {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 400 },
      output_tokens: 5,
    });
    expect(built).toMatchObject({ cachedInputTokens: 100 });
    expect(parseLiveUsage(built)).toEqual(built);
  });

  it("builds nothing when a total is missing, rather than a row priced at nothing", () => {
    expect(backendReport("resp_1", { output_tokens: 5 })).toBeNull();
    expect(backendReport("resp_1", { input_tokens: 5 })).toBeNull();
    expect(backendReport("", backendUsage)).toBeNull();
  });
});

describe("the queue carries GPT-Live's reports", () => {
  it("checkpoints an in-flight retry without rejecting late usage or posting concurrently", async () => {
    let release!: (outcome: PostOutcome) => void;
    const posted: { seconds: number; keepalive: boolean }[] = [];
    const meter = new GptLiveMeter({
      sessionId: "journal-row-1",
      transport: {
        liveConnected: async () => "accepted",
        liveClose: async () => "accepted",
        liveUsage: async (_id, report, keepalive) => {
          if (report.kind !== "voice") throw new Error("expected voice usage");
          posted.push({ seconds: report.seconds, keepalive });
          if (posted.length === 1) return new Promise<PostOutcome>((resolve) => { release = resolve; });
          return "accepted";
        },
      },
    });
    meter.report({ kind: "voice", seconds: 15, eventId: "tick" });
    const checkpoint = meter.checkpoint();
    meter.report({ kind: "voice", seconds: 32, eventId: "final" });
    expect(posted).toEqual([{ seconds: 15, keepalive: false }]);
    release("retry");
    await checkpoint;
    expect(posted).toEqual([
      { seconds: 15, keepalive: false },
      { seconds: 15, keepalive: true },
      { seconds: 32, keepalive: true },
    ]);
    expect(meter.status.pending).toBe(0);
    meter.end("pagehide");
    await meter.flush();
  });

  it("posts connected, each report and the close, in order, to the session it was given", async () => {
    const posted: { what: string; sessionId: string; report?: GptLiveUsageReport; reason?: string | null; keepalive: boolean }[] = [];
    const accepted: PostOutcome = "accepted";
    const meter = new GptLiveMeter({
      sessionId: "journal-row-1",
      transport: {
        liveConnected: async (sessionId, keepalive) => {
          posted.push({ what: "connected", sessionId, keepalive });
          return accepted;
        },
        liveUsage: async (sessionId, report, keepalive) => {
          posted.push({ what: "usage", sessionId, report, keepalive });
          return accepted;
        },
        liveClose: async (sessionId, reason, keepalive) => {
          posted.push({ what: "close", sessionId, reason, keepalive });
          return accepted;
        },
      },
    });
    meter.connected();
    const voice = voiceReport(usageUpdated);
    const backend = backendReport("resp_1", backendUsage);
    if (!voice || !backend) throw new Error("the fixtures did not build");
    meter.report(voice);
    meter.report(backend);
    await new Promise((r) => setTimeout(r, 0));
    meter.end("reader");
    await meter.flush();

    expect(posted.map((p) => p.what)).toEqual(["connected", "usage", "usage", "close"]);
    expect(posted.every((p) => p.sessionId === "journal-row-1")).toBe(true);
    expect(posted[1]?.report).toEqual(voice);
    expect(posted[2]?.report).toEqual(backend);
    expect(posted[3]).toMatchObject({ reason: "reader" });
  });

  it("gives what is still queued at teardown one keepalive attempt", async () => {
    /* The first post is held open, so everything behind it is still queued
       when the call ends. That is the pass that may outlive the page. */
    let release!: (outcome: PostOutcome) => void;
    const posted: { what: string; keepalive: boolean }[] = [];
    const meter = new GptLiveMeter({
      sessionId: "journal-row-1",
      transport: {
        liveConnected: (_sessionId, keepalive) => {
          posted.push({ what: "connected", keepalive });
          return new Promise<PostOutcome>((resolve) => {
            release = resolve;
          });
        },
        liveUsage: async (_sessionId, report, keepalive) => {
          posted.push({ what: report.kind, keepalive });
          return "accepted";
        },
        liveClose: async (_sessionId, _reason, keepalive) => {
          posted.push({ what: "close", keepalive });
          return "accepted";
        },
      },
    });
    meter.connected();
    const voice = voiceReport(closed);
    if (!voice) throw new Error("the fixture did not build");
    meter.report(voice);
    meter.end("pagehide");
    const flushed = meter.flush();
    release("accepted");
    await flushed;
    expect(posted).toEqual([
      { what: "connected", keepalive: false },
      { what: "voice", keepalive: true },
      { what: "close", keepalive: true },
    ]);
  });

  it("stops retrying a report the server refused", async () => {
    let tries = 0;
    const meter = new GptLiveMeter({
      sessionId: "journal-row-1",
      delays: [0, 0, 0],
      transport: {
        liveConnected: async () => "accepted",
        liveUsage: async () => {
          tries += 1;
          return "refused";
        },
        liveClose: async () => "accepted",
      },
    });
    const voice = voiceReport(usageUpdated);
    if (!voice) throw new Error("the fixture did not build");
    meter.report(voice);
    await new Promise((r) => setTimeout(r, 20));
    expect(tries).toBe(1);
    expect(meter.status).toMatchObject({ refused: 1, pending: 0 });
  });
});
