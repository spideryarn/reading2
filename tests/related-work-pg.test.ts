/**
 * **Sources › Not cited, against a real Postgres**: the table, the owner's
 * loader, and `GET` / `POST /api/related-work/:slug` end to end.
 * docs/plans/261011ac-sources-not-cited-related-work-it-leaves-out.md.
 *
 * What the doubles in tests/related-work.test.ts cannot hold:
 *
 * 1. **Who may ask.** Another reader's slug is the same 404 as a slug nobody
 *    has, on both verbs, and a signed-out caller a 401 — each **before
 *    anything is asked of OpenAlex**.
 * 2. **Opening the chip sends nothing.** The `GET` answers `not-searched`
 *    until the owner's `POST`, and the kept search afterwards, with no request.
 * 3. **The loader's snapshot**: the imported title and year reach the query,
 *    the current Bibliography and its staleness reach the filter.
 * 4. **The table's shape CHECKs** refuse what no writer should store.
 *
 * `fetchBibliographicJson` is replaced, so nothing here reaches a network and
 * the count of requests is exact (tests/setup/provider-guard.ts refuses
 * `api.openalex.org` anyway). Everything else is real.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { RELATED_WORK_TYPES } from "../src/related-work.js";
import { articleRevisions, articles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import type { OwnerId } from "../src/owner.js";
import type { Bibliography, BlockId, CitedWork, RelatedWorkResult } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const ANSWER = JSON.parse(
  readFileSync(new URL("./fixtures/openalex/related-attention.json", import.meta.url), "utf8"),
) as unknown;

/** Every address the fake fetcher was asked for, in order. */
let asked: string[] = [];

vi.mock("../src/fetch.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/fetch.js")>();
  return {
    ...actual,
    fetchBibliographicJson: async (url: string) => {
      asked.push(url);
      if (url.startsWith("https://api.openalex.org/works?search.semantic=")) return ANSWER;
      throw new actual.FetchFailure("not-found", url, "HTTP 404", { status: 404 });
    },
  };
});

await pgReady({
  suite: "tests/related-work-pg.test.ts",
  tables: [
    "spideryarn.related_work_searches",
    "spideryarn.rate_limit_events",
    "spideryarn.bibliographic_services",
    "spideryarn.articles",
  ],
});

const { handleApi } = await import("../src/routes.js");

const MINE = "test-related-work-mine";
const NO_BIB = "test-related-work-no-bib";
const THEIRS = "test-related-work-theirs";
/** A second real reader, so "not yours" is the owner filter rather than a typo. */
const CAROL = "00000000-0000-4000-8000-0000ca401e11" as OwnerId;

function withMeta(change: (meta: Record<string, unknown>) => void) {
  return async (dir: string): Promise<void> => {
    const file = path.join(dir, "meta.json");
    const meta = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    change(meta);
    await writeFile(file, JSON.stringify(meta, null, 2));
  };
}

const asTransformer = withMeta((meta) => {
  meta.title = "Attention Is All You Need";
  meta.byline = "Ashish Vaswani";
  meta.publishedYear = 2017;
  delete meta.publishedAt;
  delete meta.doi;
});

/** One row the piece cites: ConvS2S, by its arXiv id — which OpenAlex gives as arXiv's DOI. */
function cites(slug: string, at: BlockId): Bibliography {
  const row: CitedWork = {
    id: "spya-convs2",
    key: "arxiv:1705.03122",
    title: "Convolutional sequence to sequence learning",
    why: "A convolutional alternative.",
    mentions: [],
    citedAt: [at],
    firstCited: at,
    citedInBody: true,
    url: "https://arxiv.org/abs/1705.03122",
    linkFrom: "arxiv",
  };
  return {
    version: "citations/2",
    generator: "test",
    slug,
    /* Not the article's fingerprint, so the list reads as stale — which the
       answer must then say (F4). */
    sourceHash: "test",
    citations: [row],
    capped: false,
    generatedAt: "2026-10-11T00:00:00.000Z",
    elapsedMs: 1,
  };
}

async function setBibliography(article: ScratchArticle, bibliography: Bibliography): Promise<void> {
  const db = getDb();
  const [row] = await db.select({ revision: articles.currentRevisionId }).from(articles).where(eq(articles.id, article.articleId));
  if (!row?.revision) throw new Error("the scratch article has no current revision");
  await db.update(articleRevisions).set({ bibliography }).where(eq(articleRevisions.id, row.revision));
}

const scratch: ScratchArticle[] = [];
let mine: ScratchArticle | undefined;

beforeAll(async () => {
  await seedAuthUser(getDb(), { id: CAROL, email: "carol-related-work@example.invalid", onConflictDoNothing: true });
  mine = await scratchArticleInPg(MINE, { ownerId: TEST_OWNER, mutate: asTransformer });
  scratch.push(mine);
  await setBibliography(mine, cites(MINE, mine.blocks[0]?.id as BlockId));
  scratch.push(await scratchArticleInPg(NO_BIB, { ownerId: TEST_OWNER, mutate: asTransformer }));
  const theirs = await scratchArticleInPg(THEIRS, { ownerId: CAROL, mutate: asTransformer });
  scratch.push(theirs);
  await setBibliography(theirs, cites(THEIRS, theirs.blocks[0]?.id as BlockId));
}, 240_000);

afterAll(async () => {
  for (const article of scratch) await article.remove();
  await closeDb();
});

beforeEach(async () => {
  asked = [];
  const db = getDb();
  await db.execute(sql`delete from spideryarn.related_work_searches
                        where article_id in (select id from spideryarn.articles where slug like 'test-related-work-%')`);
  await db.execute(sql`delete from spideryarn.rate_limit_events where bucket = 'related-work-search'`);
  await db.execute(sql`update spideryarn.bibliographic_services set next_start_at = now(), cooldown_until = null`);
  await db.execute(sql`update spideryarn.bibliographic_service_slots set lease_until = null`);
});

interface Reply {
  status: number;
  body: Record<string, unknown> | null;
}

async function call(method: string, url: string, headers: Record<string, string> = AUTHED_HEADERS): Promise<Reply> {
  const req = Object.assign((async function* () {})(), { method, url, headers }) as unknown as IncomingMessage;
  let status = 0;
  let text = "";
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader() {},
    end(chunk?: string) {
      if (chunk) text += chunk;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    parsed = null;
  }
  return { status, body: parsed };
}

const get = (slug: string, headers?: Record<string, string>) => call("GET", `/api/related-work/${slug}`, headers);
const post = (slug: string, headers?: Record<string, string>) => call("POST", `/api/related-work/${slug}`, headers);

describe("GET and POST /api/related-work/:slug", () => {
  it("asks nothing on opening, searches on the owner's press, and keeps the answer", async () => {
    expect(await get(MINE)).toEqual({ status: 200, body: { kind: "not-searched" } });
    expect(asked).toEqual([]);

    const pressed = await post(MINE);
    expect(pressed.status).toBe(200);
    const found = pressed.body as RelatedWorkResult | null;
    expect(found).toMatchObject({
      kind: "found",
      excluded: 1,
      /* The test list's `sourceHash` is not the article's (F4). */
      bibliographyStale: true,
      bibliographyCapped: false,
      yearLimited: 2017,
      queryChanged: false,
    });
    if (found?.kind !== "found") throw new Error("not found");
    expect(found.works.map((w) => w.title)).not.toContain("Convolutional Sequence to Sequence Learning");
    expect(found.works).toHaveLength(7);

    /* One request, carrying the imported title and the year filter. */
    expect(asked).toHaveLength(1);
    const url = new URL(asked[0] ?? "");
    expect(url.searchParams.get("search.semantic")?.startsWith("Attention Is All You Need ")).toBe(true);
    expect(url.searchParams.get("filter")).toBe(`publication_year:<2018,type:${RELATED_WORK_TYPES}`);

    /* The next open is the kept answer, and asks nothing. */
    asked = [];
    expect((await get(MINE)).body).toEqual(found);
    expect(asked).toEqual([]);
  });

  it("keeps the answer unfiltered, so the Bibliography is applied as it is when read", async () => {
    await post(MINE);
    const [row] = await getDb().execute(sql`
      select jsonb_array_length(r.results) as n, r.fingerprint, r.year_limit
        from spideryarn.related_work_searches r join spideryarn.articles a on a.id = r.article_id
       where a.slug = ${MINE}`).then((r) => (r as unknown as { rows: { n: number; fingerprint: string; year_limit: number }[] }).rows);
    expect(row).toMatchObject({ n: 8, year_limit: 2017 });
    expect(row?.fingerprint).toMatch(/^related-work\/2:[0-9a-f]{64}$/);
  });

  it("says no-bibliography and asks nothing, on both verbs", async () => {
    expect(await get(NO_BIB)).toEqual({ status: 200, body: { kind: "no-bibliography" } });
    expect(await post(NO_BIB)).toEqual({ status: 200, body: { kind: "no-bibliography" } });
    expect(asked).toEqual([]);
  });

  it("is a 404 for another reader's article, on both verbs, and asks nothing", async () => {
    expect((await get(THEIRS)).status).toBe(404);
    const pressed = await post(THEIRS);
    expect(pressed.status).toBe(404);
    expect(pressed.body?.kind).toBeUndefined();
    expect(asked).toEqual([]);
    /* The positive control for "theirs is a real article": a slug nobody has is the same answer. */
    expect((await post("test-related-work-nobody-has-this")).status).toBe(404);
  });

  it("is a 401 for a signed-out caller, and asks nothing", async () => {
    expect((await get(MINE, {})).status).toBe(401);
    expect((await post(MINE, {})).status).toBe(401);
    expect(asked).toEqual([]);
  });
});

describe("the related_work_searches table", () => {
  const insert = (fingerprint: string, results: string, year: number | null) => sql`
    insert into spideryarn.related_work_searches (article_id, fingerprint, year_limit, results)
    values (${mine?.articleId ?? ""}, ${fingerprint}, ${year}, ${results}::jsonb)`;

  it("refuses a fingerprint that is not the recipe's shape, a year out of range, and results that are not a list", async () => {
    const good = `related-work/1:${"a".repeat(64)}`;
    await expect(getDb().execute(insert("the query itself", "[]", null))).rejects.toThrow();
    await expect(getDb().execute(insert(good, "[]", 3000))).rejects.toThrow();
    await expect(getDb().execute(insert(good, "{}", null))).rejects.toThrow();
    /* The positive control: the same insert with every value right is taken. */
    await expect(getDb().execute(insert(good, "[]", 2017))).resolves.toBeDefined();
  });
});
