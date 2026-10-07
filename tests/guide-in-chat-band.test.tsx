// @vitest-environment jsdom
/**
 * **The guide in Chat's band** — plan
 * docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md,
 * stage 2, and GPT Sol's F2 on it: *openable in Chat* is its own idea, the
 * kind a send carries is the open conversation's (or the handoff target's),
 * never the band's, and `visible` goes with a chat alone.
 *
 * - the pinned row is handed down whether or not the guide exists;
 * - the stored guide is opened, and a send to it is a `guide` turn with no
 *   blocks on screen, while a chat's send is unchanged;
 * - with no guide, one is begun here and the server's id for it is taken;
 * - `?guide=1` opens the guide, existing or not, and round-trips to
 *   `?thread=<id>`;
 * - an ordinary *Ask in chat* while the guide is open still starts a fresh
 *   chat, and a handoff that targets the guide goes to the guide while a chat
 *   is open;
 * - the guide's unsent words come back after a mode change, under the same
 *   guide, stored or begun here;
 * - no Live in the guide.
 *
 * The real band and the real `useChat`, with `ChatPanel` stubbed to expose
 * the props it is handed: tests/conversation-band-origin.test.tsx's harness.
 * What the panel draws for the guide is tests/guide-in-chat-panel.test.tsx.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread, ThreadKind } from "../src/types.js";
import { chatDraftsFor, forgetChatDrafts } from "../src/web/chat-draft.js";
import type { ChatHandoff } from "../src/web/modes/conversation/ConversationModes.js";
import { settleChat } from "./helpers/settle-chat.js";

let panel: Record<string, unknown> | undefined;

vi.mock("../src/web/ChatPanel.js", () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    panel = props;
    return null;
  },
}));

const posts: { url: string; body: Record<string, unknown> }[] = [];
let stored: ChatThread[] = [];
let onPost: (body: Record<string, unknown>) => Response | Promise<Response>;

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return {
    ...real,
    apiFetch: (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        posts.push({ url: String(url), body });
        return Promise.resolve(onPost(body));
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

const { ConversationBand } = await import("../src/web/modes/conversation/ConversationModes.js");

const SLUG = "a-piece";
const AT = "2026-10-07T09:00:00.000Z";
/** What a chat's send carries as on screen; a guide's must carry none. */
const ON_SCREEN = ["spya-k3m9qt"];

function thread(id: string, kind: ThreadKind, said = true): ChatThread {
  return {
    id,
    kind,
    title: kind === "guide" ? "Where should I start?" : `A question in ${id}`,
    createdAt: AT,
    updatedAt: AT,
    messages: said
      ? [
          { id: `${id.slice(0, 9)}q`, role: "user", text: "said", createdAt: AT, status: "done" },
          { id: `${id.slice(0, 9)}a`, role: "assistant", text: "answered", createdAt: AT, status: "done" },
        ]
      : [],
  };
}

const GUIDE = thread("spya-gdeaaa", "guide");
const CHAT = thread("spya-chtaaa", "chat");

/** The server names the conversation (perhaps not as this tab did), answers, and finishes. */
function answered(threadId: string): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const frame = (event: string, data: unknown) =>
        c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      frame("begin", {
        threadId,
        title: "Where should I start?",
        messageId: "spya-rep333",
        questionId: "spya-que333",
        attempt: "att-1",
      });
      frame("done", { text: "Start with the Methods.", citations: [], searches: 0, model: "m" });
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  forgetChatDrafts();
  posts.length = 0;
  stored = [];
  panel = undefined;
  onPost = (body) => answered(String(body.threadId));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function band(handoff: ChatHandoff | null) {
  return createElement(
    StrictMode,
    null,
    createElement(
      NuqsAdapter,
      null,
      createElement(ConversationBand, {
        slug: SLUG,
        blocks: new Map<string, string>(),
        onJump: () => {},
        kind: "chat" as const,
        onScreen: () => ON_SCREEN,
        handoff,
        onHandoffTaken: () => {},
      }),
    ),
  );
}

const param = (name: string): string | null => new URLSearchParams(location.search).get(name);

async function show(handoff: ChatHandoff | null = null): Promise<void> {
  await act(async () => root.render(band(handoff)));
  await settleChat();
  await vi.waitFor(() => {
    expect(param("thread")).toBe(panel?.threadId ?? null);
  });
}

async function mount(search = "?mode=chat", handoff: ChatHandoff | null = null): Promise<void> {
  history.replaceState(null, "", `/a-piece${search}`);
  await show(handoff);
}

async function leave(): Promise<void> {
  await act(async () => root.unmount());
  panel = undefined;
  root = createRoot(host);
}

function prop<T>(name: string): T {
  const value = panel?.[name];
  if (value === undefined) throw new Error(`the band handed the panel no ${name}`);
  return value as T;
}
const threads = (): ChatThread[] => prop<ChatThread[]>("threads");
const guides = (): ChatThread[] => threads().filter((t) => t.kind === "guide");
const pinned = () => prop<{ thread: ChatThread | null; onOpen(): void }>("guide");

async function openGuide(): Promise<void> {
  await act(async () => pinned().onOpen());
  await settleChat();
}

async function send(question: string): Promise<void> {
  await act(async () => prop<(q: string) => void>("onSend")(question));
  await settleChat();
}

describe("the guide's pinned row", () => {
  it("is handed down before the guide exists, and names the stored one once it does", async () => {
    await mount();
    expect(pinned().thread).toBeNull();
    await leave();
    stored = [GUIDE, CHAT];
    await mount();
    expect(pinned().thread?.id).toBe(GUIDE.id);
    /* Not among Chat's listed rows: it is pinned, not listed. */
    expect(prop<ChatThread[]>("listed").map((t) => t.id)).toEqual([CHAT.id]);
  });
});

describe("sending in the guide", () => {
  it("opens the stored guide and sends a guide turn, with nothing on screen", async () => {
    stored = [GUIDE, CHAT];
    await mount();
    await openGuide();
    expect(panel?.threadId).toBe(GUIDE.id);
    await send("Where next?");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ question: "Where next?", threadId: GUIDE.id, kind: "guide" });
    expect(posts[0]?.body).not.toHaveProperty("visible");
  });

  it("leaves a chat's send as it was: no kind, and the blocks on screen", async () => {
    stored = [GUIDE, CHAT];
    await mount(`?mode=chat&thread=${CHAT.id}`);
    await send("What does it say?");
    expect(posts[0]?.body).toMatchObject({ threadId: CHAT.id, visible: ON_SCREEN });
    expect(posts[0]?.body).not.toHaveProperty("kind");
  });

  it("begins one when there is none, and takes the server's id for it", async () => {
    await mount();
    await openGuide();
    expect(guides()).toHaveLength(1);
    const local = guides()[0] as ChatThread;
    expect(panel?.threadId).toBe(local.id);
    /* The server already held a guide for this article and folded the turn
       into it (src/chat.ts § `targetOf`): its `begin` frame names that one. */
    onPost = () => answered("spya-gdsrv9");
    await send("Where should I start?");
    expect(posts[0]?.body).toMatchObject({ threadId: local.id, kind: "guide" });
    expect(posts[0]?.body).not.toHaveProperty("visible");
    await vi.waitFor(() => expect(param("thread")).toBe("spya-gdsrv9"));
    expect(panel?.threadId).toBe("spya-gdsrv9");
  });

  it("offers no Live in the guide, and refuses to start one there", async () => {
    stored = [GUIDE, CHAT];
    await mount(`?mode=chat&thread=${CHAT.id}`);
    expect(panel?.live).toBeDefined();
    await openGuide();
    expect(panel?.live).toBeUndefined();
    const start = prop<(id: string | null) => string | undefined>("onStartLive");
    expect(start(GUIDE.id)).toBeUndefined();
  });

  it("edits with the open guide's rules, never Chat's visible blocks", async () => {
    stored = [GUIDE, CHAT];
    await mount(`?mode=chat&thread=${GUIDE.id}`);
    const question = GUIDE.messages[0];
    if (!question) throw new Error("the guide fixture needs a question");
    await act(async () => prop<(id: string, text: string) => void>("onEdit")(question.id, "Where first?"));
    await settleChat();
    expect(posts[0]?.body).toMatchObject({ threadId: GUIDE.id, edit: question.id, question: "Where first?" });
    expect(posts[0]?.body).not.toHaveProperty("visible");
    expect(posts[0]?.body).not.toHaveProperty("kind");
  });

  it("keeps a chat edit's visible blocks unchanged", async () => {
    stored = [GUIDE, CHAT];
    await mount(`?mode=chat&thread=${CHAT.id}`);
    const question = CHAT.messages[0];
    if (!question) throw new Error("the chat fixture needs a question");
    await act(async () => prop<(id: string, text: string) => void>("onEdit")(question.id, "What does it say?"));
    await settleChat();
    expect(posts[0]?.body).toMatchObject({ threadId: CHAT.id, edit: question.id, visible: ON_SCREEN });
  });
});

describe("deleting the guide", () => {
  it("returns to Chat's list and leaves the pinned way to begin it again", async () => {
    stored = [GUIDE, CHAT];
    await mount(`?mode=chat&thread=${GUIDE.id}`);
    await act(async () => prop<(id: string) => void>("onDelete")(GUIDE.id));
    await settleChat();
    expect(panel?.threadId).toBeNull();
    expect(guides()).toHaveLength(0);
    expect(pinned().thread).toBeNull();
  });
});

describe("?guide=1", () => {
  it("opens the stored guide and becomes ?thread=<its id>", async () => {
    stored = [GUIDE, CHAT];
    await mount("?mode=chat&guide=1");
    await vi.waitFor(() => expect(param("guide")).toBeNull());
    expect(param("thread")).toBe(GUIDE.id);
    expect(panel?.threadId).toBe(GUIDE.id);
    expect(guides()).toHaveLength(1);
  });

  it("begins one guide, not two, when there is none", async () => {
    stored = [CHAT];
    await mount("?mode=chat&guide=1");
    await vi.waitFor(() => expect(param("guide")).toBeNull());
    expect(guides()).toHaveLength(1);
    expect(panel?.threadId).toBe(guides()[0]?.id);
    expect(posts, "opening spends nothing").toHaveLength(0);
  });
});

describe("handoffs and the guide", () => {
  it("starts a fresh chat for an ordinary Ask in chat, even with the guide open", async () => {
    stored = [GUIDE, CHAT];
    await mount(`?mode=chat&thread=${GUIDE.id}`);
    expect(panel?.threadId).toBe(GUIDE.id);
    await show({ slug: SLUG, target: "chat", question: "What is an axiom?", send: true });
    expect(posts).toHaveLength(1);
    const body = posts[0]?.body ?? {};
    expect(body.threadId).not.toBe(GUIDE.id);
    expect(body.threadId).not.toBe(CHAT.id);
    expect(body).not.toHaveProperty("kind");
    expect(body.visible).toEqual(ON_SCREEN);
  });

  it("sends to the guide a handoff that targets it, with a chat open", async () => {
    stored = [GUIDE, CHAT];
    await mount(`?mode=chat&thread=${CHAT.id}`);
    await show({ slug: SLUG, target: "guide", question: "Where should I start?", send: true });
    expect(posts, "one press, one model call").toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ threadId: GUIDE.id, kind: "guide", question: "Where should I start?" });
    expect(posts[0]?.body).not.toHaveProperty("visible");
    expect(panel?.threadId).toBe(GUIDE.id);
  });

  it("begins the guide for a handoff that targets it when there is none, and sends once", async () => {
    stored = [CHAT];
    await mount("?mode=chat", { slug: SLUG, target: "guide", question: "Where should I start?", send: true });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ kind: "guide", question: "Where should I start?" });
    expect(guides()).toHaveLength(1);
  });

  it("leaves a waiting guide handoff in the guide's box, and sends nothing", async () => {
    stored = [GUIDE, CHAT];
    await mount("?mode=chat", { slug: SLUG, target: "guide", question: "Where should I start?", send: false });
    expect(posts).toHaveLength(0);
    expect(panel?.threadId).toBe(GUIDE.id);
    expect(chatDraftsFor(SLUG).thread(GUIDE.id)).toBe("Where should I start?");
  });
});

describe("the guide's unsent words across a mode change", () => {
  it("puts the reader back in the stored guide with them", async () => {
    stored = [GUIDE, CHAT];
    await mount();
    await openGuide();
    chatDraftsFor(SLUG).setThread(GUIDE.id, "half a thought");
    await leave();
    history.replaceState(null, "", "/a-piece?mode=chat");
    await show();
    expect(panel?.threadId).toBe(GUIDE.id);
    expect(chatDraftsFor(SLUG).thread(GUIDE.id)).toBe("half a thought");
  });

  it("begins a guide this tab began again under the same id, never as a chat", async () => {
    stored = [CHAT];
    await mount();
    await openGuide();
    const local = guides()[0]?.id as string;
    chatDraftsFor(SLUG).setThread(local, "half a thought");
    await leave();
    history.replaceState(null, "", "/a-piece?mode=chat");
    await show();
    expect(panel?.threadId).toBe(local);
    expect(threads().find((t) => t.id === local)?.kind).toBe("guide");
    expect(chatDraftsFor(SLUG).thread(local)).toBe("half a thought");
  });

  it("follows the stored guide when its id is corrected after the band has gone", async () => {
    stored = [CHAT];
    let answer: ((response: Response) => void) | undefined;
    onPost = () => new Promise<Response>((resolve) => {
      answer = resolve;
    });
    await mount();
    await openGuide();
    const local = guides()[0]?.id as string;
    await send("Where should I start?");
    expect(posts).toHaveLength(1);

    /* A mode change unmounts the band before the singleton correction arrives. */
    await leave();
    const storedGuide = thread("spya-gdsrv9", "guide");
    answer?.(answered(storedGuide.id));
    await settleChat();

    stored = [storedGuide, CHAT];
    history.replaceState(null, "", `/a-piece?mode=chat&thread=${local}`);
    await show();
    expect(panel?.threadId).toBe(storedGuide.id);
    expect(param("thread")).toBe(storedGuide.id);
  });
});
