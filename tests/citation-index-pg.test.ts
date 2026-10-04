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
import { CITERS_FRESH_MS, type FetchedCiters, openAlexCitersUrl, openAlexWorkUrl } from "../src/citation-index.js";
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
      mutate: withMeta((meta) => {
        delete meta.doi;
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
