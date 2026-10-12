// @vitest-environment jsdom
/**
 * **Chat's @-mentions, from the hook to the wire and back** — plan
 * docs/plans/261012d-chat-at-mention-your-own-articles.md § 1 and § 4, the
 * client half.
 *
 * - The "Bringing in" row reaches the server as `mentions` on a new question,
 *   and only there: a retry and an edit carry none (the server refuses both).
 * - The row is told to empty once the server has begun the turn, and not when
 *   the server refused the question.
 * - `mentioned`, from the `begin` frame and from the thread list, is laid over
 *   the thread the panel draws.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThreadView, MentionedArticleView } from "../src/types.js";
import { settleChat } from "./helpers/settle-chat.js";

let answer: (url: string, init?: RequestInit) => Promise<Response>;

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return { ...real, apiFetch: (url: string, init?: RequestInit) => answer(String(url), init) };
});

const { useChat } = await import("../src/web/useChat.js");

const SLUG = "an-article";
const SMITH: MentionedArticleView = {
  available: true,
  title: "Smith 2024",
  slug: "smith-2024",
  blockIds: ["spya-smth23"],
};

let container: HTMLDivElement;
let root: Root;
let chat: ReturnType<typeof useChat> | undefined;
let posts: Record<string, unknown>[] = [];
let threads: ChatThreadView[] = [];
/** What the next POST answers: a stream with these frames, or a refusal. */
let reply: { frames: string } | { status: number; error: string };
/** How many times an uncertain outcome let the composer's row go. */
let rowLetGo = 0;

function Harness() {
  chat = useChat(SLUG);
  return null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function frames(begin: Record<string, unknown>): string {
  return (
    `event: begin\ndata: ${JSON.stringify(begin)}\n\n` +
    `event: done\ndata: ${JSON.stringify({ text: "An answer." })}\n\n`
  );
}

async function mount(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Harness));
  });
  await settleChat();
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  chat = undefined;
  posts = [];
  threads = [];
  reply = { frames: "" };
  rowLetGo = 0;
  answer = (_url, init) => {
    if ((init?.method ?? "GET") === "GET") return Promise.resolve(json({ threads }));
    posts.push(init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {});
    if ("status" in reply) return Promise.resolve(json({ error: reply.error }, reply.status));
    return Promise.resolve(new Response(reply.frames, { status: 200 }));
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("mentions on the wire", () => {
  it("sends the row's slugs with a new question", async () => {
    await mount();
    await act(async () => {
      chat?.send(null, "compare them", null, {
        kind: "chat",
        mentions: { slugs: ["smith-2024"], onAccepted: () => {} },
      });
    });
    await settleChat();
    expect(posts[0]?.mentions).toEqual(["smith-2024"]);
  });

  it("calls onAccepted on the begin frame, and lays its `mentioned` over the thread", async () => {
    await mount();
    let accepted = 0;
    /* The server's own name for the conversation, so the frame renames it too. */
    reply = {
      frames: frames({
        threadId: "spya-thrd99",
        title: "compare them",
        messageId: "spya-rep222",
        questionId: "spya-qst222",
        mentioned: [SMITH],
      }),
    };
    await act(async () => {
      chat?.send(null, "compare them", null, {
        kind: "chat",
        mentions: { slugs: ["smith-2024"], onAccepted: () => accepted++ },
      });
    });
    await settleChat();
    expect(accepted).toBe(1);
    expect(chat?.threads.find((t) => t.id === "spya-thrd99")?.mentioned).toEqual([SMITH]);
  });

  it("does not empty the row when the server refuses the question", async () => {
    await mount();
    let accepted = 0;
    let refused = 0;
    let unconfirmed: string | null = null;
    reply = { status: 400, error: "That is the article you have open." };
    await act(async () => {
      chat?.send(null, "compare them", null, {
        kind: "chat",
        onUnconfirmed: (id) => {
          unconfirmed = id;
        },
        mentions: { slugs: [SLUG], onAccepted: () => accepted++, onRefused: () => refused++ },
      });
    });
    await settleChat();
    expect(posts).toHaveLength(1);
    expect(accepted).toBe(0);
    expect(refused).toBe(1);
    expect(unconfirmed).toBeNull();
  });

  it("keeps an uncertain closed stream out of the composer and exposes its local failed thread", async () => {
    await mount();
    let refused = 0;
    let unconfirmed: string | null = null;
    /* A 200 that closes before `begin`: the write may still have landed, so the
       client must not make the same question immediately sendable again. The
       caller instead opens the local failed thread, as an ordinary first send
       already does. */
    reply = { frames: "" };
    let sentTo = "";
    await act(async () => {
      sentTo = chat?.send(null, "compare them", null, {
        kind: "chat",
        onUnconfirmed: (id) => {
          unconfirmed = id;
        },
        mentions: {
          slugs: [SLUG],
          onAccepted: () => {},
          onRefused: () => refused++,
          onUnconfirmed: () => rowLetGo++,
        },
      }) ?? "";
    });
    await settleChat();
    expect(refused).toBe(0);
    expect(unconfirmed).toBe(sentTo);
    /* And the composer is told, which a follow-up's needs: it has no navigation to do it. */
    expect(rowLetGo).toBe(1);
  });

  it("does not make a pre-header network loss resendable either", async () => {
    await mount();
    let refused = 0;
    let unconfirmed: string | null = null;
    answer = () => Promise.reject(new TypeError("Failed to fetch"));
    let sentTo = "";
    await act(async () => {
      sentTo = chat?.send(null, "compare them", null, {
        kind: "chat",
        onUnconfirmed: (id) => {
          unconfirmed = id;
        },
        mentions: {
          slugs: [SLUG],
          onAccepted: () => {},
          onRefused: () => refused++,
          onUnconfirmed: () => rowLetGo++,
        },
      }) ?? "";
    });
    await settleChat();
    expect(refused).toBe(0);
    expect(unconfirmed).toBe(sentTo);
    /* And the composer is told, which a follow-up's needs: it has no navigation to do it. */
    expect(rowLetGo).toBe(1);
  });

  it("reports begin even when the server accepts the optimistic thread id", async () => {
    await mount();
    let begun: string | null = null;
    answer = (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { threadId: string };
      return Promise.resolve(
        new Response(
          frames({
            threadId: body.threadId,
            title: "compare them",
            messageId: "spya-rep222",
            questionId: "spya-qst222",
            mentioned: [SMITH],
          }),
          { status: 200 },
        ),
      );
    };
    let sentTo = "";
    await act(async () => {
      sentTo = chat?.send(null, "compare them", null, {
        kind: "chat",
        onBegun: (id) => {
          begun = id;
        },
        mentions: { slugs: ["smith-2024"], onAccepted: () => {} },
      }) ?? "";
    });
    await settleChat();
    expect(begun).toBe(sentTo);
  });

  it("sends no mentions on a retry or an edit", async () => {
    threads = [
      {
        kind: "chat",
        id: "spya-thrd22",
        title: "t",
        createdAt: "2026-10-12T10:00:00.000Z",
        updatedAt: "2026-10-12T10:00:00.000Z",
        messages: [
          { id: "spya-qstn23", role: "user", text: "q", createdAt: "2026-10-12T10:00:00.000Z", status: "done" },
          { id: "spya-answ23", role: "assistant", text: "a", createdAt: "2026-10-12T10:00:01.000Z", status: "done" },
        ],
        mentioned: [SMITH],
      },
    ];
    await mount();
    await act(async () => chat?.retry("spya-thrd22", "spya-answ23"));
    await settleChat();
    await act(async () => chat?.edit("spya-thrd22", "spya-qstn23", "q again", null));
    await settleChat();
    expect(posts.length).toBeGreaterThanOrEqual(2);
    for (const body of posts) expect(body).not.toHaveProperty("mentions");
  });

  it("lays a loaded thread's `mentioned` over it", async () => {
    threads = [
      {
        kind: "chat",
        id: "spya-thrd22",
        title: "t",
        createdAt: "2026-10-12T10:00:00.000Z",
        updatedAt: "2026-10-12T10:00:00.000Z",
        messages: [],
        mentioned: [SMITH, { available: false, title: "Gone", reason: "deleted" }],
      },
    ];
    await mount();
    expect(chat?.threads.find((t) => t.id === "spya-thrd22")?.mentioned).toEqual([
      SMITH,
      { available: false, title: "Gone", reason: "deleted" },
    ]);
  });
});
