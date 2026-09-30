/**
 * **The job runner's half of High-powered AI** — `readStepPower` in src/jobs.ts,
 * docs/plans/260930f-high-powered-ai-per-article.md decisions 3–4.
 *
 * tests/jobs-walk.test.ts holds that the walk hands each step whatever
 * `AdvanceParts.power` says, and fails the step when it cannot say. This holds
 * the production reader against real rows — and that production is wired to it,
 * because a fake injected into every other test cannot see whether the real one
 * is (the composition-root mutation, docs/postmortems on imaginary coverage):
 *
 * - an administrator's article with the column set is `high`;
 * - a reader's article with the column set is `standard` — a copied, restored or
 *   hand-edited row must not double what we spend before billing exists;
 * - an administrator's article with the column clear is `standard`;
 * - no row at all is a failure, never a quiet `standard`.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { DEV_OWNER_ID } from "../src/owner.js";
import type { Job } from "../src/types.js";
import { TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

await pgReady({ suite: "tests/high-power-step.test.ts", tables: ["spideryarn.articles"] });

const { PRODUCTION, readStepPower } = await import("../src/jobs.js");

const ADMINS = "test-high-power-step-admins";
const READERS = "test-high-power-step-readers";

let admins: ScratchArticle | undefined;
let readers: ScratchArticle | undefined;

beforeAll(async () => {
  admins = await scratchArticleInPg(ADMINS, { ownerId: TEST_OWNER });
  readers = await scratchArticleInPg(READERS, { ownerId: DEV_OWNER_ID });
}, 120_000);

afterAll(async () => {
  await admins?.remove();
  await readers?.remove();
  await closeDb();
});

const jobFor = (slug: string, ownerId: Job["ownerId"]): Job =>
  ({ id: "job", ownerId, slug, steps: [], status: "running", createdAt: "" }) as Job;

async function setColumn(articleId: string, on: boolean): Promise<void> {
  await getDb()
    .update(articles)
    .set({ highPowerSince: on ? new Date() : null })
    .where(eq(articles.id, articleId));
}

describe("readStepPower", { timeout: 60_000 }, () => {
  it("is high for an administrator's article with the column set", async () => {
    await setColumn(admins!.articleId, true);
    expect(await readStepPower(jobFor(ADMINS, TEST_OWNER))).toBe("high");
  });

  it("is standard for an administrator's article with the column clear", async () => {
    await setColumn(admins!.articleId, false);
    expect(await readStepPower(jobFor(ADMINS, TEST_OWNER))).toBe("standard");
  });

  it("is standard for a reader's article even with the column set (decision 4)", async () => {
    await setColumn(readers!.articleId, true);
    expect(await readStepPower(jobFor(READERS, DEV_OWNER_ID))).toBe("standard");
  });

  it("is owner-scoped: another owner's job does not read this article's column", async () => {
    await setColumn(admins!.articleId, true);
    await expect(readStepPower(jobFor(ADMINS, DEV_OWNER_ID))).rejects.toThrow(/No article row/);
  });

  it("fails rather than answering standard when there is no row", async () => {
    await expect(readStepPower(jobFor("test-high-power-step-nobody", TEST_OWNER))).rejects.toThrow(
      /No article row/,
    );
  });

  it("is what production's walk is wired to", () => {
    expect(PRODUCTION.power).toBe(readStepPower);
  });
});
