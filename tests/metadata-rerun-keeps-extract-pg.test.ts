/**
 * **The administrator's standalone `metadata` run, through Postgres and a real
 * job, keeps what `extract` wrote.** Plan 261009p, GPT Sol's plan review F2.
 *
 * tests/metadata-rerun-keeps-extract.test.ts holds the rules over a fake
 * store. This is the part a fake cannot show: that the draft the job writes
 * into really does carry the published revision's columns, that the step reads
 * them, and that `metaColumns` then writes them back rather than null.
 *
 * Real: `enqueue`, `advanceJobWith`, `claimSession`, the draft and its carry,
 * the step, the write and the publication. Faked: the metadata reader, the
 * registry and the title tidier, so no model and no network.
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { type AdvanceParts, advanceJobWith, claimSession, enqueue } from "../src/jobs.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import { STEPS, articleRegistryDeps, metadataReaders, titleTidiers } from "../src/pipeline.js";
import type { Job } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();
vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

await pgReady({
  suite: "tests/metadata-rerun-keeps-extract-pg.test.ts",
  columns: [{ table: "spideryarn.article_revisions", column: "quality" }],
});

const ADMIN = ADMIN_USER_ID_LOCAL as OwnerId;
const RUN = randomUUID().slice(0, 8);
const SLUG = `test-metadata-rerun-${RUN}`;

/**
 * How `extract` read it, written onto the published revision before the run.
 * Not `source`: the corpus article's stored bytes are HTML, and `source` is the
 * step's own reading of what the bytes are (`made`).
 */
const READ_BY_EXTRACT = {
  extractMethod: "model:pages",
  pages: 12,
  unverified: true,
  recall: 0.93,
  pagesChecked: 12,
  quality: [`page 3 looked short (${RUN})`],
  siteName: "Example Journal Site",
  lang: "en",
  excerpt: "The excerpt extract wrote.",
  note: "A note extract wrote.",
  byline: "Extract Author, University of Somewhere",
  abstract: "The abstract extract kept.",
  doi: "10.1234/extract",
  journal: "Extract Journal",
  publishedAt: "2023-05-01",
} as const;

let article: ScratchArticle | undefined;

async function currentRevision() {
  const [row] = await getDb()
    .select({ id: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.slug, SLUG))
    .limit(1);
  if (!row?.id) throw new Error(`no current revision for ${SLUG}`);
  const [revision] = await getDb().select().from(articleRevisions).where(eq(articleRevisions.id, row.id));
  if (!revision) throw new Error(`no revision row ${row.id}`);
  return revision;
}

async function drive(id: string): Promise<Job> {
  const parts: AdvanceParts = { power: async () => "standard", session: claimSession, steps: STEPS };
  return await runAsOwner(ADMIN, async () => {
    for (let n = 1; n <= 40; n++) {
      const advanced = await advanceJobWith(id, parts);
      if (advanced?.done) return advanced.job;
      if (advanced?.busy) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`job ${id} did not finish in 40 advances`);
  });
}

beforeAll(async () => {
  await seedAuthUser(getDb(), { id: ADMIN, email: `metadata-rerun-${ADMIN}@example.invalid`, onConflictDoNothing: true });
  article = await scratchArticleInPg(SLUG, { ownerId: ADMIN });
  const before = await currentRevision();
  await getDb().update(articleRevisions).set({ ...READ_BY_EXTRACT, quality: [...READ_BY_EXTRACT.quality] }).where(eq(articleRevisions.id, before.id));
});

afterAll(async () => {
  vi.restoreAllMocks();
  await article?.remove();
  await closeDb();
});

describe("the administrator's standalone metadata run on an article extract read", () => {
  it("publishes a revision that still says how the PDF was read", async () => {
    const before = await currentRevision();
    vi.spyOn(articleRegistryDeps, "lookup").mockResolvedValue({ kind: "unavailable", why: "busy" });
    vi.spyOn(titleTidiers, "import").mockResolvedValue({ title: "A Fresh Title" });
    const found = {
      title: "A Fresh Title", authors: [], abstract: null, doi: null, from: "model" as const, textChars: 100,
      answeredBy: "fixture",
    };
    vi.spyOn(metadataReaders, "html").mockResolvedValue(found);
    vi.spyOn(metadataReaders, "pdf").mockResolvedValue(found);

    const job = await runAsOwner(ADMIN, () =>
      enqueue({ slug: SLUG, steps: ["metadata"], force: ["metadata"], pump: false }),
    );
    const done = await drive(job.id);
    expect(done.status, done.error).toBe("done");

    const after = await currentRevision();
    expect(after.id).not.toBe(before.id);
    expect(after.title).toBe("A Fresh Title");
    expect(after).toMatchObject({ ...READ_BY_EXTRACT, quality: [...READ_BY_EXTRACT.quality] });
  });
});
