/**
 * **The Metadata page's glossary verdict, from the run's own inputs** —
 * `ArticleMetadata.glossaryRun`, plan
 * docs/plans/261001i-glossary-undo-find-more-and-say-append-or-rewrite-in-metadata.md § 3.
 *
 * The unit test (tests/glossary-run-kind.test.ts) holds the decision to
 * `existingFor`. What it cannot see is whether `articleMetadata` hands it the
 * *same* source fingerprint and profile the glossary job will: the page builds
 * its fingerprint from the revision's stored metadata columns, and the job from
 * `tryReadArticle` (src/article-input.ts). So the list here is stamped the way
 * the job would stamp it — from `tryReadArticle`, and from the owner's profile
 * rendered as `resolveProfile` renders it — and the page must call it `append`.
 * A page fingerprint or profile that drifted from the job's reads `rewrite`.
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { tryReadArticle } from "../src/article-input.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { PROMPT_VERSION, runProfileHash } from "../src/glossary.js";
import { CAPABLE_MODEL } from "../src/models.js";
import { runAsOwner, type OwnerId } from "../src/owner.js";
import { renderProfile } from "../src/profile.js";
import { articleFingerprint } from "../src/source-hash.js";
import { PIPELINE_RUN } from "../src/store/artifacts.js";
import { readsPgArtifacts } from "../src/store/artifacts-pg.js";
import { pgArticleReader } from "../src/store/pg.js";
import { pgReaderStore } from "../src/store/pg-reader.js";
import { beginRevision, publishRevision, recordStepRun } from "../src/store/pg-revisions.js";
import type { Glossary } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

await pgReady({
  suite: "tests/store-glossary-run-kind-pg.test.ts",
  tables: ["spideryarn.article_revisions", "spideryarn.reader_profiles"],
});

/* Its own owner, so the profile this suite writes is nobody else's to change
   mid-run — the profile is per reader, not per article. */
const OWNER = randomUUID() as OwnerId;
const SLUG = `test-glossary-run-kind-${OWNER.slice(0, 8)}`;
const as = <T>(fn: () => Promise<T>) => runAsOwner(OWNER, fn);

let article: ScratchArticle;
/** The fingerprint the glossary job would stamp, read the way the job reads it. */
let jobFingerprint: string;

const listFor = (over: Partial<Glossary>): Glossary => ({
  version: PROMPT_VERSION,
  generator: CAPABLE_MODEL,
  slug: SLUG,
  sourceHash: jobFingerprint,
  profileHash: null,
  entries: [],
  passes: 1,
  generatedAt: "2026-10-01T00:00:00.000Z",
  elapsedMs: 1,
  ...over,
});

/** Publish a revision whose glossary is `list`, as a run of the step would. */
async function publishGlossary(list: Glossary): Promise<void> {
  await as(async () => {
    const begun = await beginRevision({ slug: SLUG });
    await getDb()
      .update(articleRevisions)
      .set({ glossary: list })
      .where(eq(articleRevisions.id, begun.revisionId));
    await recordStepRun({
      revisionId: begun.revisionId,
      stepName: "glossary",
      inputHash: list.sourceHash,
      implementationVersion: PIPELINE_RUN,
      promptVersion: list.version,
      model: list.generator,
      status: "done",
      startedAt: new Date(Date.now() - 5_000),
      finishedAt: new Date(),
    });
    await publishRevision({ slug: SLUG, revisionId: begun.revisionId });
  });
}

const verdict = () => as(async () => (await pgArticleReader.articleMetadata(SLUG)).glossaryRun);

beforeAll(async () => {
  await seedAuthUser(getDb(), {
    id: OWNER,
    email: `glossary-run-kind-${OWNER}@example.test`,
    onConflictDoNothing: true,
  });
  article = await scratchArticleInPg(SLUG, { ownerId: OWNER });
  const [row] = await getDb()
    .select({ revisionId: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.id, article.articleId));
  if (!row?.revisionId) throw new Error("the scratch article has no published revision");
  const reads = readsPgArtifacts(
    {
      slug: SLUG,
      articleId: article.articleId,
      revisionId: row.revisionId,
      jobId: "none",
      attemptId: "none",
    },
    getDb(),
  );
  const input = await as(() => tryReadArticle(SLUG, reads));
  if (!input) throw new Error("the scratch article has no blocks or tree");
  jobFingerprint = articleFingerprint(input.blocks, input.tree, input.meta);
}, 60_000);

afterAll(async () => {
  await as(() => pgReaderStore.writeProfile(null));
  await article?.remove();
  await closeDb();
});

describe("ArticleMetadata.glossaryRun", () => {
  it("is append for a list stamped the way the glossary job stamps one", async () => {
    await as(() => pgReaderStore.writeProfile(null));
    await publishGlossary(listFor({}));
    expect(await verdict()).toBe("append");
  }, 30_000);

  it("is append for a profiled list when the reader's profile is the one it was written from", async () => {
    await as(() => pgReaderStore.writeProfile("A physicist."));
    const purpose = (await as(() => pgArticleReader.articleMetadata(SLUG))).purpose;
    /* `resolveProfile`'s rendering, over the same two boxes. */
    const rendered = renderProfile({ profile: "A physicist.", purpose });
    await publishGlossary(listFor({ profileHash: runProfileHash(rendered) }));
    expect(await verdict()).toBe("append");
  }, 30_000);

  it("is rewrite once the reader's profile has moved on", async () => {
    await as(() => pgReaderStore.writeProfile("A historian."));
    expect(await verdict()).toBe("rewrite");
  }, 30_000);

  it("is rewrite for a list written from another version of the article", async () => {
    await as(() => pgReaderStore.writeProfile(null));
    await publishGlossary(listFor({ sourceHash: "0000000000000000" }));
    expect(await verdict()).toBe("rewrite");
  }, 30_000);
});
