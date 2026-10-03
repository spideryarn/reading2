// @vitest-environment jsdom
/**
 * **A GPT-Live exchange reaches the server saying which engine spoke**, from
 * `useChat`'s `speak` down to the body of `POST …/spoken`.
 *
 * The server marks the stored row with the model (`gpt-live-1` or the Realtime
 * one) from this field, and reads an absent field as Realtime. So a hop that
 * drops it does not fail: the row is written, under the wrong model, and
 * nothing anywhere says so. There are three hops (the operation `speak`
 * builds, the command the reducer makes of it, the body the controller makes
 * of that) and each rebuilds its object field by field. This test stands on
 * the last one, as tests/chat-kind-reaches-the-server.test.tsx does for `kind`.
 *
 * The other half matters as much: a Realtime exchange sends **no** engine,
 * which is what every tab opened before the second engine existed sends.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { settleChat } from "./helpers/settle-chat.js";

let answer: (url: string, init?: RequestInit) => Promise<Response>;

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return { ...real, apiFetch: (url: string, init?: RequestInit) => answer(String(url), init) };
});

const { useChat } = await import("../src/web/useChat.js");

const SLUG = "an-article";
const THREAD = "spya-thra01";
const AT = "2026-10-03T07:00:00.000Z";

let container: HTMLDivElement;
let root: Root;
let chat: ReturnType<typeof useChat> | undefined;
let posts: { url: string; body: Record<string, unknown> }[] = [];

function Harness() {
  chat = useChat(SLUG);
  return null;
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  chat = undefined;
  posts = [];
  answer = (url, init) => {
    if ((init?.method ?? "GET") === "GET") return Promise.resolve(json({ threads: [] }));
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    posts.push({ url, body });
    /* The server's answer to a spoken append: the thread, with both rows stored. */
    return Promise.resolve(
      json({
        thread: {
          id: THREAD,
          kind: "chat",
          title: "A conversation",
          createdAt: AT,
          updatedAt: AT,
          messages: [
            { id: "spya-stq001", role: "user", text: body.question, createdAt: AT, status: "done" },
            { id: "spya-sta001", role: "assistant", text: body.answer, createdAt: AT, status: "done" },
          ],
        },
      }),
    );
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Harness));
  });
  await settleChat();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const exchange = { threadId: THREAD, question: "Is it still standing?", answer: "Yes, it is.", expectedTailId: null };

it("a gpt-live exchange posts engine: gpt-live", async () => {
  let landed: unknown;
  await act(async () => {
    landed = await chat?.speak({ ...exchange, engine: "gpt-live" });
  });
  await settleChat();
  expect(landed).toMatchObject({ ok: true, tailId: "spya-sta001" });
  expect(posts).toHaveLength(1);
  expect(posts[0]?.url).toMatch(/\/spoken$/);
  expect(
    posts[0]?.body.engine,
    "The body has no engine, so the server will mark a GPT-Live answer as the Realtime model's.",
  ).toBe("gpt-live");
});

it("a Realtime exchange sends no engine, which is what an old tab sends", async () => {
  await act(async () => {
    await chat?.speak(exchange);
  });
  await settleChat();
  expect(posts).toHaveLength(1);
  expect(posts[0]?.body).not.toHaveProperty("engine");
  expect(posts[0]?.body).toMatchObject({ question: "Is it still standing?", answer: "Yes, it is.", expectedTailId: null });
});

it("sends no engine even when Realtime is named", async () => {
  await act(async () => {
    await chat?.speak({ ...exchange, engine: "realtime" });
  });
  await settleChat();
  expect(posts[0]?.body).not.toHaveProperty("engine");
});
