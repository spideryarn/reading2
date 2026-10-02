/**
 * A step that was renamed is still readable under its old name.
 *
 * `hierarchy` became `structure` on 2026-10-02 (plan 261002b). A job row
 * enqueued by the old code during the deploy can still hold `hierarchy` in
 * `jobs.steps` (jsonb, no CHECK) or in `jobs.reset.regenerate`, and the new
 * code must run it under its new name rather than meet an unregistered step.
 * `RETIRED_STEPS` in src/step-order.ts is the table; `toJob` in
 * src/store/pg-jobs.ts applies it on the way out of the database.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { eq } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { jobs } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { currentStepName, RETIRED_STEPS, STEP_ORDER } from "../src/step-order.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import type { JobReset, JobStep, OwnerId } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

describe("currentStepName", () => {
  it("reads a retired name as its successor", () => {
    expect(currentStepName("hierarchy")).toBe("structure");
    expect(currentStepName("trajectory")).toBe("skim");
  });

  it("passes a current name through unchanged", () => {
    expect(currentStepName("structure")).toBe("structure");
    expect(currentStepName("skim")).toBe("skim");
    expect(currentStepName("toString")).toBe("toString");
  });

  it("only ever maps onto a step that exists, and never from one", () => {
    const order: readonly string[] = STEP_ORDER;
    for (const [retired, successor] of Object.entries(RETIRED_STEPS)) {
      expect(order).toContain(successor);
      expect(order).not.toContain(retired);
    }
  });
});

await pgReady({ suite: "tests/retired-step-names.test.ts", tables: ["spideryarn.jobs"] });

/* This file's own person, fresh each run; the stem lets a killed run's rubble be swept. */
const OWNER_STEM = "000000e7-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;
const JOB_ID = mintId();

{
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  try {
    /* No run lock: the row is only ever `queued`, so it takes none of the
       running slots the lock exists to serialise. */
    await pool.query(`delete from spideryarn.jobs where owner_id::text like $1`, [RUBBLE]);
    await pool.query(`delete from auth.users where id::text like $1`, [RUBBLE]);
    await seedAuthUser(pool, { id: OWNER, email: `retired-step-names-${OWNER}@example.invalid` });
  } finally {
    await pool.end();
  }
}

describe("a job row written under a retired step name", () => {
  it("is read back under the new name, in its steps and in its reset", async () => {
    // What old code wrote mid-deploy. The type says StepName; the database does not.
    const oldSteps = [
      { name: "hierarchy", label: "Building the hierarchy", status: "pending" },
    ] as unknown as JobStep[];
    const oldReset = { regenerate: ["hierarchy"], profile: "p" } as unknown as JobReset;

    await getDb().insert(jobs).values({
      id: JOB_ID,
      ownerId: OWNER,
      slug: "retired-step-names",
      workKey: "retired-step-names",
      steps: oldSteps,
      status: "queued",
      reset: oldReset,
    });

    const job = await pgJobStore.get(JOB_ID, OWNER);
    expect(job).toBeDefined();
    expect(job?.steps).toEqual([
      { name: "structure", label: "Building the hierarchy", status: "pending" },
    ]);
    expect(job?.reset).toEqual({ regenerate: ["structure"], profile: "p" });

    // The stored row is untouched: the translation is on the way out only.
    const [raw] = await getDb().select().from(jobs).where(eq(jobs.id, JOB_ID));
    expect(raw?.steps[0]?.name).toBe("hierarchy");
  });
});

afterAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query("delete from spideryarn.jobs where owner_id = $1", [OWNER]);
    await pool.query("delete from auth.users where id = $1", [OWNER]);
  } finally {
    await pool.end();
  }
});

process.on("beforeExit", () => {
  void closeDb();
});
