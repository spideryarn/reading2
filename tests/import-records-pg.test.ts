/**
 * **Every import that ended leaves one row in `import_records`, and Delete
 * permanently takes it.**
 *
 * Greg, 2026-10-08 (spya-f9c9pe): *"let's just make sure that we are making it
 * possible for the dev agent to access, find, debug whatever it needs to solve
 * problems from production after the fact."* A `jobs` row is trimmed after
 * fifty finished jobs; the record is not. Plan
 * docs/plans/261008i-a-failed-import-report-carries-the-address-and-a-record-of-every-import.md
 * § Stage 2.
 *
 * The record is written by the trigger `jobs_record_import`, so most cases
 * here move a `jobs` row with plain SQL — that is the point of a trigger: it
 * holds for every writer, the four store paths and a hand-run repair alike. One
 * case goes through `enqueue` so the real path is seen to write it too.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, importRecords, ingestEvents, jobs } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { enqueue, getJob } from "../src/jobs.js";
import { type OwnerId, runAsOwner, runInRequest, setRequestOwner } from "../src/owner.js";
import { pgShelfStore } from "../src/store/pg-shelf.js";
import type { Job, JobStep } from "../src/types.js";
import {
  formatList,
  formatOne,
  parseArgs,
  type Queryable,
  readRecords,
} from "../scripts/import-records.js";
import { bareArticles } from "./helpers/bare-article.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/import-records-pg.test.ts",
  tables: ["spideryarn.jobs", "spideryarn.import_records"],
  keepPool: true,
  max: 4,
});

/** Fixed and distinctive, so a killed run's rows are cleared rather than added to. */
const OWNER = "1d0e7ec0-0000-4000-8000-0000000000a1" as OwnerId;
const OTHER = "1d0e7ec0-0000-4000-8000-0000000000a2" as OwnerId;
const SLUG = "test-import-records";
const URL = "https://example.com/paper.pdf?token=abc";
const ERROR = "The page answered 403 Forbidden, so we could not read it.";

const FAILED_AT_FETCH: JobStep[] = [
  { name: "fetch", label: "Fetching the page", status: "error", error: ERROR },
  { name: "extract", label: "Reading the article", status: "pending" },
];
const ALL_DONE: JobStep[] = [
  { name: "fetch", label: "Fetching the page", status: "done" },
  { name: "extract", label: "Reading the article", status: "done" },
];
/** A mode run on an article already on the shelf: no `fetch`, so not an import. */
const MODE_RUN: JobStep[] = [{ name: "glossary", label: "Glossary", status: "error", error: ERROR }];

async function givenJob(values: {
  status: Job["status"];
  steps: JobStep[];
  owner?: OwnerId;
  error?: string;
  url?: string;
}): Promise<string> {
  const id = mintId();
  await getDb()
    .insert(jobs)
    .values({
      id,
      ownerId: values.owner ?? OWNER,
      slug: SLUG,
      steps: values.steps,
      status: values.status,
      workKey: `work-${id}`,
      ...(values.error !== undefined && { error: values.error }),
      ...(values.url !== undefined && { url: values.url }),
    });
  return id;
}

async function setStatus(id: string, status: Job["status"], steps?: JobStep[]): Promise<void> {
  await getDb()
    .update(jobs)
    .set({ status, finishedAt: new Date(), ...(steps && { steps }) })
    .where(eq(jobs.id, id));
}

const recordsFor = (jobId: string) =>
  getDb().select().from(importRecords).where(eq(importRecords.jobId, jobId));

async function clear(): Promise<void> {
  for (const owner of [OWNER, OTHER]) {
    await pool.query("delete from spideryarn.import_records where owner_id = $1", [owner]);
    await pool.query("delete from spideryarn.jobs where owner_id = $1", [owner]);
    await pool.query("delete from spideryarn.ingest_events where owner_id = $1", [owner]);
    await pool.query("delete from spideryarn.articles where owner_id = $1", [owner]);
    await pool.query("delete from spideryarn.billing_accounts where owner_id = $1", [owner]);
  }
}

beforeEach(async () => {
  for (const id of [OWNER, OTHER]) {
    await seedAuthUser(pool, {
      id,
      email: `import-records-${id}@spideryarn.local`,
      onConflictDoNothing: true,
    });
  }
  await clear();
});

afterAll(async () => {
  await clear();
  await closeDb();
  await pool.end();
});

describe("the trigger that records an import's ending", () => {
  it("records a failed import: where it came from, the step, the error, every step", async () => {
    /* Queued rather than running: `jobs_running_is_fenced` wants an attempt
       and a lease, and any non-terminal status is the same "before" here. */
    const id = await givenJob({ status: "queued", steps: FAILED_AT_FETCH, url: URL });
    await getDb().update(jobs).set({ failureKind: "blocked" }).where(eq(jobs.id, id));
    expect(await recordsFor(id)).toEqual([]);

    await setStatus(id, "error");

    const [record, ...more] = await recordsFor(id);
    expect(more).toEqual([]);
    expect(record).toMatchObject({
      jobId: id,
      ownerId: OWNER,
      slug: SLUG,
      status: "error",
      failureKind: "blocked",
      failedStep: "fetch",
      error: ERROR,
      url: URL,
      steps: FAILED_AT_FETCH,
    });
    expect(record!.finishedAt).toBeInstanceOf(Date);
    expect(record!.recordedAt).toBeInstanceOf(Date);
  });

  it("records a success, a cancel, and a row inserted already terminal", async () => {
    const done = await givenJob({ status: "queued", steps: ALL_DONE });
    await setStatus(done, "done");
    const cancelled = await givenJob({ status: "queued", steps: FAILED_AT_FETCH });
    await setStatus(cancelled, "cancelled");
    const born = await givenJob({ status: "done", steps: ALL_DONE });

    expect((await recordsFor(done))[0]).toMatchObject({ status: "done", failedStep: null, error: null });
    expect((await recordsFor(cancelled))[0]).toMatchObject({ status: "cancelled" });
    expect((await recordsFor(born))[0]).toMatchObject({ status: "done" });
  });

  it("takes the job's own error when no step failed", async () => {
    const steps: JobStep[] = [{ name: "fetch", label: "Fetching the page", status: "pending" }];
    const id = await givenJob({ status: "queued", steps, error: "The runner stopped." });
    await setStatus(id, "error");
    expect((await recordsFor(id))[0]).toMatchObject({ failedStep: null, error: "The runner stopped." });
  });

  it("records nothing for a mode run, whose steps have no fetch", async () => {
    const id = await givenJob({ status: "queued", steps: MODE_RUN });
    await setStatus(id, "error");
    expect(await recordsFor(id)).toEqual([]);
  });

  it("keeps the first ending: Dismiss, and a hand repair back through queued, add nothing", async () => {
    const id = await givenJob({ status: "queued", steps: FAILED_AT_FETCH });
    await setStatus(id, "error");
    await getDb().update(jobs).set({ dismissedAt: new Date() }).where(eq(jobs.id, id));
    await setStatus(id, "queued");
    await setStatus(id, "done", ALL_DONE);

    const rows = await recordsFor(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "error", failedStep: "fetch" });
  });

  it("outlives the job row, which is what it is for", async () => {
    const id = await givenJob({ status: "queued", steps: FAILED_AT_FETCH });
    await setStatus(id, "error");
    await getDb().delete(jobs).where(eq(jobs.id, id));
    expect(await recordsFor(id)).toHaveLength(1);
  });

  it("does not stop a reservation being deleted; the record just loses the link", async () => {
    const [event] = await getDb()
      .insert(ingestEvents)
      .values({ ownerId: OWNER, slug: SLUG })
      .returning({ id: ingestEvents.id });
    const id = await givenJob({ status: "queued", steps: FAILED_AT_FETCH });
    await getDb().update(jobs).set({ ingestEventId: event!.id }).where(eq(jobs.id, id));
    await setStatus(id, "error");
    expect((await recordsFor(id))[0]!.ingestEventId).toBe(event!.id);

    await getDb().delete(jobs).where(eq(jobs.id, id));
    await getDb().delete(ingestEvents).where(eq(ingestEvents.id, event!.id));
    expect((await recordsFor(id))[0]).toMatchObject({ ingestEventId: null, ownerId: OWNER });
  });
});

describe("the real path", () => {
  it("records an import that `enqueue` queued and that failed", async () => {
    await bareArticles([SLUG], OWNER);
    /* A `fetch` on a slug with no source fails at once and offline —
       tests/owner-jobs.test.ts does the same. */
    const job = await runInRequest(() => {
      setRequestOwner(OWNER);
      return enqueue({ slug: SLUG, steps: ["fetch"] });
    });
    let ended: Job | undefined;
    for (let i = 0; i < 400 && !ended; i++) {
      const now = await runInRequest(() => {
        setRequestOwner(OWNER);
        return getJob(job.id);
      });
      if (now && now.status !== "queued" && now.status !== "running") ended = now;
      else await new Promise((r) => setTimeout(r, 25));
    }
    expect(ended?.status).toBe("error");
    expect((await recordsFor(job.id))[0]).toMatchObject({ status: "error", failedStep: "fetch" });
  }, 30_000);
});

describe("Delete permanently", () => {
  it("takes the owner's records for the slug, and leaves another owner's", async () => {
    await getDb().insert(articles).values({ ownerId: OWNER, slug: SLUG });
    const mine = await givenJob({ status: "queued", steps: FAILED_AT_FETCH });
    await setStatus(mine, "error");
    /* Another owner's failed attempt at the same name — possible, because a
       slug is reserved only by whoever won it (src/store/pg-shelf.ts). */
    const theirs = await givenJob({ status: "queued", steps: FAILED_AT_FETCH, owner: OTHER });
    await setStatus(theirs, "error");
    /* And a record whose job has already been trimmed away. */
    const trimmed = await givenJob({ status: "queued", steps: FAILED_AT_FETCH });
    await setStatus(trimmed, "error");
    await getDb().delete(jobs).where(eq(jobs.id, trimmed));

    expect(await runAsOwner(OWNER, () => pgShelfStore.destroy(SLUG))).toEqual({ destroyed: SLUG });

    const left = await getDb()
      .select({ jobId: importRecords.jobId, ownerId: importRecords.ownerId })
      .from(importRecords)
      .where(eq(importRecords.slug, SLUG));
    expect(left).toEqual([{ jobId: theirs, ownerId: OTHER }]);
  });
});

describe("scripts/import-records.ts", () => {
  it("lists failures without the address or the error, and shows one in full", async () => {
    const id = await givenJob({ status: "queued", steps: FAILED_AT_FETCH, url: URL });
    await setStatus(id, "error");
    const ok = await givenJob({ status: "queued", steps: ALL_DONE });
    await setStatus(ok, "done");

    const client = await pool.connect();
    try {
      const q = client as unknown as Queryable;
      const failures = (await readRecords(q, { kind: "list", all: false, limit: 1000 })).filter(
        (r) => r.owner_id === OWNER,
      );
      expect(failures.map((r) => r.job_id)).toEqual([id]);
      const listed = formatList(failures).join("\n");
      expect(listed).toContain(id);
      expect(listed).toContain("example.com");
      expect(listed).not.toContain("token=abc");
      expect(listed).not.toContain(ERROR);

      const everything = await readRecords(q, { kind: "list", all: true, limit: 1000 });
      expect(everything.map((r) => r.job_id)).toEqual(expect.arrayContaining([id, ok]));

      const [one] = await readRecords(q, { kind: "one", jobId: id });
      const shown = formatOne(one!).join("\n");
      expect(shown).toContain(URL);
      expect(shown).toContain(ERROR);
      expect(shown).toMatch(/fetch\s+error/);

      /* Every read inside `begin read only` and rolled back, even when it
         throws — never a `SET`, which on the pooler would outlive it. */
      const sent: string[] = [];
      const spy: Queryable = {
        query: async <R,>(text: string, values?: unknown[]) => {
          sent.push(text.trim().split(/\s+/).slice(0, 2).join(" "));
          if (text.startsWith("select to_regclass")) return { rows: [] as R[] };
          return (await q.query<R>(text, values)) as { rows: R[] };
        },
      };
      await expect(readRecords(spy, { kind: "one", jobId: id })).rejects.toThrow(/not deployed/);
      expect(sent).toEqual(["begin read", "select to_regclass('spideryarn.import_records')", "rollback"]);
    } finally {
      client.release();
    }
  });

  it("parses its arguments", () => {
    expect(parseArgs([])).toEqual({ kind: "list", all: false, limit: 20 });
    expect(parseArgs(["--all", "--limit", "5"])).toEqual({ kind: "list", all: true, limit: 5 });
    expect(parseArgs(["spya-abc123"])).toEqual({ kind: "one", jobId: "spya-abc123" });
    expect(parseArgs(["--limit", "0"])).toMatch(/--limit/);
    expect(parseArgs(["drop table"])).toMatch(/not understood/);
  });
});
