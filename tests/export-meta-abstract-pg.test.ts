/**
 * **The rollback's `meta.json` carries the abstract**, and still leaves out the
 * DOI and the journal. Plan 261009q.
 *
 * `src/store/export.ts` builds `meta.json` field by field, so a field it does
 * not name is a field the rollback loses with nothing saying so — the class in
 * docs/postmortems/261009h-a-flag-the-store-did-not-keep.md. The abstract was
 * one: for a minimal paper it is the only prose the article has.
 *
 * `doi` and `journal` are pinned *absent* on purpose: whether the rollback
 * should carry them is Greg's open question (plan 261004a), and the omission is
 * written down beside the code and in docs/project/export.md. When he decides,
 * this assertion is the one to change.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { exportArticle } from "../src/store/export.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

await pgReady({
  suite: "tests/export-meta-abstract-pg.test.ts",
  columns: [{ table: "spideryarn.article_revisions", column: "abstract" }],
});

const RUN = randomUUID().slice(0, 8);
const SLUG = `test-export-abstract-${RUN}`;
const ABSTRACT = `We study the arrow of time (${RUN}).`;

let article: ScratchArticle | undefined;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: DEV_OWNER_ID });
  const [row] = await getDb()
    .select({ id: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.slug, SLUG))
    .limit(1);
  if (!row?.id) throw new Error(`no current revision for ${SLUG}`);
  await getDb()
    .update(articleRevisions)
    .set({ abstract: ABSTRACT, doi: "10.1234/abstract-test", journal: "Journal of Tests" })
    .where(eq(articleRevisions.id, row.id));
}, 60_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

describe("the rollback's meta.json", () => {
  it("carries the abstract, and not yet the DOI or the journal", async () => {
    const out = await mkdtemp(path.join(tmpdir(), "spideryarn-export-abstract-"));
    try {
      await runAsOwner(DEV_OWNER_ID, () =>
        exportArticle(SLUG, { dataRoot: out, outputRoot: path.join(out, "output") }),
      );
      const meta = JSON.parse(await readFile(path.join(out, SLUG, "meta.json"), "utf8")) as Record<string, unknown>;
      expect(meta.abstract).toBe(ABSTRACT);
      expect(meta).not.toHaveProperty("doi");
      expect(meta).not.toHaveProperty("journal");
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
