// @vitest-environment jsdom
/**
 * **Send hands over from the live session, and waits.**
 *
 * One conversation, two input methods, one speaker at a time. A reader may hold
 * a draft while talking; pressing Send gracefully ends the conversation and only
 * then uses the typed path.
 *
 * **The wait is the whole test.** A typed turn claims the conversation's tail,
 * and the flush the hang-up starts is about to move it — so an unawaited
 * handoff turns the expected-tail guard into a 409 we inflicted on ourselves,
 * which the reader sees as their question being refused for no reason they
 * could act on. It is also invisible in development, where everything is fast
 * and the flush usually wins the race.
 *
 * Live can also start a new conversation from the list. Its status and words
 * belong only to the thread it was started in; a failure must be visible in
 * the actual composer, not only on the development preview.
 *
 * docs/plans/260831l-live-conversation-in-chat.md § 1d and § 4.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage, ChatThread } from "../src/types.js";
import type { LiveApi, LiveLine } from "../src/web/live/useLiveConversation.js";
import { liveGroups } from "../src/web/live/tail.js";

const { ChatPanel } = await import("../src/web/ChatPanel.js");

const AT = "2026-08-31T12:00:00.000Z";
const message = (id: string, role: ChatMessage["role"], text: string): ChatMessage => ({
  id,
  role,
  text,
  createdAt: AT,
  status: "done",
});

const THREAD: ChatThread = {
  kind: "chat",
  id: "spya-k3m9qt",
  title: "An earlier conversation",
  createdAt: AT,
  updatedAt: AT,
  messages: [message("spya-msgu01", "user", "typed"), message("spya-msga01", "assistant", "answered")],
};

/** What the panel did, in order. */
let events: string[] = [];
let host: HTMLDivElement;
let root: Root;

/** A live session that takes a controllable amount of time to hang up. */
function fakeLive(phase: LiveApi["phase"]): { api: LiveApi; finish: () => void } {
  let release!: () => void;
  const done = new Promise<void>((r) => {
    release = r;
  });
  const api = {
    phase,
    error: null,
    lines: [],
    pointers: [],
    tools: [],
    hearing: false,
    speaking: false,
    seen: {},
    placement: null,
    inputLevel: { current: 0.5 },
    measuringInput: true,
    quietInput: false,
    deviceLabel: "MacBook Pro Microphone",
    playbackBlocked: false,
    enableAudio: async () => { events.push("enableAudio"); },
    thinking: false,
    pendingTools: [],
    notice: null,
    hasUnsavedLines: false,
    threadId: THREAD.id,
    start: () => {},
    stop: () => {
      events.push("stop");
      return done;
    },
    say: () => {},
    stall: null,
    reconnect: () => { events.push("reconnect"); },
    step: null,
    reconnecting: false,
  } satisfies LiveApi;
  return { api, finish: () => release() };
}

/** One live line, placed in an exchange the way the hook places it. */
function line(id: string, role: LiveLine["role"], text: string, done: boolean, exchange = id, seq = 0): LiveLine {
  return { id, role, text, done, exchange, session: 1, seq };
}

function paint(live?: LiveApi, threadId: string | null = THREAD.id, threads = [THREAD], blocks = new Map<string, string>()): void {
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        kind: "chat" as const,
        loaded: true,
        loadFailed: false,
        threads,
        threadId,
        onThread: (id: string | null) => { events.push(`thread:${id}`); },
        onSend: (q: string) => {
          events.push(`send:${q}`);
        },
        onNew: () => {},
        onSendNew: (q: string) => {
          events.push(`sendNew:${q}`);
        },
        onDiscard: (id: string) => { events.push(`discard:${id}`); },
        onRename: () => {},
        onDelete: () => {},
        canStartOver: true,
        onRetry: () => {},
        onEdit: () => {},
        onStop: () => {},
        onJump: (id: string) => { events.push(`jump:${id}`); },
        recovering: new Set<string>(),
        blocks,
        focusNonce: 0,
        error: null,
        ...(live ? { live, onStartLive: (id: string | null) => { events.push(`startLive:${id ?? "new"}`); return undefined; } } : {}),
      }),
    );
  });
}

function box(): HTMLTextAreaElement {
  const el = host.querySelector<HTMLTextAreaElement>("textarea.chat-input");
  if (!el) throw new Error("no composer");
  return el;
}

/** Type, then press Enter — the way a reader actually sends. */
function ask(question: string): void {
  const el = box();
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(el, question);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

beforeEach(() => {
  events = [];
  // This jsdom has no localStorage; use the same seam as mic-devices.test.ts.
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("Send while a live conversation is running", () => {
  it("does NOT send until the hang-up has finished", async () => {
    /* The bug this prevents is a 409 nobody could act on: the typed turn claims
       the conversation's tail while the flush is still moving it. It is also
       invisible in development, where the flush usually wins the race. */
    const { api, finish } = fakeLive("live");
    paint(api);
    ask("and what about the ending?");

    await act(async () => {
      await Promise.resolve();
    });
    expect(events, "the typed turn went before the flush had finished").toEqual(["stop"]);

    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(events).toEqual(["stop", "send:and what about the ending?"]);
  });

  it("sends straight away when there is no session to end", async () => {
    /* No pointless await on the ordinary path — every typed turn in the app
       goes through this line. */
    const { api } = fakeLive("idle");
    paint(api);
    ask("just typing");
    await act(async () => {
      await Promise.resolve();
    });
    expect(events).toEqual(["send:just typing"]);
  });

  it("does not wait on a session that already failed", async () => {
    /* `failed` is a session that never got going. Waiting for its hang-up would
       be waiting for a teardown that has already happened, and the reader's
       question would sit there. */
    const { api } = fakeLive("failed");
    paint(api);
    ask("carry on");
    await act(async () => {
      await Promise.resolve();
    });
    expect(events).toEqual(["send:carry on"]);
  });
});

describe("where the button is offered", () => {
  it("is in the composer of a conversation", () => {
    const { api } = fakeLive("idle");
    paint(api);
    expect(host.querySelector(".chat-live-btn")).not.toBeNull();
  });

  it("starts a new conversation from the list composer", () => {
    const { api } = fakeLive("idle");
    paint(api, null);
    expect(host.querySelector("textarea.chat-input"), "no box to check").not.toBeNull();
    const button = host.querySelector<HTMLButtonElement>(".chat-live-btn");
    expect(button, "there is no way to begin a spoken conversation").not.toBeNull();
    act(() => button!.click());
    expect(events).toEqual(["startLive:new"]);
  });

  it("offers Live on an empty loaded list after an unused thread was closed", () => {
    const { api } = fakeLive("idle");
    paint(api, null, []);
    expect(host.querySelector(".chat-live-btn")).not.toBeNull();
  });

  it("is absent entirely when the panel was given no session", () => {
    /* `ChatDialog` mounts the same composer and owns no session. It must not
       render a dead button. */
    paint();
    expect(host.querySelector(".chat-live-btn")).toBeNull();
  });
});

describe("what the button says", () => {
  /* **Not "Resume" on a thread that has only been typed in.** It read as
     picking up an earlier call, which the reader had never made — Greg,
     SPIDERYARN-READING2-3G. The click continues this thread out loud; say that.
     docs/plans/260912d-live-button-label-says-resume-on-a-thread-with-no-live-history.md */
  const label = () => host.querySelector(".chat-live-label")?.textContent;
  const name = () => host.querySelector(".chat-live-btn")?.getAttribute("aria-label");

  it("offers to continue a conversation that has messages, without calling it a resume", () => {
    const { api } = fakeLive("idle");
    paint(api);
    expect(label()).toBe("Live");
    expect(name()).toBe("Continue this conversation live");
  });

  it("offers to start one from the list", () => {
    const { api } = fakeLive("idle");
    paint(api, null);
    expect(label()).toBe("Live");
    expect(name()).toBe("Start a live conversation");
  });

  it("says Hang up while the call is on, whatever the thread holds", () => {
    const { api } = fakeLive("live");
    paint(api);
    expect(label()).toBe("Hang up");
    expect(name()).toBe("Hang up");
  });

  it.each([
    ["connecting", "Cancel", "Cancel"],
    ["closing", "Finishing…", "Finishing…"],
    ["failed", "Live", "Continue this conversation live"],
  ] as const)("names the %s action truthfully", (phase, visible, accessible) => {
    const { api } = fakeLive(phase);
    paint(api);
    expect(label()).toBe(visible);
    expect(name()).toBe(accessible);
  });

  it("keeps Remember's larger visible label while naming the continuation", () => {
    const { api } = fakeLive("idle");
    paint(api, THREAD.id, [{ ...THREAD, kind: "remember" }]);
    expect(label()).toBe("Live conversation");
    expect(name()).toBe("Continue this conversation live");
  });
});

describe("the live session in the shipping chat composer", () => {
  const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text);

  it("offers to cancel a reconnect while its hang-up runs, because Live is disabled then", async () => {
    /* GPT Sol, plan review 261002j: "Continue typing" was the only control
       that could cancel a pending reconnect during its teardown. It went, so
       this has to be here instead — and only during a reconnect. */
    const { api } = fakeLive("closing");
    paint(api);
    expect(button("Cancel reconnect"), "an ordinary hang-up has nothing to cancel").toBeUndefined();
    paint({ ...api, reconnecting: true });
    expect(host.querySelector<HTMLButtonElement>(".chat-live-btn")?.disabled).toBe(true);
    const cancel = button("Cancel reconnect");
    expect(cancel, "a reader who changed their mind is put back into a call").toBeDefined();
    act(() => cancel!.click());
    await act(async () => { await Promise.resolve(); });
    expect(events).toEqual(["stop"]);
  });

  it("offers neither dictation nor 'Continue typing' inside the live panel", () => {
    /* Greg, spya-f4eq7p: "there was a button to sort of switch from live to
       voice dictation. I don't think we need that." The composer's own
       microphone is still there, and Send or Hang up ends the call. */
    for (const phase of ["connecting", "live", "closing", "failed"] as const) {
      const { api } = fakeLive(phase);
      paint({ ...api, error: phase === "failed" ? "It stopped." : null });
      expect(button("Use dictation"), phase).toBeUndefined();
      expect(button("Continue typing"), phase).toBeUndefined();
    }
  });

  it("shows a failure as an error with Try again, not a grey line, and allows typing", async () => {
    const { api } = fakeLive("failed");
    api.error = "Microphone permission was denied. Allow access in your browser, then retry.";
    paint(api);
    const failure = host.querySelector(".chat-live-failure");
    expect(failure?.getAttribute("role")).toBe("alert");
    expect(failure?.textContent).toContain("Microphone permission was denied");
    expect(host.querySelector(".chat-live-status")?.classList.contains("is-error")).toBe(true);
    expect(host.querySelector(".chat-live-state")?.textContent).toBe("Error");
    const retry = button("Try again");
    expect(retry).toBeDefined();
    act(() => retry!.click());
    expect(events).toEqual([`startLive:${THREAD.id}`]);
    ask("continue by typing");
    await act(async () => { await Promise.resolve(); });
    expect(events.at(-1)).toBe("send:continue by typing");
  });

  it.each([
    ["ticket", "Starting…"],
    ["microphone", "Opening your microphone…"],
    ["transport", "Connecting to the voice service…"],
    ["seeding", "Loading this conversation…"],
  ] as const)("names the connecting step it is on: %s", (step, sentence) => {
    const { api } = fakeLive("connecting");
    paint({ ...api, step });
    expect(host.querySelector(".chat-live-state")?.textContent).toBe("Connecting");
    expect(host.querySelector(".chat-live-sentence")?.textContent).toBe(sentence);
    expect(host.querySelector('.chat-live-steps [aria-current="step"]')?.textContent).toBe(sentence.replace("…", ""));
  });

  it("shows the meter while connecting, and says the conversation is not hearing it yet", () => {
    const { api } = fakeLive("connecting");
    paint({ ...api, step: "transport" });
    expect(host.querySelector(".chat-live-status .mic-level"), "nothing moves while it connects").not.toBeNull();
    expect(host.textContent).toContain("The conversation will hear you once it has loaded");
    paint({ ...api, phase: "live" });
    expect(host.textContent).not.toContain("will hear you once");
    expect(host.querySelector(".chat-live-state")?.textContent).toBe("Listening");
    expect(host.querySelector(".chat-live-sentence")?.textContent).toBe("Listening — go ahead");
  });

  it("is one button, and keeps the settings in an Advanced disclosure that starts closed", async () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: async () => [{ kind: "audioinput", deviceId: "usb", label: "USB Headphones" }],
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
    try {
      const { api } = fakeLive("live");
      paint(api);
      await act(async () => { await Promise.resolve(); });
      expect(host.querySelectorAll(".chat-live select"), "a setting is still beside the Live button").toHaveLength(0);
      const advanced = host.querySelector<HTMLDetailsElement>(".chat-live-advanced");
      expect(advanced?.open, "Advanced should start closed").toBe(false);
      expect(advanced?.querySelector('select[aria-label="Microphone device"]')).not.toBeNull();
      const noise = advanced?.querySelector<HTMLSelectElement>('select[aria-label="Noise reduction"]');
      expect([...(noise?.options ?? [])].map((o) => o.text)).toEqual(["Auto", "Headphones", "Laptop mic"]);
      expect([...(advanced?.querySelectorAll("button") ?? [])].map((b) => b.textContent)).toEqual(["Reconnect"]);
    } finally {
      if (previous) Object.defineProperty(navigator, "mediaDevices", previous);
      else Reflect.deleteProperty(navigator, "mediaDevices");
    }
  });

  it("changing noise reduction during a call saves and reconnects, and is remembered", async () => {
    const { api } = fakeLive("live");
    paint(api);
    const noise = host.querySelector<HTMLSelectElement>('select[aria-label="Noise reduction"]');
    act(() => {
      noise!.value = "headset";
      noise!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    /* Go through the hook's reconnect intent rather than assembling a stop and
       start here. That path can be cancelled and refuses to restart after a
       failed save. */
    expect(events).toEqual(["reconnect"]);
    expect(window.localStorage.getItem("spya.live.micPlacement")).toBe("headset");
  });

  it("shows the live words in the thread itself, as chat turns, with no separate transcript", () => {
    const { api } = fakeLive("live");
    api.lines = [
      line("u1", "reader", "What is the argument?", true),
      line("a1", "companion", "It begins with", false, "u1"),
    ];
    paint(api);
    const scroll = host.querySelector(".chat-scroll");
    expect(scroll?.querySelector(".chat-live-tail .chat-turn.you")?.textContent).toBe("What is the argument?");
    expect(scroll?.querySelector(".chat-live-tail .chat-turn.model")?.textContent).toContain("It begins with");
    expect(scroll?.querySelector(".chat-live-tail .chat-cursor"), "no still-arriving mark").not.toBeNull();
    expect(host.querySelector(".chat-live-transcript")).toBeNull();
    expect(host.querySelector('input[aria-label="Show live transcript"]')).toBeNull();
    expect(host.querySelector(".chat-live-status")?.textContent).not.toContain("It begins with");
    /* After the saved turns: the end of this same conversation. */
    const turns = [...(scroll?.querySelectorAll(".chat-turn") ?? [])].map((t) => t.textContent);
    expect(turns.slice(0, 2)).toEqual(["typed", expect.stringContaining("answered")]);
    expect(events).toEqual([]);
  });

  it("treats the first live line as conversation content and follows its growth", () => {
    const { api } = fakeLive("live");
    const emptyThread = { ...THREAD, messages: [] };
    paint(api, THREAD.id, [emptyThread]);
    const scroll = host.querySelector<HTMLElement>(".chat-scroll")!;
    let top = 0;
    let height = 400;
    Object.defineProperties(scroll, {
      clientHeight: { configurable: true, get: () => 100 },
      scrollHeight: { configurable: true, get: () => height },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value: number) => { top = value; },
      },
    });

    api.lines = [line("u1", "reader", "The first spoken words", false)];
    height = 700;
    paint(api, THREAD.id, [emptyThread]);
    expect(host.querySelector(".chat-suggest"), "the empty-thread suggestions stayed over the live turn").toBeNull();
    expect(top, "the first spoken line was treated as an empty thread and scrolled to the top").toBe(700);

    api.lines = [{ ...api.lines[0]!, text: "The first spoken words, still growing" }];
    height = 900;
    paint(api, THREAD.id, [emptyThread]);
    expect(top, "live transcript growth was absent from the follow-scroll dependencies").toBe(900);

    /* And growth still respects a reader who deliberately scrolled away. */
    act(() => {
      scroll.scrollTop = 0;
      scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    api.lines = [{ ...api.lines[0]!, text: "The first spoken words, still growing after the reader scrolled up" }];
    height = 1_100;
    paint(api, THREAD.id, [emptyThread]);
    expect(top).toBe(0);
    expect(host.querySelector(".chat-to-bottom")?.textContent).toContain("Latest");
  });

  it("puts a late answer under the question it answers, not after the next one", () => {
    /* Rule 1: U1, U2, then R1's words. The ledger files R1 with U1, so the
       thread shows it there — arrival order would show U1, U2, R1. */
    const { api } = fakeLive("live");
    api.lines = [
      line("u1", "reader", "First question", true, "u1", 0),
      line("u2", "reader", "Second question", false, "u2", 1),
      line("r1", "companion", "Answer to the first", false, "u1", 0),
    ];
    paint(api);
    const order = [...host.querySelectorAll(".chat-live-tail .chat-live-words")].map((w) => w.textContent);
    expect(order).toEqual(["First question", "Answer to the first", "Second question"]);
  });

  it("orders exchanges by the ledger, and a retried session's kept words first, whatever order the lines are held in", () => {
    /* The hook holds lines in arrival order; the thread must not depend on
       that. Kept words from an earlier session (1) stay above the new
       session's (2), whose ledger counts from zero again. */
    const held = [
      { ...line("n1", "reader", "New session question", true, "n1", 0), session: 2 },
      line("r2", "companion", "Second answer", true, "u2", 1),
      line("u2", "reader", "Second question", true, "u2", 1),
      line("u1", "reader", "First question", true, "u1", 0),
    ];
    expect(liveGroups(held).map((g) => [...g.reader, ...g.companion].map((l) => l.text))).toEqual([
      ["First question"], ["Second question", "Second answer"], ["New session question"],
    ]);
  });

  it("stops blinking at an unfinished line once the session is no longer live", () => {
    /* An answer cut off by a hang-up or a failure never gets its final
       transcript. A cursor on it after the call has ended says more is coming,
       which is the one thing that is not true. GPT Sol, plan review 261002j. */
    const { api } = fakeLive("failed");
    api.error = "The live connection was lost.";
    api.hasUnsavedLines = true;
    api.lines = [
      line("u1", "reader", "Kept question", true),
      line("a1", "companion", "Cut off mid", false, "u1"),
      line("u9", "reader", "", false, "u9", 1),
    ];
    paint(api);
    const tail = host.querySelector(".chat-live-tail");
    expect(tail?.textContent).toContain("Cut off mid");
    expect(tail?.querySelector(".chat-cursor"), "still blinking after the call ended").toBeNull();
    expect(tail?.textContent).not.toContain("still arriving");
    expect(tail?.querySelectorAll(".chat-turn"), "an empty placeholder outlived the call").toHaveLength(2);
  });

  it("labels retained ownerless words as Stopped after the call ends", () => {
    const { api } = fakeLive("idle");
    api.lines = [line("unowned", "reader", "A typed probe with no acknowledgement", true, "unowned", Number.POSITIVE_INFINITY)];
    paint(api);
    expect(host.querySelector(".chat-live-tail")?.textContent).toContain("A typed probe with no acknowledgement");
    expect(host.querySelector(".chat-live-state")?.textContent).toBe("Stopped");
    expect(host.querySelector(".chat-live-sentence")?.textContent).toBe("Live conversation ended");
  });

  it("shows the acquired microphone, input meter and playback recovery action", async () => {
    const { api } = fakeLive("live");
    api.playbackBlocked = true;
    api.quietInput = true;
    paint(api);
    expect(host.querySelector(".mic-level"), "the microphone has no local level meter").not.toBeNull();
    expect(host.textContent).toContain("MacBook Pro Microphone");
    expect(host.textContent).toContain("No sound detected yet");
    const enable = [...host.querySelectorAll("button")].find((b) => b.textContent === "Enable sound");
    expect(enable).toBeDefined();
    await act(async () => { enable!.click(); });
    expect(events).toEqual(["enableAudio"]);
  });

  it("reports thinking and tool work without claiming the companion is speaking", () => {
    const { api } = fakeLive("live");
    api.thinking = true;
    paint(api);
    expect(host.textContent).toContain("Thinking…");
    api.pendingTools = [{ callId: "c1", name: "search_article_words" }];
    paint(api);
    expect(host.textContent).toContain("Using tools…");
    expect(host.textContent).not.toContain("Speaking…");
  });

  it("makes the latest spoken passage pressable and excludes invented block ids", () => {
    const { api } = fakeLive("live");
    api.pointers = [
      { blockIds: ["spya-older2"], why: "Earlier pointer", at: 1 },
      { blockIds: ["spya-a2b3c4", "spya-fake77"], why: "The central distinction", at: 2 },
    ];
    paint(api, THREAD.id, [THREAD], new Map([
      ["spya-a2b3c4", "The central paragraph"], ["spya-older2", "An earlier paragraph"],
    ]));
    const links = host.querySelectorAll<HTMLAnchorElement>(".chat-live-status .block-ref");
    expect(links, "show_passage never puts a passage on screen").toHaveLength(1);
    expect(links[0]?.href).toContain("at=spya-a2b3c4");
    act(() => links[0]!.click());
    expect(events).toEqual(["jump:spya-a2b3c4"]);
    expect(host.querySelector(".chat-live-status")?.textContent).not.toContain("Earlier pointer");
  });

  it("remembers a replacement microphone and uses the cancellable reconnect", async () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: async () => [
          { kind: "audioinput", deviceId: "headphones", label: "USB Headphones" },
        ],
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
    try {
      const { api } = fakeLive("live");
      paint(api);
      await act(async () => { await Promise.resolve(); });
      const picker = host.querySelector<HTMLSelectElement>('select[aria-label="Microphone device"]');
      expect(picker, "there is no way to escape a silent virtual microphone").not.toBeNull();
      act(() => {
        picker!.value = "headphones";
        picker!.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(window.localStorage.getItem("spya.dictation.deviceId")).toBe("headphones");
      expect(events).toEqual(["reconnect"]);
    } finally {
      if (previous) Object.defineProperty(navigator, "mediaDevices", previous);
      else Reflect.deleteProperty(navigator, "mediaDevices");
    }
  });

  it("shows the shared microphone choice that was made while Live was idle", async () => {
    const { api } = fakeLive("idle");
    paint(api);
    window.localStorage.setItem("spya.dictation.deviceId", "headphones");

    api.phase = "connecting";
    paint(api);
    await act(async () => { await Promise.resolve(); });

    const picker = host.querySelector<HTMLSelectElement>('select[aria-label="Microphone device"]');
    expect(picker?.value, "Live still showed the preference from its first render").toBe("headphones");
  });

  it("does not show another conversation's live words or error", () => {
    const { api } = fakeLive("live");
    api.threadId = "spya-other1";
    api.lines = [line("u1", "reader", "Private words in another thread", false)];
    api.error = "Error from another thread";
    paint(api);
    expect(host.textContent).not.toContain("Private words in another thread");
    expect(host.textContent).not.toContain("Error from another thread");
    expect(host.querySelector(".chat-live-status")).toBeNull();
  });

  it("names a stall in words and offers Reconnect, which is there whenever the call is live", () => {
    /* SPIDERYARN-READING2-42: the call "kept hanging" with nothing on screen
       saying so. The button is there with or without a notice, because the
       stall nobody predicted is the one that happens next. */
    const { api } = fakeLive("live");
    paint(api);
    const reconnect = () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Reconnect");
    expect(reconnect(), "no way out of a call that has stalled without a notice").toBeTruthy();
    paint({ ...api, stall: "microphone-paused" });
    expect(host.textContent).toMatch(/paused the microphone/);
    act(() => reconnect()?.click());
    expect(events).toContain("reconnect");
  });

  it("does not offer Reconnect, or a stall, when the call is not live", () => {
    const { api } = fakeLive("connecting");
    paint({ ...api, stall: "no-reply" });
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Reconnect")).toBe(false);
    expect(host.textContent).not.toMatch(/No reply yet/);
  });

  it("offers cancellation while the session is connecting", () => {
    const { api } = fakeLive("connecting");
    paint(api);
    const button = host.querySelector<HTMLButtonElement>(".chat-live-btn");
    expect(button?.disabled, "a startup that stalls cannot be cancelled").toBe(false);
    act(() => button!.click());
    expect(events).toEqual(["stop"]);
  });

  it("flushes a new spoken conversation before deciding whether it is empty", async () => {
    const { api, finish } = fakeLive("live");
    paint(api, THREAD.id, [{ ...THREAD, messages: [] }]);
    const leave = host.querySelector<HTMLButtonElement>('button[title="All conversations"]');
    act(() => leave!.click());
    expect(events, "the empty base was discarded while speech was still in flight").toEqual(["stop"]);
    await act(async () => { finish(); });
    expect(events).toEqual(["stop", `discard:${THREAD.id}`, "thread:null"]);
  });

  it("keeps a failed new conversation that still holds unsaved spoken words", () => {
    const { api } = fakeLive("failed");
    api.error = "Could not save the spoken turn.";
    api.lines = [line("u1", "reader", "Words still worth keeping", true)];
    paint(api, THREAD.id, [{ ...THREAD, messages: [] }]);
    act(() => host.querySelector<HTMLButtonElement>('button[title="All conversations"]')!.click());
    expect(events, "discard made the only unsaved transcript unreachable").toEqual(["thread:null"]);
  });

  it("labels retained unsaved words after a retry has cleared the connection error", () => {
    const { api } = fakeLive("live");
    api.hasUnsavedLines = true;
    api.lines = [line("u1", "reader", "Earlier words worth keeping", true)];
    paint(api);
    /* In the thread, with the notice beside the words it is about — and saying
       that where they belong is uncertain too (GPT Sol, plan review 261002j). */
    const tail = host.querySelector(".chat-scroll .chat-live-tail");
    expect(tail?.textContent).toContain("Earlier words worth keeping");
    expect(tail?.querySelector(".chat-live-unsaved")?.textContent).toMatch(/Couldn’t confirm whether these words were saved, or where they belong/);
    expect(tail?.textContent, "settled words from the failed session are labelled as still arriving").not.toContain("still arriving");
  });

  it("explains voice and thread continuity in a keyboard-reachable tooltip", async () => {
    const { api } = fakeLive("idle");
    paint(api);
    const button = host.querySelector<HTMLButtonElement>(".chat-live-btn");
    await act(async () => { button!.focus(); });
    const tooltip = document.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toContain("Talk about the article");
    expect(tooltip?.textContent).toContain("recent completed turns");
    expect(tooltip?.textContent).not.toContain("everything said here so far");
    expect(tooltip?.textContent).toContain("same conversation");
    expect(button?.hasAttribute("title")).toBe(false);
  });
});
