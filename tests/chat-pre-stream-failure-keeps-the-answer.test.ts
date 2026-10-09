/**
 * **A Retry or an Edit that fails before its stream starts takes nothing off
 * the screen.**
 * docs/plans/261006d-chat-keeps-the-previous-answer-when-a-retry-or-edit-fails-before-the-stream.md
 *
 * Retry blanks the answer and Edit rewrites the question and drops the turns
 * under it, both by drawing over rows the tab still has. A 409 un-drew them; a
 * `[db-busy]` 500, or a request that never opened, committed the drawing, and
 * the reader looked at a conversation missing what Postgres still held until
 * they reloaded.
 *
 * tests/chat-reduce.test.ts pins the transition. This goes round it: the
 * browser's own `runTurn` reads the status and the body, and the real
 * `ChatController` reduces what it reports and runs the repair. `apiFetch` is
 * the only thing replaced, by a server that holds one conversation and fails
 * the turn the way the test asks. No database: the server's side of a
 * pre-stream failure is that nothing was written, which is what the fake holds.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { STORAGE_BUSY } from "../src/messages.js";
import type { ChatThread } from "../src/types.js";

const SLUG = "a-busy-article";
const CHAT = "spya-bz5ch1";
const AT = "2026-10-06T12:00:00.000Z";

/** What the fake server holds, and how it answers the next POST. */
const server = vi.hoisted(() => ({
  threads: [] as unknown[],
  turn: (): Promise<Response> => Promise.reject(new Error("no turn expected")),
  posts: 0,
  read: null as null | (() => Promise<Response>),
}));

vi.mock("../src/web/lib/api.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/lib/api.js")>();
  return {
    ...real,
    apiFetch: (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") {
        if (server.read) return server.read();
        return Promise.resolve(Response.json({ threads: server.threads }));
      }
      server.posts++;
      return server.turn();
    },
  };
});

/* `api.js` builds a Supabase client at import, from variables only a browser
   bundle has. Nothing here signs in. */
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      refreshSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));

const { ChatController } = await import("../src/web/chat/controller.js");
const effects = await import("../src/web/chat/effects.js");
const { asOpId } = await import("../src/web/chat/model.js");
type ChatEffects = import("../src/web/chat/controller.js").ChatEffects;
type Controller = InstanceType<typeof ChatController>;

const stored = (): ChatThread => ({
  id: CHAT,
  title: "why?",
  createdAt: AT,
  messages: [
    { id: "spya-bz5q01", role: "user", text: "why?", createdAt: AT, status: "done" },
    { id: "spya-bz5a01", role: "assistant", text: "because.", createdAt: AT, status: "done" },
    { id: "spya-bz5q02", role: "user", text: "and then?", createdAt: AT, status: "done" },
    { id: "spya-bz5a02", role: "assistant", text: "nothing.", createdAt: AT, status: "done" },
  ],
} as ChatThread);

const TWO_TURNS = ["user: why?", "assistant: because.", "user: and then?", "assistant: nothing."];

const task = () => new Promise<void>((go) => setTimeout(go, 0));

/** Wait until nothing is in flight: the turn, and the repair its failure starts. */
async function settled(c: Controller): Promise<void> {
  for (let i = 0; i < 400 && c.state.operations.size > 0; i++) await task();
  expect([...c.state.operations.values()].map((o) => o.kind), "still in flight").toEqual([]);
}

async function loaded(onSettled?: () => void): Promise<Controller> {
  server.threads = [stored()];
  const unused = async () => ({ ok: false as const, error: "not in this test" });
  const real: ChatEffects = {
    loadThreads: effects.askForThreads,
    runTurn: effects.runTurn,
    renameThread: effects.renameThread,
    deleteThread: effects.deleteThread,
    deleteFrom: effects.deleteFrom,
    appendSpoken: async () => ({ ok: false, conflict: false, error: "not in this test" }),
    settledAnswer: async () => null,
    stopAnswer: unused,
    cancelThread: unused,
    markHintOpened: unused,
  };
  const c = new ChatController(SLUG, real, onSettled);
  c.dispatch({ type: "load.started", op: { id: asOpId("spya-bz5ld1"), kind: "load" } });
  await settled(c);
  expect(rows(c)).toEqual(TWO_TURNS);
  return c;
}

const rows = (c: Controller) =>
  (c.threads.find((t) => t.id === CHAT)?.messages ?? []).map(
    (m) => `${m.role}: ${m.text}${m.status === "done" ? "" : ` (${m.status})`}`,
  );

function retry(c: Controller): void {
  c.startTurn({
    type: "turn.started",
    op: {
      id: asOpId("spya-bz5op1"),
      kind: "turn",
      shape: "retry",
      threadId: CHAT,
      replyId: "spya-bz5a02",
      reply: { id: "spya-bz5a02", role: "assistant", text: "", createdAt: AT, status: "pending" },
      question: null,
      editing: null,
      opening: null,
      title: null,
      at: AT,
      began: false,
      attempt: null,
    },
    payload: { retry: "spya-bz5a02" },
  });
  /* The control: the retry really was drawn, so what is asserted afterwards is
     the screen being put back and not a retry that never started. */
  expect(rows(c).at(-1)).toBe("assistant:  (pending)");
}

function edit(c: Controller): void {
  const target = c.threads.find((t) => t.id === CHAT)?.messages[0];
  if (!target) throw new Error("the first question is not on screen");
  c.startTurn({
    type: "turn.started",
    op: {
      id: asOpId("spya-bz5op2"),
      kind: "turn",
      shape: "edit",
      threadId: CHAT,
      replyId: "spya-bz5rp2",
      reply: { id: "spya-bz5rp2", role: "assistant", text: "", createdAt: AT, status: "pending" },
      question: { ...target, text: "why not?", editedAt: AT },
      editing: target.id,
      opening: null,
      title: null,
      at: AT,
      began: false,
      attempt: null,
    },
    payload: { edit: target.id, question: "why not?", expectedTailId: "spya-bz5a02" },
  });
  expect(rows(c)).toEqual(["user: why not?", "assistant:  (pending)"]);
}

const busy = () =>
  Promise.resolve(Response.json({ error: STORAGE_BUSY.message }, { status: 500 }));
const unreachable = () => Promise.reject(new TypeError("Failed to fetch"));

afterEach(() => {
  server.posts = 0;
  server.read = null;
  server.turn = () => Promise.reject(new Error("no turn expected"));
});

describe("a turn that fails before its stream starts", () => {
  it.each([
    ["failed", "succeeded"],
    ["failed", "failed"],
    ["disconnected", "succeeded"],
    ["disconnected", "failed"],
  ] as const)("settles once after a %s retry's repair %s", async (ending, repairEnding) => {
    const onSettled = vi.fn();
    const c = await loaded(onSettled);
    let finishRead: ((response: Response) => void) | undefined;
    server.read = () => new Promise((resolve) => { finishRead = resolve; });
    server.turn = ending === "failed" ? unreachable : () =>
      Promise.resolve(new Response("", { headers: { "Content-Type": "text/event-stream" } }));
    retry(c);
    c.detach();
    for (let i = 0; i < 400 && !finishRead; i++) await task();
    expect(finishRead, "the failure must actually start the repair").toBeTypeOf("function");
    expect([...c.state.operations.values()].map((op) => op.kind)).toEqual(["repair"]);
    expect(onSettled).not.toHaveBeenCalled();
    finishRead!(repairEnding === "succeeded"
      ? Response.json({ threads: server.threads })
      : Response.json({ error: "repair read failed" }, { status: 500 }));
    await settled(c);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(rows(c)).toEqual(TWO_TURNS);
  });

  it("leaves the answer on screen after a retry the database was too busy for", async () => {
    const c = await loaded();
    server.turn = busy;
    retry(c);
    await settled(c);
    expect(server.posts).toBe(1);
    expect(rows(c)).toEqual(TWO_TURNS);
    expect(c.state.error).toBe(STORAGE_BUSY.message);
  });

  it("leaves the question and the later turns on screen after such an edit", async () => {
    const c = await loaded();
    server.turn = busy;
    edit(c);
    await settled(c);
    expect(server.posts).toBe(1);
    expect(rows(c)).toEqual(TWO_TURNS);
    expect(c.state.error).toBe(STORAGE_BUSY.message);
  });

  it("leaves the answer on screen after a retry that never reached the server", async () => {
    const c = await loaded();
    server.turn = unreachable;
    retry(c);
    await settled(c);
    expect(server.posts).toBe(1);
    expect(rows(c)).toEqual(TWO_TURNS);
    expect(c.state.error).toBeTruthy();
  });

  /* A failure does not prove the server did nothing: the response can be lost
     after the write. The repair is what finds out, and what it finds is drawn. */
  it("shows what the server holds when the retry had landed after all", async () => {
    const c = await loaded();
    server.turn = () => {
      const moved = stored();
      const last = moved.messages.at(-1);
      if (last) Object.assign(last, { text: "something else.", status: "done" });
      server.threads = [moved];
      return unreachable();
    };
    retry(c);
    await settled(c);
    expect(rows(c)).toEqual([...TWO_TURNS.slice(0, 3), "assistant: something else."]);
  });
});
