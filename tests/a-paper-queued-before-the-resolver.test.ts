/**
 * **A paper queued before the source resolver shipped, and pasted again after
 * it, is still one job.** Postgres.
 *
 * A job row stores the `urlKey` and the work key it was queued with. One queued
 * from `arxiv.org/pdf/<id>` by the build before `urlKey` resolved papers
 * (src/paper-sources.ts) carries the *unresolved* ones. `enqueue`'s in-flight
 * lookup recomputes each active job's key from its address, so a paste of the
 * `abs/` link finds that job and adopts its slug; but the stored work keys
 * differ, the queue's unique index does not see the same work, and a second job
 * was inserted on the same article and its slot charged for a run in which
 * every step is skipped.
 *
 * `enqueue` now hands the holder back before it inserts, when the holder is the
 * same work under today's resolver. docs/plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md
 * § Caller 1, *Jobs already queued when this deploys* (GPT Sol's F1 and F11).
 *
 * **The seed is written through the store, with the old keys spelled out**,
 * because nothing in today's code will produce them any more. `oldWorkKey` is a
 * copy of `workKeyFor`'s hash with the source handed in, and the first case
 * holds the copy to the original on an address no source recognises.
 *
 * **The reservations are real ones**, taken the way the route takes them. A
 * job's `ingest_event_id` is a foreign key onto the owner's own reservation, so
 * an invented id could not be seeded at all; and going through `withIngestSlot`
 * (src/billing/admission.ts) is what lets the cases say what happens to the
 * pasted request's slot, which is the charge this fix exists to stop. The owner
 * is this file's own, on the free tier's three ingests.
 */
import { createHash } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { withIngestSlot } from "../src/billing/admission.js";

import { closeDb, getDb } from "../src/db/client.js";
import { jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { slugFromUrl, slugWithShortId, urlKey } from "../src/ingest.js";
import { enqueue, getJob, retryJob } from "../src/jobs.js";
import { INTERRUPTED } from "../src/messages.js";
import { runAsOwner } from "../src/owner.js";
import { mintAttempt, workKeyFor } from "../src/store/jobs.js";
import { reserveIngest } from "../src/store/pg-billing.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import type { Job, OwnerId, StepName } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/a-paper-queued-before-the-resolver.test.ts",
  tables: ["spideryarn.jobs", "spideryarn.ingest_events"],
  keepPool: true,
});

/** Fixed, so a run killed half-way is cleared by the next one rather than accumulating owners. */
const OWNER = "0b111a99-0000-4000-8000-0000a2c51d01" as OwnerId;
const made: string[] = [];

async function clearReservations(): Promise<void> {
  await pool.query("delete from spideryarn.ingest_events where owner_id = $1", [OWNER]);
}

beforeAll(async () => {
  await seedAuthUser(pool, {
    id: OWNER,
    email: `a-paper-queued-before-the-resolver-${OWNER}@spideryarn.local`,
    onConflictDoNothing: true,
  });
  await pool.query("delete from spideryarn.jobs where owner_id = $1", [OWNER]);
  await clearReservations();
});

let wasVercel: string | undefined;
beforeEach(() => {
  /* No pump: nothing here may start fetching from arXiv. */
  wasVercel = process.env.VERCEL;
  process.env.VERCEL = "1";
});
afterEach(async () => {
  if (wasVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = wasVercel;
  /* Jobs before reservations: the foreign key points from the job. */
  const ids = made.splice(0);
  if (ids.length > 0) await getDb().delete(jobsTable).where(inArray(jobsTable.id, ids));
  await clearReservations();
});
afterAll(async () => {
  await closeDb();
  await pool.end();
});

/** A new-style arXiv id nobody else in this database is using. */
function anArxivId(): string {
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
  return `${digits(4)}.${digits(5)}`;
}

/** `workKeyFor`'s hash for an unforced, unprofiled URL job, with the source key given rather than derived. */
function oldWorkKey(names: StepName[], source: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ steps: names.map((n) => [n, false]), upload: "", profile: "", source }))
    .digest("hex");
}

/** What `urlKey` answered for an address before it resolved papers: host, path, no scheme. */
function oldUrlKey(address: string): string {
  const parsed = new URL(address);
  return `${parsed.hostname}${parsed.pathname}`;
}

const STEPS: StepName[] = ["fetch"];

/** An active first ingest of `address`, as the build before the resolver wrote it. */
async function queuedByTheOldBuild(address: string): Promise<{ job: Job; reservation: string }> {
  const admitted = await reserveIngest(OWNER, undefined, []);
  if (admitted.kind !== "admitted") throw new Error(`the seed was refused a slot: ${admitted.kind}`);
  const reservation = admitted.reservationId;
  const job: Job = {
    id: mintId(),
    ownerId: OWNER,
    /* The old slug too: `arxiv-2608`, from the half of the id before the dot. */
    slug: slugWithShortId(`arxiv-${address.split("/").at(-1)?.split(".")[0] ?? "x"}`),
    url: address,
    steps: STEPS.map((name) => ({ name, label: "Fetching the page", status: "pending" as const })),
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  const outcome = await pgJobStore.enqueueOrGet(job, {
    workKey: oldWorkKey(STEPS, oldUrlKey(address)),
    reservesName: true,
    urlKey: oldUrlKey(address),
    ingestEventId: reservation,
    requiresArticle: false,
  });
  expect(outcome.kind, "the seed was not inserted").toBe("created");
  made.push(job.id);
  return { job, reservation };
}

/** This owner's queued and running jobs for one paper, by whatever address each was queued with. */
async function activeFor(id: string): Promise<Job[]> {
  const key = urlKey(`https://arxiv.org/abs/${id}`);
  const listed = await pgJobStore.list(OWNER);
  return listed.filter(
    (job) => (job.status === "queued" || job.status === "running") && job.url !== undefined && urlKey(job.url) === key,
  );
}

async function jobsCarrying(reservation: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(eq(jobsTable.ingestEventId, reservation));
  return rows.map((row) => row.id);
}

/** Whether a reservation is still held, has been given back, or was charged. */
async function stateOf(reservation: string): Promise<"held" | "released" | "charged" | "missing"> {
  const found = await pool.query(
    "select released_at, succeeded_at from spideryarn.ingest_events where id = $1 and owner_id = $2",
    [reservation, OWNER],
  );
  const row = (found as { rows: { released_at: Date | null; succeeded_at: Date | null }[] } | undefined)?.rows[0];
  if (row === undefined) return "missing";
  if (row.succeeded_at !== null) return "charged";
  return row.released_at === null ? "held" : "released";
}

/**
 * Paste an address the way `POST /api/jobs` does (src/routes.ts): the slug from
 * the address, inside `withIngestSlot`, which takes a slot before `enqueue` and
 * gives it back afterwards if no job's insert took it.
 */
async function paste(address: string, steps: StepName[] = STEPS): Promise<{ job: Job; reservation: string }> {
  let reservation = "";
  const job = await runAsOwner(OWNER, () =>
    withIngestSlot({ ownerId: OWNER, slug: slugFromUrl(address) }, (slot) => {
      reservation = slot.ingestEventId ?? "";
      return enqueue({ slug: slugFromUrl(address), url: address, steps, ...slot });
    }),
  );
  expect(reservation, "the paste was given no slot, so the case says nothing about the charge").not.toBe("");
  if (!made.includes(job.id)) made.push(job.id);
  return { job, reservation };
}

describe("a paper queued before the resolver, pasted again after it", () => {
  it("is seeded with the keys the old build really wrote", () => {
    /* The copy of the hash agrees with the original wherever the resolver has
       nothing to say, and disagrees for a paper, which is the whole situation. */
    const ordinary = "https://example.com/why-trees";
    expect(oldUrlKey(ordinary)).toBe(urlKey(ordinary));
    expect(oldWorkKey(STEPS, oldUrlKey(ordinary))).toBe(workKeyFor(STEPS, new Set(), undefined, undefined, ordinary));
    const paper = "https://arxiv.org/pdf/2608.13566";
    expect(oldUrlKey(paper)).toBe("arxiv.org/pdf/2608.13566");
    expect(oldWorkKey(STEPS, oldUrlKey(paper))).not.toBe(workKeyFor(STEPS, new Set(), undefined, undefined, paper));
  });

  for (const shape of ["pdf", "html"]) {
    it(`hands back the job queued from the ${shape}/ address when the abs/ address is pasted`, async () => {
      const id = anArxivId();
      const seeded = await queuedByTheOldBuild(`https://arxiv.org/${shape}/${id}`);

      const pasted = await paste(`https://arxiv.org/abs/${id}?utm_source=x`);

      expect(pasted.job.id, "the paste was not handed the job already doing this work").toBe(seeded.job.id);
      const active = await activeFor(id);
      expect(active.map((job) => job.id), "one paper has more than one active job").toEqual([seeded.job.id]);
      /* The request's slot is on no job and the route's wrapper has given it
         back; the seed's own is where it was, still held by the one job. */
      expect(await jobsCarrying(pasted.reservation)).toEqual([]);
      expect(await stateOf(pasted.reservation)).toBe("released");
      expect(await jobsCarrying(seeded.reservation)).toEqual([seeded.job.id]);
      expect(await stateOf(seeded.reservation)).toBe("held");
    });
  }

  it("hands a paste the retry of a failed job from before the resolver", async () => {
    const id = anArxivId();
    const seeded = await queuedByTheOldBuild(`https://arxiv.org/pdf/${id}`);
    const attempt = mintAttempt();
    const claimed = await pgJobStore.claim(seeded.job.id, OWNER, attempt, 60_000, 4);
    expect(claimed.kind, "the seed could not be claimed, so it cannot be failed").toBe("claimed");
    await pgJobStore.finish(seeded.job.id, attempt, {
      status: "error",
      steps: seeded.job.steps,
      error: INTERRUPTED.message,
      failureKind: INTERRUPTED.kind,
    });
    expect((await runAsOwner(OWNER, () => getJob(seeded.job.id)))?.status).toBe("error");

    const retried = await runAsOwner(OWNER, () => retryJob(seeded.job.id));
    if (!retried) throw new Error("retryJob refused the failed job");
    made.push(retried.id);
    expect(retried.slug, "the retry left the failed attempt's article").toBe(seeded.job.slug);

    const pasted = await paste(`https://arxiv.org/abs/${id}`);

    expect(pasted.job.id, "the paste was not handed the retry").toBe(retried.id);
    expect((await activeFor(id)).map((job) => job.id)).toEqual([retried.id]);
    expect(await jobsCarrying(pasted.reservation)).toEqual([]);
    expect(await stateOf(pasted.reservation)).toBe("released");
  });

  /**
   * **A holder the reader has pressed Stop on is not handed back** — GPT Sol's
   * F15, reviewing the built stage 1.
   *
   * A running job with Stop pressed stays `running`, with `cancelling` set,
   * until its claimant unwinds. Handing it back would give the new request a
   * job that is about to end `cancelled`, and its slot — on no job — back to
   * the reader: the paste would vanish. `jobs_active_work` leaves cancelling
   * rows out for this reason, and the look before the insert must agree.
   */
  it("does not hand back a job that is being cancelled, and spends the paste's slot on a new one", async () => {
    const id = anArxivId();
    const seeded = await queuedByTheOldBuild(`https://arxiv.org/pdf/${id}`);
    const claimed = await pgJobStore.claim(seeded.job.id, OWNER, mintAttempt(), 60_000, 4);
    expect(claimed.kind, "the seed could not be claimed, so it cannot be left stopping").toBe("claimed");
    const stopping = await pgJobStore.requestCancel(seeded.job.id, OWNER);
    /* The state the case is about, proved rather than assumed: still active, and stopping. */
    expect(stopping?.status).toBe("running");
    expect(stopping?.cancelling).toBe(true);

    const pasted = await paste(`https://arxiv.org/abs/${id}`);

    expect(pasted.job.id, "the paste was handed a job that is stopping").not.toBe(seeded.job.id);
    expect(pasted.job.status).toBe("queued");
    expect(pasted.job.cancelling).not.toBe(true);
    expect(pasted.job.slug, "one paper became two articles").toBe(seeded.job.slug);
    /* The new request's slot is on its own new job, not given back. */
    expect(await jobsCarrying(pasted.reservation)).toEqual([pasted.job.id]);
    expect(await stateOf(pasted.reservation)).toBe("held");
  });

  it("still queues a different piece of work behind it, on the same article", async () => {
    const id = anArxivId();
    const seeded = await queuedByTheOldBuild(`https://arxiv.org/pdf/${id}`);

    const pasted = await paste(`https://arxiv.org/abs/${id}`, ["fetch", "extract"]);

    expect(pasted.job.id, "a different step list was handed somebody else's job").not.toBe(seeded.job.id);
    expect(pasted.job.slug, "one paper became two articles").toBe(seeded.job.slug);
    expect((await activeFor(id)).map((job) => job.id).sort()).toEqual([seeded.job.id, pasted.job.id].sort());
    /* And this one is a job of its own, so its slot is spent on it. */
    expect(await jobsCarrying(pasted.reservation)).toEqual([pasted.job.id]);
    expect(await stateOf(pasted.reservation)).toBe("held");
  });
});
