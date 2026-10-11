/**
 * **Major or minor: the reviewer's own sort of their own notes**, through the
 * real route and the real store, and out through the rollback exporter.
 *
 * Referee › Notes (docs/plans/261011f-referee-outline-your-notes-sorted-major-and-minor.md).
 * The field is the reviewer's alone: written only by its own named PATCH, with
 * the key required so an absent key can never mean "un-sort", and never by
 * `create`, so a resent Save cannot carry one in or take one away.
 * tests/comment-colour.test.ts is the shape this copies, and says why the
 * route rather than the store is what is called.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { comments as commentsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import type { Comment } from "../src/types.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-comment-severity";

await pgReady({
  suite: "tests/comment-severity.test.ts",
  columns: [{ table: "spideryarn.comments", column: "severity" }],
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
const sortUrl = (id: string) => `/api/comments/${SLUG}/${id}/severity`;

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

describe("PATCH /api/comments/:slug/:id/severity", () => {
  it("sorts a note major, then minor, then un-sorts it with null", async () => {
    const id = await made({ body: "Only four of the six are in Table 2." });
    expect("severity" in ((await stored(id)) ?? {})).toBe(false);

    const major = await call("PATCH", sortUrl(id), { severity: "major" });
    expect(major.status, major.body.error).toBe(200);
    expect(major.body.comment?.severity).toBe("major");
    expect((await stored(id))?.severity).toBe("major");

    const minor = await call("PATCH", sortUrl(id), { severity: "minor" });
    expect(minor.status).toBe(200);
    expect((await stored(id))?.severity).toBe("minor");

    const none = await call("PATCH", sortUrl(id), { severity: null });
    expect(none.status).toBe(200);
    expect("severity" in (none.body.comment ?? {})).toBe(false);
    expect("severity" in ((await stored(id)) ?? {})).toBe(false);
  });

  it("touches nothing else: the words, the colour and updatedAt survive a sort", async () => {
    const id = await made({ body: "a note", colour: "green" });
    const before = await stored(id);
    await call("PATCH", sortUrl(id), { severity: "major" });
    const after = await stored(id);
    expect(after?.body).toBe("a note");
    expect(after?.colour).toBe("green");
    /* A sort is not an edit of the words, so `updatedAt` must not move. */
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it("stamps severity_at on every sort, un-sorting included, and starts it null (GPT Sol F9)", async () => {
    const id = await made({ body: "n" });
    const at = async () =>
      (
        await getDb()
          .select({ severityAt: commentsTable.severityAt })
          .from(commentsTable)
          .where(eq(commentsTable.id, id))
      )[0]?.severityAt ?? null;
    expect(await at()).toBeNull();
    await call("PATCH", sortUrl(id), { severity: "major" });
    const first = await at();
    expect(first).toBeInstanceOf(Date);
    await call("PATCH", sortUrl(id), { severity: null });
    const second = await at();
    expect(second).toBeInstanceOf(Date);
    expect((second?.getTime() ?? 0) >= (first?.getTime() ?? 0)).toBe(true);
  });

  it("sorts a whole-paragraph note too", async () => {
    const r = await call("POST", POST, { blockId: BLOCK, body: "the whole paragraph" });
    expect(r.status, r.body.error).toBe(201);
    const id = r.body.comment?.id ?? "";
    const sorted = await call("PATCH", sortUrl(id), { severity: "minor" });
    expect(sorted.status, sorted.body.error).toBe(200);
    expect((await stored(id))?.severity).toBe("minor");
  });

  it("refuses a patch that does not say what the sort is, and keeps the one stored", async () => {
    const id = await made({ body: "n" });
    await call("PATCH", sortUrl(id), { severity: "major" });
    const r = await call("PATCH", sortUrl(id), {});
    expect(r.status).toBe(400);
    expect((await stored(id))?.severity).toBe("major");
  });

  it("refuses anything but major, minor or null", async () => {
    const id = await made({ body: "n" });
    await call("PATCH", sortUrl(id), { severity: "minor" });
    for (const severity of ["Major", "critical", "", 1, true, { v: "major" }]) {
      const r = await call("PATCH", sortUrl(id), { severity });
      expect({ severity, status: r.status }).toEqual({ severity, status: 400 });
    }
    expect((await stored(id))?.severity).toBe("minor");
  });

  it("answers 404 for a comment that does not exist", async () => {
    const r = await call("PATCH", sortUrl(mintId()), { severity: "major" });
    expect(r.status).toBe(404);
  });
});

describe("create never carries a sort", () => {
  it("ignores a severity sent on POST, so a Save cannot sort", async () => {
    const id = await made({ body: "n", severity: "major" });
    expect("severity" in ((await stored(id)) ?? {})).toBe(false);
  });

  it("a resent Save of a sorted note is still the same Save, and keeps the sort", async () => {
    const id = mintId();
    const first = await call("POST", POST, { id, blockId: BLOCK, quote: QUOTE, start: AT, body: "n" });
    expect(first.status).toBe(201);
    await call("PATCH", sortUrl(id), { severity: "major" });
    const again = await call("POST", POST, { id, blockId: BLOCK, quote: QUOTE, start: AT, body: "n" });
    expect(again.status, again.body.error).toBeLessThan(300);
    expect((await stored(id))?.severity).toBe("major");
  });
});

describe("the database refuses what the route refuses", () => {
  const insert = (severity: string) =>
    getDb()
      .insert(commentsTable)
      .values({
        articleId: article?.articleId ?? "",
        id: mintId(),
        ownerId: TEST_OWNER,
        blockId: BLOCK,
        quote: QUOTE,
        start: AT,
        status: "none",
        severity,
      });

  const code = async (p: Promise<unknown>): Promise<string | undefined> => {
    try {
      await p;
      return undefined;
    } catch (e) {
      const err = e as { code?: string; cause?: { code?: string } };
      return err.code ?? err.cause?.code;
    }
  };

  it("refuses a sort outside the two (comments_severity)", async () => {
    expect(await code(insert("critical"))).toBe("23514");
  });

  it("takes both, so the refusal above is not vacuous", async () => {
    for (const s of ["major", "minor"]) expect(await code(insert(s))).toBeUndefined();
  });
});

describe("the rollback exporter", () => {
  it("writes the sort into comments.json, and no key for an unsorted note", async () => {
    const sorted = await made({ body: "a major one" });
    await call("PATCH", sortUrl(sorted), { severity: "major" });
    const plain = await made({ body: "unsorted" });
    const out = await mkdtemp(path.join(tmpdir(), "spideryarn-export-severity-"));
    try {
      await asTestOwner(() =>
        exportArticle(SLUG, { dataRoot: out, outputRoot: path.join(out, "output") }),
      );
      const { comments } = JSON.parse(
        await readFile(path.join(out, SLUG, "comments.json"), "utf8"),
      ) as { comments: Record<string, unknown>[] };
      expect(comments.find((c) => c.id === sorted)?.severity).toBe("major");
      const note = comments.find((c) => c.id === plain);
      expect(note).toBeDefined();
      expect("severity" in (note ?? {})).toBe(false);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
