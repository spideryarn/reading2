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

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type Candidate,
  MAX_PER_RUN,
  type MainDeps,
  type NeverPublishedSurvey,
  TidySafetyError,
  checkDeletion,
  destroyEach,
  main,
  parseIdsFile,
  proofIsClean,
  proveEligible,
  surveyNeverPublished,
  writeBackup,
} from "../scripts/never-published-tidy.js";
import { closeDb, getDb } from "../src/db/client.js";
import type { AiCallRow } from "../src/ai-spend.js";
import {
  aiCalls,
  articleRevisions,
  articleTags,
  articles,
  blockIdentities,
  checkpoints,
  ingestEvents,
  jobs,
  uploads,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import { aiCallInsertValues } from "../src/store/ai-calls-pg.js";
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
  await getDb().update(blockIdentities).set({ firstSeenAt: then }).where(inArray(blockIdentities.articleId, [...ids]));
}

/** One model call of this file's owner, as the ledger writes it; the shape of tests/store-ai-calls.test.ts's. */
function aiCall(over: Partial<AiCallRow> = {}): AiCallRow {
  return {
    id: crypto.randomUUID(), runId: crypto.randomUUID(), generationId: null, scopeKind: "job_step",
    ownerId: OWNER, articleSlug: null, jobId: null, stepName: "structure", wire: "messages", job: "structure",
    requestedModel: "anthropic/claude-sonnet-5", answeredModel: "anthropic/claude-sonnet-5", upstream: "Anthropic",
    providerAccount: "openrouter", costSource: "provider", computedCostNanos: null, priceVersion: null,
    credentialFingerprint: null, startedAt: new Date(Date.now() - 30 * DAY).toISOString(), finishedAt: null,
    durationMs: 1, outcome: "ok", attempt: null, failurePhase: null, failureClass: null, failureStatus: null,
    creditsUsedNanos: 1, byokUpstreamNanos: null, isByok: false, reportedInputTokens: 1, outputTokens: 1,
    cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, reasoningTokens: 0,
    webSearches: null, serviceTier: null, inferenceGeo: null, realtimeSessionId: null, providerEventId: null,
    eventKind: null, providerStatus: null, inputTextTokens: null, inputAudioTokens: null, inputImageTokens: null,
    cachedTextTokens: null, cachedAudioTokens: null, outputTextTokens: null, outputAudioTokens: null,
    transcriptionSeconds: null, voiceSeconds: null,
    ...over,
  };
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
  await pool.query("delete from spideryarn.uploads where owner_id = $1", [OWNER]);
  await pool.query("delete from spideryarn.ingest_events where owner_id = $1", [OWNER]);
  await pool.query("delete from spideryarn.ai_calls where owner_id = $1", [OWNER]);
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

describe("the two queries protect the same things", () => {
  /* Sol's R4. Each case starts from a quiet, untouched failed import and sets
     one protected thing alone; the survey must hold it back AND the second
     query (which is also the check under `destroy`'s lock) must refuse it. A
     clock or a setting either query forgets turns its case red. */
  const recent = () => new Date(Date.now() - 60 * 60 * 1000);
  const old = () => new Date(Date.now() - 30 * DAY);
  const set = (id: string, values: Partial<typeof articles.$inferInsert>) =>
    getDb().update(articles).set(values).where(eq(articles.id, id));
  const call = (articleId: string, over: Partial<AiCallRow>) =>
    getDb().insert(aiCalls).values(aiCallInsertValues(aiCall(over), articleId));

  const cases: [string, (a: { id: string; slug: string }) => Promise<unknown>][] = [
    ["articles.created_at", (a) => set(a.id, { createdAt: recent() })],
    ["articles.updated_at", (a) => set(a.id, { updatedAt: recent() })],
    ["articles.last_opened_at, old", (a) => set(a.id, { lastOpenedAt: old() })],
    ["articles.last_opened_at, recent", (a) => set(a.id, { lastOpenedAt: recent() })],
    ["articles.opens", (a) => set(a.id, { opens: 1 })],
    ["articles.high_power_since", (a) => set(a.id, { highPowerSince: old() })],
    ["articles.title_override", (a) => set(a.id, { titleOverride: "x" })],
    ["articles.purpose", (a) => set(a.id, { purpose: "x" })],
    ["articles.archived_at", (a) => set(a.id, { archivedAt: old() })],
    ["articles.share_token", (a) => set(a.id, { shareToken: "A".repeat(22), shareTokenAt: old() })],
    ["articles.visibility and public_at", (a) => set(a.id, { visibility: "public", publicAt: old() })],
    ["articles.public_at alone", (a) => set(a.id, { publicAt: old() })],
    ["a reader table (article_tags)", (a) => getDb().insert(articleTags).values({ articleId: a.id, tag: "x" })],
    ["checkpoints.last_used_at", (a) => getDb().update(checkpoints).set({ lastUsedAt: recent() }).where(eq(checkpoints.articleId, a.id))],
    ["checkpoints.created_at", (a) => getDb().update(checkpoints).set({ createdAt: recent() }).where(eq(checkpoints.articleId, a.id))],
    ["block_identities.first_seen_at", (a) => getDb().update(blockIdentities).set({ firstSeenAt: recent() }).where(eq(blockIdentities.articleId, a.id))],
    /* Each clock alone, however unlikely the pair: `aiCallInsertValues` turns a
       null `finishedAt` into 1970, so "finished long ago" is what a null is. */
    ["ai_calls.started_at", (a) => call(a.id, { startedAt: recent().toISOString(), finishedAt: old().toISOString() })],
    ["ai_calls.finished_at, started long ago", (a) => call(a.id, { startedAt: old().toISOString(), finishedAt: recent().toISOString() })],
    ["ai_calls.created_at, both clocks long ago", (a) => call(a.id, { startedAt: old().toISOString(), finishedAt: old().toISOString() })],
    ["uploads.minted_at", (a) => getDb().insert(uploads).values({
      id: crypto.randomUUID(), ownerId: OWNER, filename: "x.pdf", claimedBytes: 1, claimedSha256: "0".repeat(64), status: "pending",
      grantExpiresAt: new Date(Date.now() + DAY), slug: a.slug,
    })],
    ["a job, finished long ago", async (a) => {
      await getDb().insert(jobs).values({ id: mintId(), ownerId: OWNER, slug: a.slug, steps: [], status: "error", workKey: `work-${mintId()}` });
      await getDb().update(jobs).set({ createdAt: old() }).where(eq(jobs.slug, a.slug));
    }],
    ["a revision, made long ago", (a) => getDb().insert(articleRevisions).values({ articleId: a.id, status: "failed", createdAt: old() })],
    ["a reservation by slug", (a) => getDb().insert(ingestEvents).values({ ownerId: OWNER, slug: a.slug, reservedAt: old() })],
  ];

  it.each(cases)("%s", async (_name, protect) => {
    const a = await failedFirstImport("one-thing", { identities: 2, checkpoint: true });
    await age([a.id]);
    expect((await survey()).eligible.map((c) => c.articleId), "the starting point is eligible").toEqual([a.id]);
    await protect(a);
    const s = await survey();
    const held = s.candidates.find((c) => c.articleId === a.id)?.hold ?? [];
    const proof = await getDb().transaction(async (tx) => await proveEligible(tx, [a.id], 7), { accessMode: "read only" });
    expect({ surveyHolds: held.length > 0, proofRefuses: !proofIsClean(proof, 1) }).toEqual({ surveyHolds: true, proofRefuses: true });
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
      /* Dated a month back, so no clock sees it and only the comparison can. */
      await getDb().insert(blockIdentities).values({ articleId: a.id, blockId: mintId(), firstSeenAt: new Date(Date.now() - 30 * DAY) });
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

/* ------------------------------------------------- the command itself -- */

/**
 * `main` with its world replaced by watchers: the real survey, refusals,
 * backup and `destroy` against this file's own database and owner, with every
 * call to `connect`, `writeBackup` and `destroy` counted. GPT Sol's R6.
 */
function harness(over: Partial<MainDeps> = {}) {
  const calls = { connect: 0, backup: 0, destroy: [] as string[] };
  const lines: string[] = [];
  const deps: MainDeps = {
    target: () => ({ url: process.env.DATABASE_URL, file: "(the test's .env.local)" }),
    connect: () => {
      calls.connect += 1;
      return { db: getDb(), end: async () => {} };
    },
    readText: (file) => readFileSync(file, "utf8"),
    writeBackup: async (...args) => {
      calls.backup += 1;
      return await writeBackup(...args);
    },
    destroy: (slug, opts) => {
      calls.destroy.push(slug);
      return pgShelfStore.destroy(slug, opts);
    },
    aimStore: () => {},
    ownerId: OWNER,
    out: (line) => lines.push(line),
    ...over,
  };
  return { deps, calls, lines };
}

/** A throwaway directory with an ids file in it, and a backup directory beside it. */
function scratch(ids: readonly string[]) {
  const dir = mkdtempSync(path.join(tmpdir(), "never-published-tidy-main-"));
  const idsFile = path.join(dir, "ids.txt");
  writeFileSync(idsFile, `# reviewed\n${ids.join("\n")}\n`);
  return { dir, idsFile, backupDir: path.join(dir, "backup"), done: () => rmSync(dir, { recursive: true, force: true }) };
}

const stillThere = async (id: string) =>
  (await getDb().select({ id: articles.id }).from(articles).where(eq(articles.id, id))).length === 1;

describe("the command refuses, and never reaches destroy", () => {
  it("a database in .env.local that is not local, without --prod — before it connects", async () => {
    const a = await failedFirstImport("remote");
    await age([a.id]);
    const s = scratch([a.id]);
    const { deps, calls } = harness({
      target: () => ({ url: "postgresql://someone:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres", file: ".env.local" }),
    });
    try {
      await expect(main(["--delete", "--ids", s.idsFile, "--backup-dir", s.backupDir], deps)).rejects.toThrow(/not local, and --prod was not given/);
    } finally {
      s.done();
    }
    expect(calls).toEqual({ connect: 0, backup: 0, destroy: [] });
    expect(await stillThere(a.id)).toBe(true);
  });

  it("--quiet-days below seven with --delete, though the article would qualify at one day", async () => {
    /* Sol's R3: an ordinary option must not weaken the reviewed rule. Two days
       quiet: eligible at --quiet-days 1, not at 7. */
    const a = await failedFirstImport("two-days");
    const twoDaysAgo = new Date(Date.now() - 2 * DAY);
    await getDb().update(articles).set({ createdAt: twoDaysAgo }).where(eq(articles.id, a.id));
    await getDb().update(blockIdentities).set({ firstSeenAt: twoDaysAgo }).where(eq(blockIdentities.articleId, a.id));
    expect((await survey(1)).eligible.map((c) => c.articleId)).toEqual([a.id]);
    const s = scratch([a.id]);
    const { deps, calls } = harness();
    try {
      await expect(main(["--delete", "--quiet-days", "1", "--ids", s.idsFile, "--backup-dir", s.backupDir], deps)).rejects.toThrow(/at least 7/);
    } finally {
      s.done();
    }
    expect(calls).toEqual({ connect: 0, backup: 0, destroy: [] });
    expect(await stillThere(a.id)).toBe(true);
    /* And the library call refuses a survey taken at a weaker threshold. */
    const weak = await survey(1);
    expect(() => checkDeletion(weak, [a.id])).toThrow(/at least 7/);
  });

  /** One eligible article, and `main` run over it with `args`; what it threw, and what it touched. */
  async function runOn(name: string, args: (s: ReturnType<typeof scratch>, a: { id: string; slug: string }) => string[], over: Partial<MainDeps> = {}, pinned?: (a: { id: string }) => string[]) {
    const a = await failedFirstImport(name, { identities: 2, checkpoint: true });
    await age([a.id]);
    const s = scratch(pinned ? pinned(a) : [a.id]);
    const h = harness(over);
    try {
      const err = await main(args(s, a), h.deps).then(() => null, (e: unknown) => e as Error);
      return { a, err, calls: h.calls, lines: h.lines, survives: await stillThere(a.id) };
    } finally {
      s.done();
    }
  }

  it("--delete without --ids", async () => {
    const r = await runOn("no-ids", (s) => ["--delete", "--backup-dir", s.backupDir]);
    expect(r.err?.message).toMatch(/--delete needs --ids/);
    expect([r.calls.backup, r.calls.destroy, r.survives]).toEqual([0, [], true]);
  });

  it("an --ids file that is not there", async () => {
    const r = await runOn("ids-missing", (s) => ["--delete", "--ids", path.join(s.dir, "nope.txt"), "--backup-dir", s.backupDir]);
    expect(r.err?.message).toMatch(/ENOENT/);
    expect([r.calls.backup, r.calls.destroy, r.survives]).toEqual([0, [], true]);
  });

  it("an --ids file that pins an id the survey does not admit, as well as the eligible one", async () => {
    const extra = "33333333-3333-4333-8333-333333333333";
    const r = await runOn("ids-wrong", (s) => ["--delete", "--ids", s.idsFile, "--backup-dir", s.backupDir], {}, (a) => [a.id, extra]);
    expect(r.err?.message).toMatch(/not the pinned list/);
    expect([r.calls.backup, r.calls.destroy, r.survives]).toEqual([0, [], true]);
  });

  it("an --ids file that leaves the eligible article out", async () => {
    const other = "44444444-4444-4444-8444-444444444444";
    const r = await runOn("ids-short", (s) => ["--delete", "--ids", s.idsFile, "--backup-dir", s.backupDir], {}, () => [other]);
    expect(r.err?.message).toMatch(/not the pinned list/);
    expect([r.calls.backup, r.calls.destroy, r.survives]).toEqual([0, [], true]);
  });

  it("a backup that fails to write", async () => {
    const r = await runOn("backup-fails", (s) => ["--delete", "--ids", s.idsFile, "--backup-dir", s.backupDir], {
      writeBackup: async () => {
        throw new Error("disk full");
      },
    });
    expect(r.err?.message).toBe("disk full");
    expect([r.calls.destroy, r.survives]).toEqual([[], true]);
  });

  it("a title saved after the backup, before the delete", async () => {
    const r = await runOn("late-title-main", (s) => ["--delete", "--ids", s.idsFile, "--backup-dir", s.backupDir], {
      writeBackup: async (db, ids, dir) => {
        const written = await writeBackup(db, ids, dir);
        await getDb().update(articles).set({ titleOverride: "Typed just now" }).where(inArray(articles.id, [...ids]));
        return written;
      },
    });
    expect(r.err).toBeInstanceOf(TidySafetyError);
    expect(r.err?.message).toMatch(/no longer eligible/);
    expect([r.calls.destroy, r.survives]).toEqual([[], true]);
  });
});

describe("the command, when nothing is in the way", () => {
  it("backs up, deletes the pinned article through destroy, and says so", async () => {
    const a = await failedFirstImport("main-gone", { identities: 3, checkpoint: true });
    await age([a.id]);
    const s = scratch([a.id]);
    const h = harness();
    try {
      expect(await main(["--delete", "--ids", s.idsFile, "--backup-dir", s.backupDir], h.deps)).toBe(0);
    } finally {
      s.done();
    }
    expect([h.calls.connect, h.calls.backup, h.calls.destroy]).toEqual([1, 1, [a.slug]]);
    expect(await stillThere(a.id)).toBe(false);
    expect(h.lines.join("\n")).toMatch(/1 of 1 gone/);
  });

  it("a dry run touches nothing", async () => {
    const a = await failedFirstImport("main-dry");
    await age([a.id]);
    const h = harness();
    expect(await main([], h.deps)).toBe(0);
    expect([h.calls.backup, h.calls.destroy]).toEqual([0, []]);
    expect(await stillThere(a.id)).toBe(true);
    expect(h.lines.join("\n")).toMatch(/Nothing deleted/);
  });
});
