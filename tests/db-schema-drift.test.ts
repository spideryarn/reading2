/**
 * The schema drift guard, proved against the broken state.
 *
 * A check that has only ever been green is not evidence
 * ([silent-success.md](../docs/reusable/silent-success.md)), and this one exists
 * precisely to be believed when it is green. So the DDL half drops a real column
 * inside a transaction, asserts the check goes red and names it, and rolls back.
 *
 * Two halves, because they fail in different ways:
 *
 * 1. **The comparison**, tested with fixtures and no database at all. Always
 *    runs, including on a fresh clone with no Docker.
 * 2. **The query**, tested against a real Postgres and skipped loudly without
 *    one — following tests/db-schema.test.ts, which explains why the probe runs
 *    at module load rather than in `beforeAll`.
 *
 * See docs/plans/260827w-schema-drift-guard.md.
 */

import type { PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import {
  ACTUAL_SCHEMA_SQL,
  type ActualSchema,
  type DeclaredColumn,
  compareSchema,
  declaredTables,
  driftWarnings,
  readActualSchema,
} from "../src/db/schema-drift.js";
import { isLocalDatabaseUrl } from "../src/db/ssl.js";
import { loadEnvLocal } from "../src/env.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/* ------------------------------------------------------------------ */
/* 1. The comparison, with no database                                 */
/* ------------------------------------------------------------------ */

/** A column the database is happy to offer: nullable, so never "required". */
function col(table: string, column: string, extra: Partial<ActualSchema["columns"][0]> = {}) {
  return {
    table,
    column,
    nullable: true,
    hasDefault: false,
    generated: false,
    identity: false,
    selectable: true,
    ...extra,
  };
}

/** A column as the CODE declares it. Nullable and undefaulted unless said. */
function dc(name: string, extra: Partial<DeclaredColumn> = {}): DeclaredColumn {
  return { name, notNull: false, hasDefault: false, ...extra };
}

describe("compareSchema", () => {
  const declared = [{ table: "jobs", columns: [dc("id"), dc("profile")] }];

  it("is clean when the database has every declared column", () => {
    const report = compareSchema(declared, {
      schemaUsable: true,
      columns: [col("jobs", "id"), col("jobs", "profile")],
    });
    expect(report.missingOrInaccessible).toEqual([]);
    expect(driftWarnings(report)).toEqual([]);
  });

  it("names the column when the database lacks it — the 42703 that started this", () => {
    const report = compareSchema(declared, {
      schemaUsable: true,
      columns: [col("jobs", "id")],
    });
    expect(report.missingOrInaccessible).toEqual(["jobs.profile"]);
    expect(driftWarnings(report).join(" ")).toContain("jobs.profile");
  });

  it("ignores a harmless extra column, which a rollback creates routinely", () => {
    const report = compareSchema(declared, {
      schemaUsable: true,
      columns: [col("jobs", "id"), col("jobs", "profile"), col("jobs", "future_thing")],
    });
    expect(report.missingOrInaccessible).toEqual([]);
    expect(report.requiredButUndeclared).toEqual([]);
  });

  it("flags an extra column the database REQUIRES, which breaks inserts from older code", () => {
    /* GPT Sol's finding 5: "extra columns cannot break old code" is false. A
       NOT NULL column with no default cannot be omitted from an insert. */
    const report = compareSchema(declared, {
      schemaUsable: true,
      columns: [
        col("jobs", "id"),
        col("jobs", "profile"),
        col("jobs", "tenant_id", { nullable: false }),
      ],
    });
    expect(report.requiredButUndeclared).toEqual(["jobs.tenant_id"]);
    expect(driftWarnings(report).join(" ")).toContain("inserts will fail");
  });

  it("does not flag a required extra that has a default, or is generated, or is an identity", () => {
    const report = compareSchema(declared, {
      schemaUsable: true,
      columns: [
        col("jobs", "id"),
        col("jobs", "profile"),
        col("jobs", "a", { nullable: false, hasDefault: true }),
        col("jobs", "b", { nullable: false, generated: true }),
        col("jobs", "c", { nullable: false, identity: true }),
      ],
    });
    expect(report.requiredButUndeclared).toEqual([]);
  });

  it("ignores NOT NULL columns on tables this code does not declare", () => {
    const report = compareSchema(declared, {
      schemaUsable: true,
      columns: [col("jobs", "id"), col("jobs", "profile"), col("someone_else", "x", { nullable: false })],
    });
    expect(report.requiredButUndeclared).toEqual([]);
  });

  it("says so when the role cannot USAGE the schema, rather than crying total drift", () => {
    const report = compareSchema(declared, { schemaUsable: false, columns: [] });
    const warnings = driftWarnings(report).join(" ");
    expect(warnings).toContain("cannot USAGE");
    /* Both facts reported: the privilege gap AND what is missing under it. */
    expect(warnings).toContain("jobs.profile");
  });

  it("refuses to call an empty declaration clean — discovery breaking is not health", () => {
    const report = compareSchema([], { schemaUsable: true, columns: [] });
    expect(driftWarnings(report)[0]).toContain("discovery is broken");
  });

  it("goes red when the database default the code relies on is gone", () => {
    /* The false green GPT Sol found in the second review. `jobs.cancelling` is
       declared `.notNull().default(false)` and pg-jobs.ts `tryEnqueue` never
       sets it, so the DATABASE default is the only thing filling it in. The
       column still exists once the default is dropped, so existence alone
       reports health while every insert fails. */
    const withDefault = [{ table: "jobs", columns: [dc("cancelling", { notNull: true, hasDefault: true })] }];
    const clean = compareSchema(withDefault, {
      schemaUsable: true,
      columns: [col("jobs", "cancelling", { nullable: false, hasDefault: true })],
    });
    expect(clean.defaultLost).toEqual([]);

    const broken = compareSchema(withDefault, {
      schemaUsable: true,
      columns: [col("jobs", "cancelling", { nullable: false, hasDefault: false })],
    });
    expect(broken.missingOrInaccessible).toEqual([]);
    expect(broken.defaultLost).toEqual(["jobs.cancelling"]);
    expect(driftWarnings(broken).join(" ")).toContain("omit them will fail");
  });

  it("treats a column it cannot SELECT as inaccessible, not as present", () => {
    /* information_schema lists a column the role holds ANY privilege on, so an
       INSERT-only grant makes an unreadable column look healthy. Finding 3. */
    const report = compareSchema(declared, {
      schemaUsable: true,
      columns: [col("jobs", "id"), col("jobs", "profile", { selectable: false })],
    });
    expect(report.missingOrInaccessible).toEqual(["jobs.profile"]);
  });

  it("notices when code and database disagree about NOT NULL", () => {
    const report = compareSchema([{ table: "jobs", columns: [dc("id", { notNull: true })] }], {
      schemaUsable: true,
      columns: [col("jobs", "id", { nullable: true })],
    });
    expect(report.nullabilityMismatch).toEqual([
      "jobs.id (code says not null, database says nullable)",
    ]);
  });

  it("compares identifiers exactly, so a quoted camelCase column is not folded away", () => {
    const report = compareSchema([{ table: "t", columns: [dc("camelCase")] }], {
      schemaUsable: true,
      columns: [col("t", "camelcase")],
    });
    expect(report.missingOrInaccessible).toEqual(["t.camelCase"]);
  });
});

describe("declaredTables", () => {
  it("finds every table, keyed by DATABASE name rather than TypeScript name", () => {
    const declared = declaredTables();
    /* The exact set, not a count. A count of 18 also passes when one table is
       dropped and another added in the same change, which is precisely when
       somebody should be made to look. GPT Sol's second review, finding 4.

       `article_visibility_changes` arrived 2026-08-28 with the sharing switch
       (drizzle/0024, docs/plans/260827ai-public-read-only-access.md) — and this line
       going red is the mechanism working rather than a chore: a table added to
       the schema and not to a migration is exactly what the drift guard exists
       to make somebody look at. `checkpoints` arrived 2026-08-29 (drizzle/0028,
       docs/plans/260827aa-delete-the-importer.md § B3) and did exactly that: it went red
       here, and red in `is green on a fully migrated database`, before the
       migration had been applied anywhere. `realtime_sessions` arrived
       2026-09-02 (drizzle/20260902150952_realtime_sessions_and_usage.sql,
       docs/plans/260902g-cost-tracking-that-can-set-a-price.md § Stage 2A) and
       did the same. */
    expect(declared.map((d) => d.table)).toEqual([
      "ai_calls",
      "article_revisions",
      "article_visibility_changes",
      "articles",
      "block_identities",
      "chat_messages",
      "chat_threads",
      "checkpoints",
      "comments",
      "feedback",
      "glossary_lookups",
      "jobs",
      "queue_state",
      "raw_sources",
      "reader_profiles",
      "realtime_sessions",
      "referee_claims",
      "referee_criteria",
      "revision_blocks",
      "revision_step_runs",
      "search_runs",
      "uploads",
    ]);

    const revisions = declared.find((d) => d.table === "article_revisions");
    /* The trap GPT Sol caught: `getTableColumns()` keys by `rawSourceSha256`.
       Using those keys would report 21 of this table's 39 columns as missing
       from a perfectly healthy database. */
    const names = revisions?.columns.map((c) => c.name) ?? [];
    expect(names).toContain("raw_source_sha256");
    expect(names).not.toContain("rawSourceSha256");
  });

  it("includes the generated fts column, which is an ordinary column to this check", () => {
    const blocks = declaredTables().find((d) => d.table === "revision_blocks");
    expect(blocks?.columns.map((c) => c.name)).toContain("fts");
  });
});

/* ------------------------------------------------------------------ */
/* 2. The query, against a real Postgres                               */
/* ------------------------------------------------------------------ */

const url = process.env.DATABASE_URL;

/* Was on a **two-second** connect timeout, which is the drift the helper
   exists to stop. `keepPool` because the DDL half drops a real column through
   this pool and rolls it back. */
const { reachable, pool } = await pgReady({
  suite: "tests/db-schema-drift.test.ts",
  tables: ["spideryarn.jobs"],
  keepPool: true,
});

afterAll(async () => {
  await pool?.end();
});

const when = reachable ? describe : describe.skip;

when("against a real database", () => {
  /**
   * Run `body` in a transaction and always roll back.
   *
   * **And refuse outright to do it anywhere but a local database.** This block
   * runs `alter table … drop column`, and the whole value of the guard is that
   * it is trustworthy — a test harness that could drop a production column
   * under a stray `DATABASE_URL` is a worse bug than the one being guarded
   * against. `isLocalDatabaseUrl` is the same test db-migrate.ts gates on.
   */
  async function inRollback(body: (c: PoolClient) => Promise<void>): Promise<void> {
    if (!isLocalDatabaseUrl(url!)) {
      throw new Error("refusing to run DDL against a non-local DATABASE_URL");
    }
    const client = await pool!.connect();
    try {
      await client.query("begin");
      await body(client);
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
    }
  }

  async function reportFrom(c: PoolClient) {
    const rows = await c.query(ACTUAL_SCHEMA_SQL);
    return compareSchema(declaredTables(), readActualSchema(rows.rows));
  }

  it("is green on a fully migrated database", async () => {
    await inRollback(async (c) => {
      const report = await reportFrom(c);
      expect(report.schemaUsable).toBe(true);
      expect(report.declaredTables).toBe(22);
      expect(driftWarnings(report)).toEqual([]);
    });
  });

  it("goes RED when a column is dropped, and names it", async () => {
    await inRollback(async (c) => {
      await c.query('alter table spideryarn.jobs drop column "profile"');
      const report = await reportFrom(c);
      expect(report.missingOrInaccessible).toContain("jobs.profile");
      expect(driftWarnings(report).join(" ")).toContain("jobs.profile");
    });
  });

  it("goes RED when a required column is added that the code does not know about", async () => {
    await inRollback(async (c) => {
      /* Added WITH a default and then stripped of it, rather than added bare.
         A bare `not null` add fails outright once the table has any rows — as
         this one did the moment a job existed locally, which made the first
         version of this test pass for the incidental reason that the table
         happened to be empty. This reaches the shape being tested (`not null`,
         no default) whatever the table contains, and touches no rows. */
      await c.query("alter table spideryarn.jobs add column tenant_id text not null default 'x'");
      await c.query("alter table spideryarn.jobs alter column tenant_id drop default");
      const report = await reportFrom(c);
      expect(report.requiredButUndeclared).toContain("jobs.tenant_id");
    });
  });

  it("does not accept a VIEW standing where a table should be", async () => {
    await inRollback(async (c) => {
      /* The shape is right, the relation is wrong. `information_schema.columns`
         lists view columns too, so without the BASE TABLE join this passes. */
      await c.query("alter table spideryarn.jobs rename to jobs_real");
      await c.query("create view spideryarn.jobs as select * from spideryarn.jobs_real");
      const report = await reportFrom(c);
      /* EVERY declared jobs column, not merely one. "at least one is missing"
         would also pass if the BASE TABLE join excluded a single column for an
         unrelated reason — which is the assertion passing for the wrong reason.
         GPT Sol's second review, finding 4. */
      const expected = declaredTables()
        .find((d) => d.table === "jobs")!
        .columns.map((col) => `jobs.${col.name}`)
        .sort();
      expect(report.missingOrInaccessible).toEqual(expected);
    });
  });

  it("goes RED when a default the code relies on is dropped", async () => {
    await inRollback(async (c) => {
      /* jobs.cancelling is `.notNull().default(false)` and tryEnqueue omits it.
         The column survives this statement; only the default goes. */
      await c.query("alter table spideryarn.jobs alter column cancelling drop default");
      const report = await reportFrom(c);
      expect(report.missingOrInaccessible).toEqual([]);
      expect(report.defaultLost).toContain("jobs.cancelling");
    });
  });

  it("recovers cleanly — the rollback really did put the column back", async () => {
    await inRollback(async (c) => {
      const report = await reportFrom(c);
      expect(driftWarnings(report)).toEqual([]);
    });
  });
});
