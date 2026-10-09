// @vitest-environment jsdom
/**
 * **Recording that the reader opened a Recall hint — the browser's half.**
 *
 * The hint opens on screen from the panel's own state. This file is about the
 * write that follows: one checked request, and the time it answers with patched
 * into the conversation the controller holds, so leaving and coming back keeps
 * the hint open. Three layers, each where it can be asked on its own:
 *
 * - the reducer: what a press registers, and what its answer may write;
 * - the controller, with effects that are plain functions;
 * - the effect, with `apiFetch` replaced, because a non-2xx must be a failure
 *   and `fetch` reports it as a fulfilled promise.
 *
 * GPT Sol's round-2 plan review, F9.
 * docs/plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatThread } from "../src/types.js";
import type { ChatEffects } from "../src/web/chat/controller.js";
import type { ChatState, HintOutcome } from "../src/web/chat/model.js";
import { asOpId, initialState } from "../src/web/chat/model.js";
import { project } from "../src/web/chat/project.js";
import { twice } from "./helpers/chat-reduce.js";

let answer: (url: string, init?: RequestInit) => Promise<Response>;
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return { ...real, apiFetch: (url: string, init?: RequestInit) => answer(url, init) };
});
const { markHintOpened } = await import("../src/web/chat/effects.js");
const { ChatController } = await import("../src/web/chat/controller.js");

const SLUG = "a-piece";
const THREAD = "spya-thrd01";
const ANSWER = "spya-ans001";
const AT = "2026-10-04T10:00:00.000Z";
const OPENED = "2026-10-04T10:05:00.000Z";
const LOAD = asOpId("spya-load01");
const HINT_OP = asOpId("spya-hint01");
const OTHER_HINT_OP = asOpId("spya-hint02");
const RECOVER = asOpId("spya-rec001");

const HINT = "He names two games.";
const TEXT = `Do you remember what researchers kept doing?\n\nHint: ${HINT}`;

function thread(reply: Partial<ChatMessage> = {}): ChatThread {
  return {
    id: THREAD,
    title: "What I took from it",
    createdAt: AT,
    updatedAt: AT,
    kind: "learn",
    messages: [
      { id: "spya-usr001", role: "user", text: "what I took", createdAt: AT, status: "done" },
      { id: ANSWER, role: "assistant", text: TEXT, createdAt: AT, status: "done", ...reply },
    ],
  };
}

function loaded(t: ChatThread = thread()): ChatState {
  const started = twice(initialState(SLUG), { type: "load.started", op: { id: LOAD, kind: "load" } }).state;
  return twice(started, { type: "load.succeeded", opId: LOAD, threads: [t] }).state;
}

const press = (state: ChatState, id = HINT_OP, hint = HINT) =>
  twice(state, { type: "hint.started", op: { id, kind: "hint", threadId: THREAD, messageId: ANSWER, hint } });

const reply = (state: ChatState) => project(state).find((t) => t.id === THREAD)?.messages.find((m) => m.id === ANSWER);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the reducer", () => {
  it("registers the press and asks for exactly one write, carrying the hint", () => {
    const out = press(loaded());
    expect(out.commands).toEqual([
      { type: "hint", opId: HINT_OP, slug: SLUG, threadId: THREAD, messageId: ANSWER, hint: HINT },
    ]);
    expect(out.state.operations.get(HINT_OP)).toMatchObject({ kind: "hint", messageId: ANSWER });
    /* Nothing is drawn or claimed until the server answers. */
    expect(reply(out.state)).not.toHaveProperty("hintOpenedAt");
  });

  it("asks nothing for a second press while the first is out, or once it is stored", () => {
    const first = press(loaded()).state;
    const second = press(first, OTHER_HINT_OP);
    expect(second.commands).toEqual([]);
    expect(second.state).toBe(first);

    const stored = loaded(thread({ hintOpenedAt: OPENED }));
    const again = press(stored);
    expect(again.commands).toEqual([]);
    expect(again.state).toBe(stored);
  });

  it("patches the server's time into the message when the write succeeds, and retires", () => {
    const out = twice(press(loaded()).state, { type: "hint.succeeded", opId: HINT_OP, hintOpenedAt: OPENED });
    expect(reply(out.state)?.hintOpenedAt).toBe(OPENED);
    expect(out.state.operations.has(HINT_OP)).toBe(false);
    expect(out.state.error).toBeNull();
  });

  it("claims nothing when the write fails: no time, no error line, operation gone", () => {
    const out = twice(press(loaded()).state, { type: "hint.failed", opId: HINT_OP, error: "the server said no" });
    expect(reply(out.state)).not.toHaveProperty("hintOpenedAt");
    expect(out.state.operations.has(HINT_OP)).toBe(false);
    expect(out.state.error).toBeNull();
    /* And the next press is free to try again. */
    expect(press(out.state, OTHER_HINT_OP).commands).toHaveLength(1);
  });

  it("does not mark a different answer that has taken the row since the press", () => {
    /* A retry keeps the message id. The row now holds another answer with
       another hint, and the late success is about the old one. */
    const pressed = press(loaded()).state;
    const replaced: ChatState = {
      ...pressed,
      base: pressed.base.map((t) => ({
        ...t,
        messages: t.messages.map((m) =>
          m.id === ANSWER ? { ...m, text: "Do you remember the other game?\n\nHint: A new clue." } : m,
        ),
      })),
    };
    const out = twice(replaced, { type: "hint.succeeded", opId: HINT_OP, hintOpenedAt: OPENED });
    expect(reply(out.state)).not.toHaveProperty("hintOpenedAt");
    expect(out.state.operations.has(HINT_OP)).toBe(false);
  });

  it("takes the stored press from a recovered answer, so a hint opened elsewhere arrives open", () => {
    const pending = loaded(thread({ text: "", status: "pending" }));
    const looking = twice(pending, {
      type: "recovery.started",
      op: { id: RECOVER, kind: "recovery", threadId: THREAD, messageId: ANSWER, until: Date.parse(AT) + 60_000, attempt: null },
    }).state;
    const found = twice(looking, {
      type: "recovery.found",
      opId: RECOVER,
      message: { id: ANSWER, role: "assistant", text: TEXT, createdAt: AT, status: "done", hintOpenedAt: OPENED },
    }).state;
    expect(reply(found)?.hintOpenedAt).toBe(OPENED);
  });
});

describe("the controller", () => {
  function controllerWith(markHint: ChatEffects["markHintOpened"]) {
    const calls: unknown[][] = [];
    const effects: ChatEffects = {
      loadThreads: async () => ({ ok: true, threads: [thread()] }),
      renameThread: async () => ({ ok: true }),
      deleteThread: async () => ({ ok: true }),
      deleteFrom: async () => ({ ok: true }),
      runTurn: async () => {},
      appendSpoken: () => new Promise(() => {}),
      settledAnswer: async () => null,
      stopAnswer: async () => ({ ok: true }),
      cancelThread: async () => ({ ok: true }),
      markHintOpened: (...args) => {
        calls.push(args);
        return markHint(...args);
      },
    };
    const c = new ChatController(SLUG, effects);
    return { c, calls };
  }

  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const held = (c: InstanceType<typeof ChatController>) =>
    c.threads.find((t) => t.id === THREAD)?.messages.find((m) => m.id === ANSWER);

  async function ready(markHint: ChatEffects["markHintOpened"]) {
    const made = controllerWith(markHint);
    made.c.dispatch({ type: "load.started", op: { id: LOAD, kind: "load" } });
    await settle();
    expect(held(made.c)?.text).toBe(TEXT);
    return made;
  }

  const pressOn = (c: InstanceType<typeof ChatController>) =>
    c.dispatch({
      type: "hint.started",
      op: { id: HINT_OP, kind: "hint", threadId: THREAD, messageId: ANSWER, hint: HINT },
    });

  it("sends the press and keeps the returned time, so coming back finds it open", async () => {
    const { c, calls } = await ready(async () => ({ ok: true, hintOpenedAt: OPENED }));
    pressOn(c);
    await settle();
    expect(calls).toEqual([[SLUG, THREAD, ANSWER, HINT]]);
    expect(held(c)?.hintOpenedAt).toBe(OPENED);
  });

  it("claims nothing when the route fails", async () => {
    const { c } = await ready(async () => ({ ok: false, error: "500" }));
    pressOn(c);
    await settle();
    expect(held(c)).not.toHaveProperty("hintOpenedAt");
    expect(c.state.error).toBeNull();
    expect(c.state.operations.size).toBe(0);
  });

  it("claims nothing when the effect itself rejects", async () => {
    const { c } = await ready(async () => {
      throw new Error("broken");
    });
    pressOn(c);
    await settle();
    expect(held(c)).not.toHaveProperty("hintOpenedAt");
    expect(c.state.operations.size).toBe(0);
  });
});

describe("the effect", () => {
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

  it("posts the message id and the hint to the conversation's hint-opened route", async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    answer = async (url, init) => {
      seen.push({ url, init });
      return json({ hintOpenedAt: OPENED });
    };
    const out: HintOutcome = await markHintOpened(SLUG, THREAD, ANSWER, HINT);
    expect(out).toEqual({ ok: true, hintOpenedAt: OPENED });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`/api/chat/${SLUG}/${THREAD}/hint-opened`);
    expect(seen[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({ messageId: ANSWER, hint: HINT });
  });

  it.each([409, 404, 500])("reports a %i as a failure, not as a quiet success", async (status) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    answer = async () => json({ error: "no", hintOpenedAt: OPENED }, status);
    expect(await markHintOpened(SLUG, THREAD, ANSWER, HINT)).toMatchObject({ ok: false });
  });

  it("reports a 200 that names no time as a failure", async () => {
    answer = async () => json({});
    expect(await markHintOpened(SLUG, THREAD, ANSWER, HINT)).toMatchObject({ ok: false });
  });

  it("reports a dead network as a failure and does not throw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    answer = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await markHintOpened(SLUG, THREAD, ANSWER, HINT)).toMatchObject({ ok: false });
  });
});
