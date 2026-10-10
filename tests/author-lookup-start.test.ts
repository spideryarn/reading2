/**
 * **The after-response author lookup, end to end against Postgres** —
 * src/author-lookup-start.ts. docs/plans/261010c-author-gift-draft-voucher-from-the-add-page.md,
 * D4 and R2-F5/F6.
 *
 * What must hold, because each is money or a stranger's address:
 *
 * - the row is claimed **before** the provider call, so a row already claimed
 *   (or finished) is never called for;
 * - the run id on the row is the lookup's own collector's, and the ledger row a
 *   call inside it writes carries that id, the administrator and the slug;
 * - the request's collector sees none of the lookup's calls (R2-F6);
 * - a throw anywhere finishes the row `failed` with a name, never pending;
 * - an article that is gone or unread finishes `failed` without a call.
 *
 * **No model is called**: the provider call is injected. A fake that records a
 * spend row stands in for the gateway's own `recordSpend`.
 */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import type { JsonCall } from "../src/ai-call.js";
import { collectSpend, currentSpend, providerCost, recordSpend, type SpendRecord } from "../src/ai-spend.js";
import { withAfterResponseTasks, afterResponse } from "../src/after-response.js";
import { startAuthorLookup } from "../src/author-lookup-start.js";
import type { AuthorLookupCall } from "../src/author-lookup.js";
import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import type { OwnerId } from "../src/owner.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/author-lookup-start.test.ts",
  tables: ["spideryarn.author_gifts", "spideryarn.author_lookups", "spideryarn.ai_calls"],
  columns: [{ table: "spideryarn.author_lookups", column: "run_id" }],
  keepPool: true,
  max: 4,
});

const ADMIN = ADMIN_USER_ID_LOCAL as OwnerId;
const RUN = randomUUID().slice(0, 8);
const SLUG = `test-author-lookup-start-${RUN}`;
const BIO_PAGE = "https://writer.example.org/about";
const ADDRESS = `lookup-${RUN}@example.invalid`;

let article: ScratchArticle | undefined;
const runIds: string[] = [];

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: ADMIN });
}, 60_000);

afterEach(async () => {
  if (runIds.length > 0) await pool.query("delete from spideryarn.ai_calls where run_id = any($1::uuid[])", [runIds.splice(0)]);
  if (article) await pool.query("delete from spideryarn.author_gifts where article_id = $1", [article.articleId]);
});

afterAll(async () => {
  await article?.remove();
  await pool.end();
  await closeDb();
});

/** A draft gift on the scratch article and one pending lookup, as `ensureAuthorGift` leaves them. */
async function pendingLookup(articleId: string = article?.articleId ?? ""): Promise<{ giftId: string; lookupId: string }> {
  const { rows: gifts } = await pool.query<{ id: string }>(
    "insert into spideryarn.author_gifts (article_id, starter_slug, created_by) values ($1, $2, $3) returning id",
    [articleId, SLUG, ADMIN],
  );
  const giftId = gifts[0]?.id ?? "";
  const { rows: lookups } = await pool.query<{ id: string }>(
    "insert into spideryarn.author_lookups (author_gift_id) values ($1) returning id",
    [giftId],
  );
  return { giftId, lookupId: lookups[0]?.id ?? "" };
}

async function lookupRow(id: string): Promise<Record<string, unknown>> {
  const { rows } = await pool.query("select * from spideryarn.author_lookups where id = $1", [id]);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`no lookup ${id}`);
  return row;
}

async function giftRow(id: string): Promise<Record<string, unknown>> {
  const { rows } = await pool.query("select * from spideryarn.author_gifts where id = $1", [id]);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`no gift ${id}`);
  return row;
}

/** A web-search completion naming the author, with the address seen in the one result. */
function completion(): unknown {
  return {
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            author: { name: "Paul Graham", sourceUrl: BIO_PAGE },
            email: { address: ADDRESS, sourceUrl: BIO_PAGE },
            contactUrl: null,
            aboutAuthor: "An essayist.",
            suggestedMessage: "Hello, here is a private link to your essay in Spideryarn.",
            whyThisPiece: "A short essay that rewards a careful read.",
            searchedFor: ["Paul Graham email"],
          }),
          annotations: [{ type: "url_citation", url_citation: { url: BIO_PAGE, title: "About", content: `Mail ${ADDRESS}.` } }],
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 50, server_tool_use: { web_search_requests: 1 } },
  };
}

/** The spend row the gateway would record for one call — written through whatever collector is open. */
function spendRecord(): SpendRecord {
  return {
    job: "author-lookup",
    wire: "chat",
    model: "anthropic/claude-sonnet-test",
    answeredBy: "anthropic/claude-sonnet-test",
    cost: providerCost(1_000_000),
    upstreamCostNanos: null,
    providerAccount: "openrouter",
    generationId: null,
    upstream: null,
    credentialFingerprint: null,
    isByok: false,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    cacheWrite5mTokens: null,
    cacheWrite1hTokens: null,
    reasoningTokens: null,
    webSearches: 1,
    serviceTier: null,
    inferenceGeo: null,
    ms: 5,
    outcome: "ok",
  };
}

/** A fake provider call: notes what it saw, records one spend row, answers `completion()`. */
function fakeCall() {
  const seen: { runId: string | null; claimedRunId: unknown }[] = [];
  const call = (lookupId: string): AuthorLookupCall => async (): Promise<JsonCall> => {
    const runId = currentSpend()?.runId ?? null;
    seen.push({ runId, claimedRunId: (await lookupRow(lookupId)).run_id });
    if (runId) runIds.push(runId);
    recordSpend(spendRecord());
    return { json: completion(), answeredBy: "anthropic/claude-sonnet-test", generationId: null };
  };
  return { seen, call };
}

describe("startAuthorLookup", () => {
  it("claims the row with its own collector's id before the call, fills the draft, and finishes the row", async () => {
    const { giftId, lookupId } = await pendingLookup();
    const fake = fakeCall();

    await startAuthorLookup(lookupId, { call: fake.call(lookupId) });

    expect(fake.seen).toHaveLength(1);
    const [seen] = fake.seen;
    expect(seen?.runId).toBeTruthy();
    /* Claimed before the call: the row already carried this run's id when the provider was asked. */
    expect(seen?.claimedRunId).toBe(seen?.runId);

    const row = await lookupRow(lookupId);
    expect(row.outcome).toBe("address");
    expect(row.run_id).toBe(seen?.runId);
    expect(row.email).toBe(ADDRESS);
    expect(row.author_name).toBe("Paul Graham");
    expect(row.searches).toBe(1);
    expect(row.model).toBe("anthropic/claude-sonnet-test");

    const gift = await giftRow(giftId);
    expect(gift.email).toBe(ADDRESS);
    expect(gift.email_lookup_id).toBe(lookupId);
    expect(String(gift.notes)).toContain("An essayist.");

    /* The ledger row the call wrote carries the lookup's run id, the administrator and the slug. */
    const { rows } = await pool.query(
      "select owner_id, article_slug, scope_kind, purpose from spideryarn.ai_calls where run_id = $1",
      [seen?.runId],
    );
    expect(rows).toEqual([{ owner_id: ADMIN, article_slug: SLUG, scope_kind: "request", purpose: "author-lookup" }]);
  });

  it("never calls for a row that is already claimed", async () => {
    const { lookupId } = await pendingLookup();
    const other = randomUUID();
    await pool.query("update spideryarn.author_lookups set run_id = $2 where id = $1", [lookupId, other]);
    const fake = fakeCall();

    await startAuthorLookup(lookupId, { call: fake.call(lookupId) });

    expect(fake.seen).toHaveLength(0);
    const row = await lookupRow(lookupId);
    expect(row.run_id).toBe(other);
    expect(row.outcome).toBeNull();
  });

  it("finishes the row failed with the error's name when the call throws", async () => {
    const { lookupId } = await pendingLookup();
    class OddFailure extends Error {
      override name = "OddFailure";
    }
    const call: AuthorLookupCall = async () => {
      throw new OddFailure("secret prose that must not be stored");
    };

    await startAuthorLookup(lookupId, { call });

    const row = await lookupRow(lookupId);
    expect(row.outcome).toBe("failed");
    expect(row.failure).toBe("OddFailure");
    expect(row.run_id).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain("secret prose");
  });

  it("finishes the row failed with a name when something past the call throws, never leaving it pending", async () => {
    const { lookupId } = await pendingLookup();
    class PastTheCall extends Error {
      override name = "PastTheCall";
    }
    /* `runAuthorLookup` turns a throwing call into a failed outcome itself, so
       the throw comes from reading the answer, which it does not guard — a
       stand-in for any bug between the claim and the finish. */
    const call: AuthorLookupCall = async () => ({
      get json(): unknown {
        throw new PastTheCall("secret prose that must not be stored");
      },
      answeredBy: null,
      generationId: null,
    });

    await startAuthorLookup(lookupId, { call });

    const row = await lookupRow(lookupId);
    expect(row.outcome).toBe("failed");
    expect(row.failure).toBe("PastTheCall");
    expect(JSON.stringify(row)).not.toContain("secret prose");
  });

  it("finishes the row failed, without a call, when the article is unpublished", async () => {
    if (!article) throw new Error("no scratch article");
    const { lookupId } = await pendingLookup();
    const { rows } = await pool.query<{ current_revision_id: string }>(
      "select current_revision_id from spideryarn.articles where id = $1",
      [article.articleId],
    );
    const revision = rows[0]?.current_revision_id;
    await pool.query("update spideryarn.articles set current_revision_id = null where id = $1", [article.articleId]);
    const fake = fakeCall();
    try {
      await startAuthorLookup(lookupId, { call: fake.call(lookupId) });
    } finally {
      await pool.query("update spideryarn.articles set current_revision_id = $2 where id = $1", [article.articleId, revision]);
    }

    expect(fake.seen).toHaveLength(0);
    const row = await lookupRow(lookupId);
    expect(row.outcome).toBe("failed");
    expect(row.failure).toBe("article-gone");
    expect(row.run_id).toBeNull();
  });

  it("does nothing, and throws nothing, for a lookup that does not exist", async () => {
    const fake = fakeCall();
    await expect(startAuthorLookup(randomUUID(), { call: fake.call(randomUUID()) })).resolves.toBeUndefined();
    expect(fake.seen).toHaveLength(0);
  });

  it("is invisible to the request's own collector (R2-F6)", async () => {
    const { lookupId } = await pendingLookup();
    const fake = fakeCall();

    /* The nesting handleApi uses: after-response tasks outside, the request's collector inside. */
    const request = await withAfterResponseTasks(() =>
      collectSpend(async () => {
        await afterResponse("author gift: lookup", () => startAuthorLookup(lookupId, { call: fake.call(lookupId) }));
      }),
    );

    expect(fake.seen).toHaveLength(1);
    expect(fake.seen[0]?.runId).not.toBe(request.report.runId);
    expect(request.report.calls).toHaveLength(0);
    expect((await lookupRow(lookupId)).outcome).toBe("address");
  });
});
