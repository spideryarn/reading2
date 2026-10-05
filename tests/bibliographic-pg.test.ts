/**
 * **The bibliographic lookup's politeness, against a real Postgres** — stage 1 of
 * docs/plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md.
 *
 * Everything here is a property of the database rather than of an interface,
 * which is why it cannot run against the in-memory store in
 * tests/bibliographic.test.ts:
 *
 * 1. **The claim** — two lookups of one identifier make one request; a lapsed
 *    claim can be taken over; a stale claimant's `release` cannot delete the
 *    claim that replaced it.
 * 2. **Slots** — 2 for Crossref, 1 for DataCite, seeded by the migration, leased
 *    with `skip locked` and fenced on their own lease.
 * 3. **Spacing** — starts 250 ms apart, a start more than 3 s away refused
 *    *without* pushing anybody else's back, and a cooldown that refuses.
 * 4. **The shape CHECKs** — a malformed identifier or a found row with no title
 *    is refused by the table, whoever the writer.
 *
 * The tables are ownerless and shared by construction, so every case resets
 * them; the private lane is what makes that safe.
 *
 * Refuses loudly when there is no database; tests/helpers/pg-ready.ts.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type BibliographicStore,
  CLAIM_LEASE_MS,
  crossrefUrl,
  FRESHNESS,
  lookupWork,
  parseWorkId,
  SLOT_LEASE_MS,
  type WorkId,
} from "../src/bibliographic.js";
import { closeDb, getDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { FetchFailure } from "../src/fetch.js";
import { pgBibliographicStore as store } from "../src/store/pg-bibliographic.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

await pgReady({
  suite: "tests/bibliographic-pg.test.ts",
  tables: [
    "spideryarn.bibliographic_records",
    "spideryarn.bibliographic_services",
    "spideryarn.bibliographic_service_slots",
  ],
});

function id(input: string): WorkId {
  const parsed = parseWorkId(input);
  if (parsed === null) throw new Error(`not a work id: ${input}`);
  return parsed;
}

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return ((await getDb().execute(query)) as unknown as { rows: T[] }).rows;
}

beforeEach(async () => {
  const db = getDb();
  await db.execute(sql`delete from spideryarn.bibliographic_records`);
  await db.execute(sql`update spideryarn.bibliographic_services set next_start_at = now(), cooldown_until = null`);
  await db.execute(sql`update spideryarn.bibliographic_service_slots set lease_until = null`);
});

afterAll(async () => {
  await closeDb();
});

const CROSSREF_ANSWER = {
  message: {
    DOI: "10.1038/nn.4304",
    title: ["Hippocampo-cortical coupling mediates memory consolidation during sleep"],
    author: [{ given: "Nicolas", family: "Maingret" }, { name: "A Consortium" }],
    issued: { "date-parts": [[2016, 5, 16]] },
    "container-title": ["Nature Neuroscience"],
  },
};

describe("the seeded politeness rows", () => {
  it("has one service row each, and 2 + 1 + 1 slots", async () => {
    expect(
      await rows<{ service: string; slots: number }>(sql`
        select s.service, count(l.slot)::int as slots
          from spideryarn.bibliographic_services s
          left join spideryarn.bibliographic_service_slots l using (service)
         group by s.service order by s.service`),
    ).toEqual([
      { service: "crossref", slots: 2 },
      { service: "datacite", slots: 1 },
      /* The citation index, since 2026-10-04 (plan 261004h): a third service on the same limiter. */
      { service: "openalex", slots: 1 },
    ]);
  });
});

describe("the claim", () => {
  const nn = id("10.1038/nn.4304");

  it("is taken once: a second claim on a live one is refused", async () => {
    const first = await store.claim(nn, FRESHNESS, CLAIM_LEASE_MS);
    const second = await store.claim(nn, FRESHNESS, CLAIM_LEASE_MS);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await store.read(nn, FRESHNESS)).toEqual({ answer: null, claimed: true });
  });

  it("is refused over a fresh answer, and taken over a stale one without losing it", async () => {
    const first = await store.claim(nn, FRESHNESS, CLAIM_LEASE_MS);
    expect(first).not.toBeNull();
    /* A miss is stored, and `write` says when: null is only ever a lost claim (plan 261005i, GPT Sol's F1). */
    expect(await store.write(first!, { kind: "not-found" })).toBeInstanceOf(Date);
    expect(await store.claim(nn, FRESHNESS, CLAIM_LEASE_MS)).toBeNull();
    await getDb().execute(
      sql`update spideryarn.bibliographic_records set fetched_at = now() - interval '8 days' where id = ${nn}`,
    );
    expect(await store.read(nn, FRESHNESS)).toEqual({ answer: null, claimed: false });
    const claim = await store.claim(nn, FRESHNESS, CLAIM_LEASE_MS);
    expect(claim).not.toBeNull();
    await store.release(claim!);
    /* The stale answer's row is kept, only unclaimed — an error stores nothing new and deletes nothing old. */
    expect(await rows(sql`select state, claimed_until from spideryarn.bibliographic_records where id = ${nn}`)).toEqual([
      { state: "not-found", claimed_until: null },
    ]);
  });

  it("can be taken over once it lapses, and the stale holder's release leaves the new claim alone", async () => {
    const stale = await store.claim(nn, FRESHNESS, CLAIM_LEASE_MS);
    await getDb().execute(
      sql`update spideryarn.bibliographic_records set claimed_until = now() - interval '1 second' where id = ${nn}`,
    );
    /* The lapse moved the row's moment, so the fence below is on the value the stale holder was given. */
    const fresh = await store.claim(nn, FRESHNESS, CLAIM_LEASE_MS);
    expect(fresh).not.toBeNull();
    await store.release({ id: nn, until: new Date(Date.now() - 1000) });
    await store.release(stale!);
    expect((await store.read(nn, FRESHNESS)).claimed).toBe(true);
    await store.release(fresh!);
    expect(await rows(sql`select id from spideryarn.bibliographic_records where id = ${nn}`)).toEqual([]);
  });

  it("does not let a stale claimant's answer replace its successor's live claim", async () => {
    /* The answer write is part of the claim's fence, not merely a write keyed by
       the identifier. A process can pause past its lease, then wake after a
       successor has claimed the same work. Under the old `write(id, …)`, the
       update had no lease predicate and therefore cleared the successor's
       claim while installing the stale caller's answer. */
    const stale = await store.claim(nn, FRESHNESS, CLAIM_LEASE_MS);
    expect(stale).not.toBeNull();
    await getDb().execute(
      sql`update spideryarn.bibliographic_records set claimed_until = now() - interval '1 second' where id = ${nn}`,
    );
    const fresh = await store.claim(nn, FRESHNESS, CLAIM_LEASE_MS);
    expect(fresh).not.toBeNull();

    expect(await store.write(stale!, { kind: "not-found" })).toBeNull();

    expect(await store.read(nn, FRESHNESS)).toEqual({ answer: null, claimed: true });
    await store.release(fresh!);
  });

  it("makes two lookups of one identifier into one request", async () => {
    let answer: (value: unknown) => void = () => {};
    const fetchJson = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          answer = resolve;
        }),
    );
    /* Each caller's first read is told nobody holds a claim, so both reach the
       claim statement and it alone decides — without this, the second caller's
       read usually sees the first's claim and the claim is never contested. */
    const blindFirstRead = (): BibliographicStore => {
      let first = true;
      return {
        ...store,
        read: async (w, f) => {
          const seen = await store.read(w, f);
          if (!first) return seen;
          first = false;
          return { ...seen, claimed: false };
        },
      };
    };
    const one = lookupWork(nn, { store: blindFirstRead(), fetchJson });
    const two = lookupWork(nn, { store: blindFirstRead(), fetchJson });
    await vi.waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(1), { timeout: 3_000 });
    /* Give the loser time to see the claim and start waiting on it. */
    await new Promise((r) => setTimeout(r, 300));
    answer(CROSSREF_ANSWER);
    const [a, b] = await Promise.all([one, two]);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(a).toMatchObject({ kind: "found", record: { title: CROSSREF_ANSWER.message.title[0] } });
    expect(b).toEqual(a);
  });
});

describe("the cache", () => {
  it("round-trips a record, an organisation with no given name included", async () => {
    const nn = id("10.1038/nn.4304");
    const fetchJson = vi.fn(async () => CROSSREF_ANSWER);
    const first = await lookupWork(nn, { store, fetchJson });
    const second = await lookupWork(nn, { store, fetchJson });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second).toEqual({
      kind: "found",
      record: {
        id: nn,
        source: "crossref",
        title: "Hippocampo-cortical coupling mediates memory consolidation during sleep",
        authors: [{ family: "Maingret", given: "Nicolas" }, { family: "A Consortium" }],
        year: 2016,
        venue: "Nature Neuroscience",
        /* Read back from `published_day`: the second answer came from the cache. */
        published: "2016-05-16",
        doi: "10.1038/nn.4304",
        /* Crossref was asked and gave no count: the moment is kept, the count is not. */
        citedByCountReadAt: expect.any(String) as string,
      },
    });
  });

  describe("Crossref's citation count (plan 261005i)", () => {
    const doi = "10.1000/counted";
    const work = id(doi);
    const counted = (count?: number) => ({
      message: {
        DOI: doi,
        title: ["Dreams and memory consolidation"],
        ...(count === undefined ? {} : { "is-referenced-by-count": count }),
      },
    });
    const DATASET = { data: { attributes: { titles: [{ title: "A dataset" }], creators: [], doi } } };
    const notFound = (url: string) => new FetchFailure("not-found", url, "HTTP 404", { status: 404, retryAfterMs: null });
    const columns = () =>
      rows<{ state: string; source: string | null; cited_by_count: number | null; read: boolean; same: boolean | null }>(sql`
        select state, source, cited_by_count, cited_by_count_read_at is not null as read,
               cited_by_count_read_at = fetched_at as same
          from spideryarn.bibliographic_records where id = ${work}`);
    /** A record as the code before this feature left it: found, from Crossref, fetched just now, never asked for its count. */
    const preFeature = () =>
      getDb().execute(sql`
        insert into spideryarn.bibliographic_records (id, state, source, title, authors_family, authors_given, doi, fetched_at)
        values (${work}, 'found', 'crossref', 'Dreams and memory consolidation', '{}', '{}', ${doi}, now())`);

    it("round-trips the count and the moment it was read, which is the moment the answer was stored", async () => {
      const fetchJson = vi.fn(async () => counted(357));
      const first = await lookupWork(work, { store, fetchJson });
      expect(first).toMatchObject({ kind: "found", record: { citedByCount: 357 } });
      const readAt = (first as { record: { citedByCountReadAt?: string } }).record.citedByCountReadAt;
      expect(readAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(Math.abs(Date.parse(readAt!) - Date.now())).toBeLessThan(60_000);
      /* The cached read gives the same moment the write returned. */
      expect(await lookupWork(work, { store, fetchJson })).toEqual(first);
      expect(fetchJson).toHaveBeenCalledTimes(1);
      expect(await columns()).toEqual([{ state: "found", source: "crossref", cited_by_count: 357, read: true, same: true }]);
    });

    it("keeps a zero as a zero, not as no count", async () => {
      const first = await lookupWork(work, { store, fetchJson: async () => counted(0) });
      expect(first).toMatchObject({ record: { citedByCount: 0 } });
      expect(await lookupWork(work, { store, fetchJson: async () => counted(99) })).toEqual(first);
    });

    it("does not call a Crossref record fresh until somebody has asked for its count, and asks once", async () => {
      await preFeature();
      expect(await store.read(work, FRESHNESS)).toEqual({ answer: null, claimed: false });
      const fetchJson = vi.fn(async () => counted(12));
      expect(await lookupWork(work, { store, fetchJson })).toMatchObject({ record: { citedByCount: 12 } });
      expect(await lookupWork(work, { store, fetchJson })).toMatchObject({ record: { citedByCount: 12 } });
      expect(fetchJson).toHaveBeenCalledTimes(1);
    });

    it("is fresh once Crossref was asked and gave no count: asked-and-none is not never-asked", async () => {
      /* The loop this column exists to stop: `cited_by_count is null` alone would ask on every call. */
      const fetchJson = vi.fn(async () => counted());
      const first = await lookupWork(work, { store, fetchJson });
      expect((first as { record: object }).record).not.toHaveProperty("citedByCount");
      expect(await columns()).toEqual([{ state: "found", source: "crossref", cited_by_count: null, read: true, same: true }]);
      expect(await store.claim(work, FRESHNESS, CLAIM_LEASE_MS)).toBeNull();
      expect(await lookupWork(work, { store, fetchJson })).toEqual(first);
      expect(fetchJson).toHaveBeenCalledTimes(1);
    });

    it("leaves a DataCite record fresh with no read moment: there is nothing to go back for", async () => {
      await getDb().execute(sql`
        insert into spideryarn.bibliographic_records (id, state, source, title, authors_family, authors_given, doi, fetched_at)
        values (${work}, 'found', 'datacite', 'A dataset', '{}', '{}', ${doi}, now())`);
      const seen = await store.read(work, FRESHNESS);
      expect(seen.answer).toMatchObject({ kind: "found", record: { source: "datacite" } });
      expect(await store.claim(work, FRESHNESS, CLAIM_LEASE_MS)).toBeNull();
    });

    it("keeps a pre-feature record eligible after a failed refresh, and its old answer in the table", async () => {
      await preFeature();
      const down = vi.fn(async (url: string) => {
        throw new FetchFailure("server-error", url, "HTTP 500", { status: 500, retryAfterMs: null });
      });
      expect(await lookupWork(work, { store, fetchJson: down })).toEqual({ kind: "unavailable", why: "error" });
      expect(await lookupWork(work, { store, fetchJson: down })).toEqual({ kind: "unavailable", why: "error" });
      expect(down).toHaveBeenCalledTimes(2);
      expect(await columns()).toEqual([{ state: "found", source: "crossref", cited_by_count: null, read: false, same: null }]);
      const up = vi.fn(async () => counted(3));
      expect(await lookupWork(work, { store, fetchJson: up })).toMatchObject({ record: { citedByCount: 3 } });
      await lookupWork(work, { store, fetchJson: up });
      expect(up).toHaveBeenCalledTimes(1);
    });

    it("clears the count and its moment when the refresh finds DataCite's record, or nothing, in Crossref's place", async () => {
      const stale = () =>
        getDb().execute(sql`
          update spideryarn.bibliographic_records set fetched_at = now() - interval '181 days' where id = ${work}`);
      await lookupWork(work, { store, fetchJson: async () => counted(357) });
      await stale();
      const toDatacite = await lookupWork(work, {
        store,
        fetchJson: async (url) => {
          if (url === crossrefUrl(doi)) throw notFound(url);
          return DATASET;
        },
      });
      expect(toDatacite).toMatchObject({ kind: "found", record: { source: "datacite" } });
      expect((toDatacite as { record: object }).record).not.toHaveProperty("citedByCount");
      expect((toDatacite as { record: object }).record).not.toHaveProperty("citedByCountReadAt");
      expect(await columns()).toEqual([{ state: "found", source: "datacite", cited_by_count: null, read: false, same: null }]);

      await getDb().execute(sql`delete from spideryarn.bibliographic_records where id = ${work}`);
      await lookupWork(work, { store, fetchJson: async () => counted(357) });
      await stale();
      expect(
        await lookupWork(work, {
          store,
          fetchJson: async (url) => {
            throw notFound(url);
          },
        }),
      ).toEqual({ kind: "not-found" });
      expect(await columns()).toEqual([{ state: "not-found", source: null, cited_by_count: null, read: false, same: null }]);
    });

    it("says when it stored a DataCite record too, so a stored answer is never read as a lost claim", async () => {
      const claim = await store.claim(work, FRESHNESS, CLAIM_LEASE_MS);
      const at = await store.write(claim!, {
        kind: "found",
        record: { id: work, source: "datacite", title: "A dataset", authors: [], doi },
      });
      expect(at).toBeInstanceOf(Date);
      expect(await columns()).toEqual([{ state: "found", source: "datacite", cited_by_count: null, read: false, same: null }]);
    });

    it("is refused, by the table itself, a count that is not Crossref's found record's, or has no moment", async () => {
      const refusedBy = async (query: ReturnType<typeof sql>): Promise<string | undefined> => {
        try {
          await getDb().execute(query);
          return undefined;
        } catch (err) {
          const cause = (err as { cause?: { code?: string; constraint?: string } }).cause;
          expect(cause?.code).toBe("23514");
          return cause?.constraint;
        }
      };
      const found = (source: string, count: string, readAt: string) => sql`
        insert into spideryarn.bibliographic_records
          (id, state, source, title, authors_family, authors_given, doi, fetched_at, cited_by_count, cited_by_count_read_at)
        values (${work}, 'found', ${source}, 'A title', '{}', '{}', ${doi}, now(), ${sql.raw(count)}, ${sql.raw(readAt)})`;
      expect(await refusedBy(found("datacite", "12", "now()"))).toBe("bibliographic_records_cited_by_count");
      expect(await refusedBy(found("crossref", "-1", "now()"))).toBe("bibliographic_records_cited_by_count");
      expect(await refusedBy(found("crossref", "12", "null"))).toBe("bibliographic_records_cited_by_count");
      /* A read moment says "Crossref was asked", so only a Crossref record has one. */
      expect(await refusedBy(found("datacite", "null", "now()"))).toBe("bibliographic_records_cited_by_count_read_at");
      expect(
        await refusedBy(sql`
          insert into spideryarn.bibliographic_records (id, state, fetched_at, cited_by_count_read_at)
          values (${work}, 'not-found', now(), now())`),
      ).toBe("bibliographic_records_cited_by_count_read_at");
      /* A claim has SQL NULL state and source: `= 'found'` would evaluate NULL and let these through
         (docs/postmortems/261004a-a-nullable-state-turns-a-check-into-permission.md). */
      expect(
        await refusedBy(sql`
          insert into spideryarn.bibliographic_records (id, claimed_until, cited_by_count, cited_by_count_read_at)
          values (${work}, now(), 12, now())`),
      ).toBe("bibliographic_records_cited_by_count");
      expect(
        await refusedBy(sql`
          insert into spideryarn.bibliographic_records (id, claimed_until, cited_by_count_read_at)
          values (${work}, now(), now())`),
      ).toBe("bibliographic_records_cited_by_count_read_at");
      /* And the good shapes go in. */
      expect(await refusedBy(found("crossref", "2147483647", "now()"))).toBeUndefined();
      await getDb().execute(sql`delete from spideryarn.bibliographic_records where id = ${work}`);
      expect(await refusedBy(found("crossref", "null", "now()"))).toBeUndefined();
    });
  });

  it("stores nothing for an error, and cools the service for everybody on a 429", async () => {
    const nn = id("10.1038/nn.4304");
    const fetchJson = vi.fn(async (url: string) => {
      expect(url).toBe(crossrefUrl("10.1038/nn.4304"));
      throw new FetchFailure("rate-limited", url, "slow down", { status: 429, retryAfterMs: 90_000 });
    });
    expect(await lookupWork(nn, { store, fetchJson })).toEqual({ kind: "unavailable", why: "cooling-down" });
    expect(await rows(sql`select id from spideryarn.bibliographic_records`)).toEqual([]);
    const [cool] = await rows<{ secs: number }>(sql`
      select extract(epoch from (cooldown_until - now()))::float8 as secs
        from spideryarn.bibliographic_services where service = 'crossref'`);
    expect(cool!.secs).toBeGreaterThan(80);
    expect(cool!.secs).toBeLessThanOrEqual(90);
    expect(await lookupWork(id("10.1000/another"), { store, fetchJson })).toEqual({
      kind: "unavailable",
      why: "cooling-down",
    });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    /* DataCite is a different service and is not cooled. */
    expect(await store.coolingDown("datacite")).toBe(false);
  });

  it("is refused a malformed identifier or a found row with no title, by the table itself", async () => {
    /** The CHECK that refused, read off the driver's error under drizzle's wrapper. */
    const refusedBy = async (query: ReturnType<typeof sql>): Promise<string | undefined> => {
      try {
        await getDb().execute(query);
        return undefined;
      } catch (err) {
        const cause = (err as { cause?: { code?: string; constraint?: string } }).cause;
        expect(cause?.code).toBe("23514");
        return cause?.constraint;
      }
    };
    expect(
      await refusedBy(sql`insert into spideryarn.bibliographic_records (id, claimed_until) values ('doi:not-a-doi', now())`),
    ).toBe("bibliographic_records_id");
    expect(
      await refusedBy(sql`insert into spideryarn.bibliographic_records (id, claimed_until) values ('DOI:10.1000/X', now())`),
    ).toBe("bibliographic_records_id");
    expect(
      await refusedBy(sql`
        insert into spideryarn.bibliographic_records (id, state, source, authors_family, authors_given, doi, fetched_at)
        values ('doi:10.1000/x', 'found', 'crossref', '{}', '{}', '10.1000/x', now())`),
    ).toBe("bibliographic_records_shape");
    /* A claim has SQL NULL state. `state = 'found'` makes this CHECK
       evaluate NULL, which Postgres accepts; it must instead reject the day. */
    expect(
      await refusedBy(sql`
        insert into spideryarn.bibliographic_records (id, claimed_until, published_day)
        values ('doi:10.1000/claim-with-day', now(), '2024-05-31')`),
    ).toBe("bibliographic_records_published_day");
    /* And the good shapes go in, so the refusals above are about the shapes. */
    expect(
      await refusedBy(sql`insert into spideryarn.bibliographic_records (id, claimed_until) values ('arxiv:hep-th/9901001', now())`),
    ).toBeUndefined();
  });
});

describe("slots", () => {
  it("gives Crossref two and DataCite one, and no more", async () => {
    const a = await store.takeSlot("crossref", SLOT_LEASE_MS);
    const b = await store.takeSlot("crossref", SLOT_LEASE_MS);
    const c = await store.takeSlot("crossref", SLOT_LEASE_MS);
    expect([a?.slot, b?.slot].sort()).toEqual([1, 2]);
    expect(c).toBeNull();
    expect(await store.takeSlot("datacite", SLOT_LEASE_MS)).not.toBeNull();
    expect(await store.takeSlot("datacite", SLOT_LEASE_MS)).toBeNull();
    await store.freeSlot(a!);
    expect(await store.takeSlot("crossref", SLOT_LEASE_MS)).toMatchObject({ slot: a!.slot });
  });

  it("lets a lapsed lease be retaken, and a stale holder's free cannot free the new lease", async () => {
    const stale = await store.takeSlot("datacite", SLOT_LEASE_MS);
    await getDb().execute(
      sql`update spideryarn.bibliographic_service_slots set lease_until = now() - interval '1 second' where service = 'datacite'`,
    );
    const fresh = await store.takeSlot("datacite", SLOT_LEASE_MS);
    expect(fresh).not.toBeNull();
    await store.freeSlot(stale!);
    expect(await store.takeSlot("datacite", SLOT_LEASE_MS)).toBeNull();
  });

  it("treats a missing seeded slot as a store fault, not as ordinary contention", async () => {
    await getDb().execute(sql`delete from spideryarn.bibliographic_service_slots where service = 'datacite'`);
    try {
      await expect(store.takeSlot("datacite", SLOT_LEASE_MS)).rejects.toMatchObject({ name: "StoreFailure" });
    } finally {
      await getDb().execute(sql`insert into spideryarn.bibliographic_service_slots (service, slot) values ('datacite', 1)`);
    }
  });
});

describe("spacing and cooldown", () => {
  it("spaces Crossref's starts 250 ms apart", async () => {
    const waits: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = await store.takeStart("crossref", 250, 3_000);
      if (start.kind !== "start") throw new Error(`refused: ${start.kind}`);
      waits.push(start.waitMs);
    }
    expect(waits[0]).toBeLessThanOrEqual(10);
    expect(waits[1]).toBeGreaterThan(150);
    expect(waits[1]).toBeLessThanOrEqual(250);
    expect(waits[2]).toBeGreaterThan(400);
    expect(waits[2]).toBeLessThanOrEqual(500);
  });

  it("refuses a start more than 3 s away without pushing anybody else's back", async () => {
    await getDb().execute(
      sql`update spideryarn.bibliographic_services set next_start_at = now() + interval '5 seconds' where service = 'datacite'`,
    );
    const before = await rows<{ at: string }>(
      sql`select next_start_at::text as at from spideryarn.bibliographic_services where service = 'datacite'`,
    );
    expect(await store.takeStart("datacite", 500, 3_000)).toEqual({ kind: "busy" });
    const after = await rows<{ at: string }>(
      sql`select next_start_at::text as at from spideryarn.bibliographic_services where service = 'datacite'`,
    );
    expect(after).toEqual(before);
  });

  it("refuses every start while cooling down, and a shorter cooldown never shortens a longer one", async () => {
    await store.coolDown("crossref", 60_000);
    await store.coolDown("crossref", 1_000);
    expect(await store.coolingDown("crossref")).toBe(true);
    expect(await store.takeStart("crossref", 250, 3_000)).toEqual({ kind: "cooling-down" });
    const [cool] = await rows<{ secs: number }>(sql`
      select extract(epoch from (cooldown_until - now()))::float8 as secs
        from spideryarn.bibliographic_services where service = 'crossref'`);
    expect(cool!.secs).toBeGreaterThan(50);
  });
});
