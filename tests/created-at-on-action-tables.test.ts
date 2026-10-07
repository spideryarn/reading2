/**
 * `created_at` on the five tables that had no first time — stage 1 of
 * docs/plans/261003j-store-when-it-happened-timestamp-audit.md.
 *
 * Three claims, each against the real store functions and a real Postgres:
 *
 * 1. **A new row gets a time**, from the database default — no store names the
 *    column, so this is the only proof any writer is covered.
 * 2. **A later write keeps the first time.** Four of the five are upserts whose
 *    `do update` replaces the row's values; `at` / `found_at` / `updated_at`
 *    move and `created_at` must not.
 * 3. **A row from before the column stays null.** The migration adds the column
 *    with no default and only then sets one, so no existing row was given an
 *    invented time; a row inserted here with an explicit `null` stands in for
 *    one, and the store touching it must not stamp it either.
 *
 * Every id is minted per run (tests/fixture-ids.test.ts says why).
 */

import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, readerProfiles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { type OwnerId, runInRequest, setRequestOwner } from "../src/owner.js";
import { pgCitationFindStore } from "../src/store/pg-citation-finds.js";
import { pgCitationInvestigationStore } from "../src/store/pg-citation-investigations.js";
import { pgGlossaryHiddenStore } from "../src/store/pg-glossary-hidden.js";
import { pgGlossaryLookupStore } from "../src/store/pg-lookups.js";
import { pgReaderStore } from "../src/store/pg-reader.js";
import { pgSourceGuessStore } from "../src/store/pg-source-guesses.js";
import type { CitationFind, CitationInvestigation, GlossaryLookup } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

await pgReady({
  suite: "tests/created-at-on-action-tables.test.ts",
  columns: [
    { table: "spideryarn.glossary_hidden_entries", column: "created_at" },
    { table: "spideryarn.reader_profiles", column: "created_at" },
    { table: "spideryarn.glossary_lookups", column: "created_at" },
    { table: "spideryarn.citation_finds", column: "created_at" },
    { table: "spideryarn.citation_investigations", column: "created_at" },
    { table: "spideryarn.upload_source_guesses", column: "created_at" },
  ],
});

const OWNER = randomUUID() as OwnerId;
const ARTICLE_ID = randomUUID();
const SLUG = `created-at-fixture-${ARTICLE_ID.slice(0, 8)}`;

const EARLIER = "2026-08-01T00:00:00.000Z";
const LATER = "2026-08-02T00:00:00.000Z";

/** Every store here reads `currentOwnerId()`, so each call needs a request. */
function asOwner<T>(body: () => Promise<T>): Promise<T> {
  return runInRequest(async () => {
    setRequestOwner(OWNER);
    return body();
  });
}

type Times = { createdAt: string | null; moving: string | null };

/** `created_at`, and the column that is supposed to move, as ISO or null. */
async function timesOf(table: string, moving: string | null, where: ReturnType<typeof sql>): Promise<Times> {
  const result = await getDb().execute(
    sql`select created_at, ${moving ? sql.raw(moving) : sql`null`} as moving
        from ${sql.raw(`spideryarn.${table}`)} where ${where}`,
  );
  expect(result.rows, `${table}: one row`).toHaveLength(1);
  const row = result.rows[0] as { created_at: Date | string | null; moving: Date | string | null };
  const iso = (v: Date | string | null) => (v === null ? null : new Date(v).toISOString());
  return { createdAt: iso(row.created_at), moving: iso(row.moving) };
}

const byEntry = (entryId: string) => sql`article_id = ${ARTICLE_ID} and entry_id = ${entryId}`;

/** A time the database has just written, give or take the suite's own running time. */
function expectRecent(iso: string | null, startedAt: number): void {
  expect(iso).not.toBeNull();
  const t = new Date(iso ?? 0).getTime();
  /* A minute of slack either side: the clock is the database's, not this process's. */
  expect(t).toBeGreaterThan(startedAt - 60_000);
  expect(t).toBeLessThan(Date.now() + 60_000);
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lookup(at: string, answer: string): GlossaryLookup {
  return { answer, citations: [], searches: 1, model: "a-model", at };
}

function find(at: string, url: string): CitationFind {
  return { url, host: "example.org", searches: 1, model: "a-model", at };
}

function investigation(at: string, answer: string): CitationInvestigation {
  return {
    answer,
    sources: [{ url: "https://example.org/a" }],
    extractsRead: 1,
    longestExtractWords: 9,
    matchedHost: null,
    searches: 1,
    searchesFrom: "x",
    model: "a-model",
    at,
    contextHash: "h",
    promptVersion: "citation-investigate/5",
  };
}

const startedAt = Date.now();

beforeAll(async () => {
  const db = getDb();
  await seedAuthUser(db, { id: OWNER, email: `created-at-${OWNER}@example.invalid` });
  await db.insert(articles).values({ id: ARTICLE_ID, ownerId: OWNER, slug: SLUG });
});

afterAll(async () => {
  const db = getDb();
  /* The article's delete cascades to the four article-scoped tables. */
  await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
  await db.delete(readerProfiles).where(eq(readerProfiles.ownerId, OWNER));
  await db.execute(sql`delete from auth.users where id = ${OWNER}`);
  await closeDb();
});

describe("glossary_lookups.created_at", () => {
  it("is stamped on the first lookup and kept by Dig deeper again, while `at` moves", async () => {
    const term = mintId();
    await asOwner(() => pgGlossaryLookupStore.save(SLUG, term, lookup(EARLIER, "the first answer")));
    const first = await timesOf("glossary_lookups", "at", byEntry(term));
    expectRecent(first.createdAt, startedAt);
    expect(first.moving).toBe(EARLIER);

    await pause(20);
    await asOwner(() => pgGlossaryLookupStore.save(SLUG, term, lookup(LATER, "the second answer")));
    const second = await timesOf("glossary_lookups", "at", byEntry(term));
    expect(second.moving).toBe(LATER);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it("stays null on a row from before the column, however often it is looked up again", async () => {
    const term = mintId();
    await getDb().execute(sql`
      insert into spideryarn.glossary_lookups
        (article_id, entry_id, owner_id, answer, citations, searches, model, at, created_at)
      values (${ARTICLE_ID}, ${term}, ${OWNER}, 'an old answer', '[]'::jsonb, 0, 'old-model', ${EARLIER}, null)
    `);
    await asOwner(() => pgGlossaryLookupStore.save(SLUG, term, lookup(LATER, "a newer answer")));
    const after = await timesOf("glossary_lookups", "at", byEntry(term));
    expect(after.moving).toBe(LATER);
    expect(after.createdAt).toBeNull();
  });
});

describe("glossary_hidden_entries.created_at", () => {
  /** A term the reader added is a lookup row with a name, and `hide` accepts its id. */
  async function addedTerm(): Promise<string> {
    const term = mintId();
    await getDb().execute(sql`
      insert into spideryarn.glossary_lookups
        (article_id, entry_id, owner_id, answer, citations, searches, model, at, added_name)
      values (${ARTICLE_ID}, ${term}, ${OWNER}, 'an answer', '[]'::jsonb, 0, 'a-model', ${EARLIER}, ${`term ${term}`})
    `);
    return term;
  }

  it("is stamped when the reader hides an entry, and a second hide keeps it", async () => {
    const term = await addedTerm();
    await asOwner(() => pgGlossaryHiddenStore.hide(SLUG, term));
    const first = await timesOf("glossary_hidden_entries", null, byEntry(term));
    expectRecent(first.createdAt, startedAt);

    await pause(20);
    await asOwner(() => pgGlossaryHiddenStore.hide(SLUG, term));
    const second = await timesOf("glossary_hidden_entries", null, byEntry(term));
    expect(second.createdAt).toBe(first.createdAt);
  });

  it("stays null on a hide from before the column, when it is hidden again", async () => {
    const term = await addedTerm();
    await getDb().execute(sql`
      insert into spideryarn.glossary_hidden_entries (article_id, entry_id, created_at)
      values (${ARTICLE_ID}, ${term}, null)
    `);
    await asOwner(() => pgGlossaryHiddenStore.hide(SLUG, term));
    const after = await timesOf("glossary_hidden_entries", null, byEntry(term));
    expect(after.createdAt).toBeNull();
  });
});

describe("reader_profiles.created_at", () => {
  const mine = sql`owner_id = ${OWNER}`;

  it("is stamped on the first write and kept by every later one, while `updated_at` moves", async () => {
    await getDb().delete(readerProfiles).where(eq(readerProfiles.ownerId, OWNER));
    await asOwner(() => pgReaderStore.writeProfile("A physicist."));
    const first = await timesOf("reader_profiles", "updated_at", mine);
    expectRecent(first.createdAt, startedAt);

    await pause(20);
    await asOwner(() => pgReaderStore.writeProfile("A physicist, still."));
    const second = await timesOf("reader_profiles", "updated_at", mine);
    expect(second.createdAt).toBe(first.createdAt);
    expect(new Date(second.moving ?? 0).getTime()).toBeGreaterThan(new Date(first.moving ?? 0).getTime());

    await pause(20);
    await asOwner(() => pgReaderStore.writeExperimental(true));
    const third = await timesOf("reader_profiles", "updated_at", mine);
    expect(third.createdAt).toBe(first.createdAt);
    expect(new Date(third.moving ?? 0).getTime()).toBeGreaterThan(new Date(second.moving ?? 0).getTime());
  });

  it("is stamped when the first write is the experimental switch rather than the profile", async () => {
    await getDb().delete(readerProfiles).where(eq(readerProfiles.ownerId, OWNER));
    await asOwner(() => pgReaderStore.writeExperimental(true));
    expectRecent((await timesOf("reader_profiles", "updated_at", mine)).createdAt, startedAt);
  });

  it("stays null on a row from before the column, through a profile edit and a switch", async () => {
    await getDb().delete(readerProfiles).where(eq(readerProfiles.ownerId, OWNER));
    await getDb().execute(sql`
      insert into spideryarn.reader_profiles (owner_id, profile, updated_at, created_at)
      values (${OWNER}, 'An old profile.', ${EARLIER}, null)
    `);
    await asOwner(() => pgReaderStore.writeProfile("A newer profile."));
    await asOwner(() => pgReaderStore.writeExperimental(true));
    const after = await timesOf("reader_profiles", "updated_at", mine);
    expect(after.createdAt).toBeNull();
    expect(new Date(after.moving ?? 0).getTime()).toBeGreaterThan(new Date(EARLIER).getTime());
  });
});

describe("citation_finds.created_at", () => {
  it("is stamped on the first find and kept by a re-find, while `found_at` moves", async () => {
    const entry = mintId();
    await asOwner(() => pgCitationFindStore.save(SLUG, entry, find(EARLIER, "https://example.org/one")));
    const first = await timesOf("citation_finds", "found_at", byEntry(entry));
    expectRecent(first.createdAt, startedAt);
    expect(first.moving).toBe(EARLIER);

    await pause(20);
    await asOwner(() => pgCitationFindStore.save(SLUG, entry, find(LATER, "https://example.org/two")));
    const second = await timesOf("citation_finds", "found_at", byEntry(entry));
    expect(second.moving).toBe(LATER);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it("stays null on a find from before the column, when the work is found again", async () => {
    const entry = mintId();
    await getDb().execute(sql`
      insert into spideryarn.citation_finds
        (article_id, entry_id, owner_id, url, host, model, found_at, created_at)
      values (${ARTICLE_ID}, ${entry}, ${OWNER}, 'https://example.org/old', 'example.org', 'old-model', ${EARLIER}, null)
    `);
    await asOwner(() => pgCitationFindStore.save(SLUG, entry, find(LATER, "https://example.org/new")));
    const after = await timesOf("citation_finds", "found_at", byEntry(entry));
    expect(after.moving).toBe(LATER);
    expect(after.createdAt).toBeNull();
  });
});

describe("citation_investigations.created_at", () => {
  it("is stamped on the first press and kept by a second, while `at` moves", async () => {
    const entry = mintId();
    await asOwner(() => pgCitationInvestigationStore.save(SLUG, entry, investigation(EARLIER, "First.")));
    const first = await timesOf("citation_investigations", "at", byEntry(entry));
    expectRecent(first.createdAt, startedAt);
    expect(first.moving).toBe(EARLIER);

    await pause(20);
    await asOwner(() => pgCitationInvestigationStore.save(SLUG, entry, investigation(LATER, "Second.")));
    const second = await timesOf("citation_investigations", "at", byEntry(entry));
    expect(second.moving).toBe(LATER);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it("stays null on an investigation from before the column, when it is pressed again", async () => {
    const entry = mintId();
    await asOwner(() => pgCitationInvestigationStore.save(SLUG, entry, investigation(EARLIER, "Old.")));
    /* The row has a dozen required columns, so let the store write it and then
       put it in the state a row that predates the column is in. */
    await getDb().execute(
      sql`update spideryarn.citation_investigations set created_at = null where ${byEntry(entry)}`,
    );
    await asOwner(() => pgCitationInvestigationStore.save(SLUG, entry, investigation(LATER, "New.")));
    const after = await timesOf("citation_investigations", "at", byEntry(entry));
    expect(after.moving).toBe(LATER);
    expect(after.createdAt).toBeNull();
  });
});

/**
 * **The sixth table, added 2026-10-07** (seventh sweep, DB4). Until then
 * `claimed_at` stood in as this table's "when", and it is not one: every
 * reclaim re-stamps it and `release` sets it to the Unix epoch so the row is
 * reclaimable at once. `claimed_at` still means exactly that — the eligibility
 * clock — and `created_at` is the first claim, which no store names.
 */
describe("upload_source_guesses.created_at", () => {
  const mine = sql`article_id = ${ARTICLE_ID}`;
  const EPOCH = new Date(0).toISOString();

  it("is stamped on the first claim and kept through a release and a reclaim, while `claimed_at` moves", async () => {
    const claimed = await asOwner(() => pgSourceGuessStore.claim(SLUG, { staleMs: 60_000 }));
    if (claimed.kind !== "claimed") throw new Error(`the first claim was ${claimed.kind}`);
    const first = await timesOf("upload_source_guesses", "claimed_at", mine);
    expectRecent(first.createdAt, startedAt);
    expectRecent(first.moving, startedAt);

    // The release that used to erase the table's only real time.
    expect(await asOwner(() => pgSourceGuessStore.release(SLUG, claimed.token, { refund: true }))).toBe(true);
    const released = await timesOf("upload_source_guesses", "claimed_at", mine);
    expect(released.moving).toBe(EPOCH);
    expect(released.createdAt).toBe(first.createdAt);

    await pause(20);
    const again = await asOwner(() => pgSourceGuessStore.claim(SLUG, { staleMs: 60_000 }));
    expect(again.kind).toBe("claimed");
    const reclaimed = await timesOf("upload_source_guesses", "claimed_at", mine);
    expectRecent(reclaimed.moving, startedAt);
    expect(reclaimed.createdAt).toBe(first.createdAt);
  });

  it("stays null on a row from before the column, when it is reclaimed and answered", async () => {
    /* The row the case above left, put in the state a row that predates the
       column is in, and stale so that it can be claimed again. */
    await getDb().execute(
      sql`update spideryarn.upload_source_guesses
             set created_at = null, claimed_at = to_timestamp(0), attempts = 1 where ${mine}`,
    );
    const claimed = await asOwner(() => pgSourceGuessStore.claim(SLUG, { staleMs: 60_000 }));
    if (claimed.kind !== "claimed") throw new Error(`the reclaim was ${claimed.kind}`);
    expect((await timesOf("upload_source_guesses", "claimed_at", mine)).createdAt).toBeNull();

    await asOwner(() =>
      pgSourceGuessStore.finish(SLUG, claimed.token, { status: "none", why: "no-match", searches: 1, model: "m" }),
    );
    expect((await timesOf("upload_source_guesses", "finished_at", mine)).createdAt).toBeNull();
  });
});
