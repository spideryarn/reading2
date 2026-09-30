/**
 * `GET /api/admin/articles/:slug/cost` — what one article has cost, for the
 * metadata page's administrator section.
 * docs/plans/260930f-article-cost-on-the-metadata-page.md.
 *
 * The stores are stubbed; the SQL is held in tests/ai-calls-spend-pg.test.ts.
 * What this pins is the route's own three decisions:
 *
 * - it is behind the `/api/admin` gate, so nobody else reaches the store;
 * - it answers **only for an article the administrator owns** — a stranger's
 *   slug is the owner-scoped 404, asked before any spend is read, because the
 *   admin pages do not follow identifiers into other people's articles;
 * - it categorises each line with `costCategoryOf`, the words `npm run cost`
 *   uses, and says `no-store`.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ArticleCost } from "../src/admin.js";
import type { Verifier } from "../src/auth.js";
import { acceptAny, AUTHED_HEADERS, TEST_SUB } from "./helpers/authed.js";

const seen = vi.hoisted(() => ({
  calls: [] as string[],
  owned: true,
}));

vi.mock("../src/store/pg.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/pg.js")>("../src/store/pg.js");
  return {
    ...actual,
    ownedArticleIdentity: async (slug: string) => {
      seen.calls.push(`ownedArticleIdentity(${slug})`);
      if (!seen.owned) throw actual.notFound(slug);
      return { id: "00000000-0000-4000-8000-00000068a001", createdAt: new Date("2026-09-01") };
    },
  };
});

vi.mock("../src/store/ai-calls-spend-pg.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/ai-calls-spend-pg.js")>(
    "../src/store/ai-calls-spend-pg.js",
  );
  return {
    ...actual,
    spendForArticle: async (article: { id: string; slug: string; ownerId: string }) => {
      seen.calls.push(`spendForArticle(${article.id}, ${article.slug}, ${article.ownerId})`);
      return [
        {
          scopeKind: "job_step",
          job: "glossary",
          stepName: "glossary",
          calls: 2,
          creditsNanos: 30_000_000,
          byokNanos: 0,
          computedNanos: 0,
          computedCalls: 0,
          unpricedCalls: 0,
          nonOkCalls: 0,
          firstAt: new Date("2026-09-30T10:00:00.000Z"),
          lastAt: new Date("2026-09-30T10:05:00.000Z"),
        },
        {
          scopeKind: "request",
          job: "chat",
          stepName: null,
          calls: 1,
          creditsNanos: 1_000_000,
          byokNanos: 0,
          computedNanos: 0,
          computedCalls: 0,
          unpricedCalls: 0,
          nonOkCalls: 0,
          firstAt: new Date("2026-09-30T11:00:00.000Z"),
          lastAt: new Date("2026-09-30T11:00:00.000Z"),
        },
      ];
    },
    silentLiveSessionsForArticle: async (article: { slug: string }) => {
      seen.calls.push(`silentLiveSessionsForArticle(${article.slug})`);
      return 0;
    },
  };
});

const { handleApi } = await import("../src/routes.js");

const acceptSomebodyElse: Verifier = async () => ({
  ok: true,
  claims: {
    sub: randomUUID(),
    email: "somebody-else@example.test",
    role: "authenticated",
    is_anonymous: false,
  },
});

async function request(
  urlPath: string,
  verify: Verifier = acceptAny,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const req = Object.assign((async function* () {})(), {
    method: "GET",
    url: urlPath,
    headers: AUTHED_HEADERS,
  }) as unknown as IncomingMessage;
  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
  let status = 0;
  const res = {
    get statusCode() {
      return status;
    },
    set statusCode(v: number) {
      status = v;
    },
    writableEnded: false,
    destroyed: false,
    setHeader(name: string, value: unknown) {
      headers[name.toLowerCase()] = String(value);
    },
    flushHeaders() {},
    on() {},
    writeHead(code: number) {
      status = code;
    },
    write(chunk: string | Buffer) {
      chunks.push(Buffer.from(chunk as never));
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk) chunks.push(Buffer.from(chunk as never));
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, verify);
  return { status, headers, body: Buffer.concat(chunks).toString("utf8") };
}

const SLUG = "an-article-spya-abc123";
const URL_OF = `/api/admin/articles/${SLUG}/cost`;

beforeEach(() => {
  seen.calls.length = 0;
  seen.owned = true;
});

describe("an article's cost, for the administrator", () => {
  it("answers the lines, categorised, and says no-store", async () => {
    const sent = await request(URL_OF);
    expect(sent.status).toBe(200);
    expect(sent.headers["cache-control"]).toBe("private, no-store");
    /* Keyed on the article the lookup found, and on the administrator as its
       owner — src/store/ai-calls-spend-pg.ts § `belongsTo`. */
    expect(seen.calls).toContain(
      `spendForArticle(00000000-0000-4000-8000-00000068a001, ${SLUG}, ${TEST_SUB})`,
    );
    const cost = JSON.parse(sent.body) as ArticleCost;
    expect(cost.slug).toBe(SLUG);
    expect(cost.silentLiveSessions).toBe(0);
    expect(cost.lines.map((l) => [l.job, l.category])).toEqual([
      ["glossary", "on-demand enrichment"],
      ["chat", "interactive request work"],
    ]);
    expect(cost.lines[0]).toMatchObject({
      calls: 2,
      creditsNanos: 30_000_000,
      firstAt: "2026-09-30T10:00:00.000Z",
      lastAt: "2026-09-30T10:05:00.000Z",
    });
  });

  it("is a 404 for an article the administrator does not own, before any spend is read", async () => {
    seen.owned = false;
    const sent = await request(URL_OF);
    expect(sent.status).toBe(404);
    expect(seen.calls).toEqual([`ownedArticleIdentity(${SLUG})`]);
  });

  it("is refused to anybody else by the namespace gate, which reaches no store", async () => {
    const sent = await request(URL_OF, acceptSomebodyElse);
    expect(sent.status).toBe(403);
    expect(seen.calls).toEqual([]);
  });

  it("refuses a capture that is not a slug", async () => {
    const sent = await request("/api/admin/articles/..%2Fetc/cost");
    expect(sent.status).toBe(400);
    expect(seen.calls).toEqual([]);
  });
});
