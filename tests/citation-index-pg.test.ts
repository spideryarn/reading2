/**
 * **Reception's *Cited by*, against a real Postgres**: the cache's two tables,
 * the limiter's third service, and `GET /api/citers/:slug` end to end.
 * docs/plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md.
 *
 * Three things here are properties of the database or of the route, which the
 * in-memory doubles in tests/citation-index.test.ts cannot hold:
 *
 * 1. **The store** — a found row and its list round-trip in order; a refresh
 *    replaces both together; and the shape CHECKs refuse a `not-indexed` row
 *    that carries a count, whoever the writer.
 * 2. **The limiter** — the migration seeds one `openalex` service row and one
 *    slot, which src/store/pg-bibliographic.ts treats as a fault when missing.
 * 3. **The route** — who may ask, and which title the answer is checked
 *    against. An owner gets the list with the Experimental switch off; a
 *    renamed paper still gets its list; another reader's slug and a signed-out
 *    caller are refused **before anything is asked of OpenAlex**; and a second
 *    article carrying the first one's DOI gets nothing off the cache.
 *
 * `fetchBibliographicJson` is replaced, so nothing here reaches a network and
 * the count of requests is exact (tests/setup/provider-guard.ts refuses
 * `api.openalex.org` anyway). Everything else is real.
 *
 * Refuses loudly when there is no database; tests/helpers/pg-ready.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkId } from "../src/bibliographic.js";
import {
  CITERS_FRESH_MS,
  type FetchedCiters,
  openAlexCitersUrl,
  openAlexTitleSearchUrl,
  openAlexWorkUrl,
  titleQueryOf,
} from "../src/citation-index.js";
import { POSSIBLE_PER_PAGE, openAlexFulltextUrl } from "../src/citation-fulltext.js";
import { closeDb, getDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import type { OwnerId } from "../src/owner.js";
import type { Citer } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/openalex/${name}`, import.meta.url), "utf8")) as unknown;

const DOI = "10.3390/e26060481";
const ID = `doi:${DOI}` as WorkId;
const TITLE = "Self-Improvising Memory: A Perspective on Memories as Agential, Dynamically Reinterpreting Cognitive Glue";
const WORK_URL = openAlexWorkUrl(DOI);
const CITERS_URL = openAlexCitersUrl("W4399223951", 100);

/* Plan 261011q: a no-DOI article found by title. One agreeing author, so the
   match also needs the article's year, which `loadArticleIdentity` must carry. */
const ATTENTION = "Attention Is All You Need";
const SEARCH_URL = openAlexTitleSearchUrl(titleQueryOf(ATTENTION) ?? "");
const TITLE_CITERS_URL = openAlexCitersUrl("W2626778328", 100);
const SEARCH_ANSWER = {
  meta: { count: 1 },
  results: [
    {
      id: "https://openalex.org/W2626778328",
      display_name: ATTENTION,
      publication_year: 2017,
      authorships: [{ author: { display_name: "Ashish Vaswani" } }, { author: { display_name: "Noam Shazeer" } }],
    },
  ],
};

/* Plan 261025h: The Extended Mind, held twice by OpenAlex, and its topic view.
   The answers are real, trimmed (tests/citation-index.test.ts says from where). */
const EM_TITLE = "The extended mind";
const EM_SEARCH_URL = openAlexTitleSearchUrl(titleQueryOf(EM_TITLE) ?? "");
const EM_UNION = "W393180982|W4239232206";
const EM_CITERS_URL = openAlexCitersUrl(EM_UNION, 100);
const EM_TOPIC_URL = openAlexCitersUrl(EM_UNION, 100, "extended mind");
const EM_KEY = "openalex:w393180982|w4239232206";

/* Plan 261026f: the reported piece, no DOI, no author and no year, so its
   full-text search is the one request, newest first. */
const WORKSPACE_TITLE = "Verbalizable Representations Form a Global Workspace in Language Models";
const POSSIBLE_URL = openAlexFulltextUrl(
  "verbalizable representations form a global workspace in language models",
  null,
  { perPage: POSSIBLE_PER_PAGE, order: "newest" },
);
const POSSIBLE_ANSWER = {
  meta: { count: 134 },
  results: [
    { id: "https://openalex.org/W1", display_name: `A ${WORKSPACE_TITLE}`, publication_year: 2026, cited_by_count: 0, authorships: [] },
    {
      id: "https://openalex.org/W2",
      display_name: "Reader--Writer Coupling in Transformer MLPs",
      publication_year: 2026,
      cited_by_count: 0,
      authorships: [{ author: { display_name: "A. Researcher" } }],
      type: "preprint",
    },
  ],
};

/** Every address the fake fetcher was asked for, in order. */
let asked: string[] = [];

vi.mock("../src/fetch.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/fetch.js")>();
  return {
    ...actual,
    /* Only the one function; `FetchFailure` stays the real class, because
       src/citation-index.ts branches on it. */
    fetchBibliographicJson: async (url: string) => {
      asked.push(url);
      if (url === WORK_URL) return fixture("work-e26060481.json");
      if (url === CITERS_URL) return fixture("citers-e26060481.json");
      if (url === SEARCH_URL) return SEARCH_ANSWER;
      if (url === TITLE_CITERS_URL) return fixture("citers-e26060481.json");
      if (url === EM_SEARCH_URL) return fixture("extended-mind-search.json");
      if (url === EM_CITERS_URL) return fixture("extended-mind-citers.json");
      if (url === EM_TOPIC_URL) return fixture("extended-mind-topic.json");
      if (url === POSSIBLE_URL) return POSSIBLE_ANSWER;
      throw new actual.FetchFailure("not-found", url, "HTTP 404", { status: 404 });
    },
  };
});

await pgReady({
  suite: "tests/citation-index-pg.test.ts",
  tables: [
    "spideryarn.citation_index_lookups",
    "spideryarn.citation_index_citers",
    "spideryarn.bibliographic_services",
    "spideryarn.bibliographic_service_slots",
    "spideryarn.articles",
  ],
});

const { pgCitationIndexStore: store } = await import("../src/store/pg-citation-index.js");
const { pgBibliographicStore: limiter } = await import("../src/store/pg-bibliographic.js");
const { handleApi } = await import("../src/routes.js");

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return ((await getDb().execute(query)) as unknown as { rows: T[] }).rows;
}

beforeEach(async () => {
  asked = [];
  const db = getDb();
  await db.execute(sql`delete from spideryarn.citation_index_lookups`);
  await db.execute(sql`update spideryarn.bibliographic_services set next_start_at = now(), cooldown_until = null`);
  await db.execute(sql`update spideryarn.bibliographic_service_slots set lease_until = null`);
});

/* -------------------------------------------------------------- the store -- */

function citer(n: number, over: Partial<Citer> = {}): Citer {
  return {
    openalexId: `W${5000 + n}`,
    doi: `10.1000/citer.${n}`,
    title: `A citing paper, number ${n}`,
    authors: ["Ada Lovelace", "Charles Babbage"],
    authorCount: 2,
    year: 2025,
    venue: "A Journal",
    kind: "article",
    citedByCount: 10 - n,
    ...over,
  };
}

function found(citers: Citer[], over: Partial<Extract<FetchedCiters, { kind: "found" }>> = {}): FetchedCiters {
  return {
    kind: "found",
    target: { openalexId: "W4399223951", title: TITLE, authors: ["Michael G. Levin"] },
    count: citers.length,
    returned: citers.length,
    dropped: 0,
    capped: false,
    citers,
    ...over,
  };
}

describe("the citation index cache", () => {
  it("round-trips a found row and its list, in order, optional fields and all", async () => {
    const bare: Citer = { openalexId: "W9", title: "No DOI, no year, no venue", authors: [], authorCount: 0, citedByCount: 0 };
    const answer = found([citer(0), bare, citer(2)], { count: 389, returned: 5, dropped: 2, capped: true });
    const fetchedAt = await store.write(ID, answer);
    const back = await store.read(ID, CITERS_FRESH_MS);
    expect(back).toEqual({ ...answer, fetchedAt, fresh: true });
  });

  it("round-trips a not-indexed row, and says when a row has gone stale", async () => {
    await store.write(ID, { kind: "not-indexed" });
    expect(await store.read(ID, CITERS_FRESH_MS)).toMatchObject({ kind: "not-indexed", fresh: true });
    await getDb().execute(sql`
      update spideryarn.citation_index_lookups set fetched_at = now() - interval '8 days' where work_id = ${ID}`);
    expect(await store.read(ID, CITERS_FRESH_MS)).toMatchObject({ kind: "not-indexed", fresh: false });
    expect(await store.read("doi:10.1000/never-asked" as WorkId, CITERS_FRESH_MS)).toBeNull();
  });

  it("replaces the row and its list together", async () => {
    await store.write(ID, found([citer(0), citer(1), citer(2)]));
    await store.write(ID, found([citer(7)]));
    const back = await store.read(ID, CITERS_FRESH_MS);
    expect(back?.kind === "found" ? back.citers.map((c) => c.openalexId) : null).toEqual(["W5007"]);
    await store.write(ID, { kind: "not-indexed" });
    expect(await rows(sql`select 1 from spideryarn.citation_index_citers where work_id = ${ID}`)).toEqual([]);
  });

  /** The constraint that refused, read off the driver's error under drizzle's wrapper — or undefined if nothing did. */
  const refusedBy = async (query: ReturnType<typeof sql>): Promise<string | undefined> => {
    try {
      await getDb().execute(query);
      return undefined;
    } catch (err) {
      return (err as { cause?: { constraint?: string } }).cause?.constraint ?? "refused, by no named constraint";
    }
  };

  it("refuses a not-indexed row that carries a count, and a found row without one", async () => {
    expect(
      await refusedBy(sql`
        insert into spideryarn.citation_index_lookups (work_id, state, cited_by_count)
        values ('doi:10.1000/a', 'not-indexed', 3)`),
    ).toBe("citation_index_lookups_shape");
    expect(
      await refusedBy(sql`
        insert into spideryarn.citation_index_lookups (work_id, state, openalex_id)
        values ('doi:10.1000/b', 'not-indexed', 'W1')`),
    ).toBe("citation_index_lookups_shape");
    expect(
      await refusedBy(sql`
        insert into spideryarn.citation_index_lookups
          (work_id, state, openalex_id, returned, dropped, capped, target_title, target_authors)
        values ('doi:10.1000/c', 'found', 'W1', 0, 0, false, 'A title', '{}')`),
    ).toBe("citation_index_lookups_shape");
    /* The positive control: the same found row with its count is accepted. */
    expect(
      await refusedBy(sql`
        insert into spideryarn.citation_index_lookups
          (work_id, state, openalex_id, cited_by_count, returned, dropped, capped, target_title, target_authors)
        values ('doi:10.1000/c', 'found', 'W1', 0, 0, 0, false, 'A title', '{}')`),
    ).toBeUndefined();
  });

  it("round-trips twins under the key that names them both, and the work's keyword (261025h)", async () => {
    const twins = found([citer(0)], {
      target: { openalexId: "W393180982", alsoHeldAs: ["W4239232206"], title: "The Extended Mind", authors: ["Andy Clark"], keyword: "extended mind" },
      count: 5849,
    });
    const key = EM_KEY as `openalex:w${string}`;
    const fetchedAt = await store.write(key, twins);
    expect(await store.read(key, CITERS_FRESH_MS)).toEqual({ ...twins, fetchedAt, fresh: true });
    const topic = `${EM_KEY}#topic` as `openalex:w${string}#topic`;
    const topicAt = await store.write(topic, { ...twins, count: 556 } as FetchedCiters);
    expect(await store.read(topic, CITERS_FRESH_MS)).toMatchObject({ count: 556, fetchedAt: topicAt, target: twins.kind === "found" ? twins.target : {} });
    /* A row with no twins and no keyword reads back with neither. */
    await store.write(ID, found([]));
    const plain = await store.read(ID, CITERS_FRESH_MS);
    expect(plain?.kind === "found" ? Object.keys(plain.target).sort() : null).toEqual(["authors", "openalexId", "title"]);
  });

  it("refuses a keyword on a not-indexed row, and an empty one", async () => {
    expect(
      await refusedBy(sql`
        insert into spideryarn.citation_index_lookups (work_id, state, target_keyword)
        values ('doi:10.1000/k', 'not-indexed', 'extended mind')`),
    ).toBe("citation_index_lookups_shape");
    expect(
      await refusedBy(sql`
        insert into spideryarn.citation_index_lookups
          (work_id, state, openalex_id, cited_by_count, returned, dropped, capped, target_title, target_authors, target_keyword)
        values ('doi:10.1000/k', 'found', 'W1', 0, 0, 0, false, 'A title', '{}', '')`),
    ).toBe("citation_index_lookups_shape");
  });

  it("keys a row by a DOI or by OpenAlex's lower-cased id, and by nothing else (261011q)", async () => {
    const key = (workId: string) =>
      refusedBy(sql`
        insert into spideryarn.citation_index_lookups (work_id, state) values (${workId}, 'not-indexed')`);
    /* Twins, up to four records (261025h), and the topic view's row beside any key. */
    expect(await key("openalex:w393180982|w4239232206")).toBeUndefined();
    expect(await key("openalex:w1|w2|w3|w4")).toBeUndefined();
    expect(await key("openalex:w1|w2|w3|w4|w5")).toBe("citation_index_lookups_work_id");
    expect(await key("openalex:w1|")).toBe("citation_index_lookups_work_id");
    expect(await key("openalex:w393180982|w4239232206#topic")).toBeUndefined();
    expect(await key("doi:10.1000/topic#topic")).toBeUndefined();
    expect(await key("doi:10.1000/topic#other")).toBe("citation_index_lookups_work_id");
    expect(await key("openalex:w1#topic#topic")).toBe("citation_index_lookups_work_id");
    expect(await key("openalex:w2626778328")).toBeUndefined();
    expect(await key("openalex:W2626778328")).toBe("citation_index_lookups_work_id");
    expect(await key("openalex:w12ab")).toBe("citation_index_lookups_work_id");
    expect(await key("openalex:2626778328")).toBe("citation_index_lookups_work_id");
    expect(await key("title:attention is all you need")).toBe("citation_index_lookups_work_id");
  });

  it("refuses a citer whose id or DOI is not the right shape, and one with no lookup behind it", async () => {
    await store.write(ID, found([]));
    const insert = (workId: string, openalexId: string, doi: string | null) =>
      refusedBy(sql`
        insert into spideryarn.citation_index_citers
          (work_id, position, openalex_id, doi, title, authors, author_count, cited_by_count)
        values (${workId}, 0, ${openalexId}, ${doi}, 'A title', '{}', 0, 0)`);
    expect(await insert(ID, "https://openalex.org/W1", null)).toBe("citation_index_citers_openalex_id");
    expect(await insert(ID, "W1", "https://doi.org/10.1000/x")).toBe("citation_index_citers_doi");
    expect(await insert("doi:10.1000/no-lookup", "W1", null)).toBe(
      "citation_index_citers_work_id_citation_index_lookups_work_id_fk",
    );
    expect(await insert(ID, "W1", "10.1000/x")).toBeUndefined();
  });
});

describe("the limiter's third service", () => {
  it("has one openalex row and one slot, seeded by the migration", async () => {
    expect(
      await rows<{ service: string; slots: number }>(sql`
        select s.service, count(l.slot)::int as slots
          from spideryarn.bibliographic_services s
          left join spideryarn.bibliographic_service_slots l using (service)
         where s.service = 'openalex'
         group by s.service`),
    ).toEqual([{ service: "openalex", slots: 1 }]);
  });

  it("leases its one slot, refuses a second, and cools down on its own", async () => {
    const lease = await limiter.takeSlot("openalex", 20_000);
    expect(lease?.slot).toBe(1);
    expect(await limiter.takeSlot("openalex", 20_000)).toBeNull();
    if (lease) await limiter.freeSlot(lease);
    await limiter.coolDown("openalex", 60_000);
    expect(await limiter.coolingDown("openalex")).toBe(true);
    expect(await limiter.coolingDown("crossref")).toBe(false);
    expect(await limiter.takeStart("openalex", 500, 3_000)).toEqual({ kind: "cooling-down" });
  });
});

/* -------------------------------------------------------------- the route -- */

const MINE = "test-citers-mine";
const NO_DOI = "test-citers-no-doi";
const WRONG_DOI = "test-citers-wrong-doi";
const THEIRS = "test-citers-theirs";
const BY_TITLE = "test-citers-by-title";
const TWINS = "test-citers-twins";
/** The reported piece's identity (plan 261026f), from its public address and as an upload. */
const POSSIBLE = "test-citers-possible";
const UPLOADED = "test-citers-possible-upload";
/** A second real reader, so "not yours" is the owner filter rather than a typo. */
const CAROL = "00000000-0000-4000-8000-00000c17e4c1" as OwnerId;

/** Rewrite the cloned article's `meta.json` before it is loaded. */
function withMeta(change: (meta: Record<string, unknown>) => void) {
  return async (dir: string): Promise<void> => {
    const file = path.join(dir, "meta.json");
    const meta = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    change(meta);
    await writeFile(file, JSON.stringify(meta, null, 2));
  };
}

const asLevin = withMeta((meta) => {
  meta.title = TITLE;
  meta.byline = "Michael Levin";
  meta.doi = DOI;
});

const scratch: ScratchArticle[] = [];

beforeAll(async () => {
  await seedAuthUser(getDb(), { id: CAROL, email: "carol-citers@example.invalid", onConflictDoNothing: true });
  scratch.push(await scratchArticleInPg(MINE, { ownerId: TEST_OWNER, mutate: asLevin }));
  scratch.push(
    await scratchArticleInPg(NO_DOI, {
      ownerId: TEST_OWNER,
      /* No author either: with one, it would be searched for by title (plan 261011q). */
      mutate: withMeta((meta) => {
        delete meta.doi;
        delete meta.byline;
        delete meta.authors;
      }),
    }),
  );
  /* No DOI, the title and authors of the work the fake search returns, and a year. */
  scratch.push(
    await scratchArticleInPg(BY_TITLE, {
      ownerId: TEST_OWNER,
      mutate: withMeta((meta) => {
        delete meta.doi;
        delete meta.authors;
        delete meta.publishedAt;
        meta.title = ATTENTION;
        meta.byline = "Ashish Vaswani";
        meta.publishedYear = 2017;
      }),
    }),
  );
  /* The trial's clark-chalmers-1998: a PDF with no DOI and no year (261025h). */
  scratch.push(
    await scratchArticleInPg(TWINS, {
      ownerId: TEST_OWNER,
      mutate: withMeta((meta) => {
        delete meta.doi;
        delete meta.publishedAt;
        delete meta.publishedYear;
        meta.title = EM_TITLE;
        meta.byline = "ANDY CLARK; DAVID CHALMERS";
        meta.authors = [
          { name: "ANDY CLARK", affiliations: [] },
          { name: "DAVID CHALMERS", affiliations: [] },
        ];
      }),
    }),
  );
  /* Another paper of the same reader's, with Levin's DOI on it by mistake. */
  scratch.push(
    await scratchArticleInPg(WRONG_DOI, {
      ownerId: TEST_OWNER,
      mutate: withMeta((meta) => {
        meta.title = "Attention Is All You Need";
        meta.byline = "Ashish Vaswani";
        meta.doi = DOI;
      }),
    }),
  );
  scratch.push(await scratchArticleInPg(THEIRS, { ownerId: CAROL, mutate: asLevin }));
  /* The identity columns set on the revision directly, as an import would have
     left them: the same title, from a public address or off the reader's disk. */
  for (const [slug, filename] of [
    [POSSIBLE, null],
    [UPLOADED, "workspace-draft.pdf"],
  ] as const) {
    scratch.push(await scratchArticleInPg(slug, { ownerId: TEST_OWNER }));
    await getDb().execute(sql`
      update spideryarn.article_revisions r
         set title = ${WORKSPACE_TITLE}, doi = null, byline = null, authors = null,
             published_at = null, published_year = null,
             final_url = 'https://transformer-circuits.pub/2026/workspace/index.html',
             raw_filename = ${filename}
        from spideryarn.articles a
       where a.current_revision_id = r.id and a.slug = ${slug}`);
  }
}, 240_000);

afterAll(async () => {
  for (const article of scratch) await article.remove();
  await closeDb();
});

interface Reply {
  status: number;
  body: Record<string, unknown> | null;
}

async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = AUTHED_HEADERS): Promise<Reply> {
  const req = Object.assign(
    (async function* () {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body));
    })(),
    { method, url, headers: body !== undefined ? { ...headers, "content-type": "application/json" } : headers },
  ) as unknown as IncomingMessage;
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

const citers = (slug: string, headers?: Record<string, string>) => call("GET", `/api/citers/${slug}`, undefined, headers);

describe("GET /api/citers/:slug", () => {
  it("gives the owner the list, with the Experimental switch off (F4)", async () => {
    const off = await call("PATCH", "/api/reader", { experimental: false });
    expect(off.status).toBe(200);
    expect(off.body?.experimentalSince ?? null).toBeNull();

    const { status, body } = await citers(MINE);
    expect(status).toBe(200);
    expect(body).toMatchObject({ kind: "found", count: 39, returned: 39, dropped: 0, capped: false });
    expect(body?.citers).toHaveLength(39);
    expect(asked).toEqual([WORK_URL, CITERS_URL]);
    /* The second ask is the cache's: the same answer and no request. */
    expect((await citers(MINE)).body).toEqual(body);
    expect(asked).toEqual([WORK_URL, CITERS_URL]);
  });

  it("says no-doi for an article without one, and asks nothing", async () => {
    expect(await citers(NO_DOI)).toEqual({ status: 200, body: { kind: "no-doi" } });
    expect(asked).toEqual([]);
  });

  it("finds an article with no DOI by its title, author and year, and keys its list by OpenAlex's id (261011q)", async () => {
    const { status, body } = await citers(BY_TITLE);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      kind: "found",
      via: "title",
      target: { openalexId: "W2626778328", title: ATTENTION },
      count: 39,
    });
    expect(asked).toEqual([SEARCH_URL, TITLE_CITERS_URL]);
    expect(
      await rows(sql`select work_id from spideryarn.citation_index_lookups where work_id like 'openalex:%'`),
    ).toEqual([{ work_id: "openalex:w2626778328" }]);
  });

  it("joins The Extended Mind's twin records, and answers its topic view on ?about=topic (261025h)", async () => {
    const all = await citers(TWINS);
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({
      kind: "found",
      via: "title",
      target: { openalexId: "W393180982", alsoHeldAs: ["W4239232206"] },
      count: 5849,
      topic: { keyword: "extended mind" },
    });
    expect(all.body?.filteredBy).toBeUndefined();
    /* The topic's list is not fetched until it is asked for. */
    expect(asked).toEqual([EM_SEARCH_URL, EM_CITERS_URL]);

    const topic = await call("GET", `/api/citers/${TWINS}?about=topic`);
    expect(topic.status).toBe(200);
    expect(topic.body).toMatchObject({ kind: "found", filteredBy: "extended mind", count: 556, topic: { count: 556 } });
    expect(asked).toEqual([EM_SEARCH_URL, EM_CITERS_URL, EM_SEARCH_URL, EM_TOPIC_URL]);
    expect(
      await rows(sql`select work_id, target_keyword from spideryarn.citation_index_lookups where work_id like ${`${EM_KEY}%`} order by work_id`),
    ).toEqual([
      { work_id: EM_KEY, target_keyword: "extended mind" },
      { work_id: `${EM_KEY}#topic`, target_keyword: "extended mind" },
    ]);
    /* Then the plain list carries the count, off the topic's row. */
    expect((await citers(TWINS)).body).toMatchObject({ topic: { keyword: "extended mind", count: 556 } });
  });

  it("refuses an ?about= it does not know", async () => {
    expect((await call("GET", `/api/citers/${TWINS}?about=anything`)).status).toBe(400);
    expect(asked).toEqual([]);
  });

  it("checks the imported title, so a renamed paper still gets its citers (F2)", async () => {
    const renamed = await call("PATCH", `/api/library/${MINE}`, { title: "Levin on memory, to read on the train" });
    expect(renamed.status).toBe(200);
    try {
      const { status, body } = await citers(MINE);
      expect(status).toBe(200);
      expect(body?.kind).toBe("found");
    } finally {
      await call("PATCH", `/api/library/${MINE}`, { title: null });
    }
  });

  it("gives a second article carrying that DOI nothing, fresh and off the cache (F1)", async () => {
    expect((await citers(WRONG_DOI)).body).toEqual({ kind: "unconfirmed" });
    /* One request: the list was never asked for. */
    expect(asked).toEqual([WORK_URL]);
    /* The right article fills the cache… */
    expect((await citers(MINE)).body?.kind).toBe("found");
    asked = [];
    /* …and the wrong one still gets nothing from it. */
    expect((await citers(WRONG_DOI)).body).toEqual({ kind: "unconfirmed" });
    expect(asked).toEqual([]);
  });

  it("is a 404 for another reader's article, and asks nothing", async () => {
    const { status, body } = await citers(THEIRS);
    expect(status).toBe(404);
    expect(body?.kind).toBeUndefined();
    expect(asked).toEqual([]);
    /* The positive control for "theirs is a real article": a slug nobody has
       is the very same answer, which is the point. */
    expect((await citers("test-citers-nobody-has-this")).status).toBe(404);
  });

  it("is a 401 for a signed-out caller, and asks nothing", async () => {
    const { status } = await citers(MINE, {});
    expect(status).toBe(401);
    expect(asked).toEqual([]);
  });
});

describe("GET /api/citers/:slug?with=possible (261026f)", () => {
  it("adds Possible citations to a no-doi answer for an article from a public address", async () => {
    expect(await citers(POSSIBLE)).toEqual({ status: 200, body: { kind: "no-doi" } });
    expect(asked).toEqual([]);

    const { status, body } = await call("GET", `/api/citers/${POSSIBLE}?with=possible`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      kind: "no-doi",
      possible: { kind: "found", total: 134, dropped: 1, order: "newest" },
    });
    /* The piece's own record (*A Verbalizable…*) is out; the citer is in. */
    expect((body?.possible as { citers: { openalexId: string }[] }).citers.map((c) => c.openalexId)).toEqual(["W2"]);
    expect(asked).toEqual([POSSIBLE_URL]);
  });

  it("never sends an upload's title, and answers it as before", async () => {
    expect(await call("GET", `/api/citers/${UPLOADED}?with=possible`)).toEqual({ status: 200, body: { kind: "no-doi" } });
    expect(asked).toEqual([]);
  });

  it("leaves a found list as it was, and asks nothing more for it", async () => {
    const plain = (await citers(MINE)).body;
    asked = [];
    expect((await call("GET", `/api/citers/${MINE}?with=possible`)).body).toEqual(plain);
    expect(asked).toEqual([]);
  });

  it("refuses a with= it does not know, alone or repeated, before asking anything", async () => {
    expect((await call("GET", `/api/citers/${POSSIBLE}?with=everything`)).status).toBe(400);
    expect((await call("GET", `/api/citers/${POSSIBLE}?with=possible&with=everything`)).status).toBe(400);
    expect(asked).toEqual([]);
  });

  it("is a 404 for another reader's article, with=possible or not", async () => {
    expect((await call("GET", `/api/citers/${THEIRS}?with=possible`)).status).toBe(404);
    expect(asked).toEqual([]);
  });
});
