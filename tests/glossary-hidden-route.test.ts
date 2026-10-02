/**
 * **Hiding a glossary entry, through the route and Postgres** —
 * `PUT`/`DELETE /api/glossary/:slug/hidden/:entryId`, src/store/pg-glossary-hidden.ts,
 * and the owner's read attaching `hidden: true` (`loadGlossary`, src/store/pg.ts).
 * docs/plans/261002c-glossary-hide-an-entry-dig-deeper-from-the-card-hyphens-match-spaces.md § 2.
 *
 * 1. **A round trip**: PUT is a 204 and the next GET carries `hidden: true` on
 *    that entry and no other; DELETE is a 204 and the flag goes.
 * 2. **Both are idempotent.**
 * 3. **A stranger's slug is a 404 on both verbs**, and writes nothing.
 * 4. **A malformed id is a 400.**
 * 5. **A well-formed id the glossary does not have is a 404 on PUT**, and
 *    writes nothing — but **DELETE of it is a 204**, so an orphan row (an
 *    entry that has since left the glossary) can still be removed.
 * 6. **Deleting the article removes the rows.**
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, glossaryHiddenEntries } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { EVAL_OWNER_ID } from "../src/owner.js";
import type { Glossary, GlossaryEntry } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-glossary-hidden-route";
const STRANGERS = "test-glossary-hidden-route-strangers";
const DOOMED = "test-glossary-hidden-route-doomed";

/* Well-formed ids in the id alphabet, used by no other test file. */
const KEPT = "spya-ghk2zt";
const HIDDEN = "spya-ghk3wr";
const ABSENT = "spya-ghk4xm";

await pgReady({
  suite: "tests/glossary-hidden-route.test.ts",
  tables: ["spideryarn.glossary_hidden_entries", "spideryarn.article_revisions"],
});

const { handleApi } = await import("../src/routes.js");

let article: ScratchArticle | undefined;
let strangers: ScratchArticle | undefined;
let doomed: ScratchArticle | undefined;

/**
 * Put a known two-entry glossary on the article's current revision, over
 * whatever the fixture copied, so the ids are ours to name.
 */
async function giveGlossary(which: ScratchArticle | undefined): Promise<void> {
  if (!which) throw new Error("no scratch article");
  const db = getDb();
  const [row] = await db
    .select({ revisionId: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.id, which.articleId));
  if (!row?.revisionId) throw new Error(`${which.slug} has no current revision`);
  const [current] = await db
    .select({ glossary: articleRevisions.glossary })
    .from(articleRevisions)
    .where(eq(articleRevisions.id, row.revisionId));
  const base = (current?.glossary ?? {}) as Partial<Glossary>;
  const block = which.blocks[0]?.id;
  if (!block) throw new Error(`${which.slug} has no blocks`);
  const entry = (id: string, name: string): GlossaryEntry => ({
    id,
    name,
    kind: "concept",
    aliases: [],
    senseHere: `What ${name} means here.`,
    blocks: [],
  });
  const glossary = {
    version: "glossary/3",
    generator: "test",
    sourceHash: "f".repeat(64),
    passes: 1,
    generatedAt: "2026-10-02T00:00:00.000Z",
    elapsedMs: 1,
    ...base,
    slug: which.slug,
    entries: [entry(KEPT, "Win-shift"), entry(HIDDEN, "Radial arm maze")],
  };
  await db
    .update(articleRevisions)
    .set({ glossary: glossary as unknown as Glossary })
    .where(eq(articleRevisions.id, row.revisionId));
}

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  /* Owned by somebody else: the requests below authenticate as `TEST_OWNER`. */
  strangers = await scratchArticleInPg(STRANGERS, { ownerId: EVAL_OWNER_ID });
  doomed = await scratchArticleInPg(DOOMED, { ownerId: TEST_OWNER });
  await giveGlossary(article);
  await giveGlossary(strangers);
  await giveGlossary(doomed);
}, 120_000);

afterAll(async () => {
  await article?.remove();
  await strangers?.remove();
  await doomed?.remove();
  await closeDb();
});

async function request(method: string, url: string): Promise<{ status: number; body: unknown }> {
  const req = Object.assign(
    (async function* () {})(),
    { method, url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;
  let written = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    writeHead(s: number) {
      (this as { statusCode: number }).statusCode = s;
    },
    flushHeaders() {},
    on() {},
    write(piece: string) {
      written += piece;
      return true;
    },
    end(piece?: string) {
      if (piece) written += piece;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
  return {
    status: (res as unknown as { statusCode: number }).statusCode,
    body: written ? JSON.parse(written) : null,
  };
}

const hide = (slug: string, id: string) => request("PUT", `/api/glossary/${slug}/hidden/${id}`);
const unhide = (slug: string, id: string) => request("DELETE", `/api/glossary/${slug}/hidden/${id}`);

/** Which entries the owner's read says are hidden. */
async function hiddenInRead(slug: string): Promise<string[]> {
  const got = await request("GET", `/api/glossary/${slug}`);
  expect(got.status).toBe(200);
  const entries = (got.body as { glossary: { entries: GlossaryEntry[] } }).glossary.entries;
  return entries.filter((e) => e.hidden === true).map((e) => e.id);
}

async function rowsOf(which: ScratchArticle | undefined): Promise<string[]> {
  const rows = await getDb()
    .select({ entryId: glossaryHiddenEntries.entryId })
    .from(glossaryHiddenEntries)
    .where(eq(glossaryHiddenEntries.articleId, which?.articleId ?? ""));
  return rows.map((r) => r.entryId).sort();
}

describe("PUT and DELETE /api/glossary/:slug/hidden/:entryId", () => {
  it("hides an entry, the owner's read says so, and unhiding takes it back", async () => {
    expect(await hiddenInRead(SLUG)).toEqual([]);
    expect((await hide(SLUG, HIDDEN)).status).toBe(204);
    expect(await hiddenInRead(SLUG)).toEqual([HIDDEN]);
    expect((await unhide(SLUG, HIDDEN)).status).toBe(204);
    expect(await hiddenInRead(SLUG)).toEqual([]);
  });

  it("is idempotent both ways", async () => {
    expect((await hide(SLUG, HIDDEN)).status).toBe(204);
    expect((await hide(SLUG, HIDDEN)).status).toBe(204);
    expect(await rowsOf(article)).toEqual([HIDDEN]);
    expect((await unhide(SLUG, HIDDEN)).status).toBe(204);
    expect((await unhide(SLUG, HIDDEN)).status).toBe(204);
    expect(await rowsOf(article)).toEqual([]);
  });

  it("is a 404 on both verbs for an article somebody else owns, and writes nothing", async () => {
    expect((await hide(STRANGERS, HIDDEN)).status).toBe(404);
    expect((await unhide(STRANGERS, HIDDEN)).status).toBe(404);
    expect(await rowsOf(strangers)).toEqual([]);
  });

  it("refuses a malformed id with a 400", async () => {
    expect((await hide(SLUG, "not-an-id")).status).toBe(400);
    expect((await unhide(SLUG, "not-an-id")).status).toBe(400);
    expect(await rowsOf(article)).toEqual([]);
  });

  it("refuses to hide a well-formed id the glossary does not have, with a sentence", async () => {
    const got = await hide(SLUG, ABSENT);
    expect(got.status).toBe(404);
    expect(JSON.stringify(got.body)).toContain("not in this article's glossary");
    expect(await rowsOf(article)).toEqual([]);
  });

  it("unhides an orphan — a row whose entry has left the glossary", async () => {
    await getDb().insert(glossaryHiddenEntries).values({ articleId: article?.articleId ?? "", entryId: ABSENT });
    expect(await rowsOf(article)).toEqual([ABSENT]);
    expect((await unhide(SLUG, ABSENT)).status).toBe(204);
    expect(await rowsOf(article)).toEqual([]);
  });

  it("goes when the article does", async () => {
    expect((await hide(DOOMED, KEPT)).status).toBe(204);
    expect(await rowsOf(doomed)).toEqual([KEPT]);
    await doomed?.remove();
    expect(await rowsOf(doomed)).toEqual([]);
  });
});
