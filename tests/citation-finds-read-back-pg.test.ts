/**
 * **A stored find, read back through `GET /api/bibliography/:slug` — in Postgres.**
 * src/citation-find.ts § `runCitationLookup`, src/store/pg-citation-finds.ts,
 * and the read half in `loadBibliography` (`attachFinds`, `attachLookups`).
 *
 * The rules about *what* is kept are tests/citation-find.test.ts, with the
 * model and the store injected. What only the real composition can show is
 * here: the lookup writes through the real `citationFindStore`, and the GET a
 * page refresh makes reads the row back onto its entry.
 *
 * 1. **A kept page is stored and read back onto its entry** — a searched row
 *    reads as `web`, with the search result's own URL and title, not the
 *    model's.
 * 2. **A link the article gave wins** over a stored find for the same id — a
 *    re-run can turn a searched row into a DOI row and inherit its id.
 * 3. **A looked-up row the article linked keeps its DOI link and gains the
 *    reading**, and a list made again with a different `why` drops the reading
 *    and keeps the link.
 *
 * Until 2026-10-04 this file was tests/citation-find-route.test.ts and wrote its
 * finds through `POST /api/bibliography/:slug/:id/find`. That route is deleted
 * (no caller since plan 260930d); the lookup is now driven the way its one
 * caller drives it — `runCitationLookup` with `DIG_DEEPER_MODEL`, as
 * *Investigate* does (src/citation-investigate.ts) — so the fingerprints on the
 * stored lookup are the real ones the read half checks. Investigate's own route
 * is tests/citation-investigate-route.test.ts.
 *
 * The model call is injected — nothing here spends.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { JsonCall } from "../src/ai-call.js";
import { runCitationLookup } from "../src/citation-find.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, citationFinds } from "../src/db/schema.js";
import { DIG_DEEPER_MODEL } from "../src/dig-deeper.js";
import { loadEnvLocal } from "../src/env.js";
import type { BlockId, Bibliography, BibliographyResponse, CitedWork, FindCitationResponse } from "../src/types.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
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
  suite: "tests/citation-finds-read-back-pg.test.ts",
  tables: ["spideryarn.revision_blocks", "spideryarn.citation_finds"],
});

const { handleApi } = await import("../src/routes.js");
const { citationFindStore, loadArticle } = await import("../src/store/index.js");

let article: ScratchArticle | undefined;

/** One non-streamed chat completion, as the provider answers it. */
function completion(content: unknown, result: { url: string; title: string; content: string }): unknown {
  return {
    model: "anthropic/claude-sonnet-5",
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify(content),
          annotations: [{ type: "url_citation", url_citation: result }],
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, server_tool_use: { web_search_requests: 1 } },
  };
}

/** The model names the paper — and offers its own title too, which must never be the one stored. */
const NAMES_THE_PAPER = completion(
  { url: PAPER, title: "What The Model Called It" },
  { url: PAPER, title: PAPER_TITLE, content: `Abstract. ${TITLE}.` },
);

const SUPPORT_QUOTE = "The loss scales as a power-law with model size";
const DOES_QUOTE = "We study empirical scaling laws for language model performance";
const PUBLISHER_PAGE = "https://publisher.example/doi/10.1000/given";

/**
 * The model names the DOI row's publisher page and reads its extract — an
 * extract that names the first author and the year, and holds both quotes.
 */
const JUDGES_THE_DOI_PAGE = completion(
  {
    url: PUBLISHER_PAGE,
    paperDoes: "It measures how a language model's loss falls as the model grows.",
    paperDoesQuote: DOES_QUOTE,
    support: "supports",
    supportQuote: SUPPORT_QUOTE,
  },
  {
    url: PUBLISHER_PAGE,
    title: TITLE,
    content: `Kaplan (2020). ${DOES_QUOTE}. ${SUPPORT_QUOTE}, dataset size and compute.`,
  },
);

const WHY = "The curve the piece extrapolates from.";

/** Rewrite one row's `why` in the stored list — what a list made again does. */
async function setWhy(id: string, why: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ revision: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.id, article?.articleId ?? ""));
  if (!row?.revision) throw new Error("the scratch article has no current revision");
  const [rev] = await db
    .select({ bibliography: articleRevisions.bibliography })
    .from(articleRevisions)
    .where(eq(articleRevisions.id, row.revision));
  const citations = rev?.bibliography as Bibliography;
  const next = { ...citations, citations: citations.citations.map((w) => (w.id === id ? { ...w, why } : w)) };
  await db.update(articleRevisions).set({ bibliography: next }).where(eq(articleRevisions.id, row.revision));
}

function work(over: Partial<CitedWork> & Pick<CitedWork, "id">, at: BlockId): CitedWork {
  return {
    key: `work:${over.id}`,
    title: TITLE,
    authors: "Kaplan, J.",
    year: "2020",
    why: WHY,
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
  const citations: Bibliography = {
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
  await db.update(articleRevisions).set({ bibliography: citations }).where(eq(articleRevisions.id, row.revision));
  /* A find stored against the row whose article gave a DOI — what a re-run
     that turned a searched row into a DOI row and inherited its id leaves.
     Through the real store, as every find is written. */
  await asTestOwner(() =>
    citationFindStore.save(SLUG, GIVEN, {
      url: "https://example.org/not-the-doi",
      title: "A page found earlier",
      host: "example.org",
      searches: 1,
      model: "test",
      at: new Date().toISOString(),
    }),
  );
}, 120_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
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

async function listed(id: string): Promise<CitedWork | undefined> {
  const got = await request("GET", `/api/bibliography/${SLUG}`);
  expect(got.status).toBe(200);
  return (got.body as BibliographyResponse).bibliography.citations.find((w) => w.id === id);
}

/**
 * ***Look it up* for one row, as Investigate's first step runs it**: the row
 * as the list has it now, the article, the real find store, and the model
 * Investigate sends. Only the model call is a stub.
 */
async function lookUp(id: string, reply: unknown): Promise<FindCitationResponse> {
  const row = await listed(id);
  if (!row) throw new Error(`the list has no ${id}`);
  return asTestOwner(async () =>
    runCitationLookup(
      {
        finds: citationFindStore,
        call: async (): Promise<JsonCall> => ({
          json: reply,
          answeredBy: "anthropic/claude-sonnet-5",
          generationId: null,
        }),
      },
      SLUG,
      id,
      row,
      await loadArticle(SLUG),
      DIG_DEEPER_MODEL,
    ),
  );
}

describe("a stored find, read back through GET /api/bibliography/:slug", () => {
  it("keeps the search result's page, and a fresh read shows it on the entry", async () => {
    expect(await listed(SEARCHED)).toMatchObject({ linkFrom: "search" });

    const answer = await lookUp(SEARCHED, NAMES_THE_PAPER);
    expect(answer.outcome).toBe("found");

    const [row] = await getDb()
      .select()
      .from(citationFinds)
      .where(and(eq(citationFinds.articleId, article?.articleId ?? ""), eq(citationFinds.entryId, SEARCHED)));
    expect(row).toMatchObject({ url: PAPER, title: PAPER_TITLE, host: "arxiv.org", searches: 1 });

    const entry = await listed(SEARCHED);
    expect(entry).toMatchObject({ url: PAPER, linkFrom: "web", found: { title: PAPER_TITLE, host: "arxiv.org" } });
  });

  it("never lets a stored find override a link the article gave", async () => {
    /* The premise: the find the suite seeded for this row is really there. */
    const stored = await asTestOwner(() => citationFindStore.load(SLUG, GIVEN));
    expect(stored).toMatchObject({ url: "https://example.org/not-the-doi" });

    expect(await listed(GIVEN)).toMatchObject({ url: "https://doi.org/10.1000/given", linkFrom: "doi" });
    expect((await listed(GIVEN))?.found).toBeUndefined();
  });

  /* Until plan 260929g a linked row could not be looked up at all. Look it up
     is offered on every row (R-3), so these pin what replaced the refusal — and
     that the article's link still always wins. */
  it("looks up a row the article linked: the reading is read back, and its DOI link stays", async () => {
    const answer = await lookUp(GIVEN, JUDGES_THE_DOI_PAGE);
    expect(answer).toMatchObject({
      outcome: "found",
      work: { id: GIVEN, url: "https://doi.org/10.1000/given", linkFrom: "doi" },
      lookup: { state: "assessed", host: "publisher.example", verdict: { support: "supports", quote: SUPPORT_QUOTE } },
    });

    const entry = await listed(GIVEN);
    expect(entry).toMatchObject({ url: "https://doi.org/10.1000/given", linkFrom: "doi" });
    expect(entry?.found).toBeUndefined();
    expect(entry?.lookup).toMatchObject({
      state: "assessed",
      verdict: { support: "supports", quote: SUPPORT_QUOTE },
      paperDoes: { quote: DOES_QUOTE },
    });
  });

  it("drops the reading, and keeps the link, when the list is made again with a different why", async () => {
    await setWhy(GIVEN, "A different use of the same work, from a list made again.");
    try {
      const entry = await listed(GIVEN);
      expect(entry).toMatchObject({ url: "https://doi.org/10.1000/given", linkFrom: "doi" });
      expect(entry?.lookup).toBeUndefined();
    } finally {
      await setWhy(GIVEN, WHY);
    }
    expect((await listed(GIVEN))?.lookup?.state).toBe("assessed");
  });
});
