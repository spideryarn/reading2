/**
 * **scripts/never-published-tidy.ts — the rule, the refusals, and the delete**,
 * against a real database, on throwaway articles of one owner of its own.
 *
 * The articles are made by `lockOrCreateArticle`, the line a first import uses
 * to bring a row into existence, and left exactly as a failed first import
 * leaves them: no current revision. Each is then given the one thing that
 * should hold it back. Nothing here touches a row this file did not create:
 * every survey is scoped to `OWNER`.
 *
 * docs/plans/261007f-tidy-the-never-published-production-articles.md.
 */

import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type Candidate,
  MAX_PER_RUN,
  type NeverPublishedSurvey,
  TidySafetyError,
  checkDeletion,
  destroyEach,
  parseIdsFile,
  surveyNeverPublished,
  writeBackup,
} from "../scripts/never-published-tidy.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, blockIdentities, checkpoints, jobs } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import { createPgCheckpointStore } from "../src/store/checkpoints-pg.js";
import { pgShelfStore } from "../src/store/pg-shelf.js";
import { lockOrCreateArticle } from "../src/store/pg-revisions.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/never-published-tidy.test.ts",
  tables: ["spideryarn.articles", "spideryarn.block_identities", "spideryarn.checkpoints"],
  keepPool: true,
  max: 4,
});

/** Fixed and distinctive, so a killed run's rows are cleared rather than added to. */
const OWNER = "7e1d0000-0000-4000-8000-0000000000b1" as OwnerId;
const asOwner = <T,>(fn: () => Promise<T>): Promise<T> => runAsOwner(OWNER, fn);
const DAY = 86_400_000;

/** A first import that died: the row `lockOrCreateArticle` makes, and nothing published. */
async function failedFirstImport(name: string, opts: { identities?: number; checkpoint?: boolean } = {}) {
  const slug = `test-never-published-${name}`;
  const row = await asOwner(() =>
    getDb().transaction(async (tx) => await lockOrCreateArticle(tx, slug, { askedUrl: null })),
  );
  const n = opts.identities ?? 3;
  if (n > 0) {
    await getDb().insert(blockIdentities).values(
      Array.from({ length: n }, () => ({ articleId: row.id, blockId: mintId() })),
    );
  }
  if (opts.checkpoint) {
    await createPgCheckpointStore({ slug, articleId: row.id }).write(slug, "pdf-chunk", "abc123", { text: "x" });
  }
  return { id: row.id, slug };
}

/** Move this file's own rows a month into the past, so the quiet rule is exercised for real. */
async function age(ids: readonly string[]) {
  const then = new Date(Date.now() - 30 * DAY);
  await getDb().update(articles).set({ createdAt: then }).where(inArray(articles.id, [...ids]));
  await getDb().update(checkpoints).set({ createdAt: then, lastUsedAt: then }).where(inArray(checkpoints.articleId, [...ids]));
}

const survey = (quietDays = 7) => surveyNeverPublished(getDb(), { quietDays, ownerId: OWNER });

/** Back the targets up to a throwaway directory, then destroy them as the script does. */
async function deleteThem(targets: readonly Candidate[]) {
  const dir = mkdtempSync(path.join(tmpdir(), "never-published-tidy-test-"));
  try {
    const { backup } = await writeBackup(getDb(), targets.map((t) => t.articleId), dir);
    return await destroyEach(getDb(), targets, 7, backup);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Until another backend of this database is waiting on a row lock. */
async function waitUntilSomebodyWaitsForALock(): Promise<void> {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    const { rows } = await pool.query(
      "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
    );
    if ((rows[0] as { n: number }).n > 0) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("nothing ever waited for the billing lock");
}

async function clear(): Promise<void> {
  await pool.query("delete from spideryarn.jobs where owner_id = $1", [OWNER]);
  await pool.query("delete from spideryarn.articles where owner_id = $1", [OWNER]);
  await pool.query("delete from spideryarn.billing_accounts where owner_id = $1", [OWNER]);
}

beforeEach(async () => {
  await seedAuthUser(pool, { id: OWNER, email: `never-published-tidy-${OWNER}@spideryarn.local`, onConflictDoNothing: true });
  await clear();
});
afterEach(clear);
afterAll(async () => {
  await closeDb();
  await pool.query("delete from auth.users where id = $1", [OWNER]).catch(() => {});
  await pool.end();
});

describe("the rule", () => {
  it("admits a quiet, untouched failed import and holds back each protected one, for its own reason", async () => {
    const plain = await failedFirstImport("plain", { identities: 4, checkpoint: true });
    const withJob = await failedFirstImport("job");
    const withTitle = await failedFirstImport("title");
    const withDraft = await failedFirstImport("draft");
    const young = await failedFirstImport("young");

    await getDb().insert(jobs).values({
      id: mintId(), ownerId: OWNER, slug: withJob.slug, steps: [], status: "error", workKey: `work-${mintId()}`,
    });
    await asOwner(() => pgShelfStore.patch(withTitle.slug, { title: "A reader's own title" }));
    await getDb().insert(articleRevisions).values({ articleId: withDraft.id, status: "failed" });
    await age([plain.id, withJob.id, withTitle.id, withDraft.id]);
    /* The job and the patch stamp their own clocks: put them back too. */
    await getDb().update(jobs).set({ createdAt: new Date(Date.now() - 30 * DAY) }).where(eq(jobs.ownerId, OWNER));
    await getDb().update(articles).set({ updatedAt: new Date(Date.now() - 30 * DAY) }).where(eq(articles.id, withTitle.id));
    await getDb().update(articleRevisions).set({ createdAt: new Date(Date.now() - 30 * DAY) }).where(eq(articleRevisions.articleId, withDraft.id));

    const s = await survey();
    const hold = Object.fromEntries(s.candidates.map((c) => [c.articleId, c.hold]));
    expect(hold).toEqual({
      [plain.id]: [],
      [withJob.id]: ["has-jobs"],
      [withTitle.id]: ["has-reader-state"],
      [withDraft.id]: ["has-revisions"],
      [young.id]: ["recent"],
    });
    expect(s.eligible.map((c) => c.articleId)).toEqual([plain.id]);
    expect(s.eligible[0]?.attached).toMatchObject({ blockIdentities: 4, checkpoints: 1, revisions: 0, jobs: 0 });
    expect(s.proven).toBe(true);
    expect(s.proof).toMatchObject({ seen: 1, published: 0, jobs: 0, recent: 0 });
  });

  it("never lists an article that has a published revision", async () => {
    const a = await failedFirstImport("published");
    await getDb().insert(articleRevisions).values({ articleId: a.id, status: "published" });
    await age([a.id]);
    expect((await survey()).candidates).toEqual([]);
  });
});

describe("--delete refuses", () => {
  const fake = (over: Partial<NeverPublishedSurvey>): NeverPublishedSurvey => ({
    candidates: [], eligible: [], proven: true, role: "fixture", quietDays: 7,
    proof: { seen: 0, published: 0, revisions: 0, jobs: 0, reservations: 0, readerState: 0, recent: 0 },
    ...over,
  });
  const cand = (articleId: string) => ({
    articleId, shortId: null, ownerId: OWNER, slug: "x", createdAt: new Date(), newestActivity: new Date(), hold: [],
    attached: { revisions: 0, blockIdentities: 0, checkpoints: 0, aiCalls: 0, jobs: 0, reservations: 0, uploadsBySlug: 0, readerState: 0 },
  });
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";

  it("a list that differs from the pinned ids, either way round", () => {
    const s = fake({ eligible: [cand(A)], proof: { ...fake({}).proof, seen: 1 } });
    expect(() => checkDeletion(s, [A, B])).toThrow(TidySafetyError);
    expect(() => checkDeletion(s, [])).toThrow(/not pinned/);
    expect(checkDeletion(s, [A]).map((c) => c.articleId)).toEqual([A]);
  });

  it("an unproven survey, and one over the cap", () => {
    expect(() => checkDeletion(fake({ proven: false }), [])).toThrow(/disagree/);
    const many = Array.from({ length: MAX_PER_RUN + 1 }, (_, i) => cand(`${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`));
    const s = fake({ eligible: many, proof: { ...fake({}).proof, seen: many.length } });
    expect(() => checkDeletion(s, many.map((c) => c.articleId))).toThrow(/cap/);
  });

  it("an ids file with junk or a repeat", () => {
    expect(parseIdsFile(`# reviewed\n${A}\n\n${B}  # second\n`)).toEqual([A, B]);
    expect(() => parseIdsFile("not-an-id\n")).toThrow(TidySafetyError);
    expect(() => parseIdsFile(`${A}\n${A}\n`)).toThrow(/twice/);
  });

  it("an article that gained a job after the survey, and deletes nothing", async () => {
    const a = await failedFirstImport("late-job");
    await age([a.id]);
    const s = await survey();
    expect(s.eligible.map((c) => c.articleId)).toEqual([a.id]);
    await getDb().insert(jobs).values({
      id: mintId(), ownerId: OWNER, slug: a.slug, steps: [], status: "queued", workKey: `work-${mintId()}`,
    });
    await expect(deleteThem(checkDeletion(s, [a.id]))).rejects.toThrow(/no longer eligible/);
    expect(await getDb().select({ id: articles.id }).from(articles).where(eq(articles.id, a.id))).toHaveLength(1);
  });

  it("a title saved while the delete waits for the billing lock: refused under the lock, nothing deleted", async () => {
    /* Sol's R1. The preliminary re-proof passes; `destroy` then queues behind
       the owner's billing row, which this test holds on its own connection;
       a reader's PATCH lands in that window; the lock is released. Only a check
       taken after the locks, inside the deleting transaction, can see it. */
    const a = await failedFirstImport("late-title", { identities: 2, checkpoint: true });
    await age([a.id]);
    const targets = checkDeletion(await survey(), [a.id]);

    await pool.query("insert into spideryarn.billing_accounts (owner_id) values ($1) on conflict do nothing", [OWNER]);
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select 1 from spideryarn.billing_accounts where owner_id = $1 for update", [OWNER]);
      const run = deleteThem(targets).then(() => null, (e: unknown) => e);
      await waitUntilSomebodyWaitsForALock();
      await asOwner(() => pgShelfStore.patch(a.slug, { title: "Typed while the delete waited" }));
      await holder.query("commit");
      const err = await run;
      expect(err).toBeInstanceOf(TidySafetyError);
      expect((err as Error).message).toMatch(/under the lock/);
    } finally {
      await holder.query("rollback").catch(() => {});
      holder.release();
    }
    const [left] = await getDb().select({ title: articles.titleOverride }).from(articles).where(eq(articles.id, a.id));
    expect(left?.title).toBe("Typed while the delete waited");
  });

  it("rows the backup does not hold: a block identity minted after the backup was written", async () => {
    const a = await failedFirstImport("late-identity", { identities: 2 });
    await age([a.id]);
    const targets = checkDeletion(await survey(), [a.id]);
    const dir = mkdtempSync(path.join(tmpdir(), "never-published-tidy-test-"));
    try {
      const { backup } = await writeBackup(getDb(), [a.id], dir);
      await getDb().insert(blockIdentities).values({ articleId: a.id, blockId: mintId() });
      await expect(destroyEach(getDb(), targets, 7, backup)).rejects.toThrow(/not the rows the backup holds.*block_identities: 3 now, 2 backed up/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(await getDb().select({ id: articles.id }).from(articles).where(eq(articles.id, a.id))).toHaveLength(1);
  });

  it("a backup directory inside the repository", async () => {
    await expect(writeBackup(getDb(), [A], path.resolve(import.meta.dirname, "..", "data"))).rejects.toThrow(/inside the repository/);
  });
});

describe("--delete", () => {
  it("backs up, then destroys exactly the pinned article through the store, cascading its ids and checkpoints", async () => {
    const gone = await failedFirstImport("gone", { identities: 5, checkpoint: true });
    const kept = await failedFirstImport("kept-young", { identities: 2 });
    await age([gone.id]);

    const s = await survey();
    const targets = checkDeletion(s, [gone.id]);
    const dir = mkdtempSync(path.join(tmpdir(), "never-published-tidy-test-"));
    try {
      const { file, backup: written } = await writeBackup(getDb(), [gone.id], dir);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      const backup = JSON.parse(readFileSync(file, "utf8"));
      expect(backup.articles.map((r: { id: string }) => r.id)).toEqual([gone.id]);
      expect(backup.block_identities).toHaveLength(5);
      expect(backup.checkpoints).toHaveLength(1);

      const done = await destroyEach(getDb(), targets, 7, written);
      expect(done.map((d) => d.articleId)).toEqual([gone.id]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const left = await getDb().select({ id: articles.id }).from(articles).where(eq(articles.ownerId, OWNER));
    expect(left.map((r) => r.id)).toEqual([kept.id]);
    const ids = await getDb().select({ n: sql<number>`count(*)::int` }).from(blockIdentities).where(eq(blockIdentities.articleId, gone.id));
    const cps = await getDb().select({ n: sql<number>`count(*)::int` }).from(checkpoints).where(and(eq(checkpoints.articleId, gone.id)));
    expect([ids[0]?.n, cps[0]?.n]).toEqual([0, 0]);

    /* Run again: nothing eligible, nothing to do — idempotent. */
    expect((await survey()).eligible).toEqual([]);
  });
});
