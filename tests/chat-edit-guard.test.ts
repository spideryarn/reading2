// @vitest-environment jsdom
/**
 * An edit says which message it believes is last.
 *
 * ## The bug on the other end of this
 *
 * `withEdit` checks only that its target still exists and is a question, then
 * discards everything after it. So: tab A appends Q2 and its answer; stale tab
 * B edits Q1 and deletes both; A's model finishes and writes into a row that is
 * gone, having already shown the reader a perfectly successful answer; the
 * reader reloads and it is not there. **The mutex orders those two writes; it
 * does not make the result correct.**
 *
 * The fix is deliberately narrow — no thread version, which would 409 two
 * *appends* that succeed today — so the only edits refused are those whose
 * discard set has changed underneath them. `expectedTailId` in
 * src/store/contracts.ts and `requireTail` in src/store/fs.ts are the server's
 * half, and tests/store-chat-tail-guard.test.ts pins those.
 *
 * **This is the half nothing else can see.** The guard is optional in the
 * contract, because the value can only come from the client — so a client that
 * sends nothing is not refused, it is simply unprotected, and every server-side
 * test goes on passing. That is why the assertion is on the request body.
 *
 * Same harness as tests/use-chat-recovery.test.ts: React's own `act` and
 * `createRoot`, no testing library, a stubbed `fetch`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChat, type ChatApi } from "../src/web/useChat.js";
import type { ChatThread } from "../src/types.js";

const SLUG = "an-article";
const THREAD = "th-server";

let container: HTMLDivElement;
let root: Root;
let latest: ChatApi | undefined;

function Harness() {
  latest = useChat(SLUG);
  return null;
}

/** Two complete turns, so an edit of the first has something to discard. */
const stored: ChatThread[] = [
  {
    id: THREAD,
    title: "a question",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    kind: "chat" as const,
    messages: [
      { id: "q1", role: "user", text: "first", createdAt: "2026-01-01T00:00:00.000Z", status: "done" },
      { id: "a1", role: "assistant", text: "one", createdAt: "2026-01-01T00:00:00.000Z", status: "done" },
      { id: "q2", role: "user", text: "second", createdAt: "2026-01-01T00:00:01.000Z", status: "done" },
      { id: "a2", role: "assistant", text: "two", createdAt: "2026-01-01T00:00:01.000Z", status: "done" },
    ],
  },
];

/** Every POST body the hook sent, in order. */
let posted: Record<string, unknown>[] = [];

/** A stream that says `begin` and then closes, so the turn ends cleanly. */
function shortStream(): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      const frame = (event: string, data: unknown) =>
        c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      frame("begin", { threadId: THREAD, title: "a question", messageId: "a3", questionId: "q1" });
      frame("done", { text: "rewritten", status: "done", citations: [], searches: 0, model: "m" });
      c.close();
    },
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify({ threads: stored })),
        } as unknown as Response);
      }
      if (init.method === "POST") {
        posted.push(JSON.parse((init.body as string) ?? "{}") as Record<string, unknown>);
        return Promise.resolve({ ok: true, body: shortStream() } as unknown as Response);
      }
      throw new Error(`unexpected fetch: ${init.method}`);
    }),
  );

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Harness));
  });
  await settle();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  latest = undefined;
  vi.unstubAllGlobals();
});

describe("editing a question", () => {
  it("names the message this tab believes is last", async () => {
    // The conversation as loaded ends at `a2`. That is the fact the server
    // needs, and it is the fact that will be false in the stale tab this guard
    // exists for.
    await act(async () => {
      latest?.edit(THREAD, "q1", "first, rewritten", null);
    });
    await settle();

    const edit = posted.find((b) => b.edit === "q1");
    expect(edit, "the edit was never posted").toBeDefined();
    expect(edit?.expectedTailId).toBe("a2");
  });

  it("reads the tail from before its own optimistic rewrite", async () => {
    /* The rewrite truncates the thread on screen the instant the reader
       presses save — that is what makes the panel feel immediate. Reading the
       tail afterwards would name the row the edit itself has just created, so
       the guard would compare the server's list against a list that never
       existed and refuse every edit. Cheap to get wrong, and it would look
       like the server being flaky. */
    await act(async () => {
      latest?.edit(THREAD, "q1", "first, rewritten", null);
    });
    await settle();

    const edit = posted.find((b) => b.edit === "q1");
    const optimisticIds = latest?.threads.find((t) => t.id === THREAD)?.messages.map((m) => m.id);
    expect(optimisticIds).not.toContain("a2");
    expect(edit?.expectedTailId).toBe("a2");
  });

  it("sends nothing of the sort on an ordinary question or a retry", async () => {
    /* Deliberately narrow. An append cannot destroy anything, so guarding it
       would invent a 409 for two tabs that both succeed today — which is the
       one thing this migration must not do. A retry has its own guard already:
       it insists on the thread's real last message. */
    await act(async () => {
      latest?.send(THREAD, "a third question", null);
    });
    await settle();
    await act(async () => {
      latest?.retry(THREAD, "a2");
    });
    await settle();

    for (const body of posted) {
      expect(body.expectedTailId, JSON.stringify(body)).toBeUndefined();
    }
  });
});
