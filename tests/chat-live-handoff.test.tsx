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
import type { LiveApi } from "../src/web/live/useLiveConversation.js";

/* The profile hook fetches on mount, and this test is about a textarea. */
vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));

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
  } satisfies LiveApi;
  return { api, finish: () => release() };
}

function paint(live?: LiveApi, threadId: string | null = THREAD.id, threads = [THREAD], blocks = new Map<string, string>()): void {
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        kind: "chat" as const,
        stance: "balanced" as const,
        onStance: () => {},
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
  it("shows an actionable failure and allows typing in the same conversation", async () => {
    const { api } = fakeLive("failed");
    api.error = "Microphone permission was denied. Allow access in your browser, then retry.";
    paint(api);
    expect(host.textContent).toContain("Microphone permission was denied");
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Retry live");
    expect(retry).toBeDefined();
    act(() => retry!.click());
    expect(events).toEqual([`startLive:${THREAD.id}`]);
    ask("continue by typing");
    await act(async () => { await Promise.resolve(); });
    expect(events.at(-1)).toBe("send:continue by typing");
  });

  it("shows streaming words by default, and hiding them does not stop the session", () => {
    const { api } = fakeLive("live");
    api.lines = [
      { id: "u1", role: "reader", text: "What is the argument?", done: true },
      { id: "a1", role: "companion", text: "It begins with", done: false },
    ];
    paint(api);
    expect(host.querySelector(".chat-live-transcript")?.textContent).toContain("It begins with");
    const toggle = host.querySelector<HTMLInputElement>('input[aria-label="Show live transcript"]');
    expect(toggle?.checked).toBe(true);
    act(() => toggle!.click());
    expect(host.querySelector(".chat-live-transcript")).toBeNull();
    expect(events).toEqual([]);
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

  it("remembers a replacement microphone and flushes before reconnecting", async () => {
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
      const { api, finish } = fakeLive("live");
      paint(api);
      await act(async () => { await Promise.resolve(); });
      const picker = host.querySelector<HTMLSelectElement>('select[aria-label="Microphone device"]');
      expect(picker, "there is no way to escape a silent virtual microphone").not.toBeNull();
      act(() => {
        picker!.value = "headphones";
        picker!.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(window.localStorage.getItem("spya.dictation.deviceId")).toBe("headphones");
      expect(events).toEqual(["stop"]);
      await act(async () => { finish(); });
      expect(events).toEqual(["stop", `startLive:${THREAD.id}`]);
    } finally {
      if (previous) Object.defineProperty(navigator, "mediaDevices", previous);
      else Reflect.deleteProperty(navigator, "mediaDevices");
    }
  });

  it("does not show another conversation's live words or error", () => {
    const { api } = fakeLive("live");
    api.threadId = "spya-other1";
    api.lines = [{ id: "u1", role: "reader", text: "Private words in another thread", done: false }];
    api.error = "Error from another thread";
    paint(api);
    expect(host.textContent).not.toContain("Private words in another thread");
    expect(host.textContent).not.toContain("Error from another thread");
    expect(host.querySelector(".chat-live-status")).toBeNull();
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
    api.lines = [{ id: "u1", role: "reader", text: "Words still worth keeping", done: true }];
    paint(api, THREAD.id, [{ ...THREAD, messages: [] }]);
    act(() => host.querySelector<HTMLButtonElement>('button[title="All conversations"]')!.click());
    expect(events, "discard made the only unsaved transcript unreachable").toEqual(["thread:null"]);
  });

  it("labels retained unsaved words after a retry has cleared the connection error", () => {
    const { api } = fakeLive("live");
    api.hasUnsavedLines = true;
    api.lines = [{ id: "u1", role: "reader", text: "Earlier words worth keeping", done: true }];
    paint(api);
    expect(host.querySelector(".chat-live-transcript")?.textContent).toContain("Earlier words worth keeping");
    expect(host.querySelector(".chat-live-transcript")?.textContent).toContain("Couldn’t confirm whether these earlier words were saved");
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
