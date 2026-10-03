/**
 * **A highlight's colour, through the real route and the real store** — and
 * out again through the rollback exporter.
 *
 * A highlight is a comment with a colour (docs/plans/261003e-span-highlights-with-a-colour.md).
 * Everything here goes in through `handleApi` and comes back out through
 * `commentStore.load`, as tests/comment-referee-mark.test.ts does for the
 * referee's placement and for its reason: a column the application cannot reach
 * is invisible to every test of that application.
 *
 * The review findings this file holds (plan review, 2026-10-03):
 *  - **S4** a colour needs words: refused on a whole-block bookmark at POST, at
 *    PATCH, and by the database itself;
 *  - **S10** same-Save idempotency includes the colour — same id and colour is
 *    the same Save, a different colour (or none against one) is a 409;
 *  - **S11** the rollback exporter lists comment fields by hand, so it is run.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { comments as commentsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import type { Comment } from "../src/types.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-comment-colour";

await pgReady({
  suite: "tests/comment-colour.test.ts",
  columns: [{ table: "spideryarn.comments", column: "colour" }],
});

const { handleApi } = await import("../src/routes.js");
const { commentStore } = await import("../src/store/index.js");
const { exportArticle } = await import("../src/store/export.js");

let article: ScratchArticle | undefined;
let BLOCK = "";
let QUOTE = "";
const AT = 0;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  const block = article.blocks.find((b) => b.text.length > 40);
  if (!block) throw new Error("the fixture has no block long enough to quote");
  BLOCK = block.id;
  QUOTE = block.text.slice(AT, AT + 20);
});

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

afterEach(async () => {
  if (!article) return;
  await asTestOwner(async () => {
    for (const c of await commentStore.load(SLUG)) await commentStore.remove(SLUG, c.id);
  });
});

const POST = `/api/comments/${SLUG}`;
const colourUrl = (id: string) => `/api/comments/${SLUG}/${id}/colour`;

interface Reply {
  status: number;
  body: { error?: string; comment?: Comment };
}

/** `handleApi` over a fake request/response pair — tests/comment-referee-mark.test.ts's harness. */
async function call(method: string, url: string, body?: unknown): Promise<Reply> {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;
  let status = 0;
  let text = "";
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader() {},
    end(chunk: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
  return { status, body: text ? JSON.parse(text) : {} };
}

/** What the store holds — never what the route just said. */
async function stored(id: string): Promise<Comment | undefined> {
  return (await asTestOwner(() => commentStore.load(SLUG))).find((c) => c.id === id);
}

async function made(fields: Record<string, unknown>): Promise<string> {
  const r = await call("POST", POST, { blockId: BLOCK, quote: QUOTE, start: AT, ...fields });
  expect(r.status, r.body.error).toBe(201);
  const id = r.body.comment?.id;
  if (id === undefined) throw new Error("201 with no comment");
  return id;
}

describe("a colour on the create path", () => {
  it("stores a wordless highlight's colour, in the answer and on disk", async () => {
    const id = await made({ colour: "green" });
    expect((await stored(id))?.colour).toBe("green");
    expect((await stored(id))?.body).toBeUndefined();
  });

  it("leaves an uncoloured comment with no colour key, rather than a null", async () => {
    const id = await made({ body: "hm" });
    expect("colour" in ((await stored(id)) ?? {})).toBe(false);
  });

  it("refuses a colour that is not one of the four, and stores nothing", async () => {
    for (const colour of ["purple", "Yellow", "", 3, { name: "yellow" }]) {
      const r = await call("POST", POST, { blockId: BLOCK, quote: QUOTE, start: AT, colour });
      expect({ colour, status: r.status }).toEqual({ colour, status: 400 });
    }
    expect(await asTestOwner(() => commentStore.load(SLUG))).toEqual([]);
  });

  it("refuses a colour on a whole-paragraph bookmark (S4)", async () => {
    const r = await call("POST", POST, { blockId: BLOCK, colour: "yellow" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/whole-paragraph/);
    expect(await asTestOwner(() => commentStore.load(SLUG))).toEqual([]);
  });
});

describe("the same Save twice, and a different one under the same id (S10)", () => {
  it("hands back the stored row for the same id and the same colour", async () => {
    const id = mintId();
    const first = await call("POST", POST, { id, blockId: BLOCK, quote: QUOTE, start: AT, colour: "blue" });
    const again = await call("POST", POST, { id, blockId: BLOCK, quote: QUOTE, start: AT, colour: "blue" });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body.comment?.id).toBe(id);
    expect(await asTestOwner(() => commentStore.load(SLUG))).toHaveLength(1);
  });

  it("refuses the same id with a different colour, and keeps the first", async () => {
    const id = mintId();
    await call("POST", POST, { id, blockId: BLOCK, quote: QUOTE, start: AT, colour: "blue" });
    const clash = await call("POST", POST, { id, blockId: BLOCK, quote: QUOTE, start: AT, colour: "pink" });
    expect(clash.status).toBe(409);
    expect((await stored(id))?.colour).toBe("blue");
  });

  it("treats no colour and a named colour as different Saves, both ways round", async () => {
    const plain = mintId();
    await call("POST", POST, { id: plain, blockId: BLOCK, quote: QUOTE, start: AT });
    const coloured = await call("POST", POST, { id: plain, blockId: BLOCK, quote: QUOTE, start: AT, colour: "yellow" });
    expect(coloured.status).toBe(409);

    const hl = mintId();
    await call("POST", POST, { id: hl, blockId: BLOCK, quote: QUOTE, start: AT, colour: "yellow" });
    const bare = await call("POST", POST, { id: hl, blockId: BLOCK, quote: QUOTE, start: AT });
    expect(bare.status).toBe(409);
    expect((await stored(hl))?.colour).toBe("yellow");
    expect("colour" in ((await stored(plain)) ?? {})).toBe(false);
  });
});

describe("PATCH /api/comments/:slug/:id/colour", () => {
  it("recolours, then takes the colour away with null", async () => {
    const id = await made({ colour: "yellow", body: "a note" });

    const pink = await call("PATCH", colourUrl(id), { colour: "pink" });
    expect(pink.status).toBe(200);
    expect(pink.body.comment?.colour).toBe("pink");
    expect((await stored(id))?.colour).toBe("pink");

    const none = await call("PATCH", colourUrl(id), { colour: null });
    expect(none.status).toBe(200);
    expect("colour" in (none.body.comment ?? {})).toBe(false);
    expect("colour" in ((await stored(id)) ?? {})).toBe(false);
    /* Only the colour: the words survive, and a recolour is not an edit. */
    expect((await stored(id))?.body).toBe("a note");
    expect((await stored(id))?.updatedAt).toBeUndefined();
  });

  it("colours a comment that had none", async () => {
    const id = await made({});
    const r = await call("PATCH", colourUrl(id), { colour: "green" });
    expect(r.status).toBe(200);
    expect((await stored(id))?.colour).toBe("green");
  });

  it("refuses a patch that does not say what the colour is", async () => {
    const id = await made({ colour: "blue" });
    const r = await call("PATCH", colourUrl(id), {});
    expect(r.status).toBe(400);
    expect((await stored(id))?.colour).toBe("blue");
  });

  it("refuses a colour that is not one of the four", async () => {
    const id = await made({ colour: "blue" });
    const r = await call("PATCH", colourUrl(id), { colour: "orange" });
    expect(r.status).toBe(400);
    expect((await stored(id))?.colour).toBe("blue");
  });

  it("refuses a colour on a whole-paragraph bookmark with a 409 (S4)", async () => {
    const r = await call("POST", POST, { blockId: BLOCK });
    expect(r.status).toBe(201);
    const id = r.body.comment?.id ?? "";
    const patched = await call("PATCH", colourUrl(id), { colour: "yellow" });
    expect(patched.status).toBe(409);
    expect("colour" in ((await stored(id)) ?? {})).toBe(false);
  });

  it("answers 404 for a comment that does not exist", async () => {
    const r = await call("PATCH", colourUrl(mintId()), { colour: "yellow" });
    expect(r.status).toBe(404);
  });
});

describe("the database refuses what the route refuses", () => {
  /** A raw insert — the SQL half, with nothing above it to help. */
  const insert = (fields: { quote: string | null; start: number | null; colour: string }) =>
    getDb()
      .insert(commentsTable)
      .values({
        articleId: article?.articleId ?? "",
        id: mintId(),
        ownerId: TEST_OWNER,
        blockId: BLOCK,
        status: "none",
        ...fields,
      });

  /** The check-violation code, read off the error or its cause. */
  const code = async (p: Promise<unknown>): Promise<string | undefined> => {
    try {
      await p;
      return undefined;
    } catch (e) {
      const err = e as { code?: string; cause?: { code?: string } };
      return err.code ?? err.cause?.code;
    }
  };

  it("refuses a colour outside the four (comments_colour)", async () => {
    expect(await code(insert({ quote: QUOTE, start: AT, colour: "purple" }))).toBe("23514");
  });

  it("refuses a colour on a quote-less row (comments_colour_needs_quote)", async () => {
    expect(await code(insert({ quote: null, start: null, colour: "yellow" }))).toBe("23514");
  });

  it("takes each of the four on a selection, so the refusals above are not vacuous", async () => {
    for (const colour of ["yellow", "green", "blue", "pink"]) {
      expect(await code(insert({ quote: QUOTE, start: AT, colour }))).toBeUndefined();
    }
  });
});

describe("the rollback exporter (S11)", () => {
  it("writes the colour into comments.json, and no key for an uncoloured note", async () => {
    const hl = await made({ colour: "pink" });
    const plain = await made({ body: "an ordinary note" });
    const out = await mkdtemp(path.join(tmpdir(), "spideryarn-export-colour-"));
    try {
      await asTestOwner(() =>
        exportArticle(SLUG, { dataRoot: out, outputRoot: path.join(out, "output") }),
      );
      const { comments } = JSON.parse(
        await readFile(path.join(out, SLUG, "comments.json"), "utf8"),
      ) as { comments: Record<string, unknown>[] };
      expect(comments.find((c) => c.id === hl)?.colour).toBe("pink");
      const note = comments.find((c) => c.id === plain);
      expect(note).toBeDefined();
      expect("colour" in (note ?? {})).toBe(false);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
