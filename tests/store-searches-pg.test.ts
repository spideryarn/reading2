/**
 * The Postgres searches store, held to `src/searches.ts`'s semantics — and to
 * the one thing the filesystem cannot do.
 *
 * The assertions worth having are the ones with a way to go red. A retry that
 * leaves the failed attempt's error sitting under a fresh answer; a trim that
 * deletes the run it has just inserted; a sweep that emits `not in ()` and
 * 500s on the first read of a quiet article; and the fence — a model call that
 * another process already declared dead writing its stale answer over the retry
 * the reader is watching.
 *
 * ## Why it builds its own article
 *
 * An `articles` row with **no `current_revision_id`**, so `listArticles` cannot
 * see it and tests/store-parity.test.ts cannot be made flaky by it. Same trick
 * as tests/store-comments.test.ts, same reason.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, searchRuns } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { MAX_RUNS } from "../src/searches.js";
import { pgSearchStore } from "../src/store/pg-searches.js";

loadEnvLocal();

const SLUG = "store-searches-fixture";
const ARTICLE_ID = "00000000-0000-4000-8000-0000000000d0";
const NONE: ReadonlySet<string> = new Set();

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
      "select to_regclass('spideryarn.search_runs') is not null as ready",
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

/** A clock the test drives, so `createdAt` is a fact rather than a race. */
function clockFrom(startMs: number, stepMs = 1000): () => string {
  let n = 0;
  return () => new Date(startMs + stepMs * n++).toISOString();
}

when("the Postgres searches store", () => {
  beforeAll(async () => {
    await getDb()
      .insert(articles)
      // No `currentRevisionId`, so the library cannot see it. See the header.
      .values({ id: ARTICLE_ID, ownerId: currentOwnerId(), slug: SLUG })
      .onConflictDoNothing();
  });

  afterEach(async () => {
    await getDb().delete(searchRuns).where(eq(searchRuns.articleId, ARTICLE_ID));
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(searchRuns).where(eq(searchRuns.articleId, ARTICLE_ID));
    await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
    await closeDb();
  });

  it("records a pending run before the model is called", async () => {
    const { run, attempt } = await pgSearchStore.begin(SLUG, "about time");
    expect(run.status).toBe("pending");
    expect(run.hits).toEqual([]);
    // Absent, not null: the wire form of `{model: null}` is not `{}`.
    expect("model" in run).toBe(false);
    expect("error" in run).toBe(false);
    // The attempt is the whole point of this store. Files return undefined.
    expect(attempt).toBeTruthy();
  });

  it("resets a failed run rather than minting a second one — all three conditions", async () => {
    const { run, attempt } = await pgSearchStore.begin(SLUG, "about time", "spya-run001");
    await pgSearchStore.finish(SLUG, run.id, { status: "error", error: "the model fell over" }, attempt);

    const again = await pgSearchStore.begin(SLUG, "about time", run.id);
    expect((await pgSearchStore.load(SLUG)).length).toBe(1);
    expect(again.run.id).toBe(run.id);
    expect(again.run.status).toBe("pending");
    /* **The failed attempt's error must not survive.** `withRun` rebuilds the
       run field by field precisely so it cannot, and the obvious UPDATE — set
       status and nothing else — leaves the old error sitting under whatever
       answer arrives next. */
    expect("error" in again.run).toBe(false);
    expect("model" in again.run).toBe(false);
    expect(again.run.hits).toEqual([]);
    // Still the same question, so the same clock. Opposite of a chat retry.
    expect(again.run.createdAt).toBe(run.createdAt);
  });

  it("does not reset a run that is done, or one asking a different question", async () => {
    const { run, attempt } = await pgSearchStore.begin(SLUG, "about time", "spya-run002");
    await pgSearchStore.finish(SLUG, run.id, { status: "done", hits: [] }, attempt);

    // A double-clicked POST, or a stale tab retrying after another tab won.
    const second = await pgSearchStore.begin(SLUG, "about time", run.id);
    expect(second.run.id).not.toBe(run.id);

    // Same id, different question: still a collision, still a new id.
    const third = await pgSearchStore.begin(SLUG, "about something else", run.id);
    expect(third.run.id).not.toBe(run.id);
    expect((await pgSearchStore.load(SLUG)).find((r) => r.id === run.id)?.status).toBe("done");
  });

  it("keeps the newest MAX_RUNS, and never trims the run it just inserted", async () => {
    /* The clock runs BACKWARDS, which is the case that matters. The file keeps
       the last thirty array elements; this keeps the thirty newest by
       timestamp, and a newly inserted run with an older timestamp would trim
       itself — the model call then finishes into a row that is gone, and the
       reader gets a 404 for a search they are watching. */
    const ids: string[] = [];
    for (let i = 0; i < MAX_RUNS + 3; i++) {
      const at = clockFrom(Date.parse("2026-08-01T00:00:00.000Z") + (MAX_RUNS + 3 - i) * 60_000);
      const { run } = await pgSearchStore.begin(SLUG, `criterion ${i}`, undefined, at);
      ids.push(run.id);
      // The run just written is always still there, whatever its timestamp.
      const after = await pgSearchStore.load(SLUG);
      expect(after.map((r) => r.id), `run ${i} trimmed itself`).toContain(run.id);
      expect(after.length).toBeLessThanOrEqual(MAX_RUNS);
    }
    expect((await pgSearchStore.load(SLUG)).length).toBe(MAX_RUNS);
  });

  it("sweeps nothing, loudly, when the article has no runs at all", async () => {
    /* `notInArray` with an empty list emits `not in ()`, which Postgres rejects
       as a syntax error rather than treating as "matches nothing". This is the
       first read of a quiet article, so it is also the most likely 500 in the
       whole store. */
    await expect(pgSearchStore.sweepPending(SLUG, { keep: NONE, graceMs: 1000 })).resolves.toEqual(
      [],
    );
    const { run } = await pgSearchStore.begin(SLUG, "about time");
    await expect(
      pgSearchStore.sweepPending(SLUG, { keep: NONE, graceMs: 60_000 }),
    ).resolves.toHaveLength(1);
    expect((await pgSearchStore.load(SLUG))[0]?.id).toBe(run.id);
  });

  it("spares a young attempt from another process, and buries an old one", async () => {
    const { run } = await pgSearchStore.begin(SLUG, "about time");

    // Young: some other process may still be on it. This is the case the
    // filesystem store gets wrong, and the reason `graceMs` exists.
    await pgSearchStore.sweepPending(SLUG, { keep: NONE, graceMs: 60_000 });
    expect((await pgSearchStore.load(SLUG))[0]?.status).toBe("pending");

    // Old enough that nobody can still be on it.
    await getDb()
      .update(searchRuns)
      .set({ attemptStartedAt: new Date(Date.now() - 600_000) })
      .where(and(eq(searchRuns.articleId, ARTICLE_ID), eq(searchRuns.id, run.id)));
    const swept = await pgSearchStore.sweepPending(SLUG, { keep: NONE, graceMs: 60_000 });
    expect(swept[0]?.status).toBe("error");
  });

  it("spares this process's own work however old it is", async () => {
    const { run } = await pgSearchStore.begin(SLUG, "about time");
    await getDb()
      .update(searchRuns)
      .set({ attemptStartedAt: new Date(Date.now() - 600_000) })
      .where(and(eq(searchRuns.articleId, ARTICLE_ID), eq(searchRuns.id, run.id)));
    // A search this server has genuinely been streaming for ten minutes must
    // not be killed by this same server.
    const after = await pgSearchStore.sweepPending(SLUG, {
      keep: new Set([run.id]),
      graceMs: 60_000,
    });
    expect(after[0]?.status).toBe("pending");
  });

  it("refuses a finish from an attempt that is no longer the live one", async () => {
    /* The race this store exists for, in four lines:
         1. process A begins a run
         2. process B's sweep declares it dead
         3. the reader retries — a NEW attempt on the same run
         4. A's model call finally returns
       Step 4 must not land. Fenced on identity alone it would, and the reader
       would watch their retry be replaced by the answer that already failed. */
    const first = await pgSearchStore.begin(SLUG, "about time");
    await getDb()
      .update(searchRuns)
      .set({ attemptStartedAt: new Date(Date.now() - 600_000) })
      .where(eq(searchRuns.articleId, ARTICLE_ID));
    await pgSearchStore.sweepPending(SLUG, { keep: NONE, graceMs: 60_000 });

    const retried = await pgSearchStore.begin(SLUG, "about time", first.run.id);
    expect(retried.attempt).not.toBe(first.attempt);

    const late = await pgSearchStore.finish(
      SLUG,
      first.run.id,
      { status: "done", hits: [], model: "stale-model" },
      first.attempt,
    );
    // Zero rows, reported as `undefined`, which the route already answers 404 for.
    expect(late).toBeUndefined();
    const now = (await pgSearchStore.load(SLUG))[0];
    expect(now?.status).toBe("pending");
    expect("model" in (now ?? {})).toBe(false);

    // And the live attempt still lands.
    const good = await pgSearchStore.finish(
      SLUG,
      first.run.id,
      { status: "done", hits: [], model: "live-model" },
      retried.attempt,
    );
    expect(good?.model).toBe("live-model");
  });

  it("never lets a patch rename a run or change its question", async () => {
    const { run, attempt } = await pgSearchStore.begin(SLUG, "about time");
    await pgSearchStore.finish(
      SLUG,
      run.id,
      { id: "spya-other0", criterion: "something else", status: "done" } as never,
      attempt,
    );
    const stored = (await pgSearchStore.load(SLUG))[0];
    expect(stored?.id).toBe(run.id);
    expect(stored?.criterion).toBe("about time");
  });

  it("returns runs oldest first, with the id breaking a tie", async () => {
    /* One clock for both, so the timestamps collide on purpose. Without the
       `id` tie-break these two swap places between requests, and the exporter
       and this store then disagree about array order — which shows up as the
       round-trip test failing for a reason that is not a bug. */
    const fixed = () => "2026-08-01T00:00:00.000Z";
    const a = await pgSearchStore.begin(SLUG, "first", "spya-aaa001", fixed);
    const b = await pgSearchStore.begin(SLUG, "second", "spya-bbb001", fixed);
    const order = (await pgSearchStore.load(SLUG)).map((r) => r.id);
    expect(order).toEqual([a.run.id, b.run.id].sort());
  });

  it("404s for an article that is not there, and 400s for a non-slug", async () => {
    await expect(pgSearchStore.load("no-such-article-at-all")).rejects.toMatchObject({
      status: 404,
    });
    await expect(pgSearchStore.load("../etc/passwd")).rejects.toMatchObject({ status: 400 });
  });
});
