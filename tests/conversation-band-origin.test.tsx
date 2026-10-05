// @vitest-environment jsdom
/**
 * **A handed-over conversation carries where it was started from, to the
 * server, on its first typed Send** — and to no other conversation.
 * Plan 261005i: D1, and the plan review's F4 and F5.
 *
 * The origin is held beside the conversation's unsent words in the article's
 * draft store (src/web/chat-draft.ts), keyed by conversation id, because the
 * band is unmounted on every mode change and the conversation it began goes
 * with it. So the cases here are the ones that lifetime has to survive: a
 * look at another mode and back, a second handoff, a delete, and a first Send
 * that fails.
 *
 * **Live waits for that first typed Send** (F4). A spoken first turn creates
 * the thread by another route, which carries no origin, and the server sets
 * an origin on insert only: the thread would be left without one for good.
 *
 * The real band and the real `useChat`, with `ChatPanel` stubbed to expose
 * the props it is handed: tests/conversation-band-handoff.test.tsx's harness.
 * What the reader sees is asked in tests/debate-check-claim-in-chat.test.tsx.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread, ThreadOrigin } from "../src/types.js";
import { chatDraftsFor, forgetChatDrafts } from "../src/web/chat-draft.js";
import type { ChatHandoff } from "../src/web/modes/conversation/ConversationModes.js";
import { settleChat } from "./helpers/settle-chat.js";

/** The props the band last handed down. */
let panel: Record<string, unknown> | undefined;

vi.mock("../src/web/ChatPanel.js", () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    panel = props;
    return null;
  },
}));

const posts: { url: string; body: Record<string, unknown> }[] = [];
/** What the list GET answers with. */
let stored: ChatThread[] = [];
/** How the next chat POST is answered. */
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
const CLAIM: ThreadOrigin = { mode: "debate", blockId: "spya-bbbbbb", quote: "RNA can transfer a memory" };
const OTHER: ThreadOrigin = { mode: "debate", blockId: "spya-cccccc", quote: "Memories survive metamorphosis" };
const SEED = "Check this claim";
const LENS: ThreadOrigin = { mode: "debate", lens: "replication attempts" };

/** The server names the rows, answers, and finishes. */
function answered(threadId: string, origin?: unknown): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const frame = (event: string, data: unknown) =>
        c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      frame("begin", {
        threadId,
        ...(origin ? { origin } : {}),
        title: "Check this claim",
        messageId: "spya-rep222",
        questionId: "spya-que222",
        attempt: "att-1",
      });
      frame("done", { text: "It did not replicate.", citations: [], searches: 0, model: "m" });
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const refused = (): Response =>
  new Response(JSON.stringify({ error: "The server fell over" }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  forgetChatDrafts();
  posts.length = 0;
  stored = [];
  panel = undefined;
  onPost = (body) => answered(String(body.threadId), body.origin);
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
        onScreen: () => [],
        handoff,
        onHandoffTaken: () => {},
      }),
    ),
  );
}

async function show(handoff: ChatHandoff | null): Promise<void> {
  await act(async () => root.render(band(handoff)));
  await settleChat();
  await vi.waitFor(() => {
    expect(new URLSearchParams(location.search).get("thread")).toBe(panel?.threadId ?? null);
  });
}

async function mount(handoff: ChatHandoff | null): Promise<void> {
  history.replaceState(null, "", "/a-piece?mode=chat");
  await show(handoff);
}

/** Leave Chat: the band is unmounted, as it is on every mode change. */
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
const open = (): string => prop<string>("threadId");
const drafts = () => chatDraftsFor(SLUG);

async function send(question: string): Promise<void> {
  await act(async () => prop<(q: string) => void>("onSend")(question));
  await settleChat();
}

describe("a conversation handed over with an origin", () => {
  it("keeps the origin beside the conversation, sends nothing, then sends exactly it with the first question", async () => {
    await mount({ slug: SLUG, question: SEED, origin: CLAIM });
    const fresh = open();
    expect(drafts().thread(fresh)).toBe(SEED);
    expect(drafts().origin(fresh)).toEqual(CLAIM);
    expect(posts, "the press sends nothing").toHaveLength(0);

    await send(SEED);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body.threadId).toBe(fresh);
    expect(posts[0]?.body.origin).toEqual(CLAIM);
    expect(posts[0]?.body.kind, "an ordinary chat: no kind on the wire").toBeUndefined();
  });

  it("stops sending the origin once the server has the thread", async () => {
    await mount({ slug: SLUG, question: SEED, origin: CLAIM });
    await send(SEED);
    await send("and who disagrees?");
    expect(posts).toHaveLength(2);
    expect(posts[1]?.body.threadId).toBe(open());
    expect("origin" in (posts[1]?.body ?? {}), "a follow-up carries none").toBe(false);
  });

  it("uses the server's replacement id and stored origin, and forgets the pending entry", async () => {
    onPost = (body) => answered("spya-rgn444", body.origin);
    await mount({ slug: SLUG, question: SEED, origin: CLAIM });
    const guessed = open();
    await send(SEED);
    await vi.waitFor(() => expect(open()).toBe("spya-rgn444"));
    expect(prop<ChatThread[]>("threads").find((t) => t.id === open())?.origin).toEqual(CLAIM);
    expect(drafts().origin(guessed)).toBeUndefined();
    expect(drafts().origin(open())).toBeUndefined();
    await send("Follow up");
    expect(posts[1]?.body.threadId).toBe("spya-rgn444");
    expect(posts[1]?.body.origin).toBeUndefined();
  });

  it("shows the list where the conversation came from at once, before any reload", async () => {
    /* The `begin` frame carries the stored origin; a pending draft does not
       stand in for the server's acknowledgement. */
    await mount({ slug: SLUG, question: SEED, origin: CLAIM });
    const fresh = open();
    const handed = () => prop<ChatThread[]>("threads").find((t) => t.id === fresh);
    expect(handed()?.origin, "not before the server has it").toBeUndefined();
    await send(SEED);
    expect(handed()?.origin).toEqual(CLAIM);
    expect(handed()?.messages.length, "and it is the same conversation").toBeGreaterThan(0);
  });

  it("sends no origin from a conversation that was not handed one", async () => {
    await mount(null);
    await send("an ordinary question");
    expect(posts).toHaveLength(1);
    expect("origin" in (posts[0]?.body ?? {})).toBe(false);
  });

  it("does not share an origin between two handed-over conversations, or with an ordinary one", async () => {
    await mount({ slug: SLUG, question: SEED, origin: CLAIM });
    const first = open();
    await show({ slug: SLUG, question: "Check another", origin: OTHER });
    const second = open();
    expect(second).not.toBe(first);
    expect(drafts().origin(first)).toEqual(CLAIM);
    expect(drafts().origin(second)).toEqual(OTHER);

    await send("Check another");
    expect(posts[0]?.body.threadId).toBe(second);
    expect(posts[0]?.body.origin).toEqual(OTHER);

    /* A third, started from Chat's own button. */
    await act(async () => prop<() => void>("onNew")());
    await settleChat();
    const third = open();
    expect([first, second]).not.toContain(third);
    await send("an ordinary question");
    expect(posts[1]?.body.threadId).toBe(third);
    expect("origin" in (posts[1]?.body ?? {})).toBe(false);

    /* And the first still has its own. */
    await act(async () => prop<(id: string) => void>("onThread")(first));
    await settleChat();
    await send(SEED);
    expect(posts[2]?.body.threadId).toBe(first);
    expect(posts[2]?.body.origin).toEqual(CLAIM);
  });

  it("keeps the origin across a look at another mode, under the conversation begun in its place", async () => {
    await mount({ slug: SLUG, question: SEED, origin: CLAIM });
    const first = open();
    await leave();
    /* Back in Chat: the unsent conversation went with the band, so the arrival
       rule begins another and moves the words across. */
    await show(null);
    const again = open();
    expect(again).not.toBe(first);
    expect(drafts().thread(again)).toBe(SEED);
    expect(drafts().origin(again), "the origin moved with the words").toEqual(CLAIM);
    expect(drafts().origin(first)).toBeUndefined();

    await send(SEED);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body.threadId).toBe(again);
    expect(posts[0]?.body.origin).toEqual(CLAIM);
  });

  it("documents the inherited limit: a lens handoff displaces an unsent chat that cannot be reopened after a mode change", async () => {
    await mount(null);
    const displaced = open();
    drafts().setThread(displaced, "My unfinished question");
    await show({ slug: SLUG, question: "Ask about replication", origin: LENS });
    expect(open()).not.toBe(displaced);
    expect(drafts().thread(displaced), "kept while the band is still mounted").toBe("My unfinished question");
    expect(prop<ChatThread[]>("threads").some((t) => t.id === displaced)).toBe(true);

    await leave();
    await show(null);
    expect(drafts().origin(open()), "only the selected lens draft is restored").toEqual(LENS);
    expect(drafts().thread(open())).toBe("Ask about replication");
    expect(drafts().thread(displaced), "the words survive but have no row to open").toBe("My unfinished question");
    expect(prop<ChatThread[]>("threads").some((t) => t.id === displaced)).toBe(false);
    expect(posts).toHaveLength(0);
  });

  it("forgets the origin with a deleted conversation", async () => {
    await mount({ slug: SLUG, question: SEED, origin: CLAIM });
    const fresh = open();
    await act(async () => prop<(id: string) => void>("onDelete")(fresh));
    await settleChat();
    expect(drafts().origin(fresh)).toBeUndefined();
  });

  it("keeps a claim's origin on returning to Chat after the reader cleared the seed", async () => {
    await mount({ slug: SLUG, question: SEED, origin: CLAIM });
    const fresh = open();
    drafts().setThread(fresh, "");
    await leave();
    await show(null);
    expect(drafts().origin(open())).toEqual(CLAIM);
    await send("My own question about that claim");
    expect(posts[0]?.body.origin).toEqual(CLAIM);
  });

  it("does not overlay a refused origin on an existing plain thread after returning to Chat", async () => {
    await mount({ slug: SLUG, question: SEED, origin: CLAIM });
    const fresh = open();
    // Another creator won this id, so the server refuses our origin.
    stored = [{ id: fresh, kind: "chat", title: "Plain chat", createdAt: "2026-10-05T10:00:00Z",
      updatedAt: "2026-10-05T10:00:00Z", messages: [] }];
    onPost = () => new Response(JSON.stringify({ error: "That conversation was not started from that item" }),
      { status: 409, headers: { "content-type": "application/json" } });
    await send(SEED);
    await leave();
    await show(null);
    expect(prop<ChatThread[]>("threads").find((t) => t.id === fresh)?.origin).toBeUndefined();
  });

  it("keeps the origin after a first Send that failed, and sends it again", async () => {
    onPost = refused;
    await mount({ slug: SLUG, question: SEED, origin: CLAIM });
    const fresh = open();
    await send(SEED);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body.origin).toEqual(CLAIM);
    expect(drafts().origin(open()), "the server has no thread, so it is still pending").toEqual(CLAIM);

    onPost = (body) => answered(String(body.threadId), body.origin);
    await send(SEED);
    expect(posts).toHaveLength(2);
    expect(posts[1]?.body.threadId).toBe(fresh);
    expect(posts[1]?.body.origin, "the second attempt creates the thread, so it carries it").toEqual(CLAIM);
  });

  it("keeps the pending origin and id after a failed first Send followed by leaving Chat", async () => {
    onPost = refused;
    await mount({ slug: SLUG, question: SEED, origin: CLAIM });
    const fresh = open();
    await send(SEED);
    await leave();
    await show(null);
    expect(open(), "a possibly stored first turn must still use its original thread id").toBe(fresh);
    expect(drafts().origin(open())).toEqual(CLAIM);
    onPost = (body) => answered(String(body.threadId), body.origin);
    await send("Try again");
    expect(posts[1]?.body.threadId).toBe(fresh);
    expect(posts[1]?.body.origin).toEqual(CLAIM);
  });

  it("forgets a pending guess when the server corrects its id after leaving Chat", async () => {
    let release!: (response: Response) => void;
    onPost = () => new Promise((resolve) => { release = resolve; });
    await mount({ slug: SLUG, question: SEED, origin: CLAIM });
    const guessed = open();
    await send(SEED);
    await leave();
    stored = [{ id: "spya-rgn444", kind: "chat", title: SEED, origin: CLAIM,
      createdAt: "2026-10-05T10:00:00Z", updatedAt: "2026-10-05T10:00:00Z", messages: [] }];
    await act(async () => release(answered("spya-rgn444", CLAIM)));
    await settleChat();
    await show(null);
    expect(drafts().origin(guessed)).toBeUndefined();
    expect(prop<ChatThread[]>("threads").some((t) => t.id === guessed)).toBe(false);
  });

  it("keeps an explicit choice of another chat while a submitted origin draft is missing", async () => {
    onPost = refused;
    await mount({ slug: SLUG, question: SEED, origin: CLAIM });
    await send(SEED);
    await leave();
    stored = [{ id: "spya-rgn555", kind: "chat", title: "Another chat",
      createdAt: "2026-10-05T10:00:00Z", updatedAt: "2026-10-05T10:00:00Z", messages: [] }];
    history.replaceState(null, "", "/a-piece?mode=chat&thread=spya-rgn555");
    await show(null);
    expect(open()).toBe("spya-rgn555");
  });
});

describe("Live on a handed-over conversation", () => {
  const startLive = () => prop<(id: string | null) => string | undefined>("onStartLive");

  it("is offered on an ordinary conversation", async () => {
    await mount(null);
    expect(panel?.live, "the control").toBeDefined();
  });

  it.each([CLAIM, LENS])("is not offered, and its start is refused, until the first typed Send has landed (%j)", async (origin) => {
    await mount({ slug: SLUG, question: SEED, origin });
    const fresh = open();
    expect(panel?.live, "no Live control while the origin is pending").toBeUndefined();
    let started: string | undefined = "unset";
    await act(async () => {
      started = startLive()(fresh);
    });
    await settleChat();
    expect(started, "and the callback starts nothing").toBeUndefined();
    expect(posts, "nothing was written by voice").toHaveLength(0);
    expect(open(), "the conversation is still the open one").toBe(fresh);

    await send(SEED);
    expect(posts[0]?.body.origin).toEqual(origin);
    expect(panel?.live, "offered once the server has the thread and its origin").toBeDefined();
  });

  it("stays withheld after a first Send that failed", async () => {
    onPost = refused;
    await mount({ slug: SLUG, question: SEED, origin: CLAIM });
    await send(SEED);
    expect(panel?.live).toBeUndefined();
  });
});
