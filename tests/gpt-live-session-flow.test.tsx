// @vitest-environment jsdom
/**
 * **A GPT-Live call, driven end to end against a fake peer connection.**
 * src/web/live/gpt-live/useGptLive.ts.
 *
 * The three reducers the hook leans on have their own tests
 * (tests/gpt-live-segments, -delegations, -stall). This is the file in between,
 * and everything here is sequencing that no reducer test can see: when the
 * microphone opens, what goes down the data channel and in which order, when a
 * row is written and what it claims, and what a hang-up does before it lets go.
 * It is the GPT-Live counterpart of tests/live-session-flow.test.tsx, and the
 * fake wire is that file's, copied, so the Realtime test stays untouched.
 *
 * The events are the shapes in evals/live/gpt-live-spike/spike-out-allow.json.
 *
 * Fake timers throughout: a hang-up waits on real clocks (for the last
 * fragments, then for `session.closed`), and the stall rule is twenty seconds.
 */
import { type ReactNode, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GptLiveTicket } from "../src/types.js";
import type { SpokenLanded } from "../src/web/chat/controller.js";
import type { GptLiveUsageReport } from "../src/web/live/gpt-live/meter.js";
import { GPT_LIVE_NO_REPLY_MS } from "../src/web/live/gpt-live/stall.js";
import { useGptLive } from "../src/web/live/gpt-live/useGptLive.js";
import type { LiveOptions } from "../src/web/live/useLiveConversation.js";
import type { GptLiveOffer, LiveToolResult, LiveWiring } from "../src/web/live/wiring.js";
import { resetMicrophoneLock } from "../src/web/mic-lock.js";
import type { SpokenExchange } from "../src/web/useChat.js";

/* React warns on every `act` without this, and nothing else in the suite sets it for this file. */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ---------- the fake wire ---------- */

let sent: Record<string, unknown>[] = [];
let channel: FakeChannel | null = null;
let mic: { enabled: boolean; stopped: boolean; muted: boolean; mute(): void } | null = null;
let pcs: { disconnect(): void }[] = [];
let metered: { kind: string; sessionId: string; report?: GptLiveUsageReport; reason?: string | null }[] = [];
let offers: { slug: string; threadId: string; offer: GptLiveOffer }[] = [];

class FakeChannel {
  readyState = "connecting";
  #listeners = new Map<string, ((e: unknown) => void)[]>();
  addEventListener(name: string, fn: (e: unknown) => void) {
    this.#listeners.set(name, [...(this.#listeners.get(name) ?? []), fn]);
  }
  send(raw: string) {
    sent.push(JSON.parse(raw) as Record<string, unknown>);
  }
  close() {
    this.readyState = "closed";
  }
  open() {
    this.readyState = "open";
    for (const fn of this.#listeners.get("open") ?? []) fn({});
  }
  deliver(event: Record<string, unknown>) {
    for (const fn of this.#listeners.get("message") ?? []) fn({ data: JSON.stringify(event) });
  }
}

function fakeMic() {
  const on = new Map<string, ((e: unknown) => void)[]>();
  mic = {
    enabled: true,
    stopped: false,
    muted: false,
    mute() {
      this.muted = true;
      for (const fn of on.get("mute") ?? []) fn({});
    },
  };
  const held = mic;
  return {
    kind: "audio",
    label: "Built-in Microphone",
    get muted() { return held.muted; },
    addEventListener(name: string, fn: (e: unknown) => void) {
      on.set(name, [...(on.get(name) ?? []), fn]);
    },
    get readyState() { return held.stopped ? "ended" : "live"; },
    get enabled() { return held.enabled; },
    set enabled(v: boolean) { held.enabled = v; },
    stop() { held.stopped = true; },
  } as unknown as MediaStreamTrack;
}

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  channel = null;
  mic = null;
  pcs = [];
  metered = [];
  offers = [];
  resetMicrophoneLock();

  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async () => ({ getAudioTracks: () => [fakeMic()] }),
      enumerateDevices: async () => [],
    },
  });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal(
    "RTCPeerConnection",
    class {
      #on = new Map<string, ((e: unknown) => void)[]>();
      connectionState = "connected";
      constructor() {
        pcs.push(this);
      }
      createDataChannel() {
        channel = new FakeChannel();
        return channel;
      }
      addEventListener(name: string, fn: (e: unknown) => void) {
        this.#on.set(name, [...(this.#on.get(name) ?? []), fn]);
      }
      disconnect() {
        this.connectionState = "disconnected";
        for (const fn of this.#on.get("connectionstatechange") ?? []) fn({});
      }
      addTrack() {}
      getSenders() { return []; }
      async createOffer() { return { sdp: "v=0 the offer", type: "offer" }; }
      async setLocalDescription() {}
      async setRemoteDescription() {}
      close() {}
    },
  );
  vi.stubGlobal(
    "Audio",
    class {
      autoplay = false;
      srcObject: unknown = null;
      play = vi.fn(async () => {});
      addEventListener() {}
      pause() {}
    },
  );
  /* Nothing in this hook may reach the network by itself: the session, the
     tools and the accounting all go through the injected wiring. */
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("useGptLive called fetch directly"); }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetMicrophoneLock();
});

/* ---------- driving the hook ---------- */

const THREAD = "spya-thra01";
const TAIL = "spya-tail01";

const ticketWith = (over: Partial<GptLiveTicket> = {}): GptLiveTicket => ({
  sdp: "v=0 the answer",
  sessionId: "journal-row-1",
  liveSessionId: "live_u1_fake",
  tailId: TAIL,
  ...over,
});

type RunTool = LiveWiring["runTool"];

function wiringFor(ticket: GptLiveTicket, runTool?: RunTool): LiveWiring {
  const reports = metered;
  const asked = offers;
  return {
    ticket: async () => { throw new Error("the Realtime ticket route was called by the GPT-Live hook"); },
    session: async (slug, threadId, offer) => {
      asked.push({ slug, threadId, offer });
      return ticket;
    },
    runTool: runTool ?? (async () => ({ content: "", label: "", detail: "" })),
    liveConnected: async (sessionId) => {
      reports.push({ kind: "connected", sessionId });
      return "accepted";
    },
    liveUsage: async () => { throw new Error("a Realtime usage report was posted by the GPT-Live hook"); },
    gptLiveUsage: async (sessionId, report) => {
      reports.push({ kind: "usage", sessionId, report });
      return "accepted";
    },
    liveClose: async (sessionId, reason) => {
      reports.push({ kind: "close", sessionId, reason });
      return "accepted";
    },
  };
}

function mount(opts: LiveOptions) {
  let api: ReturnType<typeof useGptLive> | null = null;
  function Probe(): ReactNode {
    api = useGptLive("a-slug", opts);
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root!: Root;
  act(() => {
    root = createRoot(host);
    root.render(createElement(Probe));
  });
  return {
    get: () => {
      if (!api) throw new Error("the hook never rendered");
      return api;
    },
    unmount: () => act(() => root.unmount()),
  };
}

/** Let time pass, with everything queued behind it. */
const pass = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const deliver = async (...events: Record<string, unknown>[]) => {
  for (const event of events) {
    await act(async () => {
      channel?.deliver(event);
    });
  }
  await pass();
};

/** Start, and open the channel. The session has not said it has started. */
async function offered(opts: LiveOptions) {
  const h = mount(opts);
  act(() => h.get().start({ threadId: THREAD, microphone: true }));
  await pass();
  await act(async () => {
    channel?.open();
  });
  await pass();
  return h;
}

const STARTED = { type: "session.started", event_id: "ev-started", session: { id: "live_u1_fake" } };

/** Start, open, and `session.started`: a live call. */
async function live(opts: LiveOptions) {
  const h = await offered(opts);
  await deliver(STARTED);
  return h;
}

let fragments = 0;
const said = (role: "reader" | "companion", startMs: number, endMs: number, delta: string) => ({
  type: role === "reader" ? "session.input_transcript.delta" : "session.output_transcript.delta",
  start_ms: startMs,
  end_ms: endMs,
  delta,
  event_id: `ev-frag-${fragments++}`,
});

const backend = (delegationId: string, event: Record<string, unknown>) => ({
  type: "response.event",
  event_id: `ev-be-${fragments++}`,
  delegation_id: delegationId,
  event,
});
const delegated = (id: string, responseId: string) => ({
  type: "session.delegation.created",
  offset_ms: 1_200,
  delegation: { id, type: "delegation", response_id: responseId, target: "responses" },
  event_id: `ev-del-${id}`,
});
const created = (d: string, r: string) => backend(d, { type: "response.created", response: { id: r, model: "gpt-6-luna" } });
const called = (d: string, callId: string, name: string, args: unknown) =>
  backend(d, {
    type: "response.output_item.done",
    item: { type: "function_call", call_id: callId, name, arguments: JSON.stringify(args) },
  });
const completed = (d: string, r: string, input = 900, cached = 800, output = 40) =>
  backend(d, {
    type: "response.completed",
    response: {
      id: r,
      model: "gpt-6-luna",
      status: "completed",
      usage: { input_tokens: input, input_tokens_details: { cached_tokens: cached }, output_tokens: output },
    },
  });

/** A `speak` that records what it was handed and stores it under a fresh id. */
function recordingSpeak() {
  const spoken: SpokenExchange[] = [];
  const speak = async (x: SpokenExchange): Promise<SpokenLanded> => {
    spoken.push(x);
    return { ok: true, threadId: x.threadId, tailId: `spya-stored-${spoken.length}` };
  };
  return { spoken, speak };
}

/** Hang up the way the reader does, with the provider answering the close. */
async function hangUp(h: ReturnType<typeof mount>, seconds = 32) {
  let done = false;
  act(() => {
    void h.get().stop().then(() => { done = true; });
  });
  /* Past the wait for the last fragments. */
  await pass(1_000);
  if (sent.some((e) => e.type === "session.close") && !done) {
    await deliver({ type: "session.closed", reason: "close_requested", usage: { seconds }, event_id: "ev-closed" });
  }
  await pass();
  return () => done;
}

const kinds = () => metered.map((m) => (m.kind === "usage" ? `usage:${m.report?.kind}` : m.kind));

/* ---------- the tests ---------- */

describe("opening the call", () => {
  it("hands the offer to our server, and opens the microphone only on session.started", async () => {
    const h = await offered({ wiring: wiringFor(ticketWith()), tailNow: () => TAIL });

    expect(offers).toEqual([{ slug: "a-slug", threadId: THREAD, offer: { sdp: "v=0 the offer" } }]);
    /* The channel is open and the answer is set, and still nothing may be heard. */
    expect(mic?.enabled).toBe(false);
    expect(h.get().phase).toBe("connecting");
    /* What LiveStatus's step list reads. The answer is set, so the wait left is
       for `session.started`. */
    expect(h.get().step).toBe("seeding");
    expect(kinds()).toEqual(["connected"]);

    await deliver(STARTED);
    expect(mic?.enabled).toBe(true);
    expect(h.get().phase).toBe("live");
    expect(h.get().step).toBeNull();
    expect(h.get().threadId).toBe(THREAD);
    h.unmount();
  });

  /* `LiveApi` is shared with the Realtime hook, whose tap to talk is OpenAI
     Realtime's push-to-talk. This engine has no such thing, so the fields must
     say "not offered" rather than be missing, and the actions must do nothing —
     LiveStatus draws Talk and Done from `talkMode` alone. */
  it("does not offer tap to talk, and its actions change nothing", async () => {
    const h = await live({ wiring: wiringFor(ticketWith()), tailNow: () => TAIL });
    const before = sent.length;
    act(() => {
      h.get().enterTapToTalk();
      h.get().talk();
      h.get().doneTalking();
    });
    await pass();
    expect(h.get().talkMode).toBe("hands-free");
    expect(h.get().reconnecting).toBe(false);
    expect(sent.length).toBe(before);
    expect(mic?.enabled).toBe(true);
    h.unmount();
  });

  it("refuses to open the microphone when the conversation moved while it was connecting", async () => {
    const h = await offered({ wiring: wiringFor(ticketWith()), tailNow: () => "spya-someone-typed" });
    await deliver(STARTED);

    expect(mic?.enabled).toBe(false);
    expect(h.get().phase).not.toBe("live");
    expect(h.get().error).toMatch(/changed while the session was starting/);
    /* The session exists at the provider, so it is asked to close. */
    await pass(100);
    expect(sent).toEqual([{ type: "session.close" }]);
    await deliver({ type: "session.closed", reason: "close_requested", usage: { seconds: 15 }, event_id: "ev-c" });
    expect(h.get().phase).toBe("idle");
    expect(mic?.stopped).toBe(true);
    expect(metered.at(-1)).toMatchObject({ kind: "close", reason: "thread-moved" });
    h.unmount();
  });

  it("a start abandoned while the microphone is being granted opens no connection and no session", async () => {
    let grant!: () => void;
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockImplementation(
      () => new Promise((resolve) => {
        grant = () => resolve({ getAudioTracks: () => [fakeMic()] } as unknown as MediaStream);
      }),
    );
    const h = mount({ wiring: wiringFor(ticketWith()) });
    act(() => h.get().start({ threadId: THREAD }));
    await pass();
    expect(h.get().phase).toBe("connecting");

    await act(async () => { await h.get().stop(); });
    await act(async () => { grant(); });
    await pass();

    expect(pcs).toHaveLength(0);
    expect(offers).toHaveLength(0);
    expect(mic?.stopped).toBe(true);
    expect(mic?.enabled).not.toBe(false);
    expect(h.get().phase).toBe("idle");
    h.unmount();
  });

  it("fails with a sentence, and holds no microphone, when the server cannot open a session", async () => {
    const wiring = wiringFor(ticketWith());
    const h = mount({
      wiring: { ...wiring, session: async () => { throw new Error("The voice service refused. [live-upstream]"); } },
    });
    act(() => h.get().start({ threadId: THREAD }));
    await pass();
    expect(h.get().phase).toBe("failed");
    expect(h.get().error).toMatch(/Live voice is unavailable right now/);
    expect(mic?.stopped).toBe(true);
    h.unmount();
  });

  it("says so, rather than running unmetered, when the wiring has no GPT-Live route", async () => {
    const { session: _session, gptLiveUsage: _usage, ...realtimeOnly } = wiringFor(ticketWith());
    const h = mount({ wiring: realtimeOnly });
    act(() => h.get().start({ threadId: THREAD }));
    await pass();
    expect(h.get().phase).toBe("failed");
    expect(mic).toBeNull();
    expect(pcs).toHaveLength(0);
    h.unmount();
  });
});

describe("a question the backend answers with a tool", () => {
  it("runs the tool once, sends the outputs then one response.create, and writes one row when the reader speaks again", async () => {
    let finishTool!: (result: LiveToolResult) => void;
    const runTool = vi.fn<RunTool>(
      () => new Promise<LiveToolResult>((resolve) => { finishTool = resolve; }),
    );
    const { spoken, speak } = recordingSpeak();
    const h = await live({ wiring: wiringFor(ticketWith(), runTool), speak, tailNow: () => TAIL });

    await deliver(
      said("reader", 1_000, 1_200, " What"),
      said("reader", 1_200, 1_400, " does it say"),
      said("reader", 1_400, 2_000, " about the lighthouse?"),
      delegated("d1", "r1"),
      created("d1", "r1"),
      said("companion", 2_200, 2_600, " Let me check."),
      called("d1", "call-1", "search_article", { query: "lighthouse" }),
      called("d1", "call-2", "show_passage", { blockIds: ["spya-aaaaaa"], why: "the lighthouse" }),
      /* The same call again, as a redelivery would bring it. */
      called("d1", "call-1", "search_article", { query: "lighthouse" }),
    );

    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool.mock.calls[0]?.slice(0, 3)).toEqual(["a-slug", "search_article", { query: "lighthouse" }]);
    expect(h.get().pendingTools).toEqual([{ callId: "call-1", name: "search_article" }]);
    /* The filler is still being spoken, so it is "speaking", not "thinking"... */
    expect(h.get().thinking).toBe(false);
    await pass(2_000);
    /* ...and once it has finished, the wait for the tool is. */
    expect(h.get().thinking).toBe(true);
    expect(h.get().pointers.map((p) => p.blockIds)).toEqual([["spya-aaaaaa"]]);

    /* The response completes while the tool is still running: nothing is sent yet. */
    await deliver(completed("d1", "r1"));
    expect(sent).toEqual([]);

    await act(async () => {
      finishTool({ content: "It was painted teal in 1987.", label: "searched the article", detail: "1 passage" });
    });
    await pass();
    expect(sent).toEqual([
      { type: "response.item.create", item: { type: "function_call_output", call_id: "call-1", output: "It was painted teal in 1987." } },
      { type: "response.item.create", item: { type: "function_call_output", call_id: "call-2", output: "Showed the reader 1 passage." } },
      { type: "response.create" },
    ]);
    expect(h.get().pendingTools).toEqual([]);
    expect(h.get().tools.map((t) => t.name)).toEqual(["show_passage", "search_article"]);

    await deliver(
      created("d1", "r2"),
      completed("d1", "r2", 1_000, 900, 30),
      said("companion", 5_000, 5_600, " It was painted"),
      said("companion", 5_600, 6_500, " teal in 1987."),
    );
    /* Nothing more goes down the channel: the final has no calls. */
    expect(sent).toHaveLength(3);
    /* And nothing is written yet. Silence does not finish an exchange. */
    await pass(5_000);
    expect(spoken).toEqual([]);
    expect(h.get().lines.map((l) => [l.role, l.text])).toEqual([
      ["reader", "What does it say about the lighthouse?"],
      ["companion", "Let me check. It was painted teal in 1987."],
    ]);

    /* The reader speaks again, and the companion is heard past their last word. */
    await deliver(
      said("reader", 9_000, 10_000, " And who painted it then, do we know?"),
      said("companion", 11_200, 11_600, " I'll check."),
    );

    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toEqual({
      threadId: THREAD,
      question: "What does it say about the lighthouse?",
      answer: "Let me check. It was painted teal in 1987.",
      expectedTailId: TAIL,
      passages: [{ blockIds: ["spya-aaaaaa"], why: "the lighthouse" }],
      tools: [
        { name: "show_passage", label: "pointed at", detail: "spya-aaaaaa", status: "done" },
        { name: "search_article", label: "searched the article", detail: "1 passage", status: "done" },
      ],
      engine: "gpt-live",
    });
    /* The written exchange leaves the live transcript; the open one stays. */
    expect(h.get().lines.map((l) => l.text)).toEqual(["And who painted it then, do we know?", "I'll check."]);

    /* Both backend responses were billed, each once, under their own id. */
    const backendReports = metered.filter((m) => m.report?.kind === "backend").map((m) => m.report);
    expect(backendReports).toEqual([
      { kind: "backend", responseId: "r1", inputTokens: 900, cachedInputTokens: 800, outputTokens: 40 },
      { kind: "backend", responseId: "r2", inputTokens: 1_000, cachedInputTokens: 900, outputTokens: 30 },
    ]);
    h.unmount();
  });

  it("answers a failed tool with the failure, so the backend is never left waiting", async () => {
    const runTool = vi.fn<RunTool>(async () => { throw new Error("the search is down"); });
    const h = await live({ wiring: wiringFor(ticketWith(), runTool), tailNow: () => TAIL });
    await deliver(delegated("d1", "r1"), created("d1", "r1"), called("d1", "call-1", "search_article", {}), completed("d1", "r1"));
    expect(sent).toEqual([
      { type: "response.item.create", item: { type: "function_call_output", call_id: "call-1", output: "That tool failed: the search is down" } },
      { type: "response.create" },
    ]);
    expect(h.get().tools[0]).toMatchObject({ name: "search_article", detail: "failed — the search is down" });
    h.unmount();
  });

  it("shows a backend response that failed, and stops showing its tool as running", async () => {
    const runTool = vi.fn<RunTool>(() => new Promise<LiveToolResult>(() => {}));
    const h = await live({ wiring: wiringFor(ticketWith(), runTool), tailNow: () => TAIL });
    await deliver(delegated("d1", "r1"), created("d1", "r1"), called("d1", "call-1", "search_article", {}));
    expect(h.get().pendingTools).toHaveLength(1);

    await deliver(backend("d1", { type: "response.failed", response: { id: "r1", error: { message: "server_error" } } }));
    expect(h.get().pendingTools).toEqual([]);
    expect(h.get().thinking).toBe(false);
    expect(h.get().tools.at(-1)).toMatchObject({ name: "delegation", detail: expect.stringMatching(/^failed — .*server_error/) });
    expect(sent).toEqual([]);
    expect(h.get().phase).toBe("live");
    h.unmount();
  });
});

describe("hanging up", () => {
  it("hands the microphone back at once, asks the session to close, writes the last exchange and posts the final seconds", async () => {
    const { spoken, speak } = recordingSpeak();
    const h = await live({ wiring: wiringFor(ticketWith()), speak, tailNow: () => TAIL });
    await deliver(
      said("reader", 1_000, 2_000, " Is the lighthouse still standing?"),
      said("companion", 2_500, 3_500, " Yes, it is."),
      { type: "session.usage.updated", usage: { seconds: 15 }, event_id: "ev-usage-1" },
    );
    expect(spoken).toEqual([]);

    let done = false;
    act(() => { void h.get().stop().then(() => { done = true; }); });
    await pass();
    /* The device is back before anything else has finished. */
    expect(mic?.stopped).toBe(true);
    expect(h.get().phase).toBe("closing");
    /* The channel is held while fragments were still arriving a moment ago. */
    expect(sent).toEqual([]);
    await deliver(said("companion", 3_500, 4_000, " It was restored in 2019."));
    await pass(1_000);
    expect(sent).toEqual([{ type: "session.close" }]);
    expect(done).toBe(false);
    expect(spoken).toEqual([]);

    await deliver({ type: "session.closed", reason: "close_requested", usage: { seconds: 32 }, event_id: "ev-closed" });
    expect(done).toBe(true);
    expect(h.get().phase).toBe("idle");
    expect(h.get().error).toBeNull();
    expect(spoken).toEqual([
      {
        threadId: THREAD,
        question: "Is the lighthouse still standing?",
        answer: "Yes, it is. It was restored in 2019.",
        expectedTailId: TAIL,
        engine: "gpt-live",
      },
    ]);
    expect(h.get().lines).toEqual([]);
    expect(kinds()).toEqual(["connected", "usage:voice", "usage:voice", "close"]);
    expect(metered[1]?.report).toEqual({ kind: "voice", seconds: 15, eventId: "ev-usage-1" });
    expect(metered[2]?.report).toEqual({ kind: "voice", seconds: 32, eventId: "ev-closed" });
    expect(metered[3]).toMatchObject({ sessionId: "journal-row-1", reason: "reader" });
    h.unmount();
  });

  it("does not wait for ever on a session.closed that never comes", async () => {
    const { spoken, speak } = recordingSpeak();
    const h = await live({ wiring: wiringFor(ticketWith()), speak, tailNow: () => TAIL });
    await deliver(said("reader", 1_000, 2_000, " Hello there, can you hear me now?"));
    let done = false;
    act(() => { void h.get().stop().then(() => { done = true; }); });
    await pass(1_000);
    expect(sent).toEqual([{ type: "session.close" }]);
    /* Asked at about 0.8 s, once the fragments had stopped; three seconds from there. */
    await pass(2_700);
    expect(done).toBe(false);
    await pass(300);
    expect(done).toBe(true);
    expect(spoken.map((s) => s.question)).toEqual(["Hello there, can you hear me now?"]);
    expect(vi.getTimerCount()).toBe(0);
    h.unmount();
  });

  it("claims each row's tail from the one before it, in order", async () => {
    const { spoken, speak } = recordingSpeak();
    const h = await live({ wiring: wiringFor(ticketWith()), speak, tailNow: () => TAIL });
    await deliver(
      said("reader", 1_000, 2_000, " First question, about the keeper."),
      said("companion", 2_500, 3_500, " The keeper left in 1987."),
      said("reader", 6_000, 7_000, " Second question, about the lamp."),
      said("companion", 8_200, 9_000, " The lamp is original."),
    );
    expect(spoken).toHaveLength(1);
    await hangUp(h);
    expect(spoken.map((s) => [s.question, s.expectedTailId])).toEqual([
      ["First question, about the keeper.", TAIL],
      ["Second question, about the lamp.", "spya-stored-1"],
    ]);
    h.unmount();
  });
});

describe("a write that is refused", () => {
  it("ends the call, keeps the words on screen, and writes nothing after it", async () => {
    const asked: SpokenExchange[] = [];
    const speak = async (x: SpokenExchange): Promise<SpokenLanded> => {
      asked.push(x);
      return { ok: false, conflict: true, error: "This conversation moved on." };
    };
    const h = await live({ wiring: wiringFor(ticketWith()), speak, tailNow: () => TAIL });
    await deliver(
      said("reader", 1_000, 2_000, " First question, about the keeper."),
      said("companion", 2_500, 3_500, " The keeper left in 1987."),
      said("reader", 6_000, 7_000, " Second question, about the lamp."),
      said("companion", 8_200, 9_000, " The lamp is original."),
    );
    expect(asked).toHaveLength(1);
    /* The refusal hangs up by itself. */
    await pass(1_000);
    await deliver({ type: "session.closed", reason: "close_requested", usage: { seconds: 20 }, event_id: "ev-closed" });

    expect(h.get().phase).toBe("idle");
    expect(h.get().error).toBe("This conversation moved on.");
    expect(h.get().hasUnsavedLines).toBe(true);
    expect(mic?.stopped).toBe(true);
    /* The second exchange was never offered: its tail would have been a guess. */
    expect(asked).toHaveLength(1);
    expect(h.get().lines.map((l) => l.text)).toEqual([
      "First question, about the keeper.",
      "The keeper left in 1987.",
      "Second question, about the lamp.",
      "The lamp is original.",
    ]);
    /* The thread groups by these (src/web/live/tail.ts): two exchanges of one call. */
    expect(h.get().lines.map((l) => [l.exchange, l.seq, l.session])).toEqual([
      ["gpt-live-0", 0, 1],
      ["gpt-live-0", 0, 1],
      ["gpt-live-1", 1, 1],
      ["gpt-live-1", 1, 1],
    ]);
    expect(metered.at(-1)).toMatchObject({ kind: "close", reason: "append-refused" });
    h.unmount();
  });
});

describe("the provider ending the call", () => {
  it.each([
    ["expired", /time limit/],
    ["content", /something that was said/],
    ["connection_lost", /connection was lost/],
    ["remote_hangup", /ended the call/],
    ["something_new", /conversation ended/],
  ])("session.closed %s says why, writes what was said and does not ask to close again", async (reason, sentence) => {
    const { spoken, speak } = recordingSpeak();
    const h = await live({ wiring: wiringFor(ticketWith()), speak, tailNow: () => TAIL });
    await deliver(
      said("reader", 1_000, 2_000, " Is the lighthouse still standing?"),
      said("companion", 2_500, 3_500, " Yes, it is."),
    );
    await deliver({ type: "session.closed", reason, usage: { seconds: 7_200 }, event_id: "ev-closed" });
    await pass(1_000);

    expect(h.get().phase).toBe("idle");
    expect(h.get().error).toMatch(sentence);
    expect(sent).toEqual([]);
    expect(mic?.stopped).toBe(true);
    expect(spoken.map((s) => s.answer)).toEqual(["Yes, it is."]);
    expect(metered.find((m) => m.report?.kind === "voice")?.report).toMatchObject({ seconds: 7_200 });
    expect(metered.at(-1)).toMatchObject({ kind: "close", reason: `provider-${reason}` });
    h.unmount();
  });
});

describe("errors that are not the end of the call", () => {
  it("logs and counts event_not_allowed, and carries on", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = await live({ wiring: wiringFor(ticketWith()), tailNow: () => TAIL });
    await deliver({ type: "error", error: { type: "invalid_request_error", code: "event_not_allowed", message: "quoted text" } });
    expect(h.get().phase).toBe("live");
    expect(h.get().error).toBeNull();
    expect(h.get().seen.error).toBe(1);
    expect(logged.mock.calls.flat().join(" ")).toMatch(/event_not_allowed/);
    /* The provider's message can quote what was sent. Only the code is logged. */
    expect(logged.mock.calls.flat().join(" ")).not.toMatch(/quoted text/);
    logged.mockRestore();
    h.unmount();
  });

  it("an error before the call has started is the end of it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = await offered({ wiring: wiringFor(ticketWith()), tailNow: () => TAIL });
    await deliver({ type: "error", error: { code: "session_failed" } });
    await pass(4_000);
    expect(h.get().phase).toBe("failed");
    expect(mic?.enabled).toBe(false);
    expect(mic?.stopped).toBe(true);
    logged.mockRestore();
    h.unmount();
  });
});

describe("what the status strip is told", () => {
  it("estimates hearing and speaking from how recently each side's fragments arrived", async () => {
    const h = await live({ wiring: wiringFor(ticketWith()), tailNow: () => TAIL });
    expect(h.get().hearing).toBe(false);
    await deliver(said("reader", 1_000, 1_200, " Hello"));
    expect(h.get().hearing).toBe(true);
    expect(h.get().speaking).toBe(false);
    await pass(2_000);
    expect(h.get().hearing).toBe(false);
    await deliver(said("companion", 3_000, 3_200, " Hi"));
    expect(h.get().speaking).toBe(true);
    await pass(2_000);
    expect(h.get().speaking).toBe(false);
    h.unmount();
  });

  it("says no reply when the backend finished and the voice never spoke (the spike's eleventh run)", async () => {
    const captured = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = await live({ wiring: wiringFor(ticketWith()), tailNow: () => TAIL });
    await deliver(
      said("reader", 1_000, 2_000, " What does it say about the lighthouse?"),
      delegated("d1", "r1"),
      created("d1", "r1"),
      said("companion", 2_200, 2_600, " One moment."),
      completed("d1", "r1"),
    );
    await pass(GPT_LIVE_NO_REPLY_MS - 2_000);
    expect(h.get().stall).toBeNull();
    await pass(3_000);
    expect(h.get().stall).toBe("no-reply");

    /* The answer, late: spoken after the final, so the debt is paid. */
    await deliver(said("companion", 30_000, 30_400, " It was painted teal."));
    await pass(1_000);
    expect(h.get().stall).toBeNull();
    captured.mockRestore();
    h.unmount();
  });

  it("does not call a few words followed by silence a stall", async () => {
    const h = await live({ wiring: wiringFor(ticketWith()), tailNow: () => TAIL });
    await deliver(
      said("companion", 1_000, 2_000, " That is the whole of that section."),
      said("reader", 4_000, 4_400, " Right, thanks."),
    );
    await pass(GPT_LIVE_NO_REPLY_MS + 5_000);
    expect(h.get().stall).toBeNull();
    h.unmount();
  });

  it("says the microphone is paused when the device stops giving samples", async () => {
    const h = await live({ wiring: wiringFor(ticketWith()), tailNow: () => TAIL });
    act(() => mic?.mute());
    await pass();
    expect(h.get().stall).toBe("microphone-paused");
    h.unmount();
  });
});

describe("the caps", () => {
  it("ends a call the reader has stopped talking in, and a reader fragment starts the clock again", async () => {
    const h = await live({ wiring: wiringFor(ticketWith()), tailNow: () => TAIL });
    await pass(4 * 60_000);
    await deliver(said("reader", 240_000, 241_000, " Still here, just reading this bit."));
    await pass(4 * 60_000);
    expect(h.get().phase).toBe("live");
    await pass(70_000);
    expect(h.get().error).toMatch(/a few minutes of quiet/);
    await deliver({ type: "session.closed", reason: "close_requested", usage: { seconds: 550 }, event_id: "ev-closed" });
    expect(h.get().phase).toBe("idle");
    expect(metered.at(-1)).toMatchObject({ kind: "close", reason: "idle-cap" });
    h.unmount();
  });
});

describe("a typed turn into a live call", () => {
  it("sends the message and a response.create, and stores the text as the question", async () => {
    const { spoken, speak } = recordingSpeak();
    const h = await live({ wiring: wiringFor(ticketWith()), speak, tailNow: () => TAIL });
    await pass(2_000);
    act(() => h.get().say("What does it say about the lighthouse?"));
    expect(sent).toEqual([
      { type: "response.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "What does it say about the lighthouse?" }] } },
      { type: "response.create" },
    ]);
    await deliver(said("companion", 3_000, 4_000, " It was painted teal in 1987."));
    await hangUp(h);
    expect(spoken.map((s) => [s.question, s.answer])).toEqual([
      ["What does it say about the lighthouse?", "It was painted teal in 1987."],
    ]);
    h.unmount();
  });
});
