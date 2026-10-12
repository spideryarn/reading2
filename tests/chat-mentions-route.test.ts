/**
 * **@-mentioning another of your own articles in a chat, at the route** —
 * plan docs/plans/261012d-chat-at-mention-your-own-articles.md, Stage 1.
 *
 * What a request may carry and what is refused (every refusal a 400 with
 * words, and nothing written); what is stored (the article's id, never its
 * slug); what the model is sent, on a send, a retry and an edit alike, from the
 * store rather than the body; and what happens when a mentioned article later
 * stops being the reader's, is deleted, or grows past the cap.
 *
 * Harness copied from tests/chat-help-route.test.ts: a model stub that
 * answers, so the request `converse` builds can be read.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import type { OwnerId } from "../src/owner.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

await pgReady({
  suite: "tests/chat-mentions-route.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.chat_mentions", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore } = await import("../src/store/index.js");
const { resolveMentions } = await import("../src/chat-mentions.js");

const run = randomUUID().slice(0, 8);
const name = (what: string) => `test-chat-mentions-${what}-${run}`;
const OPEN = name("open");

let open: ScratchArticle;
let a: ScratchArticle;
let b: ScratchArticle;
let c: ScratchArticle;
let d: ScratchArticle;
let big: ScratchArticle;
let minimal: ScratchArticle;
let strangers: ScratchArticle;
const stranger = randomUUID() as OwnerId;
let moved: ScratchArticle;
let gone: ScratchArticle;

/**
 * A copy of `writes` whose every block says which copy it is, so each
 * mentioned article's text can be told apart in the request. (Their block ids
 * are `writes`' own, the open article's too; nothing here asserts on ids
 * across them — the collision case is tests/chat-mentions-prompt.test.ts's.)
 */
const variant =
  (tag: string) =>
  async (dir: string): Promise<void> => {
    const { readFile, writeFile } = await import("node:fs/promises");
    const at = `${dir}/blocks.json`;
    const parsed = JSON.parse(await readFile(at, "utf8")) as { blocks: { text: string; tag: string }[] };
    for (const blk of parsed.blocks) if (blk.tag === "p") blk.text = `${tag}: ${blk.text}`;
    await writeFile(at, JSON.stringify(parsed));
  };

/** Pad every block, so the article is well past the 120,000-character cap. */
async function padBlocks(dir: string): Promise<void> {
  const { readFile, writeFile } = await import("node:fs/promises");
  const at = `${dir}/blocks.json`;
  const parsed = JSON.parse(await readFile(at, "utf8")) as { blocks: { text: string; tag: string }[] };
  // Paragraphs only: a heading's text is what the tree matches its sections by.
  for (const blk of parsed.blocks) {
    if (blk.tag === "p") blk.text = `${blk.text} ${"padding words ".repeat(200)}`;
  }
  await writeFile(at, JSON.stringify(parsed));
}

beforeAll(async () => {
  await seedAuthUser(getDb(), { id: stranger, email: `chat-mentions-${stranger}@example.invalid` });
  [open, a, b, c, d, big, minimal, strangers, moved, gone] = await Promise.all([
    scratchArticleInPg(OPEN, { ownerId: TEST_OWNER }),
    scratchArticleInPg(name("a"), { ownerId: TEST_OWNER, from: "openai-huggingface" }),
    scratchArticleInPg(name("b"), { ownerId: TEST_OWNER, mutate: variant("Copy B") }),
    scratchArticleInPg(name("c"), { ownerId: TEST_OWNER, mutate: variant("Copy C") }),
    scratchArticleInPg(name("d"), { ownerId: TEST_OWNER, mutate: variant("Copy D") }),
    scratchArticleInPg(name("big"), { ownerId: TEST_OWNER, from: "openai-huggingface", mutate: padBlocks }),
    scratchArticleInPg(name("minimal"), { ownerId: TEST_OWNER, from: "writes" }),
    scratchArticleInPg(name("strangers"), { ownerId: stranger, from: "writes" }),
    scratchArticleInPg(name("moved"), { ownerId: TEST_OWNER, mutate: variant("Moved") }),
    scratchArticleInPg(name("gone"), { ownerId: TEST_OWNER, mutate: variant("Gone") }),
  ]);
  await getDb()
    .update(schema.articles)
    .set({ processing: "minimal" })
    .where(eq(schema.articles.id, minimal.articleId));
}, 120_000);

beforeEach(async () => {
  await asTestOwner(async () => {
    for (const thread of await chatStore.load(OPEN)) await chatStore.remove(OPEN, thread.id);
  });
  sent.length = 0;
});

afterAll(async () => {
  for (const s of [open, a, b, c, d, big, minimal, strangers, moved, gone]) await s?.remove();
  await getDb().execute(`delete from auth.users where id = '${stranger}'` as never).catch(() => {});
  await closeDb();
});

const sent: Record<string, unknown>[] = [];
const realFetch = globalThis.fetch;
beforeAll(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as Record<string, unknown>;
    const format = request.response_format as { json_schema?: { name?: unknown } } | undefined;
    if (format?.json_schema?.name === "conversation_gist") {
      return Promise.resolve(
        Response.json({
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ gist: "A short answer" }) } }],
        }),
      );
    }
    sent.push(request);
    const encoder = new TextEncoder();
    const frames = [
      `data: ${JSON.stringify({ model: "test/model", choices: [{ delta: { content: "Because." } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ finish_reason: "stop", delta: {} }] })}\n\n`,
      "data: [DONE]\n\n",
    ];
    return Promise.resolve({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(ctrl) {
          for (const f of frames) ctrl.enqueue(encoder.encode(f));
          ctrl.close();
        },
      }),
    } as Response);
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

interface Result {
  status: number;
  body: Record<string, unknown> | null;
  frames: { event: string; data: Record<string, unknown> }[];
}

async function call(method: string, pathname: string, body?: unknown): Promise<Result> {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url: pathname, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;

  let written = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    writeHead(code: number) {
      (this as { statusCode: number }).statusCode = code;
    },
    flushHeaders() {},
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

  const frames = written
    .split("\n\n")
    .filter((blk) => blk.startsWith("event: "))
    .map((blk) => {
      const [head, ...rest] = blk.split("\n");
      return {
        event: (head as string).slice("event: ".length),
        data: JSON.parse(rest.join("\n").slice("data: ".length)) as Record<string, unknown>,
      };
    });
  let parsed: Record<string, unknown> | null = null;
  if (frames.length === 0 && written.trim()) {
    try {
      parsed = JSON.parse(written) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }
  return { status: res.statusCode, body: parsed, frames };
}

const post = (body: unknown) => call("POST", `/api/chat/${OPEN}`, body);
const threads = () => asTestOwner(() => chatStore.load(OPEN));

/** The first user message's parts, of the nth request that reached the model. */
function firstUserParts(i: number): { text: string; cache_control?: unknown }[] {
  const messages = (sent[i] as { messages: { role: string; content: unknown }[] }).messages;
  return messages[1]?.content as { text: string; cache_control?: unknown }[];
}
const mentionedPart = (i: number) => firstUserParts(i)[1]?.text ?? "";

const blockText = (s: ScratchArticle) => {
  const found = s.blocks.find((blk) => blk.text.trim().length > 40);
  if (!found) throw new Error("no block worth quoting");
  return found.text;
};

async function storedMentions() {
  return getDb()
    .select()
    .from(schema.chatMentions)
    .where(eq(schema.chatMentions.articleId, open.articleId));
}

/** Send a question bringing in `slugs`, and return the thread id the server settled on. */
async function ask(threadId: string, question: string, slugs?: string[]): Promise<Result> {
  return post({ threadId, question, ...(slugs ? { mentions: slugs } : {}) });
}

describe("what is refused, before anything is written", () => {
  const T = "spya-aaaaaa";
  const refused = async (body: Record<string, unknown>, words: RegExp) => {
    const r = await post({ threadId: T, question: "compare them", ...body });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(String(r.body?.error)).toMatch(words);
    expect(r.frames).toEqual([]);
    expect(await threads()).toEqual([]);
    expect(await storedMentions()).toEqual([]);
    return String(r.body?.error);
  };

  it("another reader's article, in the same words as one that does not exist", async () => {
    const theirs = await refused({ mentions: [strangers.slug] }, /not on your shelf/);
    const nobody = await refused({ mentions: [name("nobody-has-this")] }, /not on your shelf/);
    expect(theirs).toBe(nobody);
  });

  it("the article that is open", async () => {
    await refused({ mentions: [OPEN] }, /already part of this conversation/);
  });

  it("a minimal article, which has not been read through", async () => {
    await refused({ mentions: [minimal.slug] }, /not been read through/);
  });

  it("an article over the cap, saying its size and the limit", async () => {
    await refused({ mentions: [big.slug] }, /too long to bring in whole: it is about [\d,]+ characters, and the limit is 120,000/);
  });

  it("more than three on one question", async () => {
    await refused({ mentions: [a.slug, b.slug, c.slug, d.slug] }, /at most 3 articles with one question/);
  });

  it("something that is not a list of slugs", async () => {
    await refused({ mentions: a.slug }, /list of article slugs/);
    await refused({ mentions: ["Not A Slug!"] }, /list of article slugs/);
  });

  it("mentions on any conversation but a chat", async () => {
    await refused({ kind: "learn", mentions: [a.slug] }, /only be brought into a chat/);
  });

  it("a fourth article in one conversation", async () => {
    expect((await ask(T, "first", [a.slug, b.slug])).status).toBe(200);
    expect((await ask(T, "second", [c.slug])).status).toBe(200);
    /* Mentioning one it already holds takes no new place. */
    expect((await ask(T, "third", [a.slug])).status).toBe(200);
    const r = await ask(T, "fourth", [d.slug]);
    expect(r.status).toBe(400);
    expect(String(r.body?.error)).toMatch(/most it can hold/);
    expect(new Set((await storedMentions()).map((m) => m.mentionedArticleId))).toEqual(
      new Set([a.articleId, b.articleId, c.articleId]),
    );
  });

  it("mentions on a retry or an edit, which keep what their question was sent with", async () => {
    await ask(T, "first", [a.slug]);
    const [thread] = await threads();
    const question = thread?.messages[0]?.id;
    const answer = thread?.messages[1]?.id;
    const retry = await post({ threadId: T, retry: answer, mentions: [b.slug] });
    expect(retry.status).toBe(400);
    expect(String(retry.body?.error)).toMatch(/only be brought in with a new question/);
    const edit = await post({ threadId: T, edit: question, question: "first, again", mentions: [b.slug] });
    expect(edit.status).toBe(400);
    expect(String(edit.body?.error)).toMatch(/only be brought in with a new question/);
    expect((await storedMentions()).map((m) => m.mentionedArticleId)).toEqual([a.articleId]);
  });
});

describe("a question that brings an article in", () => {
  const T = "spya-bbbbbb";

  it("stores the article's id and the title the reader saw, never the slug", async () => {
    const r = await ask(T, "how does this compare?", [a.slug]);
    expect(r.status).toBe(200);
    const rows = await storedMentions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mentionedArticleId: a.articleId, position: 0 });
    expect(JSON.stringify(rows)).not.toContain(a.slug);
    const [thread] = await threads();
    expect(rows[0]?.messageId).toBe(thread?.messages[0]?.id);
  });

  it("sends it to the model as a fenced second part, after the open article's breakpoint", async () => {
    await ask(T, "how does this compare?", [a.slug]);
    const parts = firstUserParts(0);
    expect(parts).toHaveLength(2);
    expect(parts[0]?.text).not.toContain(blockText(a));
    expect(parts[1]?.cache_control).toEqual({ type: "ephemeral" });
    expect(mentionedPart(0)).toContain("<<<UNTRUSTED ARTICLE BROUGHT IN");
    expect(mentionedPart(0)).toContain(blockText(a));
  });

  it("names it in the begin frame and on the thread GET, with its slug and ids", async () => {
    const r = await ask(T, "how does this compare?", [a.slug]);
    const begin = r.frames.find((f) => f.event === "begin")?.data;
    const expected = [
      expect.objectContaining({ available: true, slug: a.slug, blockIds: a.blocks.map((blk) => blk.id) }),
    ];
    expect(begin?.mentioned).toEqual(expected);
    const got = await call("GET", `/api/chat/${OPEN}`);
    const listed = ((got.body?.threads ?? []) as { id: string; mentioned?: unknown }[]).find((t) => t.id === T);
    expect(listed?.mentioned).toEqual(expected);
  });

  it("is still there on a later question that brings nothing", async () => {
    await ask(T, "how does this compare?", [a.slug]);
    await ask(T, "and the method?");
    expect(mentionedPart(1)).toContain(blockText(a));
  });

  it("is read from the store on a retry", async () => {
    await ask(T, "how does this compare?", [a.slug]);
    const [thread] = await threads();
    const r = await post({ threadId: T, retry: thread?.messages[1]?.id });
    expect(r.status).toBe(200);
    expect(mentionedPart(1)).toContain(blockText(a));
    const begin = r.frames.find((f) => f.event === "begin")?.data;
    expect((begin?.mentioned as unknown[] | undefined)?.length).toBe(1);
  });

  it("is read from the store on an edit of a later question, with the earlier question's too", async () => {
    await ask(T, "first", [a.slug]);
    await ask(T, "second", [b.slug]);
    const [thread] = await threads();
    const r = await post({
      threadId: T,
      edit: thread?.messages[2]?.id,
      question: "second, reworded",
      expectedTailId: thread?.messages[3]?.id,
    });
    expect(r.status).toBe(200);
    expect(mentionedPart(2)).toContain(blockText(a));
    expect(mentionedPart(2)).toContain(blockText(b));
  });

  it("an edit of the first question keeps its mentions and drops the later questions' with them", async () => {
    await ask(T, "first", [a.slug]);
    await ask(T, "second", [b.slug]);
    const [thread] = await threads();
    const r = await post({
      threadId: T,
      edit: thread?.messages[0]?.id,
      question: "first, reworded",
      expectedTailId: thread?.messages[3]?.id,
    });
    expect(r.status).toBe(200);
    expect((await storedMentions()).map((m) => m.mentionedArticleId)).toEqual([a.articleId]);
    expect(mentionedPart(2)).toContain(blockText(a));
    expect(mentionedPart(2)).not.toContain(blockText(b));
  });
});

describe("a mentioned article that is not the reader's to read any more", () => {
  const T = "spya-cccccc";

  async function viewOf(threadId: string) {
    const got = await call("GET", `/api/chat/${OPEN}`);
    return ((got.body?.threads ?? []) as { id: string; mentioned?: Record<string, unknown>[] }[]).find(
      (t) => t.id === threadId,
    )?.mentioned;
  }

  it("is re-checked against the current owner every turn: a transfer leaves its title only", async () => {
    // Seeded in `beforeAll`: seeding reaches Storage through `fetch`, which this file stubs.
    await ask(T, "compare", [moved.slug]);
    await getDb().update(schema.articles).set({ ownerId: stranger }).where(eq(schema.articles.id, moved.articleId));

    const view = await viewOf(T);
    expect(view).toHaveLength(1);
    expect(view?.[0]).toEqual({ available: false, title: expect.any(String), reason: "not-owned" });
    expect(JSON.stringify(view)).not.toContain(moved.slug);

    const r = await ask(T, "and now?");
    expect(r.status).toBe(200);
    expect(mentionedPart(1)).toContain("no longer available");
    expect(mentionedPart(1)).not.toContain(blockText(moved));
    expect(mentionedPart(1)).not.toContain(moved.slug);
  });

  it("is deleted: the mention keeps its title and says so", async () => {
    await ask(T, "compare", [gone.slug]);
    const title = (await storedMentions())[0]?.title;
    await gone.remove();
    const rows = await storedMentions();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.mentionedArticleId).toBeNull();
    expect(await viewOf(T)).toEqual([{ available: false, title, reason: "deleted" }]);
  });

  it("grew past the cap after a re-extraction: dropped, with a reason", async () => {
    await ask(T, "compare", [a.slug]);
    const [thread] = await threads();
    if (!thread) throw new Error("no thread");
    /* A re-extraction cannot be staged here, so the cap is lowered under the
       stored article instead: the resolver measures again on every turn, which
       is the property under test. */
    const resolved = await asTestOwner(() =>
      resolveMentions(OPEN, thread, thread.messages[0]?.id ?? "", { maxChars: 1_000 }),
    );
    expect(resolved).toEqual([{ available: false, title: expect.any(String), reason: "too-long" }]);
    const fits = await asTestOwner(() => resolveMentions(OPEN, thread, thread.messages[0]?.id ?? ""));
    expect(fits[0]?.available).toBe(true);
  });
});

describe("the store's own guard", () => {
  it("refuses a fourth article inside begin's transaction, whatever the route did", async () => {
    const T = "spya-dddddd";
    await ask(T, "first", [a.slug, b.slug, c.slug]);
    await expect(
      asTestOwner(() =>
        chatStore.begin(OPEN, {
          threadId: T,
          question: "sneaking one in",
          mentions: [{ articleId: d.articleId, title: "D" }],
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    const rows = await getDb()
      .select()
      .from(schema.chatMentions)
      .where(and(eq(schema.chatMentions.articleId, open.articleId), eq(schema.chatMentions.threadId, T)));
    expect(rows).toHaveLength(3);
    // And the question itself was not written either: one transaction.
    expect((await threads())[0]?.messages).toHaveLength(2);
  });
});
