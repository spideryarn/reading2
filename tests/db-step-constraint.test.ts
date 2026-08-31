/**
 * **`revision_step_runs_step` has to list every `StepName`, and it has been
 * forgotten three times.**
 *
 * `'summary'` the first time, `'assets'` in `0029_assets.sql`, and `'sketch'`
 * would have been the third: `drizzle-kit generate` diffs `src/db/schema.ts`,
 * knows nothing about a CHECK expression, and produced a migration that was one
 * `ADD COLUMN` and nothing else. Each of those three migrations carries a
 * comment warning about the previous one, which is the clearest possible sign
 * that a comment is not the mechanism.
 *
 * The failure is far from the cause and does not look like this. A step run
 * recorded for a step the constraint does not list is rejected at the insert, so
 * what a person sees is a job dying inside `revision_step_runs` with a
 * `23514 check_violation` — nothing in that message names the migration, the
 * schema or the step list.
 *
 * **This is a static check on purpose.** The obvious version asks Postgres for
 * `pg_get_constraintdef` and compares, and it is the wrong instrument twice
 * over: it needs a database, so it skips itself on a laptop with Supabase down
 * (docs/reusable/silent-success.md, and this repo's suite is not hermetic), and
 * it can only fail *after* someone has run the migration — by which point the
 * cheap moment to notice has gone. Reading the migrations answers the question
 * the moment the file is written, which is when a person can still fix it in
 * one line.
 *
 * What it deliberately does NOT check is that the database matches. That is
 * `tests/db-schema.test.ts`'s job and it needs a connection to do it.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STEP_ORDER } from "../src/pipeline.js";

const DRIZZLE = path.resolve(import.meta.dirname, "..", "drizzle");
const CONSTRAINT = "revision_step_runs_step";

/** Every `.sql` migration, oldest first — the numeric prefix is the order. */
function migrations(): { file: string; sql: string }[] {
  return readdirSync(DRIZZLE)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(path.join(DRIZZLE, file), "utf-8") }));
}

/**
 * The step names inside the **last** `ADD CONSTRAINT … CHECK (… in (…))` for
 * this constraint, which is the one the database ends up with.
 *
 * Anchored on `ADD CONSTRAINT` rather than on the constraint name alone,
 * because every one of these migrations also contains a `DROP CONSTRAINT` line
 * naming it — and a match on the drop would find no list at all and report the
 * constraint as empty, which is a different bug wearing this one's clothes.
 */
function declaredSteps(): { file: string; steps: string[] } | null {
  let found: { file: string; steps: string[] } | null = null;
  for (const { file, sql } of migrations()) {
    const re = new RegExp(
      `ADD CONSTRAINT "${CONSTRAINT}"[\\s\\S]*?in \\(([^)]*)\\)`,
      "g",
    );
    let m: RegExpExecArray | null = re.exec(sql);
    while (m) {
      const steps = (m[1] ?? "")
        .split(",")
        .map((s) => s.trim().replace(/^'|'$/g, ""))
        .filter(Boolean);
      found = { file, steps };
      m = re.exec(sql);
    }
  }
  return found;
}

describe("the revision_step_runs step constraint", () => {
  it("is declared by some migration at all", () => {
    // If this ever goes red, the regex above stopped matching rather than the
    // constraint disappearing — which would make every assertion below vacuous.
    expect(declaredSteps()).not.toBeNull();
  });

  it("lists exactly the steps the pipeline can run", () => {
    const found = declaredSteps();
    expect(found).not.toBeNull();
    const declared = [...(found as { steps: string[] }).steps].sort();
    const real = [...STEP_ORDER].sort();

    /* Both directions, and the second one matters as much as the first. A step
       missing from the constraint kills a job at the insert; a name in the
       constraint that is no longer a step is a rule about something that does
       not exist, which is how a list rots into being unreadable.

       **Taking a name out has a trap the other direction does not**, and
       `'summary'` walked into it on 2026-08-31: Postgres validates a re-added
       CHECK against the rows already in the table, so the migration has to
       delete that step's runs before it narrows the constraint.
       `drizzle/0036_drop_summary_column.sql` does, in that order. */
    expect(declared).toEqual(real);
  });

  it("names the migration that would have to change, when it is wrong", () => {
    // Not an assertion about behaviour — an assertion about the *message*. The
    // whole value of this test is that a person who trips it can act on it
    // without reading three migrations first, so the file name has to be here.
    const found = declaredSteps();
    expect((found as { file: string }).file).toMatch(/^\d{4}_.*\.sql$/);
  });
});

describe("the migration that last set it", () => {
  it("drops the constraint before adding it, because Postgres has no ALTER for a check", () => {
    const found = declaredSteps() as { file: string };
    const sql = readFileSync(path.join(DRIZZLE, found.file), "utf-8");
    const drop = sql.indexOf(`DROP CONSTRAINT "${CONSTRAINT}"`);
    const add = sql.indexOf(`ADD CONSTRAINT "${CONSTRAINT}"`);
    /* An `ADD` with no `DROP` before it fails on any database that already has
       the constraint — which is every database except a brand new one, so it
       passes on a fresh `db:reset` and fails on the machines that matter. */
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(drop).toBeLessThan(add);
  });
});
