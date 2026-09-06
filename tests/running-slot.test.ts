/**
 * The wait that stops a contended job insert being reported as a broken test.
 *
 * Two halves, and until 2026-09-02 there was only the first:
 *
 * - **The decision** — retry, rethrow, or give up with something a person can
 *   act on — driven with a fake insert, because a real second claimant makes
 *   that decision hard to arrange and slow to observe. The fake error is shaped
 *   like the real one on purpose: SQLSTATE `23505` and a `constraint` name,
 *   wrapped in an outer error the way Drizzle wraps pg's. A flat fake would pass
 *   against a `violatesConstraint` that only read the top level, which is the
 *   bug its own comment warns about.
 * - **The wait itself, against a real database.** This half is new, and its
 *   absence was the hole. Every case here used to synthesise the Postgres error,
 *   so the file stayed green whether or not any live insert could still produce
 *   one — and on 2026-09-02 that stopped being hypothetical: `jobs_active_slug`
 *   was replaced by four narrower indexes, and a *queued* insert on a slug that
 *   already has a queued job now succeeds. Five suites that share fixed fixture
 *   slugs would each have believed they owned theirs, and stomped one another's
 *   `article_revisions`, with nothing anywhere going red.
 *   docs/reusable/silent-success.md, and the plan's § 1i.
 *
 * So the helper waits on the invariant those suites actually need — **this
 * article has no job queued or running** — rather than on whichever constraint
 * happened to fire, and the cases below hold both halves of that.
 */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { getDb } from "../src/db/client.js";
import { jobs } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintAttempt } from "../src/store/jobs.js";
import { mintId } from "../src/ids.js";
import type { JobStep, OwnerId } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { takeRunLock } from "./helpers/run-lock.js";
import { insertWhenSlotFree } from "./helpers/running-slot.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

/**
 * pg's error, under Drizzle's wrapper — two levels, like the real thing.
 *
 * Every duplicate-key case here is built by this one function, so the
 * **constraint name is the only difference** between one that should be waited
 * out and one that should be rethrown. An earlier version built the rethrown
 * case flat, by hand: a regression to "retry every 23505" read the flat error
 * as not-contention and the test passed against the bug it was written for.
 */
function duplicateKey(constraint: string): Error {
  const fromPg = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint,
  });
  return Object.assign(new Error('Failed query: insert into "spideryarn"."jobs"'), {
    cause: fromPg,
  });
}

/**
 * "Nothing is queued or running on this article" — the seam, so that the cases
 * about the *decision* can run with no database at all, which is what they were
 * always doing. The real look is held by the cases at the foot of this file.
 */
const IDLE = async () => false;
const FAST = { attempts: 3, gapMs: 1, articleIsBusy: IDLE };

afterEach(() => {
  vi.useRealTimers();
});

describe("waiting out a contended job insert", () => {
  it("tries again when the insert is refused, and returns what the insert returned", async () => {
    const insert = vi
      .fn()
      .mockRejectedValueOnce(duplicateKey("jobs_one_running_per_slug"))
      .mockRejectedValueOnce(duplicateKey("jobs_one_running_per_slug"))
      .mockResolvedValue({ id: "spya-ok" });

    expect(await insertWhenSlotFree("writes", insert, FAST)).toEqual({ id: "spya-ok" });
    expect(insert).toHaveBeenCalledTimes(3);
  });

  /**
   * **Every constraint the queue arbitrates with**, because the check before the
   * insert cannot be the whole answer.
   *
   * That check reads the table and then the insert runs, and anything outside
   * this test run — a dev server mid-ingest, a second `npm test` — may land in
   * between. Whichever of the four then refuses is contention and not a bug, so
   * all four have to be waited out; a name missing from the helper's list is a
   * suite failing with `duplicate key` and pointing at itself.
   */
  it.each([
    "jobs_one_running_per_slug",
    "jobs_reserved_slug",
    "jobs_active_work",
    "jobs_active_source",
  ])("waits out %s, which a live insert really can raise", async (constraint) => {
    const insert = vi
      .fn()
      .mockRejectedValueOnce(duplicateKey(constraint))
      .mockResolvedValue({ id: "spya-ok" });

    await expect(insertWhenSlotFree("writes", insert, FAST)).resolves.toEqual({ id: "spya-ok" });
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("calls the insert afresh each time rather than retrying one value", async () => {
    /* A job wants a new id per attempt. If this ever retried a promise instead
       of the function, every attempt would carry the first attempt's id. */
    const ids: string[] = [];
    let n = 0;
    const insert = async () => {
      const id = `spya-${++n}`;
      ids.push(id);
      if (n < 3) throw duplicateKey("jobs_one_running_per_slug");
      return id;
    };

    expect(await insertWhenSlotFree("writes", insert, FAST)).toBe("spya-3");
    expect(ids).toEqual(["spya-1", "spya-2", "spya-3"]);
  });

  it("rethrows at once when the failure is not contention", async () => {
    /* The dangerous direction: a real bug swallowed into a 20-second wait and
       then reported as a wedged row. */
    const notContention = Object.assign(new Error("null value in column violates not-null"), {
      code: "23502",
      constraint: "jobs_slug_not_null",
    });
    const insert = vi.fn().mockRejectedValue(notContention);

    await expect(insertWhenSlotFree("writes", insert, FAST)).rejects.toThrow("not-null");
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("does not retry a different unique violation that happens to be 23505", async () => {
    /* GPT Sol, 2026-08-28: the previous version of this file only ever offered
       a non-23505 code here, so a regression to "retry every duplicate key,
       whatever it is" would have stayed green. The constraint name is the whole
       decision, and this is the case that says so. */
    const other = duplicateKey("jobs_draft_revision_unique");
    const insert = vi.fn().mockRejectedValue(other);

    // `toBe`, not `toThrow`: it must come back untouched, not merely look similar.
    await expect(insertWhenSlotFree("writes", insert, FAST)).rejects.toBe(other);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("parks on a timer between attempts rather than spinning", async () => {
    /* Without this, deleting the `setTimeout` leaves a tight retry loop that
       hammers the database and every case above still passes. */
    vi.useFakeTimers();
    const insert = vi.fn().mockRejectedValue(duplicateKey("jobs_one_running_per_slug"));
    const settled = vi.fn();
    void insertWhenSlotFree("writes", insert, {
      attempts: 3,
      gapMs: 500,
      articleIsBusy: IDLE,
    }).catch(settled);

    await vi.advanceTimersByTimeAsync(0);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(499);
    expect(insert).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("uses 40 attempts 500ms apart when nobody passes those numbers", async () => {
    /* Every other case here passes `FAST`, so the numbers a real caller gets
       were untested: `ATTEMPTS = 1` would have left the file green. */
    vi.useFakeTimers();
    const insert = vi.fn().mockRejectedValue(duplicateKey("jobs_one_running_per_slug"));
    const caught = vi.fn();
    void insertWhenSlotFree("writes", insert, { articleIsBusy: IDLE }).catch(caught);

    await vi.advanceTimersByTimeAsync(39 * 500 - 1);
    expect(insert).toHaveBeenCalledTimes(39);
    expect(caught).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(insert).toHaveBeenCalledTimes(40);
    expect(caught).toHaveBeenCalledOnce();
    expect(caught.mock.calls[0]?.[0]).toMatchObject({ message: expect.stringContaining("in 20s") });
  });

  it("gives up saying a row may be wedged, because waiting cannot clear that", async () => {
    const insert = vi.fn().mockRejectedValue(duplicateKey("jobs_one_running_per_slug"));

    await expect(insertWhenSlotFree("writes", insert, FAST)).rejects.toThrow(
      /could not start a job for "writes".*wedged/s,
    );
    expect(insert).toHaveBeenCalledTimes(3);
  });

  /**
   * **A line that never empties spends the budget and never inserts.**
   *
   * The other timeout case above reaches its budget through the *insert*
   * throwing; this one reaches it without ever calling the insert, which is the
   * branch the look added. Without it, "wait, then insert anyway" would pass
   * every case in this file.
   */
  it("never inserts while the article stays busy, and says so when it gives up", async () => {
    const insert = vi.fn();
    await expect(
      insertWhenSlotFree("writes", insert, {
        attempts: 3,
        gapMs: 1,
        articleIsBusy: async () => true,
      }),
    ).rejects.toThrow(/already has a job queued or running/);
    expect(insert).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------- and now against a database -- */

const { pool } = await pgReady({
  suite: "tests/running-slot.test.ts",
  columns: [{ table: "spideryarn.jobs", column: "reserves_name" }],
  keepPool: true,
});

/**
 * **This file starts jobs, so it takes the lock every file that starts jobs
 * takes** — `./helpers/run-lock.ts`, and it is not optional.
 *
 * The cases below hold a `running` row for a couple of hundred milliseconds, and
 * the global concurrency cap is counted across the whole table. Without the lock
 * this file makes `tests/store-jobs-parity.test.ts` § *"refuses a claim that
 * would put the machine over its cap"* answer `busy` where it wanted `claimed` —
 * watched happening, 2026-09-02, which is exactly the shape that docstring
 * describes and the reason it says "taken by everybody".
 */
const runLock = await takeRunLock("tests/running-slot.test.ts");

/**
 * This file's own person, fresh per run and swept by the stem afterwards — the
 * pattern tests/store-jobs-parity.test.ts sets out at length. `jobs_owner_fk`
 * needs a real `auth.users` row, and sharing one with another suite is how a
 * killed run leaves rows for the next one to trip over.
 */
const OWNER_STEM = "000000b7-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
/** A second, for the one case about a slug being global rather than an owner's. */
const OWNER_B = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;

if (pool) {
  await pool.query(`delete from spideryarn.jobs where owner_id::text like $1`, [`${OWNER_STEM}%`]);
  await pool.query(`delete from auth.users where id::text like $1`, [`${OWNER_STEM}%`]);
  for (const who of [OWNER, OWNER_B]) {
    await seedAuthUser(pool, { id: who, email: `running-slot-${who}@example.invalid` });
  }
}

afterAll(async () => {
  await runLock?.release();
  if (pool) {
    await pool.query(`delete from spideryarn.jobs where owner_id::text like $1`, [`${OWNER_STEM}%`]);
    await pool.query(`delete from auth.users where id::text like $1`, [`${OWNER_STEM}%`]);
    await pool.end();
  }
});

const STEPS: JobStep[] = [{ name: "fetch", label: "Fetching the page", status: "pending" }];

describe("the wait itself, against a real database", () => {
  const made: string[] = [];
  afterEach(async () => {
    const ids = made.splice(0);
    if (ids.length > 0) await getDb().delete(jobs).where(inArray(jobs.id, ids));
  });

  /** One row in whatever state, remembered so `afterEach` takes it away again. */
  async function put(
    slug: string,
    status: "queued" | "running",
    owner: OwnerId = OWNER,
  ): Promise<string> {
    const id = mintId();
    made.push(id);
    await getDb()
      .insert(jobs)
      .values({
        id,
        ownerId: owner,
        slug,
        steps: STEPS,
        status,
        workKey: `running-slot-${id}`,
        ...(status === "running" && {
          attemptId: mintAttempt(),
          leaseExpiresAt: new Date(Date.now() + 600_000),
        }),
      });
    return id;
  }

  /**
   * **The case that was missing, and the one the whole helper exists for.**
   *
   * A *queued* holder is the state that stopped raising anything on 2026-09-02:
   * a second queued job on one article is now allowed, on purpose, so the
   * contending insert succeeds and nothing waits. Watched red before the helper
   * was rewritten — the second row landed immediately, alongside the first.
   *
   * A *running* holder still trips `jobs_one_running_per_slug`, so it is the
   * half that goes on working through the constraint. Both are here because
   * "which of the two does the waiting" is exactly the thing that changed, and
   * a test naming only one of them would have been green over the other.
   */
  it.each(["queued", "running"] as const)(
    "does not insert while a %s job holds the article, and does the moment it settles",
    async (status) => {
      const slug = `test-running-slot-${randomUUID().slice(0, 8)}`;
      const holder = await put(slug, status);

      let landed: string | undefined;
      const waiting = insertWhenSlotFree(
        slug,
        async () => {
          const id = await put(slug, "queued");
          landed = id;
          return id;
        },
        { attempts: 200, gapMs: 20 },
      );

      /* Long enough for several attempts at 20ms. Without the wait the row is
         in on the first one, which is what makes this assertion the red. */
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(landed).toBeUndefined();

      /* The holder finishes, exactly as a real job does — not deleted, because
         a *terminal* row not holding the line is the thing being asserted. */
      await getDb().update(jobs).set({ status: "done" }).where(eq(jobs.id, holder));

      expect(await waiting).toBe(landed);
      expect(landed).toBeDefined();
    },
  );

  /**
   * **And it does not wait when there is nothing to wait for.** Without this
   * half, a helper that always slept out its whole budget and then threw would
   * pass every case above, and every suite that takes it would time out.
   */
  it("goes straight in when the article's line is empty", async () => {
    const slug = `test-running-slot-${randomUUID().slice(0, 8)}`;
    const id = await insertWhenSlotFree(slug, () => put(slug, "queued"), {
      attempts: 3,
      gapMs: 10_000,
    });
    expect(id).toMatch(/^spya-/);
  });

  /**
   * **A finished job on the slug is history and holds nothing.** The predicate
   * is `status in ('queued','running')`, and getting that wrong in the other
   * direction — waiting on any row at all — is a helper that never returns for
   * any fixture slug that has ever been used.
   */
  it("ignores a job on the slug that is already over", async () => {
    const slug = `test-running-slot-${randomUUID().slice(0, 8)}`;
    const over = await put(slug, "queued");
    await getDb().update(jobs).set({ status: "error" }).where(eq(jobs.id, over));

    const id = await insertWhenSlotFree(slug, () => put(slug, "queued"), {
      attempts: 3,
      gapMs: 10_000,
    });
    expect(id).toMatch(/^spya-/);
  });

  /**
   * **Another owner's job on the slug holds it too.**
   *
   * The mutex and the reservation are global on `slug`, because `articles.slug`
   * is — so an owner-scoped wait would let a suite start work on an article
   * somebody else's job is inside. The helper takes no owner at all, which is
   * what makes this true by construction rather than by remembering.
   */
  it("waits on a job it does not own, because the article rule is global", async () => {
    const slug = `test-running-slot-${randomUUID().slice(0, 8)}`;
    const holder = await put(slug, "running", OWNER_B);

    let landed = false;
    const waiting = insertWhenSlotFree(
      slug,
      async () => {
        await put(slug, "queued");
        landed = true;
      },
      { attempts: 200, gapMs: 20 },
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(landed).toBe(false);

    await getDb()
      .update(jobs)
      .set({ status: "cancelled", attemptId: null, leaseExpiresAt: null })
      .where(eq(jobs.id, holder));
    await waiting;
    expect(landed).toBe(true);
  });
});
