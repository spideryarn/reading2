/**
 * **The rollback keeps a quick search quick** (plan 261002e, F6).
 *
 * `search_runs.kind` defaults to `'meaning'`, so an exporter that forgot the
 * column would bring every quick search back from a round trip as a meaning
 * one — and its whole-paragraph quotes and Jev probabilities would then be read
 * as Sonnet's. Nothing would fail. No fixture in `data/` has a quick run, so
 * tests/store-roundtrip.test.ts cannot see this; the rows are made here, one of
 * each kind, as tests/store-export-referee.test.ts does for its own columns.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, searchRuns } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { exportArticle } from "../src/store/export.js";
import type { SearchRun } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const SLUG = "store-export-search-kind-fixture";
const ARTICLE_ID = "00000000-0000-4000-8000-0000000a51c1";
const REVISION_ID = "00000000-0000-4000-8000-0000000a51c2";
const QUICK_ID = "spya-qkx234";
const MEANING_ID = "spya-mnx234";

await pgReady({
  suite: "tests/store-export-search-kind.test.ts",
  tables: ["spideryarn.search_runs"],
});

describe("db:export and a search's kind", () => {
  let out: string;

  beforeAll(async () => {
    const db = getDb();
    const owner = currentOwnerId();
    await db
      .insert(articles)
      .values({ id: ARTICLE_ID, ownerId: owner, slug: SLUG })
      .onConflictDoNothing();
    await db
      .insert(articleRevisions)
      .values({ id: REVISION_ID, articleId: ARTICLE_ID, status: "published" })
      .onConflictDoNothing();
    await db
      .update(articles)
      .set({ currentRevisionId: REVISION_ID })
      .where(eq(articles.id, ARTICLE_ID));
    await db.delete(searchRuns).where(eq(searchRuns.articleId, ARTICLE_ID));
    await db.insert(searchRuns).values([
      {
        articleId: ARTICLE_ID,
        id: QUICK_ID,
        ownerId: owner,
        criterion: "minds are not software",
        kind: "quick",
        status: "done",
        hits: [],
        model: "typesafe/jev-1.13",
        createdAt: new Date("2026-10-02T10:00:00.000Z"),
      },
      {
        articleId: ARTICLE_ID,
        id: MEANING_ID,
        ownerId: owner,
        criterion: "minds are not software",
        /* Left to the column default, which is what every row before
           2026-10-02 has — so the export must write it out, not leave it to
           whoever reads the file to assume. */
        status: "done",
        hits: [],
        createdAt: new Date("2026-10-02T10:01:00.000Z"),
      },
    ]);

    out = await mkdtemp(path.join(tmpdir(), "spideryarn-export-search-kind-"));
    await exportArticle(SLUG, { dataRoot: out, outputRoot: path.join(out, "output") });
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(searchRuns).where(eq(searchRuns.articleId, ARTICLE_ID));
    await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, ARTICLE_ID));
    await db.delete(articleRevisions).where(eq(articleRevisions.id, REVISION_ID));
    await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
    await closeDb();
    if (out) await rm(out, { recursive: true, force: true });
  });

  it("writes each run's kind, the quick one and the defaulted one", async () => {
    const file = JSON.parse(
      await readFile(path.join(out, SLUG, "searches.json"), "utf8"),
    ) as { runs: SearchRun[] };
    const kinds = Object.fromEntries(file.runs.map((r) => [r.id, r.kind]));
    expect(kinds).toEqual({ [QUICK_ID]: "quick", [MEANING_ID]: "meaning" });
  });
});
