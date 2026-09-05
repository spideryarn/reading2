// @vitest-environment jsdom
/**
 * **Every thread kind but `chat` has to reach the server, and the list of them
 * is `THREAD_KINDS` rather than the one name somebody remembered.**
 *
 * `useChat`'s `send` forwarded `kind` only when it was `"remember"`, written
 * when Remember was the only second kind there was. Candidates arrived on
 * 2026-09-01 as the third, and the check was not widened — so a Candidates turn
 * posted a body with no `kind`, the server read that as chat, and the thread was
 * *stored* as chat. Three things followed, none of which looked like a bug:
 *
 * - the server answered with chat's prompt, so the model never produced the
 *   shortlist block, so the panel said "No names yet" for ever;
 * - every honesty line the panel owes an editor — that conflicts of interest
 *   were not checked, that the list skews toward the well-indexed, which byline
 *   authors were excluded against — sat behind that early return, unreachable;
 * - and `firstCandidatesThread` filters on the persisted kind, so it never found
 *   the thread it had just made, and **every visit to the sub-mode started a new
 *   paid web search** and discarded the last conversation.
 *
 * Found by driving a browser, not by a test: the route tests posted `kind`
 * themselves and passed, because the thing that was broken was the one step no
 * test was standing on. The union had grown a member and a `===` had not.
 *
 * So this test derives its cases from `THREAD_KINDS`. A fourth kind cannot be
 * added without either passing here or failing here.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THREAD_KINDS, type ThreadKind } from "../src/types.js";

let answer: (url: string, init?: RequestInit) => Promise<Response>;

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  return { ...real, apiFetch: (url: string, init?: RequestInit) => answer(String(url), init) };
});

const { useChat } = await import("../src/web/useChat.js");

const SLUG = "an-article";

let container: HTMLDivElement;
let root: Root;
let chat: ReturnType<typeof useChat> | undefined;
let posts: { url: string; body: Record<string, unknown> }[] = [];

function Harness() {
  chat = useChat(SLUG);
  return null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  chat = undefined;
  posts = [];
  answer = (url, init) => {
    if ((init?.method ?? "GET") === "GET") return Promise.resolve(json({ threads: [] }));
    posts.push({
      url,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    });
    /* An empty stream: the send is what this test is about, and a body that
       ends without frames is a case the hook already has to survive. */
    return Promise.resolve(new Response("", { status: 200 }));
  };
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
});

/** The kinds that are not the default, taken from the union itself. */
const NOT_CHAT: ThreadKind[] = THREAD_KINDS.filter((k) => k !== "chat");

describe("the kind a turn is sent under", () => {
  it("has more than one non-default kind to check, or this test proves nothing", () => {
    /* A guard on the guard. If `THREAD_KINDS` were ever reduced to one entry,
       every `it.each` below would silently become a single case and the
       "derived from the union" claim in the docstring would stop being worth
       anything. */
    expect(NOT_CHAT.length).toBeGreaterThanOrEqual(2);
    expect(NOT_CHAT).toContain("candidates");
  });

  it.each(NOT_CHAT)("reaches the server for a %s turn", async (kind) => {
    await act(async () => {
      chat?.send(null, "who could review this?", null, { kind });
    });
    await settle();

    expect(posts, `a ${kind} turn sent no request at all`).toHaveLength(1);
    expect(
      posts[0]?.body.kind,
      `A ${kind} turn posted no kind, so the server will store it as chat and answer ` +
        `it with chat's prompt. src/web/useChat.ts § send.`,
    ).toBe(kind);
  });

  it("still sends no kind for an ordinary chat turn, which is what an old tab does", async () => {
    await act(async () => {
      chat?.send(null, "why?", null, { kind: "chat" });
    });
    await settle();
    expect(posts).toHaveLength(1);
    expect(
      posts[0]?.body,
      "A body with no kind means chat, and that is what keeps a tab opened before " +
        "any of this shipped working.",
    ).not.toHaveProperty("kind");
  });
});
