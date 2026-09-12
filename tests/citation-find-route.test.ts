/**
 * **Find it on the web, through the route and Postgres** —
 * `POST /api/citations/:slug/:id/find`, src/citation-find.ts,
 * docs/plans/260911g-citations-mode.md § Stage 3.
 *
 * The rules about *what* is kept are tests/citation-find.test.ts, with the
 * model and the store injected. What only the real composition can show is
 * here:
 *
 * 1. **A kept page is stored and read back onto its entry** — the GET a page
 *    refresh makes shows the row as `web`, with the search result's own URL and
 *    title, not the model's.
 * 2. **A link the article gave wins** over a stored find for the same id — a
 *    re-run can turn a searched row into a DOI row and inherit its id.
 * 3. **An id that is not in the list is a 404, and a stranger's slug is a 404**,
 *    both before anything is spent.
 *
 * The provider is `globalThis.fetch`, stubbed — nothing here spends.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, citationFinds } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { EVAL_OWNER_ID, runAsOwner } from "../src/owner.js";
import type { BlockId, Citations, CitationsResponse, CitedWork, FindCitationResponse } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-citation-find-route";
/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`. */
const SEARCHED = "spya-fndr2a";
const GIVEN = "spya-fndr2b";

const PAPER = "https://arxiv.org/abs/2001.08361";
const PAPER_TITLE = "[2001.08361] Scaling Laws for Neural Language Models";
const TITLE = "Scaling Laws for Neural Language Models";

await pgReady({
  suite: "tests/citation-find-route.test.ts",
  tables: ["spideryarn.revision_blocks", "spideryarn.citation_finds"],
});

const { handleApi } = await import("../src/routes.js");
const { findCitation } = await import("../src/store/index.js");

let article: ScratchArticle | undefined;
const realFetch = globalThis.fetch;
let providerCalls = 0;

/** The provider answers one non-streamed chat completion naming the paper. */
function providerNames(url: string): void {
  globalThis.fetch = ((_url: string) => {
    providerCalls += 1;
    const body = {
      model: "anthropic/claude-sonnet-5",
      choices: [
        {
          finish_reason: "stop",
          message: {
            /* The model's answer carries its own title too — which must never
               be the one stored. */
            content: JSON.stringify({ url, title: "What The Model Called It" }),
            annotations: [
              {
                type: "url_citation",
                url_citation: { url: PAPER, title: PAPER_TITLE, content: `Abstract. ${TITLE}.` },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, server_tool_use: { web_search_requests: 1 } },
    };
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response);
  }) as unknown as typeof fetch;
}

function work(over: Partial<CitedWork> & Pick<CitedWork, "id">, at: BlockId): CitedWork {
  return {
    key: `work:${over.id}`,
    title: TITLE,
    authors: "Kaplan, J.",
    year: "2020",
    why: "The curve the piece extrapolates from.",
    mentions: [],
    citedAt: [at],
    firstCited: at,
    citedInBody: true,
    url: "https://scholar.google.com/scholar?q=x",
    linkFrom: "search",
    ...over,
  };
}

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  const first = article.blocks[0]?.id as BlockId;
  const citations: Citations = {
    version: "citations/2",
    generator: "test",
    slug: SLUG,
    sourceHash: "test",
    citations: [
      work({ id: SEARCHED }, first),
      work({ id: GIVEN, url: "https://doi.org/10.1000/given", linkFrom: "doi" }, first),
    ],
    capped: false,
    generatedAt: "2026-09-12T00:00:00.000Z",
    elapsedMs: 1,
  };
  const db = getDb();
  const [row] = await db
    .select({ revision: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.id, article.articleId));
  if (!row?.revision) throw new Error("the scratch article has no current revision");
  await db.update(articleRevisions).set({ citations }).where(eq(articleRevisions.id, row.revision));
  /* A find stored against the row whose article gave a DOI — what a re-run
     that turned a searched row into a DOI row and inherited its id leaves. */
  await db.insert(citationFinds).values({
    articleId: article.articleId,
    entryId: GIVEN,
    ownerId: TEST_OWNER,
    url: "https://example.org/not-the-doi",
    title: "A page found earlier",
    host: "example.org",
    searches: 1,
    model: "test",
    foundAt: new Date(),
  });
}, 120_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  await article?.remove();
  await closeDb();
});

beforeEach(() => {
  providerCalls = 0;
  providerNames(PAPER);
});

/** One JSON request and its response. */
async function request(method: string, url: string): Promise<{ status: number; body: unknown }> {
  const req = Object.assign(
    (async function* () {
      yield* [Buffer.from("{}")];
    })(),
    { method, url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;
  let written = "";
  let status = 0;
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    writeHead(s: number) {
      status = s;
      (this as { statusCode: number }).statusCode = s;
    },
    flushHeaders() {},
    on() {},
    write(piece: string) {
      written += piece;
      return true;
    },
    end(piece?: string) {
      if (piece) written += piece;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
  return { status: status || (res as unknown as { statusCode: number }).statusCode, body: written ? JSON.parse(written) : null };
}

const find = (id: string) => request("POST", `/api/citations/${SLUG}/${id}/find`);

async function listed(id: string): Promise<CitedWork | undefined> {
  const got = await request("GET", `/api/citations/${SLUG}`);
  return (got.body as CitationsResponse).citations.citations.find((w) => w.id === id);
}

describe("POST /api/citations/:slug/:id/find", () => {
  it("keeps the search result's page, and a fresh read shows it on the entry", async () => {
    const got = await find(SEARCHED);
    expect(got.status).toBe(200);
    const answer = got.body as FindCitationResponse;
    expect(answer.outcome).toBe("found");
    expect(providerCalls).toBe(1);

    const [row] = await getDb()
      .select()
      .from(citationFinds)
      .where(and(eq(citationFinds.articleId, article?.articleId ?? ""), eq(citationFinds.entryId, SEARCHED)));
    expect(row).toMatchObject({ url: PAPER, title: PAPER_TITLE, host: "arxiv.org", searches: 1 });

    const entry = await listed(SEARCHED);
    expect(entry).toMatchObject({ url: PAPER, linkFrom: "web", found: { title: PAPER_TITLE, host: "arxiv.org" } });
  });

  it("stores nothing when the model names a page the search did not return", async () => {
    await getDb()
      .delete(citationFinds)
      .where(and(eq(citationFinds.articleId, article?.articleId ?? ""), eq(citationFinds.entryId, SEARCHED)));
    providerNames("https://arxiv.org/pdf/2001.08361");
    const got = await find(SEARCHED);
    expect(got.status).toBe(200);
    expect((got.body as FindCitationResponse).outcome).toBe("no-match");
    expect(await listed(SEARCHED)).toMatchObject({ linkFrom: "search" });
  });

  it("never lets a stored find override a link the article gave", async () => {
    expect(await listed(GIVEN)).toMatchObject({ url: "https://doi.org/10.1000/given", linkFrom: "doi" });
    expect((await listed(GIVEN))?.found).toBeUndefined();
  });

  it("refuses a row whose link the article gave, with a 409 and no call", async () => {
    const got = await find(GIVEN);
    expect(got.status).toBe(409);
    expect(providerCalls).toBe(0);
  });

  it("is a 404 for an entry id the list does not have, with no call", async () => {
    const got = await find("spya-n2t3h4");
    expect(got.status).toBe(404);
    expect(providerCalls).toBe(0);
  });

  it("is a 404 for somebody who does not own the article, with no call", async () => {
    await expect(runAsOwner(EVAL_OWNER_ID, () => findCitation(SLUG, SEARCHED))).rejects.toMatchObject({
      status: 404,
    });
    expect(providerCalls).toBe(0);
  });
});
