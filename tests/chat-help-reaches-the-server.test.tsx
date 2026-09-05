// @vitest-environment jsdom
/**
 * **The "?" press has to reach the server, and today it does not.**
 *
 * `ChatTarget` has carried `help?: true` since 2026-09-04 — the draft knows
 * perfectly well which button opened it, and uses it to decide what the opening
 * message quotes. What it has never done is *say so in the request*. So the
 * server has no way to tell a "?" press from somebody typing the same sentence,
 * report 1R's metadata has nothing to be stored from, and report 1S's
 * pedagogical instruction has nothing to fire on.
 *
 * This is the same shape as the bug tests/chat-kind-reaches-the-server.test.tsx
 * was written for: a field that exists on the client, is correct on the client,
 * and never leaves the building. That one was found by driving a browser rather
 * than by a test, because the broken step was the one step no test was standing
 * on. This file stands on it.
 *
 * Harness copied from that file — React's own `act` and `createRoot`, a stubbed
 * `apiFetch`, and the assertion is on the JSON that left.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("a help turn says so on the wire", () => {
  it("posts help: true when the '?' sent it", async () => {
    await act(async () => {
      chat?.send(null, "About block spya-k3m9qt: I could not follow this.", null, {
        anchor: { blockId: "spya-k3m9qt" },
        help: true,
      });
    });
    await settle();

    expect(posts, "the send made no request at all").toHaveLength(1);
    expect(
      posts[0]?.body.help,
      "A '?' press posted no `help`, so nothing is stored about it and the answer is " +
        "written with the ordinary chat prompt. src/web/useChat.ts § send.",
    ).toBe(true);
  });

  it("sends no help key at all for an ordinary question", async () => {
    await act(async () => {
      chat?.send(null, "why?", null);
    });
    await settle();
    expect(posts).toHaveLength(1);
    /* Absent, never `help: false`. The route validates *absent or literal
       `true`* and 400s anything else, so a `false` on the wire would be a bug
       that reads as politeness. */
    expect(posts[0]?.body).not.toHaveProperty("help");
  });
});
