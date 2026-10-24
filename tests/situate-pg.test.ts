/**
 * **Situate in Postgres: owner only, and an allowance the table will take** —
 * plan docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md
 * (GPT Sol's S5 and S9).
 *
 * 1. **The owner reads it; nobody else does.** `GET /api/situate/:slug`
 *    answers the owner with the stored dossier and its three staleness facts,
 *    `200 null` before there is one; another owner's read of the same slug is
 *    "no such article"; and no public read selects the column or the DTO names
 *    it.
 * 2. **The `situate` bucket is one the table's CHECK admits** — a migration
 *    that never ran would make every press throw — and the policy's own
 *    numbers hold against the real limiter: one at a time, four an hour.
 *
 * Real store, real routes; the harness after
 * tests/none-yet-is-not-a-404-route.test.ts and tests/fetch-allowance.test.ts.
 */
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, rateLimitEvents } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import { emptyCounts, PROMPT_VERSION, SITUATE_RATE_POLICY } from "../src/situate.js";
import { loadSituate } from "../src/store/index.js";
import { pgFetchAllowanceStore } from "../src/store/pg-rate-limit.js";
import { NONE_YET_AS_NULL_HEADER, type Situate, type SituateResponse } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const SLUG = "test-situate-owner-read";
const STRANGER = "00000000-0000-4000-8000-0000005a7a7e" as OwnerId;

await pgReady({
  suite: "tests/situate-pg.test.ts",
  tables: ["spideryarn.article_revisions", "spideryarn.rate_limit_events"],
  columns: [{ table: "spideryarn.article_revisions", column: "situate" }],
});

await seedAuthUser(getDb(), { id: STRANGER, email: "situate-stranger@example.invalid", onConflictDoNothing: true });

const { handleApi } = await import("../src/routes.js");

let article: ScratchArticle | undefined;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
}, 240_000);

afterAll(async () => {
  await article?.remove();
  await getDb().delete(rateLimitEvents).where(eq(rateLimitEvents.ownerId, STRANGER));
  await closeDb();
});

async function setSituate(value: Situate | null): Promise<void> {
  if (!article) throw new Error("no article");
  const [row] = await getDb()
    .select({ revisionId: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.id, article.articleId));
  if (!row?.revisionId) throw new Error(`${SLUG} has no published revision`);
  const written = await getDb()
    .update(articleRevisions)
    .set({ situate: value })
    .where(eq(articleRevisions.id, row.revisionId))
    .returning({ id: articleRevisions.id });
  if (written.length !== 1) throw new Error(`wrote ${written.length} revisions, not 1`);
}

async function get(url: string): Promise<{ status: number; body: string }> {
  const req = Object.assign((async function* () {})(), {
    method: "GET",
    url,
    headers: { ...AUTHED_HEADERS, [NONE_YET_AS_NULL_HEADER]: "1" },
  }) as unknown as IncomingMessage;
  let written = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    on() {},
    write(chunk: string) {
      written += chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk) written += chunk;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
  return { status: (res as unknown as { statusCode: number }).statusCode, body: written };
}

const STORED: Situate = {
  version: PROMPT_VERSION,
  generator: "test",
  slug: SLUG,
  sourceHash: "not-this-article",
  profileHash: null,
  generatedAt: "2026-10-24T09:00:00.000Z",
  elapsedMs: 1,
  kind: "review",
  year: 2023,
  angle: "since",
  outcome: "read",
  overview: "Where it sits.",
  findings: [
    {
      id: "si-000000000001",
      kind: "since",
      blockId: "spya-aaaaaa",
      quote: "a quote",
      note: "A later paper says otherwise.",
      strength: "suggestive",
      sources: [{ origin: "web", url: "https://example.org/x", title: "X", quote: "six words from the page itself" }],
    },
  ],
  questions: ["What changed?"],
  searched: { queries: [{ q: "q", for: "f", group: "claim", outcome: "found", pages: 1 }], pages: 1, citers: 0, cited: 0 },
  counts: emptyCounts(),
};

describe("the dossier is the owner's alone (S9)", () => {
  it("is 200 null to the owner before there is one", async () => {
    await setSituate(null);
    expect(await get(`/api/situate/${SLUG}`)).toEqual({ status: 200, body: "null" });
  });

  it("is the stored dossier to the owner, with its staleness facts", async () => {
    await setSituate(STORED);
    const res = await get(`/api/situate/${SLUG}`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as SituateResponse;
    expect(body.situate.findings.map((f) => f.id)).toEqual(["si-000000000001"]);
    /* Written against another article's bytes: stale. By another model: outdated. */
    expect(body.stale).toBe(true);
    expect(body.outdated).toBe(true);
    expect(body.profileChanged).toBe(false);
  });

  it("is no such article to anybody else", async () => {
    await setSituate(STORED);
    const err = await runAsOwner(STRANGER, () => loadSituate(SLUG)).catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(404);
    expect(String((err as Error).message)).not.toContain("Where it sits");
  });

  it("is never selected by a public read, nor named by the public DTO", async () => {
    const root = path.resolve(import.meta.dirname, "..");
    const publicReader = await readFile(path.join(root, "src/store/public-reader.ts"), "utf8");
    const dto = await readFile(path.join(root, "src/public/dto.ts"), "utf8");
    expect(publicReader).not.toMatch(/articleRevisions\.situate\b/);
    expect(dto).not.toMatch(/\bsituate\b/i);
  });
});

describe("the situate allowance against the real table (S5)", () => {
  it("takes one, refuses a second while it runs, and refuses the fifth in an hour", async () => {
    const take = () => runAsOwner(STRANGER, () => pgFetchAllowanceStore.take("situate", SITUATE_RATE_POLICY));
    const finish = (id: string) => runAsOwner(STRANGER, () => pgFetchAllowanceStore.finish(id));
    await getDb().delete(rateLimitEvents).where(eq(rateLimitEvents.ownerId, STRANGER));

    const first = await take();
    if (first.kind !== "allowed") throw new Error(`expected an allowance, got ${first.kind}`);
    expect((await take()).kind).toBe("concurrency");
    await finish(first.id);
    for (let i = 1; i < SITUATE_RATE_POLICY.fills; i++) {
      const next = await take();
      if (next.kind !== "allowed") throw new Error(`expected allowance ${i + 1}, got ${next.kind}`);
      await finish(next.id);
    }
    expect((await take()).kind).toBe("rate");
  });
});
