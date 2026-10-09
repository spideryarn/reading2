// @vitest-environment jsdom
/**
 * **The live words and the saved words are one place, and one copy.**
 * docs/plans/261002j-live-voice-chat-cleanup.md § 1b, and GPT Sol's plan review.
 *
 * The real hook, the real chat controller and the real ChatPanel, with only the
 * provider wire and our server faked — because the bug this guards is *between*
 * them. The live copy is the hook's state and the provisional rows are the
 * controller's store, and React commits those two at different priorities: a
 * handoff that changes them separately shows a frame with both copies (or with
 * neither) and nothing else in the suite can see it.
 *
 * So this file runs **outside `act`**, against React's real scheduler, and
 * looks at the DOM where a browser could paint: once the step's own microtasks
 * have drained, and again after React's scheduled work has run. `act` would
 * batch the two priorities into one commit and agree with the broken version.
 *
 * Also here: the level meter's clone being stopped on every way a session ends,
 * and a reconnect cancelled from the panel during its hang-up.
 */
import { createElement, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage, ChatThread } from "../src/types.js";
import { ChatController, type ChatEffects } from "../src/web/chat/controller.js";
import type { SpokenOutcome } from "../src/web/chat/effects.js";
import { asOpId, type ThreadsOutcome } from "../src/web/chat/model.js";
import { resetMicrophoneLock } from "../src/web/mic-lock.js";
import { type LiveApi, useLiveConversation } from "../src/web/live/useLiveConversation.js";
import type { LiveTicket, LiveWiring } from "../src/web/live/wiring.js";
import type { SpokenExchange } from "../src/web/useChat.js";

const { ChatPanel } = await import("../src/web/ChatPanel.js");

/* ---------- the fake wire (the shape of tests/live-session-flow.test.tsx's) ---------- */

class FakeChannel {
  readyState = "connecting";
  #listeners = new Map<string, ((e: unknown) => void)[]>();
  addEventListener(name: string, fn: (e: unknown) => void) {
    this.#listeners.set(name, [...(this.#listeners.get(name) ?? []), fn]);
  }
  send() {}
  close() { this.readyState = "closed"; }
  open() {
    this.readyState = "open";
    for (const fn of this.#listeners.get("open") ?? []) fn({});
  }
  deliver(event: Record<string, unknown>) {
    for (const fn of this.#listeners.get("message") ?? []) fn({ data: JSON.stringify(event) });
  }
}

/** A track as far as the hook uses one, recording what was done to it. */
interface Track { label: string; enabled: boolean; stopped: boolean; clones: Track[] }
let channel: FakeChannel | null = null;
let pcs = 0;
let tracks: Track[] = [];
let sentTracks: MediaStreamTrack[] = [];

function fakeTrack(label: string): MediaStreamTrack {
  const state: Track = { label, enabled: true, stopped: false, clones: [] };
  tracks.push(state);
  const track = {
    kind: "audio",
    label,
    muted: false,
    addEventListener() {},
    get readyState() { return state.stopped ? "ended" : "live"; },
    get enabled() { return state.enabled; },
    set enabled(v: boolean) { state.enabled = v; },
    stop() { state.stopped = true; },
    clone() {
      const copy = fakeTrack(`${label} (clone)`);
      copy.enabled = state.enabled;
      state.clones.push(tracks.at(-1)!);
      return copy;
    },
  };
  return track as unknown as MediaStreamTrack;
}

const mic = () => tracks.find((t) => t.label === "Built-in Microphone")!;
const meterClone = () => mic().clones[0];

beforeEach(() => {
  channel = null;
  pcs = 0;
  tracks = [];
  sentTracks = [];
  resetMicrophoneLock();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
  vi.stubGlobal("navigator", {
    onLine: true,
    platform: "MacIntel",
    userAgent: "Test browser",
    mediaDevices: {
      getUserMedia: async () => ({ getAudioTracks: () => [fakeTrack("Built-in Microphone")] }),
      enumerateDevices: async () => [],
    },
  });
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => { storage.set(k, v); },
    removeItem: (k: string) => { storage.delete(k); },
  });
  vi.stubGlobal("RTCPeerConnection", class {
    connectionState = "connected";
    constructor() { pcs++; }
    createDataChannel() { channel = new FakeChannel(); return channel; }
    addEventListener() {}
    addTrack(track: MediaStreamTrack) { sentTracks.push(track); }
    getSenders() { return []; }
    async createOffer() { return { sdp: "v=0", type: "offer" }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    close() {}
  });
  vi.stubGlobal("Audio", class { autoplay = false; srcObject = null; addEventListener() {} pause() {} async play() {} });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => "v=0" }) as Response));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetMicrophoneLock();
});

/* ---------- the seam: the real controller, our server faked ---------- */

const THREAD = "spya-thra01";
const AT = "2026-10-02T12:00:00.000Z";
const row = (id: string, role: ChatMessage["role"], text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, role, text, status: "done", createdAt: AT, ...extra,
});
const Q = "What does the second section claim?";
const A = "That the effect only holds in small samples.";

function seam() {
  let resolveWrite!: (outcome: SpokenOutcome) => void;
  let resolveRepair!: (outcome: ThreadsOutcome) => void;
  const effects: ChatEffects = {
    loadThreads: () => new Promise((resolve) => { resolveRepair = resolve; }),
    appendSpoken: () => new Promise((resolve) => { resolveWrite = resolve; }),
    renameThread: async () => ({ ok: true }),
    deleteThread: async () => ({ ok: true }),
    deleteFrom: async () => ({ ok: true }),
    runTurn: async () => {},
    settledAnswer: async () => null,
    stopAnswer: async () => ({ ok: true }),
    cancelThread: async () => ({ ok: true }),
    markHintOpened: async () => ({ ok: false, error: "not in this test" }),
  };
  const controller = new ChatController("a-slug", effects);
  const empty: ChatThread = { id: THREAD, kind: "chat", title: "New chat", createdAt: AT, updatedAt: AT, messages: [] };
  controller.dispatch({ type: "thread.begun", thread: empty });
  let n = 0;
  /* What useChat's `speak` does, with predictable ids. */
  const speak = (exchange: SpokenExchange) => {
    n += 1;
    return controller.appendSpoken({
      id: asOpId(`spya-spok0${n}`), kind: "spoken", threadId: THREAD,
      question: row(`spya-locq0${n}`, "user", exchange.question),
      reply: row(`spya-loca0${n}`, "assistant", exchange.answer, exchange.interrupted ? { interrupted: true } : {}),
      expectedTailId: exchange.expectedTailId, at: AT,
    });
  };
  const saved = (answer = A, extra: Partial<ChatMessage> = {}): ChatThread => ({
    ...empty, messages: [row("spya-srvq01", "user", Q), row("spya-srva01", "assistant", answer, extra)],
  });
  return {
    controller, speak, saved, empty,
    write: (outcome: SpokenOutcome) => resolveWrite(outcome),
    repair: (outcome: ThreadsOutcome) => resolveRepair(outcome),
  };
}

const wiring: LiveWiring = {
  ticket: async (): Promise<LiveTicket> => ({
    token: "ek_test", expiresAt: 0, model: "m", seed: [], tailId: null, sessionId: "live-session-1",
  }),
  runTool: async () => ({ content: "", label: "", detail: "" }),
  liveConnected: async () => "accepted",
  liveUsage: async () => "accepted",
  liveClose: async () => "accepted",
};

/* ---------- mounting, and looking where a browser could paint ---------- */

let host: HTMLDivElement;
let root: Root;
let live!: LiveApi;

function mount(s: ReturnType<typeof seam>, liveWiring: LiveWiring = wiring) {
  function Harness() {
    const snap = useSyncExternalStore(s.controller.subscribe, s.controller.getSnapshot);
    live = useLiveConversation("a-slug", { wiring: liveWiring, speak: s.speak, tailNow: () => null });
    return createElement(ChatPanel, {
      slug: "a-slug", kind: "chat" as const, loaded: true, loadFailed: false,
      threads: [...snap.threads], threadId: THREAD,
      onThread: () => {}, onSend: () => {}, onNew: () => {}, onSendNew: () => {}, onDiscard: () => {},
      onRename: () => {}, onDelete: () => {}, canStartOver: true, onRetry: () => {}, onEdit: () => {}, onDeleteFrom: undefined,
      onStop: () => {}, onJump: () => {}, recovering: new Set<string>(), blocks: new Map<string, string>(),
      focusNonce: 0, error: null, live,
      onStartLive: () => { live.start({ threadId: THREAD }); return undefined; },
    });
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(createElement(Harness));
}

/** The end of the current task: every microtask drained, no macrotask run. */
async function endOfTask() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}
/** Let React's scheduled work (and any timers at 0) run. */
async function later() {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
}

/** How many times `text` is on screen in the thread. */
function copies(text: string): number {
  return (host.querySelector(".chat-scroll")?.textContent ?? "").split(text).length - 1;
}

/**
 * Check both moments a browser could paint after a step, and keep a record.
 * A frame with two copies is the reader watching their words duplicate; one
 * with none is them watching the words vanish and come back.
 */
const seen: { at: string; q: number; a: number }[] = [];
async function observe(at: string) {
  await endOfTask();
  seen.push({ at: `${at} (end of task)`, q: copies(Q), a: copies(A) });
  await later();
  seen.push({ at: `${at} (later)`, q: copies(Q), a: copies(A) });
}

async function connect() {
  await later();
  live.start({ threadId: THREAD });
  await later();
  channel!.open();
  await later();
  expect(live.phase).toBe("live");
}

/** One turn, as OpenAI sends it, one event per task, observed after each. */
async function speakTurn() {
  const events: [string, Record<string, unknown>][] = [
    ["item", { type: "conversation.item.added", item: { id: "u1", role: "user", type: "message" } }],
    ["question delta", { type: "conversation.item.input_audio_transcription.delta", item_id: "u1", delta: Q }],
    ["response", { type: "response.created", response: { id: "r1" } }],
    ["answer delta", { type: "response.output_audio_transcript.delta", response_id: "r1", item_id: "a1", delta: A }],
    ["answer done", { type: "response.output_audio_transcript.done", response_id: "r1", item_id: "a1", transcript: A }],
    ["response done", { type: "response.done", response: { id: "r1", status: "completed", output: [{ type: "message" }] } }],
    ["question done", { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: Q }],
  ];
  for (const [name, event] of events) {
    channel!.deliver(event);
    await observe(name);
  }
}

/** From the moment both halves are on screen, every observation shows exactly one of each. */
function expectOneCopyThroughout() {
  const from = seen.findIndex((s) => s.q > 0 && s.a > 0);
  expect(from, "the exchange never appeared at all").toBeGreaterThanOrEqual(0);
  const wrong = seen.slice(from).filter((s) => s.q !== 1 || s.a !== 1);
  expect(wrong, "a frame showed the exchange twice, or not at all").toEqual([]);
  expect(seen.slice(0, from).filter((s) => s.q > 1 || s.a > 1)).toEqual([]);
}

afterEach(async () => {
  seen.length = 0;
  root?.unmount();
  host?.remove();
  await later();
});

describe("the handoff from live words to the saved conversation", () => {
  it("shows one copy through an ordinary save", async () => {
    const s = seam();
    mount(s);
    await connect();
    await speakTurn();
    expect(host.querySelector(".chat-live-tail"), "the provisional rows did not take over").toBeNull();
    s.write({ ok: true, thread: s.saved() });
    await observe("saved");
    expectOneCopyThroughout();
    expect(s.controller.threads[0]?.messages.map((m) => m.id)).toEqual(["spya-srvq01", "spya-srva01"]);
  });

  it("shows one copy while a slow save is still out", async () => {
    const s = seam();
    mount(s);
    await connect();
    await speakTurn();
    for (let i = 0; i < 5; i++) await observe(`waiting ${i}`);
    s.write({ ok: true, thread: s.saved() });
    await observe("saved");
    expectOneCopyThroughout();
  });

  it("shows one copy through a 409 whose repair finds the exchange stored", async () => {
    const s = seam();
    mount(s);
    await connect();
    await speakTurn();
    s.write({ ok: false, conflict: true, error: "Conversation moved on." });
    await observe("refused");
    s.repair({ ok: true, threads: [s.saved()] });
    await observe("repaired");
    expectOneCopyThroughout();
    expect(live.hasUnsavedLines).toBe(false);
  });

  it("shows one copy through a 409 whose repair finds it missing, and keeps the words with the notice", async () => {
    const s = seam();
    mount(s);
    await connect();
    await speakTurn();
    s.write({ ok: false, conflict: true, error: "Conversation moved on." });
    await observe("refused");
    s.repair({ ok: true, threads: [s.empty] });
    await observe("repaired, missing");
    await observe("settled");
    expectOneCopyThroughout();
    const tail = host.querySelector(".chat-live-tail");
    expect(tail?.textContent).toContain(Q);
    expect(tail?.querySelector(".chat-live-unsaved"), "kept words with no word about why").not.toBeNull();
    expect(tail?.querySelector(".chat-cursor"), "a finished session still blinking").toBeNull();
  });

  it("shows one copy when a definite failed save restores the live words", async () => {
    const s = seam();
    mount(s);
    await connect();
    await speakTurn();
    s.write({ ok: false, conflict: false, error: "Could not save that spoken exchange." });
    await observe("failed");
    await observe("settled");
    expectOneCopyThroughout();
    const tail = host.querySelector(".chat-live-tail");
    expect(tail?.textContent).toContain(Q);
    expect(tail?.querySelector(".chat-live-unsaved"), "restored words have no uncertainty notice").not.toBeNull();
  });

  it("shows one copy while hang-up waits for a save already in flight", async () => {
    const s = seam();
    mount(s);
    await connect();
    await speakTurn();
    const stopped = live.stop();
    await observe("hang-up waiting for save");
    expect(live.phase).toBe("closing");
    s.write({ ok: true, thread: s.saved() });
    await stopped;
    await observe("hang-up saved");
    expectOneCopyThroughout();
    expect(live.phase).toBe("idle");
  });

  it("shows one copy of an answer cut off by hanging up, and it is saved as ended early", async () => {
    const s = seam();
    mount(s);
    await connect();
    const partial = "That the effect only";
    for (const event of [
      { type: "conversation.item.added", item: { id: "u1", role: "user", type: "message" } },
      { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: Q },
      { type: "response.created", response: { id: "r1" } },
      { type: "response.output_audio_transcript.delta", response_id: "r1", item_id: "a1", delta: partial },
    ]) {
      channel!.deliver(event);
      await observe("arriving");
    }
    expect(host.querySelector(".chat-live-tail .chat-cursor"), "an arriving answer has no mark").not.toBeNull();
    const partials: number[] = [];
    const look = async (at: string) => { await observe(at); partials.push(copies(partial)); };
    /* Stop waits for the write queue, so the write is answered before it is
       awaited — and the screen is looked at in between. */
    const stopped = live.stop();
    /* The hang-up holds the channel for its grace window (the answer is
       unfinished), then drains and hands the exchange over. Watched all the
       way through. */
    const until = Date.now() + 5_000;
    do {
      await look("hanging up");
      await new Promise((r) => setTimeout(r, 50));
    } while (live.lines.length > 0 && Date.now() < until);
    expect(host.textContent, "the drained exchange is not marked").toContain("This spoken answer ended early");
    s.write({ ok: true, thread: s.saved(partial, { interrupted: true }) });
    await look("saved");
    await stopped;
    await look("closed");
    const fromQ = seen.findIndex((x) => x.q > 0);
    expect(seen.slice(fromQ).filter((x) => x.q !== 1), "the question shown twice or not at all").toEqual([]);
    expect(partials.filter((n) => n !== 1), "the cut-off answer shown twice or not at all").toEqual([]);
    expect(host.querySelector(".chat-live-tail"), "a live copy outlived the handoff").toBeNull();
  });
});

describe("the level meter's clone", () => {
  it("is enabled from the moment the microphone opens, while the original stays off until seeded", async () => {
    const s = seam();
    mount(s);
    await later();
    live.start({ threadId: THREAD });
    await later();
    expect(live.phase).toBe("connecting");
    expect(mic().enabled, "the barrier: the conversation must not hear yet").toBe(false);
    expect(meterClone()?.enabled, "the meter would read silence").toBe(true);
    expect(sentTracks.map((track) => track.label), "the enabled meter clone was sent to the conversation")
      .toEqual(["Built-in Microphone"]);
    channel!.open();
    await later();
    expect(mic().enabled).toBe(true);
    expect(meterClone()?.stopped).toBe(false);
  });

  it.each([
    ["hang-up", async () => { await live.stop(); }],
    ["unmount", async () => { root.unmount(); await later(); }],
    ["failure", async () => { channel!.deliver({ type: "error", error: { message: "boom" } }); await later(); await later(); }],
    ["reconnect", async () => { live.reconnect(); await later(); await later(); await later(); }],
  ] as const)("is stopped on %s", async (_name, end) => {
    const s = seam();
    mount(s);
    await connect();
    const clone = meterClone();
    expect(clone?.stopped).toBe(false);
    await end();
    expect(clone?.stopped, "the clone keeps the device open after the call").toBe(true);
    expect(mic().stopped).toBe(true);
  });

  it("is stopped when the reader cancels while still connecting", async () => {
    const s = seam();
    mount(s);
    await later();
    live.start({ threadId: THREAD });
    await later();
    const clone = meterClone();
    expect(clone?.stopped).toBe(false);
    await live.stop();
    await later();
    expect(clone?.stopped).toBe(true);
    expect(mic().stopped).toBe(true);
  });

  it("is stopped when its owner unmounts mid-connect", async () => {
    const s = seam();
    mount(s);
    await later();
    live.start({ threadId: THREAD });
    await later();
    const clone = meterClone();
    expect(live.phase).toBe("connecting");
    root.unmount();
    await later();
    expect(clone?.stopped, "the mid-connect clone outlived its owner").toBe(true);
    expect(mic().stopped).toBe(true);
  });

  it("is stopped by a failure before the seeding barrier lifts", async () => {
    const s = seam();
    const seeding: LiveWiring = {
      ...wiring,
      ticket: async () => ({
        token: "ek_test", expiresAt: 0, model: "m",
        seed: [{ role: "user", text: "Earlier question" }],
        tailId: "spya-earlier", sessionId: "live-session-2",
      }),
    };
    mount(s, seeding);
    await later();
    live.start({ threadId: THREAD });
    await later();
    const clone = meterClone();
    channel!.open();
    await later();
    expect(live.phase).toBe("connecting");
    channel!.deliver({ type: "error", error: { message: "seed failed" } });
    await later();
    expect(live.phase).toBe("failed");
    expect(clone?.stopped, "the clone survived a pre-barrier failure").toBe(true);
    expect(mic().stopped).toBe(true);
  });
});

describe("cancelling a reconnect from the panel", () => {
  it("leaves the reader typing: no second session after the hang-up completes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    try {
      const s = seam();
      mount(s);
      /* React's scheduler runs on `setImmediate`, which is left real, so each
         tick also lets it render what the timers changed. */
      const tick = async (ms: number) => {
        await vi.advanceTimersByTimeAsync(ms);
        for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
      };
      await tick(10);
      live.start({ threadId: THREAD });
      await tick(10);
      channel!.open();
      await tick(10);
      /* Mid-sentence, so the hang-up holds the device for its settle window —
         the time in which the reader can change their mind. */
      channel!.deliver({ type: "input_audio_buffer.speech_started" });
      await tick(10);
      live.reconnect();
      await tick(10);
      expect(live.phase).toBe("closing");
      expect(host.querySelector<HTMLButtonElement>(".chat-live-btn")?.disabled, "Live is disabled while closing").toBe(true);
      const cancel = [...host.querySelectorAll("button")].find((b) => b.textContent === "Cancel reconnect");
      expect(cancel, "no way to cancel the reconnect").toBeDefined();
      cancel!.click();
      await tick(10_000);
      expect(pcs, "a reconnect the reader cancelled still started").toBe(1);
      expect(live.phase).toBe("idle");
      expect(live.reconnecting).toBe(false);
      expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Cancel reconnect")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
