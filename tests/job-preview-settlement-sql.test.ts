/**
 * No Postgres: inspect the SQL the actual lifecycle methods send. The database
 * suite in store-jobs-parity.test.ts separately checks the resulting rows.
 */
import { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerId } from "../src/types.js";

const fake = vi.hoisted(() => ({
  sets: [] as Record<string, unknown>[],
  pause: false,
}));

vi.mock("../src/db/client.js", () => {
  const tx = {
    select: () => {
      const selection = {
        from: () => selection,
        where: () => selection,
        orderBy: async () => [],
        for: async () => fake.pause ? [{
          attemptId: "attempt", status: "running", cancelling: false,
          requeues: 0, lapsed: false,
        }] : [],
      };
      return selection;
    },
    update: () => ({
      set: (fields: Record<string, unknown>) => {
        fake.sets.push(fields);
        return { where: () => ({ returning: async () => [] }) };
      },
    }),
  };
  return { getDb: () => ({ transaction: async (body: (value: typeof tx) => unknown) => body(tx) }) };
});

import { pgJobStore } from "../src/store/pg-jobs.js";

const dialect = new PgDialect();
const OWNER = "00000000-0000-4000-8000-0000261004f1" as OwnerId;

beforeEach(() => {
  fake.sets.length = 0;
  fake.pause = false;
});

describe("a lifecycle settlement removes every step's preview", () => {
  it.each(["stop", "pause", "expiry"])("sends a preview removal on %s", async (door) => {
    if (door === "stop") await pgJobStore.requestCancel("job", OWNER);
    if (door === "pause") {
      fake.pause = true;
      await pgJobStore.pauseForDeadline("job", "attempt", 2);
    }
    if (door === "expiry") await pgJobStore.settleExpired(undefined, OWNER, 2);

    const steps = fake.sets.map((fields) => fields.steps).filter((value) => value instanceof SQL);
    expect(steps.length, "the lifecycle must have built a steps update").toBe(door === "expiry" ? 2 : 1);
    for (const expression of steps) {
      const { sql } = dialect.sqlToQuery(expression);
      /* The subtraction must surround the entire CASE, including its unchanged
         arm: queued cancellation can see a pending preview from an old pause. */
      expect(sql).toMatch(/end\s*\)\s*-\s*'preview'\s+order by step\.ordinality/i);
      if (door === "stop") {
        /* Asking a live claimant to stop must still leave its preview alone. */
        expect(sql).toMatch(/else "spideryarn"\."jobs"\."steps" end$/);
      }
    }
  });
});
