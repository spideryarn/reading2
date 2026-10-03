/**
 * `reader_notes` returns one reader's notes and conversations, and only theirs.
 *
 * docs/plans/261003l-reader-notes-chat-tool-and-explore-sub-mode-of-remember.md
 * § Reviews, PR-7. The plan first asked for "a second owner's notes on the same
 * slug", which cannot exist: slugs are global. So this is the shape the review
 * named instead — **two owned articles**, and owner A calling the real path
 * with owner B's slug and owner B's thread id.
 *
 * The tool is handed a slug and never an owner; the stores resolve the slug
 * through the article's owner before reading a child row
 * (src/store/pg.ts § `ownedSlug`). That is the boundary, and it is a property
 * of real queries, so this needs Postgres. The formatting is
 * tests/reader-notes-tool.test.ts, with no database.
 *
 * **Every "nothing came back" below has a control beside it.** B reads B's own
 * article through the same call and the private text is there; A reads A's own
 * and A's is there. Without those, a tool that returned nothing to anybody
 * would pass every refusal in this file (docs/reusable/silent-success.md).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { EVAL_OWNER_ID, type OwnerId, runAsOwner } from "../src/owner.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

/** A's article and B's. Throwaway slugs, so the rows below belong to nobody else. */
const MINE = "test-reader-notes-mine";
const THEIRS = "test-reader-notes-theirs";

/** Owner A is the reader `acceptAny` signs in; owner B is a different account. */
const A: OwnerId = TEST_OWNER;
const B: OwnerId = EVAL_OWNER_ID;

const A_NOTE = "A-OWN-NOTE-xk3";
const A_QUESTION = "A-OWN-QUESTION-xk3";
const B_NOTE = "B-PRIVATE-NOTE-q7w";
const B_QUOTE_NOTE = "B-PRIVATE-SECOND-NOTE-q7w";
const B_QUESTION = "B-PRIVATE-QUESTION-q7w";
const B_ANSWER = "B-PRIVATE-ANSWER-q7w";
const B_PRIVATE = [B_NOTE, B_QUOTE_NOTE, B_QUESTION, B_ANSWER];

await pgReady({
  suite: "tests/reader-notes-owner-isolation.test.ts",
  tables: ["spideryarn.comments", "spideryarn.chat_threads", "spideryarn.chat_messages"],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore, commentStore, loadArticle } = await import("../src/store/index.js");
const { runTool } = await import("../src/chat-tools.js");

let mine: ScratchArticle | undefined;
let theirs: ScratchArticle | undefined;
let aThread = "";
let bThread = "";

/** One finished exchange in a new conversation, and the thread's stored id. */
async function converseOnce(slug: string, question: string, answer: string): Promise<string> {
  const turn = await chatStore.begin(slug, { threadId: mintId(), question });
  await chatStore.finish(
    slug,
    turn.thread.id,
    turn.reply.id,
    { status: "done", text: answer },
    { attempt: turn.attempt },
  );
  return turn.thread.id;
}

beforeAll(async () => {
  mine = await scratchArticleInPg(MINE, { ownerId: A });
  theirs = await scratchArticleInPg(THEIRS, { ownerId: B });
  const block = theirs.blocks.find((b) => b.text.length > 20);
  const own = mine.blocks.find((b) => b.text.length > 20);
  if (!block || !own) throw new Error("the fixture has no paragraph to put a note on");

  await runAsOwner(B, async () => {
    await commentStore.create(THEIRS, { blockId: block.id, body: B_NOTE });
    await commentStore.create(THEIRS, {
      blockId: block.id,
      quote: block.text.slice(0, 12),
      start: 0,
      body: B_QUOTE_NOTE,
    });
    bThread = await converseOnce(THEIRS, B_QUESTION, B_ANSWER);
  });
  await runAsOwner(A, async () => {
    await commentStore.create(MINE, { blockId: own.id, body: A_NOTE });
    aThread = await converseOnce(MINE, A_QUESTION, "An answer for A.");
  });
}, 120_000);

afterAll(async () => {
  await mine?.remove();
  await theirs?.remove();
  await closeDb();
});

/** The tool, run the way a chat turn runs it: a slug, a kind, a thread, and no owner. */
async function notes(as: OwnerId, slug: string, args: Record<string, unknown> = {}) {
  return runAsOwner(as, async () => {
    /* The article in the context is always one the caller can load. In the real
       path a turn never gets as far as a tool for an article that is not the
       caller's — `streamChat` loads it first — so handing A's own blocks in
       with B's slug is the *more* permissive case: the store is the only thing
       left to refuse. */
    const article = await loadArticle(as === A ? MINE : THEIRS);
    return runTool("reader_notes", args, {
      slug,
      meta: article.meta,
      blocks: article.blocks,
      power: "standard",
      kind: "chat",
      threadId: "spya-notathread",
    });
  });
}

const everything = (out: { label: string; detail: string; content: string }) =>
  `${out.label}\n${out.detail}\n${out.content}`;

describe("the controls: each owner can read their own", () => {
  it("gives B their own notes and conversation", async () => {
    const list = await notes(B, THEIRS);
    expect(list.detail).toBe("2 notes, 1 conversation");
    expect(list.content).toContain(B_NOTE);
    expect(list.content).toContain(B_QUOTE_NOTE);
    expect(list.content).toContain(bThread);

    const one = await notes(B, THEIRS, { thread: bThread });
    expect(one.detail).toBe("1 exchange");
    expect(one.content).toContain(B_QUESTION);
    expect(one.content).toContain(B_ANSWER);
  });

  it("gives A their own, and nothing of B's", async () => {
    const list = await notes(A, MINE);
    expect(list.detail).toBe("1 note, 1 conversation");
    expect(list.content).toContain(A_NOTE);
    expect(list.content).toContain(aThread);
    for (const secret of B_PRIVATE) expect(everything(list)).not.toContain(secret);
    expect(list.content).not.toContain(bThread);

    const one = await notes(A, MINE, { thread: aThread });
    expect(one.content).toContain(A_QUESTION);
  });
});

describe("owner A, asking with owner B's slug and thread id", () => {
  it("gets nothing of B's notes or index from B's slug", async () => {
    const out = await notes(A, THEIRS);
    expect(out.detail).toBe("could not read them");
    for (const secret of B_PRIVATE) expect(everything(out)).not.toContain(secret);
    expect(everything(out)).not.toContain(bThread);
    expect(out.content).not.toContain("UNTRUSTED");
    // And it does not claim B has none: it says it could not read them.
    expect(out.content).not.toMatch(/no notes|no other conversations/i);
  });

  it("gets nothing of B's conversation from B's slug and B's thread id", async () => {
    const out = await notes(A, THEIRS, { thread: bThread });
    expect(out.detail).toBe("could not read them");
    for (const secret of B_PRIVATE) expect(everything(out)).not.toContain(secret);
    expect(out.content).not.toContain("UNTRUSTED");
  });

  it("gets nothing of B's conversation from A's own slug and B's thread id", async () => {
    /* The crossing most likely to be written by accident: a thread looked up by
       id alone. The transcript reads only the threads `chatStore.load(slug)`
       returned for *this* article, so B's id names nothing here. */
    const out = await notes(A, MINE, { thread: bThread });
    expect(out.detail).toBe("no such conversation");
    for (const secret of B_PRIVATE) expect(everything(out)).not.toContain(secret);
    expect(out.content).not.toContain("UNTRUSTED");
  });
});

/* ------------------------------------------------------- Live's endpoint --
   Independently callable — the browser names the tool — so it is asked too,
   over HTTP, signed in as A. */

async function post(path: string, body: unknown): Promise<{ status: number; text: string }> {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url: path, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;
  let written = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
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
  return { status: res.statusCode, text: written };
}

describe("Live's tool endpoint, signed in as A", () => {
  it.each([MINE, THEIRS])("refuses reader_notes by name on %s", async (slug) => {
    for (const args of [{}, { thread: bThread }, { thread: aThread }]) {
      const out = await post(`/api/chat/${slug}/live-tool`, { name: "reader_notes", args });
      expect(out.status).toBe(400);
      for (const secret of [...B_PRIVATE, A_NOTE, A_QUESTION]) expect(out.text).not.toContain(secret);
    }
  });

  it("still runs a shared tool on A's own article, and not on B's", async () => {
    /* The control for the refusal above: the endpoint works, for the owner. */
    const body = { name: "search_article_words", args: { query: "the" } };
    expect((await post(`/api/chat/${MINE}/live-tool`, body)).status).toBe(200);
    expect((await post(`/api/chat/${THEIRS}/live-tool`, body)).status).toBe(404);
  });
});
