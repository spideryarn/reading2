// @vitest-environment jsdom
/**
 * **The three orderings a live session is responsible for**, driven end to end
 * against a fake peer connection.
 *
 * `exchanges.ts` decides what a finished exchange *is*, and has its own tests.
 * `chat/reduce.ts` decides what happens to one once it is handed over, and has
 * its own. This is the file in between — the hook — and everything here is a
 * sequencing rule that no test of either end can see:
 *
 *  1. **The seeding barrier.** The microphone track is created disabled and is
 *     enabled only once every seed item has come back *and* the conversation's
 *     tail is still what the ticket said. A session that hears before it has
 *     been told the history answers the first question with amnesia about the
 *     last five minutes, and nothing on screen says why.
 *  2. **One append at a time.** Exchange two's `expectedTailId` is exchange
 *     one's *stored* answer id, which does not exist until exchange one has
 *     landed. Two in flight means the second claims a tail from before the
 *     first and is refused — correctly, for a reason that would read as a bug.
 *  3. **The hang-up grace.** Stop hands the device back at once and *then*
 *     holds the channel open for a moment, because the transcription of the
 *     last sentence arrives after the answer to it. Closing at once keeps the
 *     answer and loses the question. GPT Sol's finding 7.
 *
 * Each of these fails silently: no error, nothing in a console, a transcript
 * that is merely wrong.
 */
import { type ReactNode, createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetMicrophoneLock } from "../src/web/mic-lock.js";
import { useLiveConversation, type LiveOptions } from "../src/web/live/useLiveConversation.js";
import type { LiveUsageReport } from "../src/web/live/meter.js";
import type { LiveTicket, LiveWiring } from "../src/web/live/wiring.js";
import { ChatController, type ChatEffects, type SpokenLanded } from "../src/web/chat/controller.js";
import { asOpId, type ThreadsOutcome } from "../src/web/chat/model.js";
import type { SpokenOutcome } from "../src/web/chat/effects.js";
import type { ChatMessage, ChatThread } from "../src/types.js";
import type { SpokenExchange } from "../src/web/useChat.js";

/* ---------- the fake wire ---------- */

/** Everything the page sent down the data channel, as parsed objects. */
let sent: Record<string, unknown>[] = [];
/** The one live channel, so a test can push events into the hook. */
let channel: FakeChannel | null = null;
/** The microphone track the hook opened, so its `enabled` can be read. */
let mic: { enabled: boolean; stopped: boolean } | null = null;
/** Every peer connection the hook built, so a test can break the last one. */
let pcs: unknown[] = [];
let players: { play: ReturnType<typeof vi.fn>; srcObject: unknown }[] = [];
let playbackRefused = false;
/**
 * Everything the hook told our own server about what the session cost.
 *
 * The audio goes browser↔OpenAI, so the `usage` object on every turn is
 * delivered here and nowhere else: if this list stays empty the most expensive
 * feature in the app contributes nothing to `npm run cost`, and nothing else in
 * the suite would notice. src/web/live/meter.ts.
 */
let metered: { kind: string; sessionId: string; report?: LiveUsageReport; reason?: string | null }[] = [];

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
  /** The browser may dispatch the close event after close() has returned. */
  notifyClosed() {
    for (const fn of this.#listeners.get("close") ?? []) fn({});
  }
  /** The channel opening, which is what starts the seeding. */
  open() {
    this.readyState = "open";
    for (const fn of this.#listeners.get("open") ?? []) fn({});
  }
  /** One server event, as it would arrive. */
  deliver(event: Record<string, unknown>) {
    for (const fn of this.#listeners.get("message") ?? []) fn({ data: JSON.stringify(event) });
  }
}

function fakeMic() {
  mic = { enabled: true, stopped: false };
  const held = mic;
  return {
    kind: "audio",
    label: "Built-in Microphone",
    muted: false,
    get readyState() { return held.stopped ? "ended" : "live"; },
    get enabled() {
      return held.enabled;
    },
    set enabled(v: boolean) {
      held.enabled = v;
    },
    stop() {
      held.stopped = true;
    },
  } as unknown as MediaStreamTrack;
}

beforeEach(() => {
  sent = [];
  channel = null;
  mic = null;
  pcs = [];
  players = [];
  playbackRefused = false;
  metered = [];
  resetMicrophoneLock();

  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async () => ({ getAudioTracks: () => [fakeMic()] }),
      enumerateDevices: async () => [],
    },
  });
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  vi.stubGlobal(
    "RTCPeerConnection",
    class {
      constructor() {
        pcs.push(this);
      }
      createDataChannel() {
        channel = new FakeChannel();
        return channel;
      }
      /* The hook listens for `connectionstatechange`: a failed ICE negotiation
         or a closed connection is the session ending, and a page that stayed
         `live` through one would hold the microphone and hear nothing. */
      #on = new Map<string, ((e: unknown) => void)[]>();
      connectionState = "connected";
      addEventListener(name: string, fn: (e: unknown) => void) {
        this.#on.set(name, [...(this.#on.get(name) ?? []), fn]);
      }
      /** Drive it from a test: the connection dropping. */
      fail() {
        this.connectionState = "failed";
        for (const fn of this.#on.get("connectionstatechange") ?? []) fn({});
      }
      disconnect() {
        this.connectionState = "disconnected";
        for (const fn of this.#on.get("connectionstatechange") ?? []) fn({});
      }
      addTrack() {}
      getSenders() {
        return [];
      }
      async createOffer() {
        return { sdp: "v=0", type: "offer" };
      }
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
      play = vi.fn(async () => {
        if (playbackRefused) throw new DOMException("Playback blocked", "NotAllowedError");
      });
      pause() {}
      constructor() {
        players.push(this);
      }
    },
  );
  /* The SDP exchange with OpenAI, which is the only `fetch` left in the hook —
     the two calls to our own server go through the injected wiring. */
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => "v=0" }) as Response));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetMicrophoneLock();
});

/* ---------- driving the hook ---------- */

const THREAD = "spya-thra01";

function ticketWith(over: Partial<LiveTicket> = {}): LiveTicket {
  return {
    token: "ek_test",
    expiresAt: 0,
    model: "m",
    seed: [],
    tailId: null,
    /* The server's own journal row for this conversation, which every usage
       report is addressed to. Not a uuid here on purpose — nothing in this file
       reaches a database, and tests/fixture-ids.test.ts is about ids that name
       rows. */
    sessionId: "live-session-1",
    ...over,
  };
}

/** The three accounting posts, recorded rather than made. */
function meterCalls(): Pick<LiveWiring, "liveConnected" | "liveUsage" | "liveClose"> {
  // A deferred teardown belongs to the test/session that created its wire.
  // Do not let it append into a later test's replacement observation array.
  const reports = metered;
  return {
    liveConnected: async (sessionId) => {
      reports.push({ kind: "connected", sessionId });
      return "accepted";
    },
    liveUsage: async (sessionId, report) => {
      reports.push({ kind: "usage", sessionId, report });
      return "accepted";
    },
    liveClose: async (sessionId, reason) => {
      reports.push({ kind: "close", sessionId, reason });
      return "accepted";
    },
  };
}

function wiringFor(ticket: LiveTicket): LiveWiring {
  return {
    ticket: async () => ticket,
    runTool: async () => ({ content: "", label: "", detail: "" }),
    ...meterCalls(),
  };
}

function mount(opts: LiveOptions) {
  let api: ReturnType<typeof useLiveConversation> | null = null;
  function Probe(): ReactNode {
    api = useLiveConversation("a-slug", opts);
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

/** Let the hook's async work run. */
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

/** Connect, and open the channel. Returns the harness. */
async function connected(opts: LiveOptions) {
  const h = mount(opts);
  act(() => h.get().start({ threadId: THREAD, microphone: true }));
  await settle();
  await act(async () => {
    channel?.open();
  });
  await settle();
  return h;
}

/**
 * One seeded item coming back, **with its role on it**.
 *
 * The role is the whole point of this helper. A seeded *user* item is
 * indistinguishable, on the wire, from a turn the reader has just taken — and
 * its transcription is never coming, because nothing was transcribed. So a
 * ledger that were fed these would hold an unsettled turn for ever, and
 * `harvest` waits for a finished turn behind an unfinished one: every exchange
 * of the session would become silently unwritable.
 *
 * It was written without the role at first, and mutation testing said so: the
 * ledger ignores an item that is not the reader's, so the test agreed with a
 * version of the code that had no defence at all.
 */
const seedAck = (id: string, role: "user" | "assistant") => ({
  type: "conversation.item.created",
  item: { id, role, type: "message" },
});

/**
 * The events of one complete turn, in the order OpenAI sends them.
 *
 * **The transcript carries `response_id`**, as the real event does. It did not
 * for a day, and that mattered: the ledger falls back to "the newest turn" when
 * an event names no response it knows, so every test in this file was
 * exercising the fallback rather than the causal path it claims to test — and
 * would have gone on passing if the causal path were deleted. GPT Sol, second
 * review, 2026-08-31.
 */
const turn = (u: string, r: string, q: string, a: string) => [
  { type: "conversation.item.added", item: { id: u, role: "user", type: "message" } },
  { type: "response.created", response: { id: r } },
  {
    type: "response.output_audio_transcript.done",
    response_id: r,
    item_id: `${u}-a`,
    transcript: a,
  },
  /* **With the `usage` the real event carries**, because it is the only place
     OpenAI says what a turn cost and the browser is the only thing that sees
     it. src/web/live/meter.ts, and docs/research/realtime-voice-cost-tracking-web.md
     § 1 for the shape. */
  {
    type: "response.done",
    response: {
      id: r,
      status: "completed",
      output: [{ type: "message" }],
      usage: {
        total_tokens: 253,
        input_tokens: 132,
        output_tokens: 121,
        input_token_details: {
          text_tokens: 119,
          audio_tokens: 13,
          image_tokens: 0,
          cached_tokens: 64,
          cached_tokens_details: { text_tokens: 60, audio_tokens: 4 },
        },
        output_token_details: { text_tokens: 30, audio_tokens: 91 },
      },
    },
  },
  /* The transcription is a **second** bill, on its own event and in seconds
     rather than tokens — `gpt-live-transcribe` is charged per audio minute. */
  {
    type: "conversation.item.input_audio_transcription.completed",
    item_id: u,
    transcript: q,
    usage: { type: "duration", seconds: 2.5 },
  },
];

async function speakTurn(u: string, r: string, q: string, a: string) {
  for (const e of turn(u, r, q, a)) {
    await act(async () => {
      channel?.deliver(e);
    });
  }
  await settle();
}

describe("the seeding barrier", () => {
  it.each(["unmount", "pagehide"])("releases startup audio and its deadline on %s while the ticket is pending", async (exit) => {
    vi.useFakeTimers();
    const close = vi.fn(async () => {});
    let ticketSignal: AbortSignal | undefined;
    vi.stubGlobal("AudioContext", class { state = "running"; close = close; });
    const h = mount({ wiring: { ...wiringFor(ticketWith()), ticket: (_slug, _thread, _placement, signal) => {
      ticketSignal = signal;
      return new Promise(() => {});
    } } });
    try {
      act(() => h.get().start({ threadId: THREAD }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(pcs).toHaveLength(0);
      if (exit === "unmount") h.unmount();
      else act(() => window.dispatchEvent(new Event("pagehide")));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(close).toHaveBeenCalledTimes(1);
      expect(ticketSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (exit !== "unmount") h.unmount();
      vi.useRealTimers();
    }
  });

  it("times out a ticket request that never settles, before opening any device", async () => {
    vi.useFakeTimers();
    const h = mount({ wiring: { ...wiringFor(ticketWith()), ticket: () => new Promise(() => {}) } });
    try {
      act(() => h.get().start({ threadId: THREAD }));
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(h.get().phase).toBe("failed");
      expect(mic).toBeNull();
    } finally {
      h.unmount();
      vi.useRealTimers();
    }
  });

  it("times out an unanswered microphone permission and stops a track arriving afterwards", async () => {
    vi.useFakeTimers();
    let grant!: () => void;
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockImplementation(() => new Promise((resolve) => {
      grant = () => resolve({ getAudioTracks: () => [fakeMic()] } as unknown as MediaStream);
    }));
    const h = mount({ wiring: wiringFor(ticketWith()) });
    try {
      act(() => h.get().start({ threadId: THREAD }));
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(h.get().phase).toBe("failed");
      await act(async () => { grant(); });
      expect(mic?.stopped).toBe(true);
      expect(h.get().phase).toBe("failed");
    } finally {
      h.unmount();
      vi.useRealTimers();
    }
  });

  it("fails and releases capture when the data channel never opens", async () => {
    vi.useFakeTimers();
    const h = mount({ wiring: wiringFor(ticketWith()) });
    try {
      act(() => h.get().start({ threadId: THREAD }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(mic?.stopped).toBe(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(h.get().phase).toBe("failed");
      expect(h.get().error).toMatch(/starting|connect/i);
      expect(mic?.stopped).toBe(true);
    } finally {
      h.unmount();
      vi.useRealTimers();
    }
  });

  it("does not let a cancelled session's seed deadline close a later session", async () => {
    vi.useFakeTimers();
    const h = mount({ wiring: wiringFor(ticketWith({ seed: [{ role: "user", text: "history" }] })) });
    try {
      act(() => h.get().start({ threadId: THREAD }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); channel?.open(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      await act(async () => { await h.get().stop(); });
      act(() => h.get().start({ threadId: THREAD }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); channel?.open(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
      expect(h.get().phase, "an old timer cancelled the new connection").toBe("connecting");
      await act(async () => { channel?.deliver(seedAck("s2", "user")); });
      expect(h.get().phase).toBe("live");
    } finally {
      h.unmount();
      vi.useRealTimers();
    }
  });

  it("keeps the microphone OFF until every seed item has come back", async () => {
    /* The failure this prevents is silent and total: the reader starts talking
       the instant the connection is up, VAD opens a turn, and the model answers
       from an empty conversation while the history is still in flight. */
    const ticket = ticketWith({
      seed: [
        { role: "user", text: "typed question" },
        { role: "assistant", text: "typed answer" },
      ],
      tailId: "spya-msga01",
    });
    const h = await connected({
      wiring: wiringFor(ticket),
      tailNow: () => "spya-msga01",
    });

    expect(sent.filter((m) => m.type === "conversation.item.create")).toHaveLength(2);
    expect(mic?.enabled, "the session could hear before it had been told anything").toBe(false);
    expect(h.get().phase).not.toBe("live");

    /* The first item comes back. One is not enough. */
    await act(async () => {
      channel?.deliver(seedAck("s1", "user"));
    });
    expect(mic?.enabled).toBe(false);

    await act(async () => {
      channel?.deliver(seedAck("s2", "assistant"));
    });
    expect(mic?.enabled).toBe(true);
    expect(h.get().phase).toBe("live");
  });

  it("counts distinct items, not events, so a doubled acknowledgement is harmless", async () => {
    /* **The one that would be silent and total.** The API has two spellings for
       this event — `conversation.item.created` and `conversation.item.added` —
       and this hook handles both, because the spelling has moved once already.
       A session that sent both would lift a *counted* barrier at half the
       seeds, and the surplus events would then reach the ledger: a seeded user
       item is indistinguishable from a turn the reader has just taken, and its
       transcription is never coming. `harvest` holds a finished turn behind an
       unfinished one, so every exchange of that session would become
       unwritable — with no error and nothing in a console. */
    const written: SpokenExchange[] = [];
    const h = await connected({
      wiring: wiringFor(
        ticketWith({
          seed: [
            { role: "user", text: "typed question" },
            { role: "assistant", text: "typed answer" },
          ],
        }),
      ),
      speak: async (x) => {
        written.push(x);
        return { ok: true, threadId: THREAD, tailId: "spya-srva01" };
      },
    });

    /* Both spellings for the first seed. Two events, one item. */
    await act(async () => {
      channel?.deliver(seedAck("s1", "user"));
      channel?.deliver({
        type: "conversation.item.added",
        item: { id: "s1", role: "user", type: "message" },
      });
    });
    expect(mic?.enabled, "the barrier lifted on a repeat of the same item").toBe(false);

    await act(async () => {
      channel?.deliver(seedAck("s2", "assistant"));
    });
    expect(mic?.enabled).toBe(true);
    expect(h.get().phase).toBe("live");

    /* And a repeat arriving *after* the barrier is still not a turn. */
    await act(async () => {
      channel?.deliver({
        type: "conversation.item.added",
        item: { id: "s1", role: "user", type: "message" },
      });
    });
    await speakTurn("u1", "r1", "Q1", "A1");
    expect(written.map((w) => w.question), "a seed stalled the ledger").toEqual(["Q1"]);
  });

  it("fails loudly rather than sitting there when the acknowledgements never come", async () => {
    /* A barrier that never lifts is a microphone that never opens: the button
       says "connecting" and nothing ever happens or explains itself. The only
       alternative is to open it anyway, which is the amnesia this barrier
       exists to prevent, arriving silently. */
    vi.useFakeTimers();
    try {
      const h = mount({ wiring: wiringFor(ticketWith({ seed: [{ role: "user", text: "q" }] })) });
      act(() => h.get().start({ threadId: THREAD, microphone: true }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        channel?.open();
      });
      expect(h.get().error).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(h.get().error).toMatch(/did not finish starting/);
      expect(mic?.enabled, "it started listening against an unseeded session").toBe(false);
      expect(h.get().phase, "the retry button would stay disabled in closing").toBe("failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes live at once when there is nothing to seed", async () => {
    const h = await connected({ wiring: wiringFor(ticketWith()) });
    expect(mic?.enabled).toBe(true);
    expect(h.get().phase).toBe("live");
  });

  it("refuses to open the microphone when the conversation moved while connecting", async () => {
    /* Somebody typed a turn in another tab. The model has been seeded with
       history that is a turn short, so its first answer would be wrong and its
       first append would be refused — after the reader had spoken. Refusing
       here costs a sentence and none of their words. */
    const ticket = ticketWith({ seed: [{ role: "user", text: "q" }], tailId: "spya-msga01" });
    const h = await connected({
      wiring: wiringFor(ticket),
      tailNow: () => "spya-msgb02",
    });
    await act(async () => {
      channel?.deliver(seedAck("s1", "user"));
    });
    await settle();
    expect(mic?.enabled, "it started listening against stale history").toBe(false);
    expect(h.get().error).toMatch(/changed while the session was starting/);
  });

  it("does not feed the seeded history to the ledger", async () => {
    /* **The one that would stall everything.** A seeded user item looks exactly
       like a turn the reader has just taken, and its transcription is never
       coming — so the ledger would hold an unsettled turn for ever, and
       `harvest` waits for a finished turn behind an unfinished one. Every
       exchange of the session would be silently unwritable. */
    const written: SpokenExchange[] = [];
    const speak = async (x: SpokenExchange): Promise<SpokenLanded> => {
      written.push(x);
      return { ok: true, threadId: THREAD, tailId: "spya-srva01" };
    };
    await connected({
      wiring: wiringFor(ticketWith({ seed: [{ role: "user", text: "typed" }] })),
      speak,
    });
    await act(async () => {
      channel?.deliver(seedAck("s1", "user"));
    });
    await settle();

    await speakTurn("u1", "r1", "Q1", "A1");
    expect(written.map((w) => w.question), "the seed stalled the ledger").toEqual(["Q1"]);
  });
});

describe("writing the exchanges down", () => {
  it("claims the ticket's tail first, then each stored answer in turn", async () => {
    /* The whole ordering rule, seen. Exchange two cannot be sent until exchange
       one has come back, because the id it has to claim is minted by that
       write. */
    const written: SpokenExchange[] = [];
    let n = 0;
    const speak = async (x: SpokenExchange): Promise<SpokenLanded> => {
      written.push(x);
      n += 1;
      return { ok: true, threadId: THREAD, tailId: `spya-srva0${n}` };
    };
    await connected({
      wiring: wiringFor(ticketWith({ tailId: "spya-msga01" })),
      speak,
    });

    await speakTurn("u1", "r1", "Q1", "A1");
    await speakTurn("u2", "r2", "Q2", "A2");

    expect(written.map((w) => w.expectedTailId)).toEqual(["spya-msga01", "spya-srva01"]);
    expect(written.map((w) => w.question)).toEqual(["Q1", "Q2"]);
  });

  it("sends a null tail for a conversation that is empty", async () => {
    const written: SpokenExchange[] = [];
    await connected({
      wiring: wiringFor(ticketWith({ tailId: null })),
      speak: async (x) => {
        written.push(x);
        return { ok: true, threadId: THREAD, tailId: "spya-srva01" };
      },
    });
    await speakTurn("u1", "r1", "Q1", "A1");
    expect(written[0]).toHaveProperty("expectedTailId", null);
  });

  it("takes the live copy off screen once the stored one is in the thread", async () => {
    /* Otherwise the reader watches their own question duplicate itself the
       instant it is saved: once as the line this session drew, once as the row
       the thread now holds. */
    const h = await connected({
      wiring: wiringFor(ticketWith()),
      speak: async () => ({ ok: true, threadId: THREAD, tailId: "spya-srva01" }),
    });
    await act(async () => {
      channel?.deliver(turn("u1", "r1", "Q1", "A1")[0]!);
      channel?.deliver(turn("u1", "r1", "Q1", "A1")[2]!);
    });
    expect(h.get().lines.length).toBeGreaterThan(0);

    await speakTurn("u1", "r1", "Q1", "A1");
    expect(h.get().lines, "the live copy stayed beside the stored one").toEqual([]);
  });

  it("ends the session when an append is refused", async () => {
    /* Every later append would claim a tail this tab can no longer vouch for.
       A conflict has already started a repair in the reducer, which reloads the
       conversation — so the honest next step is to stop and let the reader
       start a session seeded from what is actually there. */
    const h = await connected({
      wiring: wiringFor(ticketWith()),
      speak: async () => ({ ok: false, conflict: true, error: "moved on" }),
    });
    await speakTurn("u1", "r1", "Q1", "A1");
    await settle();
    expect(h.get().error).toBe("moved on");
    expect(h.get().phase).toBe("idle");
    expect(mic?.stopped).toBe(true);
  });

  it("does not write the SECOND exchange after the first has failed", async () => {
    /* **Two exchanges can be handed over at once**, and then both are chained
       before either has run: `harvest` emits a completed turn and everything
       behind it the moment the one in front settles. If the first exhausts its
       retries, the second must not go — it would claim the tail the first
       failed to move, and the reader would be left with the *second* half of a
       conversation stored and the first missing. That is worse than losing
       both, because nothing about it looks wrong. GPT Sol, reviewing the built
       code. */
    const attempts: string[] = [];
    const h = await connected({
      wiring: wiringFor(ticketWith()),
      speak: async (x) => {
        attempts.push(x.question);
        return { ok: false, conflict: false, error: "the server never answered" };
      },
    });
    expect(h.get().phase).toBe("live");

    /* The header's own sequence: turn 2 completes while turn 1 is still waiting
       for its transcription, so both are emitted together when it lands. */
    await act(async () => {
      channel?.deliver(turn("u1", "r1", "Q1", "A1")[0]!);
      channel?.deliver(turn("u1", "r1", "Q1", "A1")[1]!);
      channel?.deliver(turn("u1", "r1", "Q1", "A1")[2]!);
      channel?.deliver(turn("u1", "r1", "Q1", "A1")[3]!);
      for (const e of turn("u2", "r2", "Q2", "A2")) channel?.deliver(e);
    });
    await act(async () => {
      channel?.deliver({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "u1",
        transcript: "Q1",
      });
    });
    await settle();

    expect(attempts, "the second exchange went after the first had failed").toEqual(["Q1"]);
  });

  it("follows the server when it overrules the conversation's id", async () => {
    const moved: string[] = [];
    const h = await connected({
      wiring: wiringFor(ticketWith()),
      speak: async () => ({ ok: true, threadId: "spya-srvt01", tailId: "spya-srva01" }),
      onThreadId: (id) => moved.push(id),
    });
    await speakTurn("u1", "r1", "Q1", "A1");
    expect(moved).toEqual(["spya-srvt01"]);
    expect(h.get().threadId).toBe("spya-srvt01");
  });
});

describe("the caps, which are the only thing between a forgotten tab and a bill", () => {
  /* The meter measures this now (§ the meter below), but measuring is not
     limiting: nothing on our server can end somebody's session, so a clock in
     the browser is the whole of the defence. OpenAI ends a session at sixty
     minutes, which bounds the damage and does not prevent it. */

  it("ends a session nobody has spoken into for a while", async () => {
    vi.useFakeTimers();
    try {
      const h = mount({ wiring: wiringFor(ticketWith()) });
      act(() => h.get().start({ threadId: THREAD, microphone: true }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        channel?.open();
      });
      expect(h.get().phase).toBe("live");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6 * 60_000);
      });
      expect(h.get().error).toMatch(/quiet/);
      expect(mic?.stopped).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still writes down the exchange it was in the middle of", async () => {
    /* **A wall clock that ends a conversation is a new way to lose words.** The
       cap goes through the ordinary hang-up rather than closing the connection,
       so the grace window, the drain and the write queue all still run — which
       is the difference between "your session ended" and "your session ended
       and took the last thing you said with it". */
    vi.useFakeTimers();
    try {
      const written: SpokenExchange[] = [];
      const h = mount({
        wiring: wiringFor(ticketWith()),
        speak: async (x) => {
          written.push(x);
          return { ok: true, threadId: THREAD, tailId: "spya-srva01" };
        },
      });
      act(() => h.get().start({ threadId: THREAD, microphone: true }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        channel?.open();
      });

      /* A turn the reader had, whose answer never finished. */
      await act(async () => {
        channel?.deliver(turn("u1", "r1", "Q1", "A1")[0]!);
        channel?.deliver({
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "u1",
          transcript: "Q1",
        });
        channel?.deliver({ type: "response.created", response: { id: "r1" } });
        channel?.deliver({
          type: "response.output_audio_transcript.delta",
          response_id: "r1",
          item_id: "r1-a",
          delta: "half an answer",
        });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 60_000);
      });
      expect(written, "the cap threw away the turn it interrupted").toHaveLength(1);
      expect(written[0]?.question).toBe("Q1");
      expect(written[0]?.answer).toBe("half an answer");
      expect(written[0]?.interrupted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT end one the reader is still talking into", async () => {
    /* The cap that mattered would be the one that cut somebody off mid-thought.
       A conversation with long pauses is exactly what this feature is for —
       `semantic_vad` exists for the same reason — so only the reader's own
       voice may reset the clock, and it must actually reset it. */
    vi.useFakeTimers();
    try {
      const h = mount({ wiring: wiringFor(ticketWith()) });
      act(() => h.get().start({ threadId: THREAD, microphone: true }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        channel?.open();
      });

      /* Four minutes of quiet, a word, then four more. Neither stretch reaches
         the cap, and the word is what makes that true. */
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4 * 60_000);
      });
      await act(async () => {
        channel?.deliver({ type: "input_audio_buffer.speech_started" });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4 * 60_000);
      });
      expect(h.get().phase, "the reader was cut off mid-conversation").toBe("live");
      expect(h.get().error).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("hanging up", () => {
  it("hands the microphone back BEFORE it waits for anything", async () => {
    /* The next claimant is a dictation button the reader has just pressed, and
       every millisecond it waits is a button that looks broken. The words are
       collected after the device is theirs, not before. */
    const h = await connected({
      wiring: wiringFor(ticketWith()),
      speak: async () => ({ ok: true, threadId: THREAD, tailId: "spya-srva01" }),
    });
    /* A turn whose transcription has not arrived, so the grace window is live. */
    await act(async () => {
      for (const e of turn("u1", "r1", "Q1", "A1").slice(0, 4)) channel?.deliver(e);
    });

    const hangUp = act(async () => {
      await h.get().stop();
    });
    /* Not awaited yet, and the device is already gone. */
    await new Promise((r) => setTimeout(r, 0));
    expect(mic?.stopped, "the reader waited for the transcript to get their mic back").toBe(true);
    await hangUp;
  });

  it("keeps the last question, which arrives AFTER the answer to it", async () => {
    /* The loss this whole grace window exists to prevent, and the one that is
       invisible: the answer is stored, the question is empty, and the reader
       reads it back a week later and disbelieves it. */
    const written: SpokenExchange[] = [];
    const h = await connected({
      wiring: wiringFor(ticketWith()),
      speak: async (x) => {
        written.push(x);
        return { ok: true, threadId: THREAD, tailId: "spya-srva01" };
      },
    });
    await act(async () => {
      for (const e of turn("u1", "r1", "Q1", "A1").slice(0, 4)) channel?.deliver(e);
    });

    const hangUp = act(async () => {
      await h.get().stop();
    });
    /* The transcription lands during the grace, as it does in life. */
    await act(async () => {
      channel?.deliver({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "u1",
        transcript: "Q1",
      });
    });
    await hangUp;

    expect(written).toHaveLength(1);
    expect(written[0]?.question, "the question was lost at the hang-up").toBe("Q1");
    expect(written[0]?.answer).toBe("A1");
  });

  it("keeps a half-finished exchange rather than discarding it", async () => {
    /* A reader who hangs up mid-answer watched those words happen. It is stored
       marked `interrupted`, because the transcript may run past what they
       actually heard and the row has to say so. */
    const written: SpokenExchange[] = [];
    const h = await connected({
      wiring: wiringFor(ticketWith()),
      speak: async (x) => {
        written.push(x);
        return { ok: true, threadId: THREAD, tailId: "spya-srva01" };
      },
    });
    await act(async () => {
      channel?.deliver(turn("u1", "r1", "Q1", "A1")[0]!);
      channel?.deliver({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "u1",
        transcript: "Q1",
      });
      channel?.deliver({ type: "response.created", response: { id: "r1" } });
      channel?.deliver({
        type: "response.output_audio_transcript.delta",
        response_id: "r1",
        item_id: "u1-a",
        delta: "half an ans",
      });
    });
    await act(async () => {
      await h.get().stop();
    });

    expect(written).toHaveLength(1);
    expect(written[0]?.answer).toBe("half an ans");
    expect(written[0]?.interrupted).toBe(true);
  });

  it("abandons a start the reader left DURING, before anything is opened", async () => {
    /* **The leak with no control on the page that could close it.** `start`
       awaits the placement, then the ticket, then the microphone, then a round
       trip to OpenAI. Leave chat mode in any of those and a cleanup that only
       tears down what exists finds `pc.current` and `dc.current` still null and
       does nothing — while the abandoned async function carries on, opens a
       peer connection, claims the microphone and goes live, owned by nobody.
       GPT Sol: "this is not speculative." */
    let handOverTheTicket!: (t: LiveTicket) => void;
    const held = new Promise<LiveTicket>((r) => {
      handOverTheTicket = r;
    });
    const h = mount({
      wiring: {
        ticket: () => held,
        runTool: async () => ({ content: "", label: "", detail: "" }),
        ...meterCalls(),
      },
    });
    act(() => h.get().start({ threadId: THREAD, microphone: true }));
    await settle();
    expect(pcs, "it built a connection before it had a ticket").toHaveLength(0);

    /* The reader leaves while the ticket is still in flight. */
    h.unmount();
    await settle();

    /* And only now does the ticket arrive. */
    await act(async () => {
      handOverTheTicket(ticketWith());
    });
    await settle();
    expect(pcs, "an abandoned start opened a connection nobody owns").toHaveLength(0);
    expect(mic, "an abandoned start claimed the microphone").toBeNull();
  });

  it("ends the session when the thing that owns it goes away", async () => {
    /* A peer connection nothing owns is a microphone that stays open with no
       control anywhere on the page that can close it — the reader's only way
       out would be to close the tab. The hook is held at the article level so
       this fires on leaving the article, and not on every conversation switch. */
    const h = await connected({
      wiring: wiringFor(ticketWith()),
      speak: async () => ({ ok: true, threadId: THREAD, tailId: "spya-srva01" }),
    });
    expect(mic?.stopped).toBe(false);
    h.unmount();
    await settle();
    expect(mic?.stopped, "the microphone survived the unmount").toBe(true);
  });

  it("waits for a sentence the reader is still saying", async () => {
    /* **The gap between VAD opening and the item being created.** In it the
       ledger has nothing pending and the words exist only in the audio going
       up — so a grace window that ends when the ledger is quiet ends instantly,
       and the reader's last sentence is simply absent from their own
       transcript with nothing saying so. GPT Sol found this; the existing grace
       tests all began after the item had already arrived. */
    /* **Asserted as an order, not as a count.** "It wrote the exchange" is true
       either way: the fake channel keeps delivering after `close()`, so a
       hang-up that gave up early still sees the events and still writes — just
       *after* it has returned. Which is exactly the damage, because Send awaits
       this promise: the typed turn goes first and claims a tail the spoken one
       is about to move. So what has to be true is that the write happens
       *before* the hang-up resolves. */
    const order: string[] = [];
    const written: SpokenExchange[] = [];
    const h = await connected({
      wiring: wiringFor(ticketWith()),
      speak: async (x) => {
        order.push("wrote it down");
        written.push(x);
        return { ok: true, threadId: THREAD, tailId: "spya-srva01" };
      },
    });
    /* The reader starts talking. Nothing has been committed yet. */
    await act(async () => {
      channel?.deliver({ type: "input_audio_buffer.speech_started" });
    });

    /* **The hang-up is started and then let run**, so its grace loop has
       definitely evaluated its condition and gone to sleep before the sentence
       arrives. Delivering in the same tick was the first version and it proved
       nothing: the events landed before the loop's first check, so the ledger
       already had something pending and the mid-sentence guard was never
       consulted. */
    let hangUp!: Promise<void>;
    act(() => {
      /* The marker is attached to the promise rather than pushed after an
         `await`, so it records when the hang-up *actually* resolved rather than
         when this test got round to looking. Pushing it after the await was the
         first version, and it recorded the test's own order instead of the
         hook's. */
      hangUp = h.get().stop().then(() => {
        order.push("hung up");
      });
    });
    await settle();

    /* Now the sentence lands, as it does in life: the buffer is committed, the
       item appears, the transcript follows. */
    await act(async () => {
      for (const e of turn("u1", "r1", "Q1", "A1")) channel?.deliver(e);
    });
    await act(async () => {
      await hangUp;
    });

    expect(order, "the hang-up returned before the last sentence was written").toEqual([
      "wrote it down",
      "hung up",
    ]);
    expect(written[0]?.question).toBe("Q1");
  });

  it("ends when the connection dies under it", async () => {
    /* A failed ICE negotiation leaves a page that looks live, holds the
       microphone and hears nothing — with no control anywhere that would end
       it, because the button says "live" and pressing it would try to hang up
       a connection that is already gone. */
    const h = await connected({ wiring: wiringFor(ticketWith()) });
    expect(h.get().phase).toBe("live");
    await act(async () => {
      (pcs.at(-1) as { fail(): void } | undefined)?.fail();
    });
    await settle();
    expect(h.get().phase).toBe("failed");
    expect(h.get().error).toMatch(/connection.*lost/i);
    expect(mic?.stopped).toBe(true);
  });

  it("joins a hang-up already in progress rather than starting a second", async () => {
    /* Not hypothetical: the reader presses Stop and the Send handoff calls it
       again a frame later, or the unmount does.

       **Asserted as the same promise, which is the observable fact.** "It only
       wrote one exchange" was the first version and it proved nothing — the
       ledger marks a turn emitted, so a second drain returns nothing whether
       there is a guard here or not. What a second teardown really costs is a
       second grace window: `Send` awaits this promise, so two of them means the
       reader's typed turn waits twice as long as it needs to, for a
       conversation that has already ended. */
    const written: SpokenExchange[] = [];
    const h = await connected({
      wiring: wiringFor(ticketWith()),
      speak: async (x) => {
        written.push(x);
        return { ok: true, threadId: THREAD, tailId: "spya-srva01" };
      },
    });
    /* Half a turn, so the first hang-up is still inside its grace window when
       the second arrives — which is the only moment the guard can matter. */
    await act(async () => {
      for (const e of turn("u1", "r1", "Q1", "A1").slice(0, 4)) channel?.deliver(e);
    });

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = h.get().stop();
      second = h.get().stop();
    });
    expect(second, "a second hang-up started its own teardown").toBe(first);
    await act(async () => {
      await first;
    });
    expect(written).toHaveLength(1);
  });
});

describe("live audio and tool recovery", () => {
  it("retains unsaved words and their warning when retrying the same conversation", async () => {
    const h = await connected({ wiring: wiringFor(ticketWith()), speak: async () => ({
      ok: false, conflict: false, error: "The spoken exchange could not be saved.",
    }) });
    await speakTurn("unsaved-u", "unsaved-r", "Keep my question", "Keep the answer");
    await settle();
    act(() => h.get().start({ threadId: THREAD }));
    await settle();
    await act(async () => { channel?.open(); });
    expect(h.get().phase).toBe("live");
    expect(h.get().lines.map((line) => line.text)).toEqual(expect.arrayContaining(["Keep my question", "Keep the answer"]));
    expect(h.get().hasUnsavedLines).toBe(true);
    expect(h.get().error).toBeNull();
    h.unmount();
  });

  it("ignores a duplicate start while an existing session still owns the device", async () => {
    const h = await connected({ wiring: wiringFor(ticketWith()) });
    const before = pcs.length;
    act(() => h.get().start({ threadId: THREAD }));
    await settle();
    expect(pcs).toHaveLength(before);
    expect(h.get().phase).toBe("live");
    expect(mic?.stopped).toBe(false);
    h.unmount();
  });

  it("meters and settles a failed response before exposing the failure", async () => {
    const written: SpokenExchange[] = [];
    const h = await connected({ wiring: wiringFor(ticketWith()), speak: async (exchange) => {
      written.push(exchange);
      return { ok: true, threadId: THREAD, tailId: "spya-faila1" };
    } });
    const events = turn("failed-u", "failed-r", "A question", "The partial answer");
    const completed = events.find((event) => event.type === "response.done")!;
    await act(async () => {
      for (const event of events.filter((event) => event.type !== "response.done")) channel?.deliver(event);
      channel?.deliver({ ...completed, response: { ...completed.response,
        status: "failed", status_details: { error: { message: "Voice service temporarily unavailable" } },
      } });
    });
    await settle();
    expect(metered.filter((event) => event.report?.kind === "response").map((event) => event.report)).toMatchObject([
      { providerEventId: "failed-r", status: "failed", inputTokens: 132, outputTokens: 121 },
    ]);
    expect(written).toMatchObject([{ question: "A question", answer: "The partial answer", interrupted: true }]);
    expect(h.get().phase).toBe("failed");
    expect(sent.filter((event) => event.type === "response.create")).toEqual([]);
    h.unmount();
  });

  it("uses the injected text item's provider id for its one visible reader line", async () => {
    const h = await connected({ wiring: wiringFor(ticketWith()) });
    act(() => h.get().say("A typed probe"));
    const item = sent.find((event) => event.type === "conversation.item.create")?.item as Record<string, unknown>;
    expect(item.id).toBe(h.get().lines[0]?.id);
    await act(async () => { channel?.deliver({ type: "conversation.item.added", item: { ...item, id: item.id ?? "provider-invented-id" } }); });
    expect(h.get().lines).toHaveLength(1);
    h.unmount();
  });

  it("meters the captured track without opening another microphone and closes its audio context", async () => {
    const actualTrack = fakeMic();
    const capture = vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue({ getAudioTracks: () => [actualTrack] } as unknown as MediaStream);
    const measured: MediaStreamTrack[] = [];
    const close = vi.fn(async () => {});
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("MediaStream", class {
      constructor(private readonly tracks: MediaStreamTrack[]) {}
      getAudioTracks() { return this.tracks; }
    });
    vi.stubGlobal("AudioContext", class {
      state = "running";
      close = close;
      createMediaStreamSource(stream: MediaStream) {
        measured.push(stream.getAudioTracks()[0]!);
        return { connect() {}, disconnect() {} };
      }
      createAnalyser() {
        return { fftSize: 2048, getFloatTimeDomainData(buffer: Float32Array) { buffer.fill(0.1); }, disconnect() {} };
      }
    });
    const h = await connected({ wiring: wiringFor(ticketWith()) });
    await act(async () => { frames.shift()?.(performance.now() + 16); });
    expect(measured).toEqual([actualTrack]);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(h.get().measuringInput).toBe(true);
    expect(h.get().inputLevel.current).toBeGreaterThan(0);
    h.unmount();
    expect(close).toHaveBeenCalledTimes(1);
    expect(mic?.stopped).toBe(true);
  });

  it("releases a connection that stays disconnected instead of reporting live forever", async () => {
    const h = await connected({ wiring: wiringFor(ticketWith()) });
    vi.useFakeTimers();
    try {
      await act(async () => {
        (pcs.at(-1) as { disconnect(): void }).disconnect();
        await vi.advanceTimersByTimeAsync(12_000);
      });
      expect(h.get().phase).toBe("failed");
      expect(h.get().error).toMatch(/connection/i);
      expect(mic?.stopped).toBe(true);
    } finally {
      h.unmount();
      vi.useRealTimers();
    }
  });

  it("hands live lines to provisional chat rows during a deferred append and restores failed words", async () => {
    let finishAppend!: (result: SpokenLanded) => void;
    let provisional: SpokenExchange | null = null;
    const h = await connected({ wiring: wiringFor(ticketWith()), speak: (exchange) => {
      provisional = exchange;
      return new Promise((resolve) => { finishAppend = resolve; });
    } });
    await speakTurn("handoff-u", "handoff-r", "Question survives", "Answer survives");
    expect(provisional).toMatchObject({ question: "Question survives", answer: "Answer survives" });
    expect(h.get().lines, "the completed exchange appeared beside its provisional chat rows").toEqual([]);
    await act(async () => { finishAppend({ ok: false, conflict: false, error: "The spoken exchange could not be saved." }); });
    expect(h.get().lines.map((line) => line.text)).toEqual(expect.arrayContaining(["Question survives", "Answer survives"]));
    h.unmount();
  });

  it("surfaces a failed provider response and releases the microphone for typing or dictation", async () => {
    const h = await connected({ wiring: wiringFor(ticketWith()) });
    await act(async () => {
      channel?.deliver({ type: "response.done", response: {
        id: "failed-response", status: "failed", output: [],
        status_details: { error: { message: "Voice service temporarily unavailable" } },
      } });
    });
    await settle();
    expect(h.get().error).toMatch(/temporarily unavailable/);
    expect(h.get().phase).toBe("failed");
    expect(mic?.stopped).toBe(true);
    h.unmount();
  });

  it("shows provisional input transcription and replaces it with the final wording", async () => {
    const h = await connected({ wiring: wiringFor(ticketWith()) });
    await act(async () => {
      channel?.deliver({ type: "conversation.item.added", item: { id: "heard-1", type: "message", role: "user" } });
      channel?.deliver({ type: "conversation.item.input_audio_transcription.delta", item_id: "heard-1", delta: "The draft" });
    });
    expect(h.get().lines.find((line) => line.id === "heard-1")).toMatchObject({ text: "The draft", done: false });
    await act(async () => {
      channel?.deliver({ type: "conversation.item.input_audio_transcription.completed", item_id: "heard-1", transcript: "The corrected wording." });
    });
    expect(h.get().lines.find((line) => line.id === "heard-1")).toMatchObject({ text: "The corrected wording.", done: true });
    h.unmount();
  });

  it("opens the same remembered microphone as dictation and names the acquired device", async () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation((key) =>
      key === "spya.dictation.deviceId" ? "physical-mic" : null,
    );
    const capture = vi.spyOn(navigator.mediaDevices, "getUserMedia");
    const h = await connected({ wiring: wiringFor(ticketWith()) });
    expect(capture).toHaveBeenCalledWith({ audio: { deviceId: { exact: "physical-mic" } } });
    expect(h.get().deviceLabel).toBe("Built-in Microphone");
    h.unmount();
  });

  it("falls back visibly when the remembered microphone was unplugged", async () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation((key) =>
      key === "spya.dictation.deviceId" ? "unplugged" : null,
    );
    const capture = vi.spyOn(navigator.mediaDevices, "getUserMedia")
      .mockRejectedValueOnce(new DOMException("Device absent", "OverconstrainedError"));
    const h = await connected({ wiring: wiringFor(ticketWith()) });
    expect(capture).toHaveBeenCalledTimes(2);
    expect(h.get().phase).toBe("live");
    expect(h.get().notice).toMatch(/microphone|device/i);
    h.unmount();
  });

  it("shows blocked playback and retries it from an explicit enable-audio action", async () => {
    playbackRefused = true;
    const h = await connected({ wiring: wiringFor(ticketWith()) });
    await act(async () => {
      (pcs.at(-1) as { ontrack: (e: unknown) => void }).ontrack({ streams: [{}] });
    });
    expect(h.get().playbackBlocked).toBe(true);
    expect(h.get().phase).toBe("live");
    playbackRefused = false;
    await act(async () => { await h.get().enableAudio(); });
    expect(h.get().playbackBlocked).toBe(false);
    expect(players.at(-1)?.play).toHaveBeenCalledTimes(2);
    h.unmount();
  });

  it("returns every tool output once and continues only after the response and all tools finish", async () => {
    let finishSearch!: () => void;
    const runTool = vi.fn(() => new Promise<{ content: string; label: string; detail: string }>((resolve) => {
      finishSearch = () => resolve({ content: "found", label: "searched", detail: "one match" });
    }));
    const h = await connected({ wiring: { ...wiringFor(ticketWith()), runTool } });
    const calls = [
      { type: "function_call", call_id: "c1", name: "show_passage", arguments: '{"blockIds":[]}' },
      { type: "function_call", call_id: "c2", name: "search_library", arguments: '{}' },
    ];
    await act(async () => {
      channel?.deliver({ type: "response.created", response: { id: "r-tools" } });
      for (const call of calls) channel?.deliver({ ...call, type: "response.function_call_arguments.done", response_id: "r-tools" });
    });
    expect(sent.filter((e) => e.type === "response.create"), "continued while the original response was still running").toHaveLength(0);
    expect(h.get().thinking).toBe(true);
    expect(h.get().pendingTools.map((t) => t.callId)).toEqual(["c2"]);
    await act(async () => {
      channel?.deliver({ type: "response.done", response: { id: "r-tools", status: "completed", output: calls } });
    });
    expect(sent.filter((e) => e.type === "response.create"), "continued before the slow tool returned").toHaveLength(0);
    await act(async () => { finishSearch(); });
    expect(sent.filter((e) => e.type === "response.create")).toHaveLength(1);
    expect(sent.filter((e) => (e.item as { type?: string } | undefined)?.type === "function_call_output")).toHaveLength(2);
    expect(runTool).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("returns a failure output when a remote tool never finishes", async () => {
    vi.useFakeTimers();
    const h = mount({ wiring: { ...wiringFor(ticketWith()), runTool: () => new Promise(() => {}) } });
    try {
      act(() => h.get().start({ threadId: THREAD }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); channel?.open(); });
      const call = { type: "function_call", call_id: "slow-call", name: "search_library", arguments: "{}" };
      await act(async () => {
        channel?.deliver({ type: "response.created", response: { id: "slow-response" } });
        channel?.deliver({ type: "response.done", response: { id: "slow-response", status: "completed", output: [call] } });
        await vi.advanceTimersByTimeAsync(65_000);
      });
      const output = sent.find((e) => (e.item as { type?: string } | undefined)?.type === "function_call_output");
      expect((output?.item as { output?: string } | undefined)?.output).toMatch(/failed|too long|timed out/i);
      expect(sent.filter((e) => e.type === "response.create")).toHaveLength(1);
      expect(h.get().pendingTools).toEqual([]);
    } finally {
      h.unmount();
      vi.useRealTimers();
    }
  });

  it("does not start an old tool continuation after the reader interrupts with another turn", async () => {
    let finishSearch!: () => void;
    const h = await connected({ wiring: { ...wiringFor(ticketWith()), runTool: () => new Promise((resolve) => {
      finishSearch = () => resolve({ content: "old search", label: "searched", detail: "" });
    }) } });
    const call = { type: "function_call", call_id: "interrupted-call", name: "search_library", arguments: "{}" };
    await act(async () => {
      channel?.deliver({ type: "response.created", response: { id: "old-r" } });
      // VAD can arrive before the tool arguments have finished streaming.
      channel?.deliver({ type: "input_audio_buffer.speech_started" });
      channel?.deliver({ ...call, type: "response.function_call_arguments.done", response_id: "old-r" });
      channel?.deliver({ type: "response.done", response: { id: "old-r", status: "completed", output: [call] } });
      channel?.deliver({ type: "input_audio_buffer.speech_stopped" });
      channel?.deliver({ type: "input_audio_buffer.committed" });
      channel?.deliver({ type: "response.created", response: { id: "new-r" } });
      finishSearch();
    });
    expect(sent.filter((e) => e.type === "response.create")).toHaveLength(0);
    await act(async () => {
      channel?.deliver({ type: "response.done", response: { id: "new-r", status: "completed", output: [] } });
    });
    expect(sent.filter((e) => e.type === "response.create"), "replied again using the old tool after answering the new question").toHaveLength(0);
    h.unmount();
  });

  it("ignores late tool completions and playback failures belonging to a stopped session", async () => {
    let finishSearch!: () => void;
    let rejectPlayback!: (error: Error) => void;
    const h = await connected({ wiring: {
      ...wiringFor(ticketWith()),
      runTool: () => new Promise((resolve) => {
        finishSearch = () => resolve({ content: "old result", label: "searched", detail: "" });
      }),
    } });
    players.at(-1)?.play.mockImplementation(() => new Promise<void>((_, reject) => { rejectPlayback = reject; }));
    await act(async () => {
      (pcs.at(-1) as { ontrack: (e: unknown) => void }).ontrack({ streams: [{}] });
      channel?.deliver({ type: "response.function_call_arguments.done", call_id: "old-call", name: "search_library", arguments: "{}", response_id: "old-response" });
    });
    await act(async () => { await h.get().stop(); });
    act(() => h.get().start({ threadId: THREAD }));
    await settle();
    await act(async () => { channel?.open(); });
    const before = sent.length;
    await act(async () => {
      finishSearch();
      rejectPlayback?.(new DOMException("Old player blocked", "NotAllowedError"));
    });
    expect(h.get().phase).toBe("live");
    expect(h.get().playbackBlocked).toBe(false);
    expect(h.get().pendingTools).toEqual([]);
    expect(sent).toHaveLength(before);
    h.unmount();
  });
});

describe("the meter, which is the only place a live conversation's cost exists", () => {
  it("ignores an old channel's delayed close when accounting for the resumed session", async () => {
    const h = await connected({ wiring: wiringFor(ticketWith()) });
    const oldChannel = channel as FakeChannel | null;
    await act(async () => { await h.get().stop(); });
    act(() => h.get().start({ threadId: THREAD }));
    await settle();
    await act(async () => { channel?.open(); oldChannel?.notifyClosed(); });
    expect(h.get().phase).toBe("live");
    await act(async () => { await h.get().stop(); });
    expect(metered.filter((report) => report.kind === "close").map((report) => report.reason)).toEqual(["reader", "reader"]);
    h.unmount();
  });

  /**
   * The audio is a WebRTC connection from this tab straight to OpenAI, so the
   * `usage` object attached to every turn is delivered to client JavaScript and
   * to nothing else — there is no server-side copy anywhere and no admin key
   * here to reconcile against. Until Stage 2B the hook received those numbers
   * every turn and read them only for function calls.
   *
   * What `meter.ts` decides on its own has its own tests. This is the part only
   * the hook can be wrong about: which events reach the meter at all, which
   * session id they are addressed to, and whether a hang-up says so.
   */

  it("says the channel opened, because a minted token is not a conversation", async () => {
    /* A reader can press Live and change their mind. A denominator built on
       issued sessions would then understate what a real conversation costs by
       however many of those there are, with nothing looking wrong. */
    const h = await connected({ wiring: wiringFor(ticketWith()) });
    await settle();
    expect(metered).toMatchObject([{ kind: "connected", sessionId: "live-session-1" }]);
    await act(async () => {
      await h.get().stop();
    });
  });

  it("reports both bills of one turn — the answer and the transcription", async () => {
    /* **The two halves are billed in different units**, on different events, by
       different models. `gpt-realtime-2.1` answers and is billed per token split
       by modality; `gpt-live-transcribe` writes down what the reader said and is
       billed per audio minute. A meter that watched `response.done` alone would
       price half of live conversation at nothing. */
    const h = await connected({
      wiring: wiringFor(ticketWith()),
      speak: async () => ({ ok: true, threadId: THREAD, tailId: "spya-srva01" }),
    });
    await speakTurn("u1", "r1", "Q1", "A1");
    await settle();

    const usage = metered.filter((m) => m.kind === "usage").map((m) => m.report);
    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({
      kind: "response",
      providerEventId: "r1",
      status: "completed",
      inputAudioTokens: 13,
      outputAudioTokens: 91,
      /* The split openai-node dropped for a while, and the one that says how
         much of the cache saving landed on the expensive modality. */
      cachedTextTokens: 60,
      cachedAudioTokens: 4,
    });
    expect(usage[1]).toMatchObject({
      kind: "transcription",
      providerEventId: "u1",
      audioSeconds: 2.5,
    });
    /* **The start time is the one this tab observed**, from `response.created`.
       Realtime events carry no timestamps, so without it the row's duration
       would have to be a zero or the whole conversation's wall-clock — both of
       which are lies about how long a call took. */
    expect(usage[0]?.startedAt).toEqual(expect.any(String));

    /* **Never a dollar amount, a model, an owner or an article.** All four come
       from the session row the server wrote when it minted the token; a client
       that could name its own model could name the cheap one. */
    for (const report of usage) {
      expect(Object.keys(report ?? {})).not.toContain("cost");
      expect(Object.keys(report ?? {})).not.toContain("model");
    }

    await act(async () => {
      await h.get().stop();
    });
  });

  it("posts nothing for a turn whose numbers it could not read", async () => {
    /* `response.done` arriving with the totals and no modality split is a
       reported provider defect (openai-agents-js#538). Filling the gaps with
       zeros would produce a report the server accepts and prices at
       approximately nothing — a turn that cost real money, in the ledger as
       free. Nothing is sent instead. */
    const h = await connected({ wiring: wiringFor(ticketWith()) });
    await act(async () => {
      channel?.deliver({ type: "response.created", response: { id: "r9" } });
      channel?.deliver({
        type: "response.done",
        response: { id: "r9", status: "completed", output: [], usage: { input_tokens: 90, output_tokens: 5 } },
      });
    });
    await settle();
    expect(metered.filter((m) => m.kind === "usage")).toHaveLength(0);
    await act(async () => {
      await h.get().stop();
    });
  });

  it("says how the conversation ended, and the reason is the browser's own word", async () => {
    /* Best-effort by nature: a closed laptop says nothing, so a session with no
       `closed_at` is ordinary rather than an error. The value is in the ones
       that do close — it is what makes "issued, never connected" and
       "connected, ended, reported nothing" different rows rather than one
       shrug. */
    const h = await connected({ wiring: wiringFor(ticketWith()) });
    await act(async () => {
      await h.get().stop();
    });
    await settle();
    expect(metered.at(-1)).toMatchObject({ kind: "close", reason: "reader" });
  });

  it("names the cap when a cap is what ended it", async () => {
    vi.useFakeTimers();
    try {
      const h = mount({ wiring: wiringFor(ticketWith()) });
      act(() => h.get().start({ threadId: THREAD, microphone: true }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        channel?.open();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6 * 60_000);
      });
      expect(h.get().error).toMatch(/quiet/);
      expect(metered.at(-1)).toMatchObject({ kind: "close", reason: "idle-cap" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("meters nothing, and says so, when the ticket carries no journal row", async () => {
    /* The preview page's spike server mints a token and writes no session row,
       so a conversation there is honestly unmetered rather than reported against
       an id nobody owns. Silence would be the wrong answer: a feature that
       quietly stops being metered is the failure this whole stage is about. */
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const h = await connected({ wiring: wiringFor(ticketWith({ sessionId: null })) });
      await speakTurn("u1", "r1", "Q1", "A1");
      await settle();
      expect(metered).toHaveLength(0);
      expect(said).toHaveBeenCalled();
      await act(async () => {
        await h.get().stop();
      });
    } finally {
      said.mockRestore();
    }
  });
});


describe("spoken repair through the actual chat controller", () => {
  const at = "2026-09-06T12:00:00.000Z";
  const row = (id: string, role: ChatMessage["role"], text: string): ChatMessage => ({
    id, role, text, status: "done", createdAt: at,
  });

  function seam() {
    let resolveWrite!: (outcome: SpokenOutcome) => void;
    let resolveRepair!: (outcome: ThreadsOutcome) => void;
    let repairSignal: AbortSignal | undefined;
    const bodies: Record<string, unknown>[] = [];
    const thread: ChatThread = {
      id: THREAD, kind: "chat", title: "New chat", createdAt: at, updatedAt: at, messages: [],
    };
    const saved: ChatThread = { ...thread, messages: [
      row("spya-srvq01", "user", "What happened?"),
      row("spya-srva01", "assistant", "The response was lost."),
    ] };
    const effects: ChatEffects = {
      loadThreads: (_slug, signal) => { repairSignal = signal; return new Promise((resolve) => { resolveRepair = resolve; }); },
      appendSpoken: (_slug, _thread, body) => {
        bodies.push(body);
        return new Promise((resolve) => { resolveWrite = resolve; });
      },
      renameThread: async () => ({ ok: true }),
      deleteThread: async () => ({ ok: true }),
      runTurn: async () => {},
      settledAnswer: async () => null,
      stopAnswer: async () => ({ ok: true }),
      cancelThread: async () => ({ ok: true }),
    };
    const controller = new ChatController("a-slug", effects);
    controller.dispatch({ type: "thread.begun", thread });
    let seq = 0;
    const speak = (exchange: SpokenExchange) => controller.appendSpoken({
      id: asOpId(`spya-spok0${++seq}`), kind: "spoken", threadId: THREAD,
      question: row(`spya-locq0${seq}`, "user", exchange.question),
      reply: { ...row(`spya-loca0${seq}`, "assistant", exchange.answer),
        ...(exchange.interrupted ? { interrupted: true } : {}),
        ...(exchange.passages ? { passages: exchange.passages } : {}),
        ...(exchange.tools ? { tools: exchange.tools } : {}),
      },
      expectedTailId: exchange.expectedTailId, at,
    });
    return { controller, saved, bodies, speak, signal: () => repairSignal,
      fail: (outcome: SpokenOutcome) => resolveWrite(outcome),
      refuse: () => resolveWrite({ ok: false, conflict: true, error: "Conversation moved on." }),
      repair: (outcome: ThreadsOutcome) => resolveRepair(outcome),
    };
  }

  it("keeps exactly one provisional copy through a deferred 409 repair, then uses the recovered server tail", async () => {
    const s = seam();
    const h = await connected({ wiring: wiringFor(ticketWith()), speak: s.speak });
    try {
      await speakTurn("u-repair", "r-repair", "What happened?", "The response was lost.");
      const visible = () => [...s.controller.threads.flatMap((t) => t.messages.map((m) => m.text)), ...h.get().lines.map((l) => l.text)];
      expect(visible()).toEqual(["What happened?", "The response was lost."]);
      await act(async () => { s.refuse(); });
      expect(h.get().lines).toEqual([]);
      expect(h.get().hasUnsavedLines).toBe(false);
      expect(visible()).toEqual(["What happened?", "The response was lost."]);
      await act(async () => { s.repair({ ok: true, threads: [s.saved] }); });
      expect(visible()).toEqual(["What happened?", "The response was lost."]);
      expect(h.get().hasUnsavedLines).toBe(false);
      expect(s.controller.state.error).toBeNull();
      expect(s.controller.threads[0]?.messages.at(-1)?.id).toBe("spya-srva01");
      await speakTurn("u-next", "r-next", "And now?", "It continues.");
      expect(s.bodies[1]?.expectedTailId).toBe("spya-srva01");
      // Settle the second request so teardown has no outstanding writer.
      s.refuse();
      await act(async () => {});
      s.repair({ ok: false, error: "Offline now." });
      await act(async () => {});
    } finally { h.unmount(); }
  });

  it("checks exhausted ambiguous writes before restoring a live copy", async () => {
    const s = seam();
    const h = await connected({ wiring: wiringFor(ticketWith()), speak: s.speak });
    try {
      await speakTurn("u-uncertain", "r-uncertain", "What happened?", "The response was lost.");
      await act(async () => { s.fail({ ok: false, conflict: false, uncertain: true, error: "Every response was lost." }); });
      expect(h.get().hasUnsavedLines).toBe(false);
      expect(h.get().lines).toEqual([]);
      expect(s.controller.threads[0]?.messages).toHaveLength(2);
      await act(async () => { s.repair({ ok: true, threads: [s.saved] }); });
      expect(h.get().hasUnsavedLines).toBe(false);
      expect(s.controller.threads[0]?.messages.map((m) => m.id)).toEqual(["spya-srvq01", "spya-srva01"]);
    } finally { h.unmount(); }
  });

  it("recovers the paired answer tail without claiming later turns the live model has not heard", async () => {
    const s = seam();
    const h = await connected({ wiring: wiringFor(ticketWith()), speak: s.speak });
    try {
      await speakTurn("u-moved", "r-moved", "What happened?", "The response was lost.");
      await act(async () => { s.refuse(); });
      const later = { ...s.saved, messages: [...s.saved.messages,
        row("spya-otherq", "user", "An unrelated question"), row("spya-othera", "assistant", "An unrelated answer"),
      ] };
      await act(async () => { s.repair({ ok: true, threads: [later] }); });
      expect(h.get().hasUnsavedLines).toBe(false);
      expect(s.controller.threads[0]?.messages).toHaveLength(4);
      await speakTurn("u-after", "r-after", "Continue?", "Only with the history I know.");
      expect(s.bodies[1]?.expectedTailId).toBe("spya-srva01");
      // The next write still conflicts against the unrelated later rows.
      await act(async () => { s.refuse(); });
      await act(async () => { s.repair({ ok: true, threads: [later] }); });
      expect(h.get().hasUnsavedLines).toBe(true);
    } finally { h.unmount(); }
  });

  it("restores genuinely missing words only after repair finishes", async () => {
    const s = seam();
    const h = await connected({ wiring: wiringFor(ticketWith()), speak: s.speak });
    try {
      await speakTurn("u-missing", "r-missing", "What happened?", "The response was lost.");
      await act(async () => { s.refuse(); });
      expect(h.get().hasUnsavedLines).toBe(false);
      await act(async () => { s.repair({ ok: true, threads: [{ ...s.saved, messages: [] }] }); });
      expect(h.get().hasUnsavedLines).toBe(true);
      expect(h.get().lines.map((l) => l.text)).toEqual(["What happened?", "The response was lost."]);
      expect(s.controller.threads[0]?.messages).toEqual([]);
    } finally { h.unmount(); }
  });

  it("bounds a hung repair while finishing and ignores its late saved response", async () => {
    const s = seam();
    const h = await connected({ wiring: wiringFor(ticketWith()), speak: s.speak });
    try {
      await speakTurn("u-timeout", "r-timeout", "What happened?", "The response was lost.");
      vi.useFakeTimers();
      await act(async () => { s.refuse(); });
      expect(h.get().hasUnsavedLines).toBe(false);
      let finished = false;
      act(() => { void h.get().stop().then(() => { finished = true; }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(finished).toBe(true);
      expect(s.signal()?.aborted).toBe(true);
      expect(h.get().hasUnsavedLines).toBe(true);
      expect(h.get().error).toMatch(/confirm|time/i);
      await act(async () => { s.repair({ ok: true, threads: [s.saved] }); });
      expect(s.controller.threads[0]?.messages).toEqual([]);
    } finally { h.unmount(); vi.useRealTimers(); }
  });
});
