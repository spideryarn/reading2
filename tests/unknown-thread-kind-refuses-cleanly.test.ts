/**
 * **What a refusal over an unknown stored thread kind leaves behind: nothing.**
 * docs/plans/261006a-remember-identifiers-become-learn-all-the-way-down.md
 * § Stage 0's code review (GPT Sol's S0-1 and S0-2).
 *
 * tests/unknown-stored-thread-kind.test.ts shows that a row whose kind this code
 * does not know makes `threadsFor` throw. This file is about the two things that
 * throw used to do on its way out:
 *
 * - **S0-1.** `rename` and `remove` committed their write and then read the
 *   list, so the read's refusal arrived after the change had stuck: the reader
 *   was told the delete failed and the conversation was gone.
 * - **S0-2.** The refusal reached the browser as a 500, and a failed Retry or
 *   Edit is committed on screen: the answer blanked, or the question rewritten
 *   and the turns under it dropped, though Postgres had kept them all. A 409 is
 *   the answer the client already puts the screen back for.
 *
 * ## How the unknown kind gets here
 *
 * These store methods and the route open their own transactions, and the
 * database is shared by the whole run, so a row with an unknown kind cannot be
 * committed (it needs the CHECK dropped). The value is changed in hand instead,
 * the way the export test in the sibling file does it: `storedThreadKind` is
 * handed a kind nobody knows while `tamper.on`, and the real function throws the
 * real class from inside the real `threadsFor`. Every row is an ordinary chat.
 *
 * ## The second half goes all the way through
 *
 * `apiFetch` is replaced by a call to `handleApi`, so the browser's own
 * `runTurn` and `askForThreads` read the route's real status and body, and the
 * real `ChatController` reduces what they report. What is asserted is what the
 * reader would be looking at.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { and, asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, chatMessages, chatThreads } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { CHAT_BEING_UPDATED } from "../src/messages.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

const FUTURE = "kind-from-the-future";

/* Off except inside `whileUnknown`, so the seeding and the control reads see the
   rows as they are. */
const tamper = vi.hoisted(() => ({ on: false }));

vi.mock("../src/types.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/types.js")>();
  return {
    ...real,
    storedThreadKind: (value: unknown) => real.storedThreadKind(tamper.on ? FUTURE : value),
  };
});

/* The browser's requests, answered by the route itself. */
vi.mock("../src/web/lib/api.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/lib/api.js")>();
  return { ...real, apiFetch: (url: string, init?: RequestInit) => viaRoute(url, init) };
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

loadEnvLocal();

const SLUG = "test-unknown-thread-kind-refuses";
const CHAT = "spya-rf5ch7";
const OTHER = "spya-rf5th2";

await pgReady({
  suite: "tests/unknown-thread-kind-refuses-cleanly.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { pgChatStore } = await import("../src/store/pg-chat.js");
const { UnknownStoredThreadKind } = await import("../src/types.js");
const { ChatController } = await import("../src/web/chat/controller.js");
const effects = await import("../src/web/chat/effects.js");
const { asOpId } = await import("../src/web/chat/model.js");
type ChatEffects = import("../src/web/chat/controller.js").ChatEffects;
type Controller = InstanceType<typeof ChatController>;

/** One request through `handleApi`, as the `Response` a browser would get. */
async function viaRoute(url: string, init: RequestInit = {}): Promise<Response> {
  const body = typeof init.body === "string" ? [Buffer.from(init.body)] : [];
  const req = Object.assign(
    (async function* () {
      yield* body;
    })(),
    { method: init.method ?? "GET", url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;
  let written = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    flushHeaders() {},
    writeHead(status: number) {
      (this as { statusCode: number }).statusCode = status;
    },
    on() {},
    write(chunk: string) {
      written += chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk) written += chunk;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
  return new Response(written, { status: res.statusCode });
}

async function whileUnknown<T>(body: () => Promise<T>): Promise<T> {
  tamper.on = true;
  try {
    return await body();
  } finally {
    tamper.on = false;
  }
}

let article: ScratchArticle | undefined;
let articleId = "";

/** The rows as Postgres holds them. Never through `threadsFor`. */
async function stored(): Promise<{ threads: string[]; messages: string[] }> {
  const db = getDb();
  const threads = await db
    .select({ id: chatThreads.id, title: chatThreads.title })
    .from(chatThreads)
    .where(eq(chatThreads.articleId, articleId))
    .orderBy(asc(chatThreads.id));
  const messages = await db
    .select({ threadId: chatMessages.threadId, role: chatMessages.role, text: chatMessages.text })
    .from(chatMessages)
    .where(eq(chatMessages.articleId, articleId))
    .orderBy(asc(chatMessages.threadId), asc(chatMessages.ordinal));
  return {
    threads: threads.map((t) => `${t.id}: ${t.title}`),
    messages: messages.map((m) => `${m.threadId} ${m.role}: ${m.text}`),
  };
}

/** A finished exchange, and the ids of its two rows. */
async function exchange(threadId: string, question: string, answer: string) {
  return asTestOwner(async () => {
    const { user, reply, attempt } = await pgChatStore.begin(SLUG, { threadId, question });
    await pgChatStore.finish(SLUG, threadId, reply.id, { status: "done", text: answer }, { attempt });
    return { question: user.id, answer: reply.id };
  });
}

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  expect(article.copied).toContain("blocks");
  const [row] = await getDb()
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.slug, SLUG), eq(articles.ownerId, TEST_OWNER)));
  articleId = row?.id ?? "";
  expect(articleId).not.toBe("");
});

afterEach(async () => {
  tamper.on = false;
  if (articleId) await getDb().delete(chatThreads).where(eq(chatThreads.articleId, articleId));
});

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

/* The model is never reached: every turn below is refused before it. A call
   that got through would be the bug, and this makes it loud. */
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() => Promise.reject(new Error("no model in tests"))) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("S0-1: a rename or a delete that cannot read the list back changes nothing", () => {
  const SEEDED = {
    threads: [`${CHAT}: why?`, `${OTHER}: and then?`],
    messages: [
      `${CHAT} user: why?`,
      `${CHAT} assistant: because.`,
      `${OTHER} user: and then?`,
      `${OTHER} assistant: nothing.`,
    ],
  };

  async function seed(): Promise<void> {
    await exchange(CHAT, "why?", "because.");
    await exchange(OTHER, "and then?", "nothing.");
    expect(await stored()).toEqual(SEEDED);
  }

  it("refuses the delete and keeps the conversation and its messages", async () => {
    await seed();
    const refusal = await whileUnknown(() =>
      asTestOwner(() => pgChatStore.remove(SLUG, CHAT)).then(
        () => "returned",
        (err: unknown) => err,
      ),
    );
    /* The rows first: what a refusal must not do matters more than its name. */
    expect(await stored()).toEqual(SEEDED);
    expect(refusal).toBeInstanceOf(UnknownStoredThreadKind);
    /* The control: the same delete, with a list it can read, does delete. So
       what kept the rows above was the refusal and not a delete that never ran. */
    await asTestOwner(() => pgChatStore.remove(SLUG, CHAT));
    expect((await stored()).threads).toEqual([`${OTHER}: and then?`]);
  });

  it("refuses the rename and keeps the old title", async () => {
    await seed();
    const refusal = await whileUnknown(() =>
      asTestOwner(() => pgChatStore.rename(SLUG, CHAT, "a new name")).then(
        () => "returned",
        (err: unknown) => err,
      ),
    );
    expect(await stored()).toEqual(SEEDED);
    expect(refusal).toBeInstanceOf(UnknownStoredThreadKind);
    await asTestOwner(() => pgChatStore.rename(SLUG, CHAT, "a new name"));
    expect((await stored()).threads).toEqual([`${CHAT}: a new name`, `${OTHER}: and then?`]);
  });
});

describe("S0-2: the refusal reaches the browser as one it puts the screen back for", () => {
  const task = () => new Promise<void>((go) => setTimeout(go, 0));

  /** Wait until nothing is in flight: the turn, and the repair its refusal starts. */
  async function settled(c: Controller): Promise<void> {
    for (let i = 0; i < 400 && c.state.operations.size > 0; i++) await task();
    expect([...c.state.operations.values()].map((o) => o.kind), "still in flight").toEqual([]);
  }

  /** A controller on the real effects, with the stored conversations loaded. */
  async function loaded(): Promise<Controller> {
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
    const c = new ChatController(SLUG, real);
    c.dispatch({ type: "load.started", op: { id: asOpId("spya-rf5ld1"), kind: "load" } });
    await settled(c);
    return c;
  }

  const rows = (c: Controller) =>
    (c.threads.find((t) => t.id === CHAT)?.messages ?? []).map(
      (m) => `${m.role}: ${m.text}${m.status === "done" ? "" : ` (${m.status})`}`,
    );

  const TWO_TURNS = ["user: why?", "assistant: because.", "user: and then?", "assistant: nothing."];
  const at = "2026-10-06T12:00:00.000Z";

  it("answers the turn with a 409 and the sentence written for a reader", async () => {
    const first = await exchange(CHAT, "why?", "because.");
    const response = await whileUnknown(() =>
      viaRoute(`/api/chat/${SLUG}`, {
        method: "POST",
        body: JSON.stringify({ threadId: CHAT, retry: first.answer }),
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: CHAT_BEING_UPDATED.message });
  });

  it("leaves the original answer on screen after a refused retry", async () => {
    await exchange(CHAT, "why?", "because.");
    const second = await exchange(CHAT, "and then?", "nothing.");
    const c = await loaded();
    expect(rows(c)).toEqual(TWO_TURNS);

    await whileUnknown(async () => {
      c.startTurn({
        type: "turn.started",
        op: {
          id: asOpId("spya-rf5op1"),
          kind: "turn",
          shape: "retry",
          threadId: CHAT,
          replyId: second.answer,
          reply: { id: second.answer, role: "assistant", text: "", createdAt: at, status: "pending" },
          question: null,
          editing: null,
          opening: null,
          title: null,
          at,
          began: false,
          attempt: null,
        },
        payload: { retry: second.answer },
      });
      /* The control: the retry really was drawn, so what is asserted below is
         the screen being put back and not a retry that never started. */
      expect(rows(c).at(-1)).toBe("assistant:  (pending)");
      await settled(c);
    });

    expect(rows(c)).toEqual(TWO_TURNS);
    expect(c.state.error).toBe(CHAT_BEING_UPDATED.message);
  });

  it("leaves the question and the later turns on screen after a refused edit", async () => {
    const first = await exchange(CHAT, "why?", "because.");
    const second = await exchange(CHAT, "and then?", "nothing.");
    const c = await loaded();
    expect(rows(c)).toEqual(TWO_TURNS);
    const target = c.threads.find((t) => t.id === CHAT)?.messages.find((m) => m.id === first.question);
    if (!target) throw new Error("the first question is not on screen");

    await whileUnknown(async () => {
      c.startTurn({
        type: "turn.started",
        op: {
          id: asOpId("spya-rf5op2"),
          kind: "turn",
          shape: "edit",
          threadId: CHAT,
          replyId: "spya-rf5rp2",
          reply: { id: "spya-rf5rp2", role: "assistant", text: "", createdAt: at, status: "pending" },
          question: { ...target, text: "why not?", editedAt: at },
          editing: first.question,
          opening: null,
          /* Not the first-question rename `useChat` would send: a title goes
             straight into `base` and is never withdrawn, which is a different
             subject from the rows this test is about. */
          title: null,
          at,
          began: false,
          attempt: null,
        },
        payload: { edit: first.question, question: "why not?", expectedTailId: second.answer },
      });
      expect(rows(c)).toEqual(["user: why not?", "assistant:  (pending)"]);
      await settled(c);
    });

    expect(rows(c)).toEqual(TWO_TURNS);
    expect(c.state.error).toBe(CHAT_BEING_UPDATED.message);
    /* And Postgres agrees with the screen. */
    expect((await stored()).messages).toEqual([
      `${CHAT} user: why?`,
      `${CHAT} assistant: because.`,
      `${CHAT} user: and then?`,
      `${CHAT} assistant: nothing.`,
    ]);
  });
});
