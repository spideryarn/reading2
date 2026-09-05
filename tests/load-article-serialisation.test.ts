/**
 * `loadArticleIntoPg`'s `serialise` option, checked against Postgres rather
 * than against itself — and the one row two unique slugs still share.
 *
 * ## Why this file exists
 *
 * The run lock used to be unconditional inside the fixture loader, so every
 * seed in the whole test run queued behind every other one. Measured here on
 * 2026-09-01, K processes each seeding a *uniquely named* article, worst seed
 * of the K, four repeats each:
 *
 * ```
 *              K=1        K=8            K=16
 * serialised   438–489ms  3307–3379ms    6455–6685ms
 * not          374–425ms  1604–1747ms    3046–3463ms
 * ```
 *
 * That is the reason it became opt-in (docs/plans/260831b-finish-the-database-move.md
 * § the sub-stage B pilot). The risk of making it opt-in is the quiet one: a
 * suite that *needed* the lock stops taking it, nothing goes red, and two
 * concurrent runs fail somewhere else. So the first case below asks **Postgres**
 * whether the flag reaches the lock, in the only way that cannot share a mistake
 * with the code under test — by holding the key from a connection of its own and
 * seeing which load waits.
 *
 * ## This file must NOT take the run lock for itself
 *
 * Every other Postgres suite takes it at module scope. This one cannot: it is
 * about who waits for the key, and `withRunLock` returns early when this process
 * is already the holder — so a file-scope take would make both arms of the first
 * case pass without the lock doing anything. Same rule, same reason, as
 * tests/run-lock.test.ts.
 *
 * It is safe without it because **every slug here is minted fresh per run**, so
 * there is nothing for a peer's `npm test` to collide with. The exception is the
 * `raw_sources` row in the second case, and that row is keyed by a hash of bytes
 * this file invents.
 */
import { createHash, randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq, inArray } from "drizzle-orm";
import { Pool, type PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, jobs, rawSources } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { loadArticleIntoPg } from "./helpers/load-article.js";
import { pgReady } from "./helpers/pg-ready.js";
import { FIXTURE_ROOT, requireFixture } from "./helpers/require-fixture.js";
import { RUN_LOCK } from "./helpers/run-lock.js";

loadEnvLocal();

/** The corpus article every clone below is made from. */
const FROM = "writes";

requireFixture(FROM, [
  "raw.json",
  "raw.html",
  "meta.json",
  "blocks.json",
  "tree.json",
  "labels.json",
  "output.html",
  "output.blocks.json",
]);

await pgReady({
  suite: "tests/load-article-serialisation.test.ts",
  tables: ["spideryarn.raw_sources"],
});
/** A connection that takes the key on purpose, to see who waits for it. */
const observer = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

/** Slugs and raw-source hashes this file made, so teardown removes those and nothing else. */
const mine = { slugs: [] as string[], shas: [] as string[] };

afterAll(async () => {
  const db = getDb();
  if (mine.slugs.length) {
    await db.delete(jobs).where(inArray(jobs.slug, mine.slugs));
    await db.update(articles).set({ currentRevisionId: null }).where(inArray(articles.slug, mine.slugs));
    await db.delete(articles).where(inArray(articles.slug, mine.slugs));
  }
  for (const sha of mine.shas) {
    await db.delete(rawSources).where(and(eq(rawSources.sha256, sha), eq(rawSources.kind, "html")));
  }
  await closeDb();
  await observer?.end();
});

/** A slug nothing else in the repo can be using. */
function freshSlug(what: string): string {
  const slug = `test-serialise-${what}-${randomBytes(4).toString("hex")}`;
  mine.slugs.push(slug);
  return slug;
}

/**
 * Clone the corpus article into a temporary data root under `slug`.
 *
 * `rawMarker` prepends bytes to `raw.html` and restamps the manifest to match,
 * which is how the second case gets a `raw_sources` row that is **not there
 * yet** — the state the collision needs and the state a developer's laptop
 * never has, because every committed fixture's object was stored long ago.
 * `tests/helpers/load-article.ts` rehashes the file against the manifest, so
 * both halves have to move together.
 */
async function clone(slug: string, rawMarker?: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "spya-serialise-"));
  const dir = path.join(root, "data", slug);
  await mkdir(path.join(root, "data"), { recursive: true });
  await cp(path.join(FIXTURE_ROOT, "data", FROM), dir, { recursive: true });

  for (const name of await readdir(dir)) {
    if (!name.endsWith(".json")) continue;
    const at = path.join(dir, name);
    const value: unknown = JSON.parse(await readFile(at, "utf8"));
    if (value && typeof value === "object" && (value as { slug?: string }).slug === FROM) {
      (value as { slug: string }).slug = slug;
      await writeFile(at, JSON.stringify(value));
    }
  }

  if (rawMarker !== undefined) {
    const bytes = Buffer.concat([
      Buffer.from(rawMarker),
      await readFile(path.join(dir, "raw.html")),
    ]);
    await writeFile(path.join(dir, "raw.html"), bytes);
    const manifest = JSON.parse(await readFile(path.join(dir, "raw.json"), "utf8")) as Record<
      string,
      unknown
    >;
    manifest["storedSha256"] = createHash("sha256").update(bytes).digest("hex");
    manifest["storedBytes"] = bytes.byteLength;
    manifest["bytes"] = bytes.byteLength;
    await writeFile(path.join(dir, "raw.json"), JSON.stringify(manifest));
  }

  await mkdir(path.join(root, "output"), { recursive: true });
  for (const ext of ["html", "blocks.json"]) {
    await cp(
      path.join(FIXTURE_ROOT, "output", `${FROM}.${ext}`),
      path.join(root, "output", `${slug}.${ext}`),
    );
  }
  return root;
}

/**
 * Take the run lock and keep it, on a connection **checked out of the pool and
 * held** rather than borrowed per query.
 *
 * ## Both halves of this were got wrong once, and each looked like a pass
 *
 * **Poll, do not assert.** A single `pg_try_advisory_lock` is what
 * tests/run-lock.test.ts does, and it makes this case fail with *"nothing may
 * hold the run lock"* whenever a peer's `npm test` is mid-suite — a failure
 * about the machine rather than about the code. Seen twice here on 2026-09-01,
 * with eight sessions sharing the tree.
 *
 * **And hold the client.** `pool.query()` checks a connection out, runs, and
 * hands it back; a `pg` pool then closes an idle connection after
 * `idleTimeoutMillis`, **10 seconds by default** — and a session advisory lock
 * dies with its session. So the key silently let go ten seconds in, and the
 * load this case had parked behind it sailed through. It was caught only
 * because a deliberate mutation failed at **10,745ms**, which is the clock
 * naming the cause the way the 20-second failures in `./helpers/running-slot.ts`
 * did. A version of this test that only ever ran green would have kept the fuse.
 * `./helpers/run-lock.ts` § *Why a session lock, on its own connection* says
 * exactly this about the loader's own connection; it is just as true of an
 * observer's.
 */
async function holdTheKey(waitMs = 30_000): Promise<PoolClient> {
  const client = await observer!.connect();
  const deadline = Date.now() + waitMs;
  for (;;) {
    const got = await client.query<{ got: boolean }>("select pg_try_advisory_lock($1) as got", [
      RUN_LOCK,
    ]);
    if (got.rows[0]?.got === true) return client;
    if (Date.now() > deadline) {
      client.release();
      throw new Error(
        `waited ${waitMs}ms for the run lock: this case has to hold the key itself to see ` +
          "who waits for it, and something else has not let go.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Did `promise` finish within `ms`? Never throws; the answer is the assertion. */
async function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  const pending = Symbol("pending");
  const result = await Promise.race([
    promise.then(
      () => "done",
      () => "threw",
    ),
    new Promise((resolve) => setTimeout(() => resolve(pending), ms)),
  ]);
  return result !== pending;
}

describe("loadArticleIntoPg's serialise option", () => {
  it("waits for the run lock when set, and does not when it is not", async () => {
    /* Holding the key is the precondition *and* the instrument: if something
       else held it, the "waits" arm would pass on a loader that never asked
       for it. */
    const keyHolder = await holdTheKey();

    const unlockedSlug = freshSlug("unlocked");
    const lockedSlug = freshSlug("locked");
    const unlockedRoot = await clone(unlockedSlug);
    const lockedRoot = await clone(lockedSlug);
    let released = false;
    try {
      /* **The negative arm, and it runs first on purpose.** With the key held
         by the observer, a load that finishes cannot have taken it. This is the
         whole claim of the change: an unserialised seed does not queue. */
      const unlocked = await loadArticleIntoPg(unlockedSlug, { root: unlockedRoot });
      expect(unlocked.published, "an unserialised load must not wait for the key").toBe(true);

      /* **The positive arm.** Same held key, `serialise: true`, and this one
         must be stuck — the flag reaching the lock is exactly what is under
         test, and a flag that was read and dropped would look like the arm
         above. */
      const locked = loadArticleIntoPg(lockedSlug, { root: lockedRoot, serialise: true });
      expect(
        await settledWithin(locked, 800),
        "a serialised load must not get past a held run lock",
      ).toBe(false);

      await keyHolder.query("select pg_advisory_unlock($1)", [RUN_LOCK]);
      released = true;

      /* And it goes through once the key is free. Without this half, a
         `serialise: true` that threw immediately would pass the assertion
         above. The wait is generous because a peer's `npm test` may take the
         key between our release and this load's next poll — that is the queue
         working, not a failure. */
      expect((await locked).published).toBe(true);
    } finally {
      if (!released) await keyHolder.query("select pg_advisory_unlock($1)", [RUN_LOCK]);
      keyHolder.release();
      await rm(unlockedRoot, { recursive: true, force: true });
      await rm(lockedRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it("loads one unseen document concurrently without the lock, and leaves one row", async () => {
    /**
     * **The reason `serialise` can default to off.** The argument for opting out
     * is "a seed under a slug nobody else uses shares no row with anybody" —
     * true of `articles`, `jobs`, `block_identities`, `revision_blocks` and
     * `revision_step_runs`, which are keyed by article or by slug.
     *
     * **`raw_sources` is not.** Its primary key is `(sha256, kind)` — one row
     * per *document*, shared by every article made from those bytes — so N
     * clones of one corpus article all write one row. This case is the only
     * thing in the suite that puts that under concurrency with the row **absent**,
     * which is the state a developer's laptop never has and the only state in
     * which it ever went wrong.
     *
     * It used to assert the opposite. `writeRawSource` did `select … for update`
     * and then `insert`, and a `for update` over no rows locks nothing: all four
     * loads missed, all four inserted, and every loser got `duplicate key value
     * violates unique constraint "raw_sources_sha256_kind_pk"` and rolled its
     * whole transaction back. Measured 2026-09-01, sixteen concurrent
     * unserialised clones with the raw bytes freshened: 15, 7 and 15 failures of
     * 16 over three runs. `writeRawSource` now inserts conflict-tolerantly and
     * compares what came back, so every writer finishes and the row is written
     * once (src/store/artifacts-pg.ts).
     *
     * **This rig really does overlap.** Its four loads collided on demand for as
     * long as the bug existed, which is what says the concurrency is real rather
     * than four calls politely taking turns. The deterministic version — writer
     * B held on writer A's uncommitted row, with the block asserted — is
     * tests/store-raw-source-race.test.ts, and that is the one to reach for if
     * this ever needs debugging.
     */
    const marker = `<!-- serialisation ${randomBytes(8).toString("hex")} -->`;
    const sha = createHash("sha256")
      .update(
        Buffer.concat([
          Buffer.from(marker),
          await readFile(path.join(FIXTURE_ROOT, "data", FROM, "raw.html")),
        ]),
      )
      .digest("hex");
    mine.shas.push(sha);

    const db = getDb();
    const before = await db
      .select({ sha256: rawSources.sha256 })
      .from(rawSources)
      .where(and(eq(rawSources.sha256, sha), eq(rawSources.kind, "html")));
    /* The precondition, and the whole reason the marker is random: with the row
       already there every caller reads it and nothing contends, so this case
       would pass on any code at all. */
    expect(before, "this document must be one Postgres has never seen").toEqual([]);

    const slugs = [0, 1, 2, 3].map((i) => freshSlug(`shared-raw-${i}`));
    const roots = await Promise.all(slugs.map((slug) => clone(slug, marker)));
    try {
      const outcomes = await Promise.allSettled(
        slugs.map((slug, i) => loadArticleIntoPg(slug, { root: roots[i]!, serialise: false })),
      );
      const refused = outcomes.filter((o) => o.status === "rejected");
      expect(
        refused.map((o) => String((o as PromiseRejectedResult).reason)),
        "concurrent unserialised loads of one unseen document must all succeed",
      ).toEqual([]);

      /* And the shared row was written exactly once — which is what says they
         succeeded by agreeing on one row, not by each getting their own. */
      const after = await db
        .select({ sha256: rawSources.sha256 })
        .from(rawSources)
        .where(and(eq(rawSources.sha256, sha), eq(rawSources.kind, "html")));
      expect(after.length).toBe(1);
    } finally {
      for (const root of roots) await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
