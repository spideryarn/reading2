/**
 * **The bibliographic cache and the politeness it runs on, in Postgres.**
 *
 * The mechanical half of src/bibliographic.ts: three tables
 * (src/db/schema.ts § bibliographic) and the statements that make "once, and
 * gently" true across every server instance rather than inside one.
 *
 * - **The claim is one statement**, `insert … on conflict (id) do update …
 *   where` the old claim has lapsed and the old answer is stale — never a
 *   `select … for update` then an insert, which locks nothing when the row is
 *   absent (docs/project/sql.md). A claim is fenced by its own `claimed_until`,
 *   truncated to the millisecond so a JavaScript `Date` carries it exactly, so
 *   `release` can never delete somebody else's later claim.
 * - **A start is one statement**: `next_start_at = greatest(next_start_at,
 *   now()) + spacing`, refused in its own `where` when the service is cooling
 *   down or the start would be more than the caller's patience away — so a
 *   caller that gives up has not pushed everybody else's start back.
 * - **A slot is a row leased with `for update skip locked`**, fenced by its
 *   `lease_until` the same way as the claim.
 *
 * Every write is its own short transaction pinned to `read committed`: an
 * `on conflict do update` or a contended `update` above that level raises
 * `40001` instead of waiting (docs/project/sql.md). No network inside any of
 * them — src/bibliographic.ts fetches between statements.
 *
 * Freshness and every lapse are judged by the database's `now()`, so a server
 * whose clock drifts cannot serve a stale answer or steal a live claim.
 *
 * ## What may be logged from this file
 *
 * Nothing: src/bibliographic.ts logs the lookup. An identifier is not personal,
 * but this file has nothing to add to that line.
 */

import { sql, type SQL } from "drizzle-orm";

import type {
  BibliographicStore,
  CachedAnswer,
  Freshness,
  IdentifierClaim,
  LimiterService,
  Registry,
  SlotLease,
  StartTaken,
  WorkAuthor,
  WorkId,
} from "../bibliographic.js";
import { getDb } from "../db/client.js";
import { guardDbStore } from "./db-errors.js";
import { READ_COMMITTED } from "./isolation.js";

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows?: T[] }).rows ?? [];
}

function secs(ms: number): number {
  return ms / 1000;
}

/** The rows the migration must seed. Checked on a failed take so absence is a fault, not permanent `busy`. */
const EXPECTED_SLOTS: Record<LimiterService, number> = { crossref: 2, datacite: 1, openalex: 1 };

/** The fresh-answer test, against the table's own columns — one copy, used by the read and by the claim. */
function freshSql(fresh: Freshness): SQL {
  return sql`(
    (spideryarn.bibliographic_records.state = 'found'
      and spideryarn.bibliographic_records.fetched_at > now() - make_interval(secs => ${secs(fresh.foundMs)}))
    or (spideryarn.bibliographic_records.state = 'not-found'
      and spideryarn.bibliographic_records.fetched_at > now() - make_interval(secs => ${secs(fresh.notFoundMs)}))
  )`;
}

interface RecordRow {
  state: "found" | "not-found" | null;
  source: Registry | null;
  title: string | null;
  authors_family: string[] | null;
  authors_given: (string | null)[] | null;
  year: number | null;
  venue: string | null;
  published_day: string | null;
  doi: string | null;
  fresh: boolean;
  claimed: boolean;
}

function answerOf(id: WorkId, row: RecordRow): CachedAnswer | null {
  if (!row.fresh) return null;
  if (row.state === "not-found") return { kind: "not-found" };
  if (row.state !== "found" || row.source === null || row.title === null || row.doi === null) return null;
  const given = row.authors_given ?? [];
  const authors: WorkAuthor[] = (row.authors_family ?? []).map((family, i) => {
    const g = given[i];
    return g === null || g === undefined ? { family } : { family, given: g };
  });
  return {
    kind: "found",
    record: {
      id,
      source: row.source,
      title: row.title,
      authors,
      ...(row.year !== null ? { year: row.year } : {}),
      ...(row.venue !== null ? { venue: row.venue } : {}),
      ...(row.published_day !== null ? { published: row.published_day } : {}),
      doi: row.doi,
    },
  };
}

const rawPgBibliographicStore: BibliographicStore = {
  async read(id, fresh) {
    const result = await getDb().execute(sql`
      select state, source, title, authors_family, authors_given, year, venue, published_day, doi,
             coalesce(${freshSql(fresh)}, false) as fresh,
             coalesce(claimed_until > now(), false) as claimed
        from spideryarn.bibliographic_records
       where id = ${id}`);
    const row = rowsOf<RecordRow>(result)[0];
    if (!row) return { answer: null, claimed: false };
    return { answer: answerOf(id, row), claimed: row.claimed };
  },

  async claim(id, fresh, leaseMs) {
    return getDb().transaction(async (tx): Promise<IdentifierClaim | null> => {
      const result = await tx.execute(sql`
        insert into spideryarn.bibliographic_records (id, claimed_until)
        values (${id}, date_trunc('milliseconds', now() + make_interval(secs => ${secs(leaseMs)})))
        on conflict (id) do update set claimed_until = excluded.claimed_until
         where (spideryarn.bibliographic_records.claimed_until is null
                or spideryarn.bibliographic_records.claimed_until <= now())
           and not coalesce(${freshSql(fresh)}, false)
        returning claimed_until`);
      const row = rowsOf<{ claimed_until: Date | string }>(result)[0];
      return row ? { id, until: new Date(row.claimed_until) } : null;
    }, READ_COMMITTED);
  },

  async release(claim) {
    await getDb().transaction(async (tx) => {
      /* A claim with no answer behind it goes altogether, so an error stores
         nothing; a stale answer being refreshed keeps its row and loses only
         the claim. Both fenced on this claim's own moment. */
      await tx.execute(sql`
        delete from spideryarn.bibliographic_records
         where id = ${claim.id} and state is null and claimed_until = ${claim.until.toISOString()}::timestamptz`);
      await tx.execute(sql`
        update spideryarn.bibliographic_records set claimed_until = null
         where id = ${claim.id} and state is not null and claimed_until = ${claim.until.toISOString()}::timestamptz`);
    }, READ_COMMITTED);
  },

  async write(claim, answer) {
    const found = answer.kind === "found" ? answer.record : null;
    const family = found ? found.authors.map((a) => a.family) : null;
    const given = found ? found.authors.map((a) => a.given ?? null) : null;
    /* `sql.param`, because a bare array inside drizzle's `sql` is spread into a
       list of parameters; node-postgres writes one array parameter as a
       Postgres array literal, nulls included. */
    return await getDb().transaction(async (tx): Promise<boolean> => {
      /* The claim row already exists. Updating it under the exact lease moment is
         the write fence: a claimant that wakes after expiry cannot overwrite the
         answer or clear the claim of the process that took over. */
      const result = await tx.execute(sql`
        update spideryarn.bibliographic_records
           set state = ${answer.kind}, source = ${found?.source ?? null}, title = ${found?.title ?? null},
               authors_family = ${sql.param(family)}::text[], authors_given = ${sql.param(given)}::text[],
               year = ${found?.year ?? null}::integer, venue = ${found?.venue ?? null}, doi = ${found?.doi ?? null},
               published_day = ${found?.published ?? null},
               fetched_at = now(), claimed_until = null
         where id = ${claim.id}
           and claimed_until = ${claim.until.toISOString()}::timestamptz
        returning id`);
      return rowsOf(result).length === 1;
    }, READ_COMMITTED);
  },

  async coolingDown(service) {
    const result = await getDb().execute(sql`
      select coalesce(cooldown_until > now(), false) as cooling
        from spideryarn.bibliographic_services where service = ${service}`);
    const row = rowsOf<{ cooling: boolean }>(result)[0];
    if (!row) throw new Error(`bibliographic_services has no row for ${service}; its migration seeds one`);
    return row.cooling;
  },

  async takeSlot(service, leaseMs) {
    return getDb().transaction(async (tx): Promise<SlotLease | null> => {
      const result = await tx.execute(sql`
        update spideryarn.bibliographic_service_slots s
           set lease_until = date_trunc('milliseconds', now() + make_interval(secs => ${secs(leaseMs)}))
          from (select service, slot from spideryarn.bibliographic_service_slots
                 where service = ${service} and (lease_until is null or lease_until <= now())
                 order by slot
                 limit 1
                 for update skip locked) free
         where s.service = free.service and s.slot = free.slot
        returning s.slot, s.lease_until`);
      const row = rowsOf<{ slot: number; lease_until: Date | string }>(result)[0];
      if (row) {
        const slot = Number(row.slot);
        if (slot < 1 || slot > EXPECTED_SLOTS[service]) {
          throw new Error(`bibliographic_service_slots has an unexpected slot for ${service}`);
        }
        return { service, slot, until: new Date(row.lease_until) };
      }
      const seeded = await tx.execute(sql`
        select count(*)::int as count
          from spideryarn.bibliographic_service_slots where service = ${service}`);
      const count = Number(rowsOf<{ count: number | string }>(seeded)[0]?.count ?? 0);
      if (count !== EXPECTED_SLOTS[service]) {
        throw new Error(`bibliographic_service_slots has ${count} rows for ${service}; its migration seeds ${EXPECTED_SLOTS[service]}`);
      }
      return null;
    }, READ_COMMITTED);
  },

  async freeSlot(lease) {
    await getDb().transaction(async (tx) => {
      await tx.execute(sql`
        update spideryarn.bibliographic_service_slots set lease_until = null
         where service = ${lease.service} and slot = ${lease.slot}
           and lease_until = ${lease.until.toISOString()}::timestamptz`);
    }, READ_COMMITTED);
  },

  async takeStart(service, spacingMs, maxWaitMs) {
    return getDb().transaction(async (tx): Promise<StartTaken> => {
      const result = await tx.execute(sql`
        update spideryarn.bibliographic_services
           set next_start_at = greatest(next_start_at, now()) + make_interval(secs => ${secs(spacingMs)})
         where service = ${service}
           and (cooldown_until is null or cooldown_until <= now())
           and next_start_at <= now() + make_interval(secs => ${secs(maxWaitMs)})
        returning greatest(0, extract(epoch from (next_start_at - make_interval(secs => ${secs(spacingMs)}) - now())) * 1000)::float8 as wait_ms`);
      const taken = rowsOf<{ wait_ms: number | string }>(result)[0];
      if (taken) return { kind: "start", waitMs: Math.ceil(Number(taken.wait_ms)) };
      /* Refused: say which of the two refusals it was, or that the row is missing. */
      const why = await tx.execute(sql`
        select coalesce(cooldown_until > now(), false) as cooling
          from spideryarn.bibliographic_services where service = ${service}`);
      const row = rowsOf<{ cooling: boolean }>(why)[0];
      if (!row) throw new Error(`bibliographic_services has no row for ${service}; its migration seeds one`);
      return row.cooling ? { kind: "cooling-down" } : { kind: "busy" };
    }, READ_COMMITTED);
  },

  async coolDown(service, forMs) {
    await getDb().transaction(async (tx) => {
      await tx.execute(sql`
        update spideryarn.bibliographic_services
           set cooldown_until = greatest(coalesce(cooldown_until, now()), now() + make_interval(secs => ${secs(forMs)}))
         where service = ${service}`);
    }, READ_COMMITTED);
  },
};

/** Guarded at the export, like every adapter here — tests/store-guarded.test.ts. */
export const pgBibliographicStore: BibliographicStore = guardDbStore(
  "bibliographic",
  rawPgBibliographicStore,
);
