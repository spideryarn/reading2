/**
 * **The citation index's cache, in Postgres** — the mechanical half of
 * src/citation-index.ts: two tables (src/db/schema.ts § citation index), one
 * row per DOI and one per citing paper.
 *
 * - **The row and its list are replaced together**, in one transaction pinned
 *   to `read committed`: the lookup row is upserted, its old citers deleted and
 *   the new ones inserted. A reader never sees a count beside another fetch's
 *   list, and a count is never stored without its list.
 * - **No claim.** Two servers refreshing one DOI in the same second both ask
 *   OpenAlex and both write; the upsert makes the second wait for the first and
 *   then replace it whole. One wasted request, and not worth
 *   `bibliographic_records`' single-flight machinery in v1.
 * - **Freshness is judged by the database's `now()`**, like the registry cache,
 *   so a server whose clock drifts cannot serve a stale row as fresh.
 *
 * ## What may be logged from this file
 *
 * Nothing: src/citation-index.ts logs the lookup.
 */

import { sql } from "drizzle-orm";

import type { WorkId } from "../bibliographic.js";
import type { CitationIndexStore, FetchedCiters, StoredCiters } from "../citation-index.js";
import { getDb } from "../db/client.js";
import type { Citer } from "../types.js";
import { guardDbStore } from "./db-errors.js";
import { READ_COMMITTED } from "./isolation.js";

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows?: T[] }).rows ?? [];
}

interface LookupRow {
  state: "found" | "not-indexed";
  openalex_id: string | null;
  cited_by_count: number | null;
  returned: number | null;
  dropped: number | null;
  capped: boolean | null;
  target_title: string | null;
  target_authors: string[] | null;
  fetched_at: Date | string;
  fresh: boolean;
}

interface CiterRow {
  openalex_id: string;
  doi: string | null;
  title: string;
  authors: string[];
  author_count: number;
  year: number | null;
  venue: string | null;
  kind: string | null;
  cited_by_count: number;
}

function citerOf(row: CiterRow): Citer {
  return {
    openalexId: row.openalex_id,
    ...(row.doi !== null ? { doi: row.doi } : {}),
    title: row.title,
    authors: row.authors,
    authorCount: Number(row.author_count),
    ...(row.year !== null ? { year: Number(row.year) } : {}),
    ...(row.venue !== null ? { venue: row.venue } : {}),
    ...(row.kind !== null ? { kind: row.kind } : {}),
    citedByCount: Number(row.cited_by_count),
  };
}

const rawPgCitationIndexStore: CitationIndexStore = {
  async read(id, freshMs): Promise<StoredCiters | null> {
    /* One statement for the row and one for its list, inside one transaction so
       the two are the same fetch's: a refresh committing between them would
       otherwise put the new list under the old count. */
    return getDb().transaction(async (tx): Promise<StoredCiters | null> => {
      const found = await tx.execute(sql`
        select state, openalex_id, cited_by_count, returned, dropped, capped, target_title, target_authors,
               fetched_at, fetched_at > now() - make_interval(secs => ${freshMs / 1000}) as fresh
          from spideryarn.citation_index_lookups
         where work_id = ${id}
           for share`);
      const row = rowsOf<LookupRow>(found)[0];
      if (!row) return null;
      const at = { fetchedAt: new Date(row.fetched_at).toISOString(), fresh: row.fresh };
      if (row.state === "not-indexed") return { kind: "not-indexed", ...at };
      /* The shape CHECK makes every one of these non-null on a found row; a row
         that somehow is not is treated as no row, and asked about again. */
      if (
        row.openalex_id === null || row.cited_by_count === null || row.returned === null ||
        row.dropped === null || row.capped === null || row.target_title === null || row.target_authors === null
      ) {
        return null;
      }
      const listed = await tx.execute(sql`
        select openalex_id, doi, title, authors, author_count, year, venue, kind, cited_by_count
          from spideryarn.citation_index_citers
         where work_id = ${id}
         order by position`);
      return {
        kind: "found",
        target: { openalexId: row.openalex_id, title: row.target_title, authors: row.target_authors },
        count: Number(row.cited_by_count),
        returned: Number(row.returned),
        dropped: Number(row.dropped),
        capped: row.capped,
        citers: rowsOf<CiterRow>(listed).map(citerOf),
        ...at,
      };
    }, READ_COMMITTED);
  },

  async write(id: WorkId, answer: FetchedCiters): Promise<string> {
    const found = answer.kind === "found" ? answer : null;
    return getDb().transaction(async (tx): Promise<string> => {
      /* `sql.param`, because a bare array inside drizzle's `sql` is spread into
         a list of parameters (src/store/pg-bibliographic.ts § write). */
      const written = await tx.execute(sql`
        insert into spideryarn.citation_index_lookups
          (work_id, state, openalex_id, cited_by_count, returned, dropped, capped, target_title, target_authors, fetched_at)
        values (${id}, ${answer.kind}, ${found?.target.openalexId ?? null}, ${found?.count ?? null}::integer,
                ${found?.returned ?? null}::integer, ${found?.dropped ?? null}::integer, ${found?.capped ?? null}::boolean,
                ${found?.target.title ?? null}, ${sql.param(found?.target.authors ?? null)}::text[], now())
        on conflict (work_id) do update set
          state = excluded.state, openalex_id = excluded.openalex_id, cited_by_count = excluded.cited_by_count,
          returned = excluded.returned, dropped = excluded.dropped, capped = excluded.capped,
          target_title = excluded.target_title, target_authors = excluded.target_authors,
          fetched_at = excluded.fetched_at
        returning fetched_at`);
      await tx.execute(sql`delete from spideryarn.citation_index_citers where work_id = ${id}`);
      for (const [position, citer] of (found?.citers ?? []).entries()) {
        await tx.execute(sql`
          insert into spideryarn.citation_index_citers
            (work_id, position, openalex_id, doi, title, authors, author_count, year, venue, kind, cited_by_count)
          values (${id}, ${position}, ${citer.openalexId}, ${citer.doi ?? null}, ${citer.title},
                  ${sql.param(citer.authors)}::text[], ${citer.authorCount}, ${citer.year ?? null}::integer,
                  ${citer.venue ?? null}, ${citer.kind ?? null}, ${citer.citedByCount})`);
      }
      const row = rowsOf<{ fetched_at: Date | string }>(written)[0];
      if (!row) throw new Error("citation_index_lookups: the upsert returned no row");
      return new Date(row.fetched_at).toISOString();
    }, READ_COMMITTED);
  },
};

/** Guarded at the export, like every adapter here — tests/store-guarded.test.ts. */
export const pgCitationIndexStore: CitationIndexStore = guardDbStore(
  "citation-index",
  rawPgCitationIndexStore,
);
