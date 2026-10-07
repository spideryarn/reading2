/**
 * **`ShelfStore.articlesOpenedBefore`, against Postgres** — the guide's measure
 * of how much a reader has used Spideryarn (GPT Sol's F7 on
 * docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md).
 *
 * Each rule the count keeps has a row here that only that rule excludes, so a
 * dropped predicate shows up as a wrong number rather than passing quietly:
 * another owner's opened article, an archived one, one never opened, one with
 * no published revision (a failed first ingest), and the article the guide is
 * on. And the answer is checked to be a number at runtime, not only in its type.
 *
 * Two private owners, seeded here, so no other suite's articles can move the
 * count while this one runs.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import { pgShelfStore } from "../src/store/pg-shelf.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

await pgReady({ suite: "tests/guide-experience-pg.test.ts", tables: ["spideryarn.articles"] });

const READER = randomUUID() as OwnerId;
const STRANGER = randomUUID() as OwnerId;
const tag = READER.slice(0, 8);
const slug = (name: string) => `test-guide-exp-${tag}-${name.toLowerCase()}`;

/** One article per rule, and how each is set up. */
const ROWS = {
  here: { owner: READER, opens: 4, archived: false, published: true },
  read1: { owner: READER, opens: 1, archived: false, published: true },
  read2: { owner: READER, opens: 9, archived: false, published: true },
  neverOpened: { owner: READER, opens: 0, archived: false, published: true },
  archived: { owner: READER, opens: 3, archived: true, published: true },
  unpublished: { owner: READER, opens: 2, archived: false, published: false },
  strangers: { owner: STRANGER, opens: 5, archived: false, published: true },
} as const;

const ids = new Map<string, { article: string; revision: string }>();

describe("articlesOpenedBefore", () => {
  beforeAll(async () => {
    const db = getDb();
    for (const owner of [READER, STRANGER]) {
      await seedAuthUser(db, { id: owner, email: `guide-exp-${owner}@example.invalid` });
    }
    for (const [name, row] of Object.entries(ROWS)) {
      const article = randomUUID();
      const revision = randomUUID();
      ids.set(name, { article, revision });
      await db.insert(articles).values({
        id: article,
        ownerId: row.owner,
        slug: slug(name),
        opens: row.opens,
        ...(row.archived ? { archivedAt: new Date() } : {}),
      });
      if (row.published) {
        await db.insert(articleRevisions).values({ id: revision, articleId: article, status: "published" });
        await db.update(articles).set({ currentRevisionId: revision }).where(eq(articles.id, article));
      }
    }
  });

  afterAll(async () => {
    const db = getDb();
    const articleIds = [...ids.values()].map((v) => v.article);
    if (articleIds.length > 0) {
      await db.update(articles).set({ currentRevisionId: null }).where(inArray(articles.id, articleIds));
      await db.delete(articleRevisions).where(inArray(articleRevisions.articleId, articleIds));
      await db.delete(articles).where(inArray(articles.id, articleIds));
    }
    for (const owner of [READER, STRANGER]) await db.execute(sql`delete from auth.users where id = ${owner}`);
    await closeDb();
  });

  it("counts the reader's other opened articles on the shelf, and nothing else", async () => {
    const n = await runAsOwner(READER, () => pgShelfStore.articlesOpenedBefore(slug("here")));
    /* read1 and read2 only: not this one, not one never opened, not an archived
       one, not a failed ingest, not a stranger's. */
    expect(n).toBe(2);
    expect(typeof n).toBe("number");
  });

  it("counts the article the guide is on when asked from another one", async () => {
    const n = await runAsOwner(READER, () => pgShelfStore.articlesOpenedBefore(slug("neverOpened")));
    expect(n).toBe(3);
  });

  it("is owner-scoped: the stranger sees only their own", async () => {
    const n = await runAsOwner(STRANGER, () => pgShelfStore.articlesOpenedBefore(slug("here")));
    expect(n).toBe(1);
    const own = await runAsOwner(STRANGER, () => pgShelfStore.articlesOpenedBefore(slug("strangers")));
    expect(own).toBe(0);
  });

  it("refuses a slug that is not a slug, before any query", async () => {
    await expect(
      runAsOwner(READER, () => pgShelfStore.articlesOpenedBefore("../../etc")),
    ).rejects.toMatchObject({ status: 400 });
  });
});
