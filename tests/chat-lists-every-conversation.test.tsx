// @vitest-environment jsdom
/**
 * **Chat lists every conversation about the article, and opens only its own.**
 *
 * Report `spya-hyfqkq`; plan
 * docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md,
 * D5, and its review's F3 and F6.
 *
 * Two sets, and the difference is the point (F3): `listed` is what the list
 * draws, every kind but Candidates; `threads` is what the band may open,
 * `chat`-kind only. The band sends the blocks on screen with every question,
 * which the server refuses on any other kind, so a Recall conversation must
 * never become the open one here, whatever `?thread=` says.
 *
 * The real band and the real `useChat`, recording the panel's props. The Send
 * case also draws the real panel and presses its composer. The rest of what
 * the panel draws is tests/chat-list-sources.test.tsx.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread, ThreadKind } from "../src/types.js";
import { chatDraftsFor, forgetChatDrafts } from "../src/web/chat-draft.js";

/** Every set of props the band handed the panel, in order. */
const renders: Record<string, unknown>[] = [];
const last = (): Record<string, unknown> | undefined => renders.at(-1);
let drawPanel = false;

vi.mock("../src/web/ChatPanel.js", async () => {
  const { ChatPanel } = await vi.importActual<typeof import("../src/web/ChatPanel.js")>("../src/web/ChatPanel.js");
  return {
    ChatPanel: (props: Record<string, unknown>) => {
      renders.push(props);
      return drawPanel ? createElement(ChatPanel, props as unknown as Parameters<typeof ChatPanel>[0]) : null;
    },
  };
});

const posts: Record<string, unknown>[] = [];
/** What the list GET answers with. */
let stored: ChatThread[] = [];

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return {
    ...real,
    apiFetch: (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        posts.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        /* An answer that never says anything: these tests are about where a
           question goes, not what comes back. */
        return Promise.resolve(
          new Response(new ReadableStream<Uint8Array>({ start() {} }), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ threads: stored }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  };
});

vi.mock("../src/web/live/useLive.js", () => ({
  useLive: () => ({
    phase: "idle", threadId: null, error: null, lines: [], pointers: [], tools: [],
    hearing: false, speaking: false, thinking: false, seen: {}, pendingTools: [],
    placement: null, deviceLabel: null, inputLevel: { current: 0 },
    measuringInput: false, quietInput: false, playbackBlocked: false,
    notice: null, hasUnsavedLines: false, stall: null, step: null,
    reconnecting: false, talkMode: "hands-free",
    stop: vi.fn(() => Promise.resolve()), start: vi.fn(), say: vi.fn(),
    enableAudio: vi.fn(() => Promise.resolve()), reconnect: vi.fn(),
    enterTapToTalk: vi.fn(), talk: vi.fn(), doneTalking: vi.fn(),
  }),
}));

const { ConversationBand } = await import("../src/web/modes/conversation/ConversationModes.js");

const SLUG = "a-piece";
const AT = "2026-09-20T10:00:00.000Z";

function thread(id: string, kind: ThreadKind, over: Partial<ChatThread> = {}): ChatThread {
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

/* Ids the address will accept: `?thread=` is parsed as a block id, whose
   alphabet has no 1, i, l or o (src/ids.ts). One that fails to parse reads as
   no thread at all, and every case below about a pasted id would pass idly. */
const CHAT = thread("spya-chat22", "chat");
const LEARN = thread("spya-rem022", "learn");
const TUTORIAL = thread("spya-tut023", "tutorial");
const EXPLORE = thread("spya-exp024", "explore");
const CANDIDATES = thread("spya-can025", "candidates");

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  renders.length = 0;
  drawPanel = false;
  posts.length = 0;
  stored = [];
  forgetChatDrafts();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  /* nuqs batches its history writes on a 50 ms throttle; let the queue flush
     while jsdom still owns `location`. */
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

/** Long enough for nuqs to have written the address. */
async function written(): Promise<void> {
  await act(async () => {
    await new Promise((go) => setTimeout(go, 80));
  });
  await settle(2);
}

function param(key: string): string | null {
  return new URLSearchParams(location.search).get(key);
}

async function mount(search: string): Promise<void> {
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
            kind: "chat",
            onScreen: () => [],
          }),
        ),
      ),
    ),
  );
  await settle();
}

const ids = (name: "threads" | "listed", props = last()): string[] =>
  ((props?.[name] as ChatThread[] | undefined) ?? []).map((t) => t.id);

function prop<T>(name: string): T {
  const value = last()?.[name];
  if (value === undefined) throw new Error(`the band handed the panel no ${name}`);
  return value as T;
}

describe("what Chat lists", () => {
  it("lists Recall, Tutorial and Explore beside the chats, and never Candidates", async () => {
    stored = [CHAT, LEARN, TUTORIAL, EXPLORE, CANDIDATES];
    await mount("?mode=chat");
    expect(ids("listed").sort()).toEqual([CHAT.id, LEARN.id, TUTORIAL.id, EXPLORE.id].sort());
    for (const props of renders) expect(ids("listed", props)).not.toContain(CANDIDATES.id);
  });
});

describe("what Chat may open is only its own kind (F3)", () => {
  it("hands the panel only chat-kind conversations to open, on every render", async () => {
    stored = [CHAT, LEARN, TUTORIAL, EXPLORE, CANDIDATES];
    await mount("?mode=chat");
    expect(ids("threads")).toEqual([CHAT.id]);
    for (const props of renders) {
      for (const t of (props.threads as ChatThread[] | undefined) ?? []) expect(t.kind).toBe("chat");
    }
  });

  it("shows the list and clears a `?thread=` that names a Recall conversation, by replace", async () => {
    stored = [CHAT, LEARN];
    await mount(`?mode=chat&thread=${LEARN.id}`);
    const before = history.length;
    await written();
    /* Never openable, at any point: the panel opens what `threadId` names
       among `threads`, and a Recall conversation is not among them. */
    for (const props of renders) expect(ids("threads", props)).not.toContain(LEARN.id);
    expect(param("thread")).toBeNull();
    expect(last()?.threadId ?? null).toBeNull();
    expect(history.length, "clearing it was a step on the Back stack").toBe(before);
    /* The list is what is left, with the chat that was already there: no
       blank conversation was begun over it. */
    expect(ids("listed").sort()).toEqual([CHAT.id, LEARN.id].sort());
    expect(ids("threads")).toEqual([CHAT.id]);
    expect(param("mode")).toBe("chat");
  });

  it("does the same for a pasted Tutorial or Explore id", async () => {
    stored = [CHAT, TUTORIAL, EXPLORE];
    await mount(`?mode=chat&thread=${EXPLORE.id}`);
    await written();
    expect(param("thread")).toBeNull();
    expect(ids("threads")).toEqual([CHAT.id]);
  });

  it("leaves a `?thread=` naming a chat alone", async () => {
    stored = [CHAT, LEARN];
    await mount(`?mode=chat&thread=${CHAT.id}`);
    await written();
    expect(param("thread")).toBe(CHAT.id);
    expect(last()?.threadId).toBe(CHAT.id);
  });

  it("shows the list for a non-chat URL even when an older chat has unsent words", async () => {
    stored = [CHAT, LEARN];
    const drafts = chatDraftsFor(SLUG);
    drafts.setDestination(CHAT.id);
    drafts.setThread(CHAT.id, "A follow-up I have not sent");
    await mount(`?mode=chat&thread=${LEARN.id}`);
    await written();
    expect(param("thread")).toBeNull();
    expect(last()?.threadId ?? null).toBeNull();
    expect(drafts.thread(CHAT.id)).toBe("A follow-up I have not sent");
  });

  it.each([false, true])("keeps a missing origin draft on the list when a non-chat URL wins (submitted: %s)", async (submitted) => {
    stored = [LEARN];
    const drafts = chatDraftsFor(SLUG);
    const was = "spya-draft2";
    const origin = { mode: "debate" as const, blockId: "spya-bbbbbb", quote: "A claim to check" };
    drafts.setDestination(was);
    drafts.setThread(was, "Check this claim");
    drafts.setOrigin(was, origin);
    drafts.markFresh(was);
    if (submitted) drafts.submitted(was);
    await mount(`?mode=chat&thread=${LEARN.id}`);
    await written();
    expect(param("thread")).toBeNull();
    expect(last()?.threadId ?? null).toBeNull();
    const recovered = prop<ChatThread[]>("threads")[0];
    if (!recovered) throw new Error("the held draft has no row");
    expect(recovered.kind).toBe("chat");
    const id = recovered.id;
    expect(drafts.thread(id)).toBe("Check this claim");
    expect(drafts.origin(id)).toEqual(origin);
    if (submitted) expect(id).toBe(was);
    await act(async () => prop<(id: string) => void>("onThread")(id));
    await settle();
    expect(last()?.onStartLive).toBeTypeOf("function");
    expect(last()?.live).toBeUndefined();
    await act(async () => prop<(q: string) => void>("onSend")("Check this claim"));
    expect(posts).toHaveLength(1);
    expect(posts[0]?.threadId).toBe(id);
    expect(posts[0]?.origin).toEqual(origin);
  });

  it("never sends a question into a conversation of another kind", async () => {
    drawPanel = true;
    stored = [CHAT, LEARN];
    await mount(`?mode=chat&thread=${LEARN.id}`);
    /* Exercise the actual composer's wiring, rather than calling onSendNew
       directly: that callback mints regardless of what the panel opened. */
    const box = host.querySelector<HTMLTextAreaElement>("textarea.chat-input");
    expect(box).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, "A new question");
      box?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => box?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await settle();
    expect(posts).toHaveLength(1);
    expect(posts[0]?.threadId).not.toBe(LEARN.id);
    /* Chat is the default kind and may go unsaid. */
    expect(posts[0]?.kind ?? "chat").toBe("chat");
  });
});

describe("an article whose only conversations are Learn's", () => {
  it("shows their rows and does not start a blank chat over them", async () => {
    stored = [LEARN, TUTORIAL];
    await mount("?mode=chat");
    await written();
    expect(ids("listed").sort()).toEqual([LEARN.id, TUTORIAL.id].sort());
    for (const props of renders) expect(ids("threads", props), "a blank chat was begun").toEqual([]);
    expect(last()?.threadId ?? null).toBeNull();
    expect(param("thread")).toBeNull();
  });

  it("still starts a new chat when the reader asks for one", async () => {
    stored = [LEARN];
    await mount("?mode=chat");
    await act(async () => prop<() => void>("onNew")());
    await settle();
    const opened = last()?.threads as ChatThread[];
    expect(opened).toHaveLength(1);
    expect(opened[0]?.kind).toBe("chat");
    expect(last()?.threadId).toBe(opened[0]?.id);
    expect(ids("listed")).toContain(LEARN.id);
  });

  it("an article with no conversation at all still opens a fresh chat on arrival", async () => {
    stored = [];
    await mount("?mode=chat");
    const opened = last()?.threads as ChatThread[];
    expect(opened).toHaveLength(1);
    expect(opened[0]?.kind).toBe("chat");
    expect(last()?.threadId).toBe(opened[0]?.id);
  });
});

describe("pressing a Learn row goes to Learn", () => {
  it("keeps the row's id when pressed before a rejected URL has flushed", async () => {
    stored = [CHAT, LEARN, TUTORIAL];
    await mount(`?mode=chat&thread=${LEARN.id}`);
    await act(async () => prop<(view: string, id: string) => void>("onOpenLearn")("tutorial", TUTORIAL.id));
    await written();
    expect(param("mode")).toBe("learn");
    expect(param("learn")).toBe("tutorial");
    expect(param("thread")).toBe(TUTORIAL.id);
  });

  it("sets mode, sub-mode and thread in one navigation", async () => {
    stored = [CHAT, LEARN, TUTORIAL];
    await mount("?mode=chat");
    await written();
    const before = history.length;
    await act(async () => prop<(view: string, id: string) => void>("onOpenLearn")("tutorial", TUTORIAL.id));
    await written();
    expect(param("mode")).toBe("learn");
    expect(param("learn")).toBe("tutorial");
    expect(param("thread")).toBe(TUTORIAL.id);
    expect(history.length, "one entry, so Back is one press").toBe(before + 1);
  });

  it("goes to Recall for a Recall conversation", async () => {
    stored = [CHAT, LEARN];
    await mount("?mode=chat&learn=quiz");
    await written();
    await act(async () => prop<(view: string, id: string) => void>("onOpenLearn")("recall", LEARN.id));
    await written();
    expect(param("mode")).toBe("learn");
    /* Recall is the default and is written as absent. */
    expect(param("learn")).toBeNull();
    expect(param("thread")).toBe(LEARN.id);
  });
});

describe("the filter is a parameter of its own (F6)", () => {
  it("is All when the address says nothing", async () => {
    stored = [CHAT, LEARN];
    await mount("?mode=chat");
    expect(last()?.from ?? null).toBeNull();
  });

  it("comes back from the address after a reload", async () => {
    stored = [CHAT, LEARN];
    await mount("?mode=chat&chatfrom=learn");
    await written();
    expect(last()?.from).toBe("learn");
    expect(param("chatfrom")).toBe("learn");
    /* The filter narrows what is drawn, not what is listed or may open. */
    expect(ids("listed").sort()).toEqual([CHAT.id, LEARN.id].sort());
  });

  it("is written by a press, and removed by All", async () => {
    stored = [CHAT, LEARN];
    await mount("?mode=chat");
    await act(async () => prop<(from: string | null) => void>("onFrom")("chats"));
    await written();
    expect(param("chatfrom")).toBe("chats");
    expect(last()?.from).toBe("chats");
    await act(async () => prop<(from: string | null) => void>("onFrom")(null));
    await written();
    expect(param("chatfrom")).toBeNull();
    expect(last()?.from ?? null).toBeNull();
  });

  it("is still there after going to Learn and pressing Back", async () => {
    stored = [CHAT, LEARN];
    await mount("?mode=chat&chatfrom=learn");
    await written();
    await act(async () => prop<(view: string, id: string) => void>("onOpenLearn")("recall", LEARN.id));
    await written();
    expect(param("mode")).toBe("learn");
    await act(async () => {
      history.back();
      await new Promise((go) => setTimeout(go, 50));
    });
    await written();
    expect(param("mode")).toBe("chat");
    expect(param("chatfrom")).toBe("learn");
    expect(last()?.from).toBe("learn");
  });

  it("is replaced with All when this article has no conversation from that source", async () => {
    stored = [CHAT, LEARN];
    await mount("?mode=chat&chatfrom=debate");
    const before = history.length;
    await written();
    expect(param("chatfrom")).toBeNull();
    expect(last()?.from ?? null).toBeNull();
    expect(history.length).toBe(before);
  });

  it("is not thrown away before the list has answered", async () => {
    stored = [CHAT, LEARN];
    await mount("?mode=chat&chatfrom=learn");
    /* Every render, the unloaded first one included, kept the choice. */
    for (const props of renders) expect(props.from).toBe("learn");
  });
});
