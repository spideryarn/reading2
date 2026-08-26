/**
 * The Postgres glossary-lookup store.
 *
 * Small, and one assertion earns the file: **`do update`, not `do nothing`.**
 * Re-checking a term is an ordinary thing for a reader to do — the web moves —
 * and the file's behaviour is last-write-wins. An upsert that quietly declines
 * to update looks correct, raises no error, and serves the first answer for
 * ever.
 *
 * The rest is the shape the row has to keep: `searches: 0` is a real answer
 * rather than a missing one, and citations survive as an array.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, glossaryLookups } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { pgGlossaryLookupStore } from "../src/store/pg-lookups.js";

loadEnvLocal();

const SLUG = "store-lookups-fixture";
const ARTICLE_ID = "00000000-0000-4000-8000-0000000000f0";
const TERM = "spya-term22";

let reachable = false;

if (process.env.DATABASE_URL) {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  let why = "";
  try {
    const probe = await pool.query(
      "select to_regclass('spideryarn.glossary_lookups') is not null as ready",
    );
    reachable = probe.rows[0]?.ready === true;
    if (!reachable) why = "the spideryarn schema is not there — run npm run db:migrate";
  } catch (err) {
    reachable = false;
    why = `could not reach it: ${(err as Error).message}`;
  }
  await pool.end();
  if (!reachable) console.warn(`\n  ⚠ DATABASE_URL is set but these tests are skipping: ${why}\n`);
}

const when = reachable ? describe : describe.skip;

when("the Postgres glossary-lookup store", () => {
  beforeAll(async () => {
    await getDb()
      .insert(articles)
      .values({ id: ARTICLE_ID, ownerId: currentOwnerId(), slug: SLUG })
      .onConflictDoNothing();
  });

  afterEach(async () => {
    await getDb().delete(glossaryLookups).where(eq(glossaryLookups.articleId, ARTICLE_ID));
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(glossaryLookups).where(eq(glossaryLookups.articleId, ARTICLE_ID));
    await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
    await closeDb();
  });

  it("stores an answer against its entry, keeping zero searches as an answer", async () => {
    const stored = await pgGlossaryLookupStore.save(SLUG, TERM, {
      answer: "A spandrel is the space between two arches.",
      citations: [{ url: "https://example.com/one", title: "Arches" }],
      // Zero is "the model chose not to search", not "nobody recorded this".
      searches: 0,
      model: "a-model",
      at: "2026-08-01T00:00:00.000Z",
    });
    expect(stored[TERM]?.searches).toBe(0);
    expect(stored[TERM]?.citations).toEqual([{ url: "https://example.com/one", title: "Arches" }]);
    expect(stored[TERM]?.at).toBe("2026-08-01T00:00:00.000Z");
  });

  it("replaces the answer when the same term is checked again", async () => {
    /* `do nothing` would pass every other assertion in this file. It is the
       one upsert mistake with no symptom: no error, no missing row, just an
       answer that never gets any newer. */
    await pgGlossaryLookupStore.save(SLUG, TERM, {
      answer: "the first answer",
      citations: [],
      searches: 1,
      model: "old-model",
      at: "2026-08-01T00:00:00.000Z",
    });
    const after = await pgGlossaryLookupStore.save(SLUG, TERM, {
      answer: "the second answer",
      citations: [{ url: "https://example.com/two" }],
      searches: 4,
      model: "new-model",
      at: "2026-08-02T00:00:00.000Z",
    });
    expect(Object.keys(after)).toEqual([TERM]);
    expect(after[TERM]?.answer).toBe("the second answer");
    expect(after[TERM]?.model).toBe("new-model");
    expect(after[TERM]?.searches).toBe(4);
    expect(after[TERM]?.at).toBe("2026-08-02T00:00:00.000Z");
  });

  it("leaves every other term alone — the race the row deletes", async () => {
    /* On disk this is one file holding every lookup, merged and rewritten under
       a mutex that only covers this process — so two servers both merge their
       own term and one reader's answer disappears with both writes reporting
       success. One row per term cannot do that.

       Written in REVERSE key order on purpose: the first version saved
       `term22` then `term33`, already sorted, so deleting the `order by`
       entirely still passed. */
    const other = "spya-term33";
    await pgGlossaryLookupStore.save(SLUG, other, {
      answer: "second term",
      citations: [],
      searches: 0,
      model: "m",
      at: "2026-08-01T00:00:01.000Z",
    });
    const both = await pgGlossaryLookupStore.save(SLUG, TERM, {
      answer: "first term",
      citations: [],
      searches: 0,
      model: "m",
      at: "2026-08-01T00:00:00.000Z",
    });
    expect(both[TERM]?.answer).toBe("first term");
    expect(both[other]?.answer).toBe("second term");
    // Keyed by entry id, in entry-id order — the clause the exporter uses.
    expect(Object.keys(both)).toEqual([TERM, other].sort());
  });

  it("is empty rather than absent for an article nobody has looked anything up in", async () => {
    expect(await pgGlossaryLookupStore.load(SLUG)).toEqual({});
  });

  it("404s for an article that is not there, and 400s for a non-slug", async () => {
    await expect(pgGlossaryLookupStore.load("no-such-article-at-all")).rejects.toMatchObject({
      status: 404,
    });
    await expect(pgGlossaryLookupStore.load("../etc/passwd")).rejects.toMatchObject({ status: 400 });
  });
});
