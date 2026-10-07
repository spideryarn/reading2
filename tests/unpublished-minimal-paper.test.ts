/** A minimal article can exist before its first revision is published.
 * Exercise the real article reader with the two database outcomes supplied;
 * the Postgres route counterpart is in minimal-paper.test.ts. */
import { beforeEach, expect, it, vi } from "vitest";
import { NOT_READ_YET } from "../src/messages.js";
import { NotProcessed } from "../src/not-processed.js";
import { runAsOwner } from "../src/owner.js";
import { TEST_OWNER } from "./helpers/authed.js";

const reads = vi.hoisted(() => ({ processing: vi.fn(), select: vi.fn() }));
vi.mock("../src/minimal-paper.js", async (original) => ({
  ...(await original<typeof import("../src/minimal-paper.js")>()),
  processingOf: reads.processing,
}));
vi.mock("../src/db/client.js", async (original) => ({
  ...(await original<typeof import("../src/db/client.js")>()),
  getDb: () => ({ select: reads.select }),
}));

const { pgArticleReader } = await import("../src/store/pg.js");
const SLUG = "unpublished-minimal";

beforeEach(() => {
  vi.clearAllMocks();
  const query = {
    from: () => query,
    innerJoin: () => query,
    where: () => query,
    limit: async () => [],
  };
  reads.select.mockReturnValue(query);
  reads.processing.mockResolvedValue(undefined);
});

it("refuses a minimal article before its first publication with the existing 409", async () => {
  reads.processing.mockResolvedValue({ id: "internal-id", processing: "minimal" });
  const err = await runAsOwner(TEST_OWNER, () => pgArticleReader.loadArticle(SLUG)).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(NotProcessed);
  expect(err).toMatchObject({ status: 409, message: NOT_READ_YET.message });
  expect(reads.processing).toHaveBeenCalledExactlyOnceWith(SLUG, TEST_OWNER);
  expect(reads.select).toHaveBeenCalledTimes(1);
});

it("keeps a full article without a published revision as a 404", async () => {
  reads.processing.mockResolvedValue({ id: "internal-id", processing: "full" });
  await expect(runAsOwner(TEST_OWNER, () => pgArticleReader.loadArticle(SLUG)))
    .rejects.toMatchObject({ status: 404 });
});

it("keeps a missing or another owner's article as a 404", async () => {
  await expect(runAsOwner(TEST_OWNER, () => pgArticleReader.loadArticle(SLUG)))
    .rejects.toMatchObject({ status: 404 });
});
