/**
 * **A live conversation begun in Remember reaches the server AS Remember** —
 * through the real controller, down to the body it hands the transport.
 *
 * SPIDERYARN-READING2-70. The reducer puts the thread's kind on the `spoken`
 * command, and the controller then rebuilds the request body field by field;
 * a test of the reducer alone stays green if that second hop drops it, which
 * is the bug back again. GPT Sol's review of the plan, finding 1.
 *
 * The second exchange is the other half: the server may name the conversation
 * something other than what this tab invented, and the next append goes to the
 * server's name — it must still say Remember.
 *
 * docs/plans/260930d-a-live-conversation-started-in-remember-is-saved-as-a-remember-conversation.md
 */
import { expect, it } from "vitest";

import type { ChatMessage, ChatThread } from "../src/types.js";
import { ChatController, type ChatEffects } from "../src/web/chat/controller.js";
import { asOpId } from "../src/web/chat/model.js";

const SLUG = "a-remember-article";
const LOCAL = "spya-rklc01";
const SERVER = "spya-rksv01";
const AT = "2026-09-30T07:00:00.000Z";

const row = (id: string, role: ChatMessage["role"], text: string): ChatMessage => ({
  id,
  role,
  text,
  createdAt: AT,
  status: "done",
});

it("sends the begun thread's kind on the first append, and again after the server renames it", async () => {
  const bodies: { threadId: string; body: Record<string, unknown> }[] = [];
  const stored: ChatThread = {
    id: SERVER,
    kind: "remember",
    title: "what I took from it",
    createdAt: AT,
    updatedAt: AT,
    messages: [row("spya-rksq01", "user", "what I took from it"), row("spya-rksa01", "assistant", "yes")],
  };
  const effects: ChatEffects = {
    loadThreads: () => new Promise(() => {}),
    renameThread: async () => ({ ok: true }),
    deleteThread: async () => ({ ok: true }),
    runTurn: () => new Promise(() => {}),
    appendSpoken: async (_slug, threadId, body) => {
      bodies.push({ threadId, body });
      if (bodies.length === 1) return { ok: true, thread: stored };
      return {
        ok: true,
        thread: {
          ...stored,
          messages: [
            ...stored.messages,
            row("spya-rksq02", "user", "and also"),
            row("spya-rksa02", "assistant", "indeed"),
          ],
        },
      };
    },
    settledAnswer: async () => null,
    stopAnswer: async () => ({ ok: true }),
    cancelThread: async () => ({ ok: true }),
    markHintOpened: async () => ({ ok: false, error: "not in this test" }),
  };
  const c = new ChatController(SLUG, effects);

  /* What Remember's arrival rule does: an empty conversation, in this tab only. */
  c.dispatch({
    type: "thread.begun",
    thread: { id: LOCAL, kind: "remember", title: "New Remember", createdAt: AT, updatedAt: AT, messages: [] },
  });

  const first = await c.appendSpoken({
    id: asOpId("spya-rkop01"),
    kind: "spoken",
    threadId: LOCAL,
    question: row("spya-rkql01", "user", "what I took from it"),
    reply: row("spya-rkal01", "assistant", "yes"),
    expectedTailId: null,
    at: AT,
  });
  expect(first).toEqual({ ok: true, threadId: SERVER, tailId: "spya-rksa01" });
  expect(bodies[0]?.threadId).toBe(LOCAL);
  expect(bodies[0]?.body).toHaveProperty("kind", "remember");

  /* The live session adopts the server's name and claims the stored tail. */
  const second = await c.appendSpoken({
    id: asOpId("spya-rkop02"),
    kind: "spoken",
    threadId: SERVER,
    question: row("spya-rkql02", "user", "and also"),
    reply: row("spya-rkal02", "assistant", "indeed"),
    expectedTailId: "spya-rksa01",
    at: AT,
  });
  expect(second.ok).toBe(true);
  expect(bodies[1]?.threadId).toBe(SERVER);
  expect(bodies[1]?.body).toHaveProperty("kind", "remember");
  expect(c.getSnapshot().threads.map((t) => [t.id, t.kind])).toEqual([[SERVER, "remember"]]);
});
