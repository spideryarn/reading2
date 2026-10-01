// @vitest-environment jsdom
/**
 * **Remember is its own single thread, and Chat does not list it.**
 *
 * Report `spya-peszam` and docs/plans/261001m-remember-is-its-own-single-thread.md
 * § Design 4. Until 2026-10-01 the list of conversations was shared between the
 * two modes; now each mode lists only its own kind, and Remember never shows a
 * list at all — it opens the reader's one Remember conversation directly.
 *
 * Asked against the real band and the real `useChat`, with `ChatPanel` stubbed
 * to record every set of props it is handed, so "never a list, not even for a
 * frame" is a claim about every render rather than about where things settled.
 * The harness is tests/conversation-band-handoff.test.tsx's.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread } from "../src/types.js";

/** Every set of props the band handed the panel, in order. */
const renders: Record<string, unknown>[] = [];
const last = (): Record<string, unknown> | undefined => renders.at(-1);

vi.mock("../src/web/ChatPanel.js", () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    renders.push(props);
    return null;
  },
}));

const calls: { url: string; method: string }[] = [];
/** What the list GET answers with. */
let stored: ChatThread[] = [];
/** A DELETE waits for this to be called, with the status it should answer. */
let releaseDelete: ((status: number) => void) | null = null;

/** The last answer's stream, so a test can speak for the server. */
let answer: ReadableStreamDefaultController<Uint8Array> | null = null;
function frame(event: string, data: unknown): void {
  answer?.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

/** An answer that says nothing and does not close unless a test makes it. */
function stream(): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      answer = controller;
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  return {
    ...real,
    apiFetch: (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url: String(url), method });
      if (method === "DELETE") {
        return new Promise<Response>((go) => {
          releaseDelete = (status) =>
            go(
              new Response(status === 200 ? "{}" : JSON.stringify({ error: "a 500" }), {
                status,
                headers: { "content-type": "application/json" },
              }),
            );
        });
      }
      if (method === "POST") return Promise.resolve(stream());
      return Promise.resolve(
        new Response(JSON.stringify({ threads: stored }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  };
});

let livePhase: "idle" | "live" = "idle";
let liveThreadId: string | null = null;
const stopLive = vi.fn<() => Promise<void>>(() => Promise.resolve());

vi.mock("../src/web/live/useLiveConversation.js", () => ({
  useLiveConversation: () => ({
    phase: livePhase,
    threadId: liveThreadId,
    stop: stopLive,
    start: vi.fn(),
  }),
}));

const { ConversationBand } = await import("../src/web/modes/conversation/ConversationModes.js");

const SLUG = "a-piece";
const AT = "2026-09-20T10:00:00.000Z";

function thread(id: string, kind: "chat" | "remember", over: Partial<ChatThread> = {}): ChatThread {
  return {
    id,
    kind,
    title: kind === "chat" ? "A question" : "Um, so what I took was",
    createdAt: AT,
    updatedAt: AT,
    messages: [
      { id: `${id.slice(0, 9)}q`, role: "user", text: "said", createdAt: AT, status: "done" },
      { id: `${id.slice(0, 9)}a`, role: "assistant", text: "answered", createdAt: AT, status: "done" },
    ],
    ...over,
  };
}

const CHAT = thread("spya-chat01", "chat");
const REMEMBER = thread("spya-rem001", "remember");

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  calls.length = 0;
  renders.length = 0;
  stored = [];
  releaseDelete = null;
  answer = null;
  livePhase = "idle";
  liveThreadId = null;
  stopLive.mockReset();
  stopLive.mockResolvedValue();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  /* nuqs batches replaceState calls on a 50 ms throttle. Let its global queue
     flush while jsdom still owns `location`; otherwise a longer multi-file run
     can tear the environment down first and report an unhandled timer error. */
  await new Promise((resolve) => setTimeout(resolve, 60));
  host.remove();
});

async function settle(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

function param(key: string): string | null {
  return new URLSearchParams(location.search).get(key);
}

async function mount(kind: "chat" | "remember", search: string): Promise<void> {
  history.replaceState(null, "", `/a-piece${search}`);
  await act(async () =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(
          NuqsAdapter,
          null,
          createElement(ConversationBand, {
            slug: SLUG,
            blocks: new Map<string, string>(),
            onJump: () => {},
            kind,
          }),
        ),
      ),
    ),
  );
  await settle();
}

const shown = (props = last()): ChatThread[] => (props?.threads as ChatThread[] | undefined) ?? [];

/**
 * **Would this set of props draw the list?** `ChatPanel` shows the list when it
 * has threads and none of them is the one `threadId` names — that is the whole
 * of its rule — so this is the panel's own condition, asked of every render.
 */
function drawsList(props: Record<string, unknown>): boolean {
  const threads = shown(props);
  return threads.length > 0 && !threads.some((t) => t.id === props.threadId);
}

function prop<T>(name: string): T {
  const value = last()?.[name];
  if (value === undefined) throw new Error(`the band handed the panel no ${name}`);
  return value as T;
}

describe("each mode lists only its own kind", () => {
  it("never lists a Remember conversation in Chat", async () => {
    stored = [CHAT, REMEMBER];
    await mount("chat", "?mode=chat");
    expect(shown().map((t) => t.id)).toEqual([CHAT.id]);
    for (const props of renders) {
      expect(shown(props).some((t) => t.kind === "remember")).toBe(false);
    }
  });
});

describe("Remember opens its one conversation and never a list", () => {
  it("opens the stored Remember conversation, on every render, without a list", async () => {
    stored = [CHAT, REMEMBER];
    await mount("remember", "?mode=remember");
    expect(last()?.threadId).toBe(REMEMBER.id);
    expect(shown().map((t) => t.id)).toEqual([REMEMBER.id]);
    expect(renders.length).toBeGreaterThan(0);
    /* The first render as well as the settled one: the list must not appear for
       even a frame while `?thread=` catches up. */
    for (const props of renders) expect(drawsList(props)).toBe(false);
    await vi.waitFor(() => expect(param("thread")).toBe(REMEMBER.id));
  });

  it("overrides a `?thread=` naming a chat", async () => {
    stored = [CHAT, REMEMBER];
    await mount("remember", `?mode=remember&thread=${CHAT.id}`);
    for (const props of renders) {
      expect(drawsList(props)).toBe(false);
      expect(props.threadId).not.toBe(CHAT.id);
    }
    expect(last()?.threadId).toBe(REMEMBER.id);
    await vi.waitFor(() => expect(param("thread")).toBe(REMEMBER.id));
  });

  it("overrides a stale `?thread=` too", async () => {
    stored = [REMEMBER];
    await mount("remember", "?mode=remember&thread=spya-gone01");
    for (const props of renders) expect(drawsList(props)).toBe(false);
    expect(last()?.threadId).toBe(REMEMBER.id);
  });

  it("begins one fresh Remember conversation when there is none", async () => {
    stored = [CHAT];
    await mount("remember", "?mode=remember");
    for (const props of renders) expect(drawsList(props)).toBe(false);
    expect(shown()).toHaveLength(1);
    const fresh = shown()[0] as ChatThread;
    expect(fresh.kind).toBe("remember");
    expect(fresh.messages).toHaveLength(0);
    expect(last()?.threadId).toBe(fresh.id);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("prefers the conversation with something in it over an empty one", async () => {
    const empty = thread("spya-rem000", "remember", { messages: [], createdAt: "2026-09-01T00:00:00.000Z" });
    stored = [empty, REMEMBER];
    await mount("remember", "?mode=remember");
    expect(last()?.threadId).toBe(REMEMBER.id);
  });
});

/**
 * **Start over is offered only on a stored, settled conversation** — named by
 * the server, at least one message, nothing of this tab's in flight for it. So
 * its DELETE is never held waiting for a name that may never come, which is
 * what two rounds of reducer machinery used to unwind. Plan 261001m.
 */
describe("Start over is offered only on a settled conversation", () => {
  const deletes = () => calls.filter((c) => c.method === "DELETE");

  it("is not offered on an empty Remember conversation, and pressing anyway sends nothing", async () => {
    stored = [CHAT];
    await mount("remember", "?mode=remember");
    const fresh = shown()[0] as ChatThread;
    expect(fresh.messages).toHaveLength(0);
    expect(last()?.canStartOver).toBe(false);

    await act(async () => prop<(id: string) => void>("onDelete")(fresh.id));
    await settle();
    expect(deletes()).toHaveLength(0);
    expect(last()?.threadId).toBe(fresh.id);
  });

  it("is not offered while the first answer is pending, and is once it is stored and settled", async () => {
    stored = [];
    await mount("remember", "?mode=remember");
    const guessed = last()?.threadId as string;

    await act(async () => prop<(q: string) => void>("onSend")("What I took"));
    await settle();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(last()?.canStartOver, "offered before the server named it").toBe(false);
    await act(async () => prop<(id: string) => void>("onDelete")(guessed));
    await settle();
    expect(deletes(), "a DELETE left for a conversation the server has not named").toHaveLength(0);

    /* Named, but its answer is still arriving. */
    await act(async () =>
      frame("begin", {
        threadId: "spya-srv001",
        title: "What I took",
        messageId: "spya-srva01",
        questionId: "spya-srvq01",
      }),
    );
    await settle();
    expect(last()?.threadId).toBe("spya-srv001");
    expect(last()?.canStartOver, "offered while the answer was still streaming").toBe(false);

    await act(async () => {
      frame("done", { text: "And here is the answer." });
      answer?.close();
    });
    await settle();
    expect(last()?.canStartOver).toBe(true);

    await act(async () => prop<(id: string) => void>("onDelete")("spya-srv001"));
    await settle();
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0]?.url).toContain("spya-srv001");
    await act(async () => releaseDelete?.(200));
    await settle();
  });

  it("is offered on a stored conversation with nothing in flight", async () => {
    stored = [REMEMBER];
    await mount("remember", "?mode=remember");
    expect(last()?.threadId).toBe(REMEMBER.id);
    expect(last()?.canStartOver).toBe(true);
  });
});

describe("Start over waits for the server", () => {
  it("finishes Live before the DELETE starts, so its final spoken POST cannot race the deletion", async () => {
    stored = [REMEMBER];
    let releaseStop: (() => void) | null = null;
    stopLive.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseStop = resolve;
        }),
    );
    await mount("remember", "?mode=remember");
    livePhase = "live";
    liveThreadId = REMEMBER.id;
    await mount("remember", "?mode=remember");

    await act(async () => {
      prop<(id: string) => void>("onDelete")(REMEMBER.id);
      await Promise.resolve();
    });

    expect(stopLive).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.method === "DELETE"), "DELETE started before Live finished").toHaveLength(0);
    await act(async () => prop<(q: string) => void>("onSend")("This must not leave"));
    expect(calls.filter((c) => c.method === "POST"), "a typed turn escaped while Start over waited").toHaveLength(0);

    livePhase = "idle";
    await act(async () => releaseStop?.());
    await settle();
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);

    await act(async () => releaseDelete?.(200));
    await settle();
  });

  it("offers nowhere to type until the DELETE has resolved, then opens a fresh one", async () => {
    stored = [REMEMBER];
    await mount("remember", "?mode=remember");
    expect(last()?.threadId).toBe(REMEMBER.id);

    await act(async () => prop<(id: string) => void>("onDelete")(REMEMBER.id));
    await settle();
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);

    /* While the DELETE is out: no conversation open, so no composer, and no
       fresh conversation begun for a first question to be sent into — that
       question would be folded into the thread the DELETE is about to remove.
       GPT Sol's plan review, F1. */
    expect(last()?.threadId ?? null).toBeNull();
    expect(shown()).toHaveLength(0);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);

    await act(async () => releaseDelete?.(200));
    await settle();

    const fresh = shown()[0];
    expect(fresh?.kind).toBe("remember");
    expect(fresh?.id).not.toBe(REMEMBER.id);
    expect(fresh?.messages).toHaveLength(0);
    expect(last()?.threadId).toBe(fresh?.id);

    /* And the first question after Start over leaves only now. */
    await act(async () => prop<(q: string) => void>("onSend")("What I remember now"));
    await settle();
    const methods = calls.filter((c) => c.method !== "GET").map((c) => c.method);
    expect(methods).toEqual(["DELETE", "POST"]);
  });

  it("puts the conversation back when the DELETE fails", async () => {
    stored = [REMEMBER];
    await mount("remember", "?mode=remember");
    await act(async () => prop<(id: string) => void>("onDelete")(REMEMBER.id));
    await settle();
    await act(async () => releaseDelete?.(500));
    await settle();
    expect(last()?.threadId).toBe(REMEMBER.id);
    expect(shown().map((t) => t.id)).toEqual([REMEMBER.id]);
    expect(last()?.error).toMatch(/Couldn't delete/);
  });
});
