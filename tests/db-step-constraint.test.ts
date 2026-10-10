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
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readJournal } from "../scripts/migration-ledger.js";
import { STEP_ORDER } from "../src/pipeline.js";
import { RETIRED_STEPS } from "../src/step-order.js";

/**
 * **Old step names the CHECK still admits, on purpose, and until when.**
 *
 * A rename done by expand and contract (plan
 * docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md § The
 * database) keeps the old name's rows through the deploy, mirrored onto the
 * new name's by a trigger, so the pre-rename code still finds its runs. The
 * CHECK has to hold both spellings for as long as that lasts. Each entry names
 * what removes it; the contract migration deletes the old rows **before** it
 * narrows the CHECK, and takes the entry out of this table in the same change.
 * Every key must be a retired step (`RETIRED_STEPS`), so this cannot become a
 * place to park a name nobody runs.
 */
const ADMITTED_DURING_EXPAND: Readonly<Record<string, string>> = {
  citations: "Bibliography's step until 2026-10-09; removed by plan 261009w's contract migration",
};

const DRIZZLE = path.resolve(import.meta.dirname, "..", "drizzle");
const CONSTRAINT = "revision_step_runs_step";
const SKIM_MIGRATION = path.join(DRIZZLE, "20261001224759_skim.sql");
const STRUCTURE_MIGRATION = path.join(DRIZZLE, "20261002140803_structure_step.sql");

/**
 * Every `.sql` migration, in the order it runs — **journal order, which is the
 * only order there is.**
 *
 * This used to sort filenames, on the reasoning that the four-digit prefix is
 * the order. It very nearly is, and stops being so on two separate days:
 * `drizzle.config.ts` now mints `migrations.prefix: "timestamp"`, so the folder
 * holds `0051_…` next to `2026…_…` — which happens to sort correctly, and
 * happening to is not a property. And journal order is array order after a
 * merge, which is whatever the person resolving the conflict wrote, and is not
 * sorted at all: `0035` sits before `0036` and is stamped later.
 *
 * The journal is what `migrate()` reads (`node_modules/drizzle-orm/migrator.cjs`),
 * so asking it is not a proxy for the answer, it is the answer. A `.sql` the
 * journal does not name never runs, and `tests/migration-journal.test.ts` is
 * what refuses to let one exist.
 */
function migrations(): { file: string; sql: string }[] {
  return readJournal(DRIZZLE)
    .map((e) => `${e.tag}.sql`)
    .filter((file) => existsSync(path.join(DRIZZLE, file)))
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
    /* The steps, plus the old names an expand and contract rename still
       admits — `ADMITTED_DURING_EXPAND` below, which says when each goes. */
    const real = [...STEP_ORDER, ...Object.keys(ADMITTED_DURING_EXPAND)].sort();

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

  it("admits an old name only while it is a retired step's, never a step's own", () => {
    for (const name of Object.keys(ADMITTED_DURING_EXPAND)) {
      expect(Object.hasOwn(RETIRED_STEPS, name), `${name} is not in RETIRED_STEPS`).toBe(true);
      expect((STEP_ORDER as readonly string[]).includes(name), `${name} is a step again`).toBe(false);
    }
  });

  it("names the migration that would have to change, when it is wrong", () => {
    // Not an assertion about behaviour — an assertion about the *message*. The
    // whole value of this test is that a person who trips it can act on it
    // without reading three migrations first, so the file name has to be here.
    // Not `/^\d{4}_/`: since drizzle.config.ts moved to timestamp prefixes the
    // folder holds both shapes, and what makes the message actionable is that
    // the name points at a file somebody can open — not what it starts with.
    const found = declaredSteps();
    const file = (found as { file: string }).file;
    expect(file).toMatch(/\.sql$/);
    expect(existsSync(path.join(DRIZZLE, file))).toBe(true);
  });
});

describe("the migration that last set it", () => {
  it("keeps the structure drain guard stable until its rewrites commit", () => {
    const sql = readFileSync(STRUCTURE_MIGRATION, "utf-8").replace(/--[^\n]*/g, "");
    // NOWAIT on all three tables also avoids holding jobs while waiting for a
    // worker transaction that has already locked a checkpoint or step-run row.
    const lock = sql.search(
      /LOCK TABLE "spideryarn"\."jobs",\s*"spideryarn"\."checkpoints",\s*"spideryarn"\."revision_step_runs"\s+IN ACCESS EXCLUSIVE MODE NOWAIT/i,
    );
    const guard = sql.indexOf("SELECT count(*) INTO live");
    const drop = sql.indexOf('DROP CONSTRAINT "checkpoints_namespace"');
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(guard).toBeGreaterThan(lock);
    expect(drop).toBeGreaterThan(guard);
  });

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

  it("refuses a job that already contains both step spellings before rewriting either array", () => {
    const sql = readFileSync(SKIM_MIGRATION, "utf-8");
    const rewrite = sql.indexOf('UPDATE "spideryarn"."jobs" SET "steps"');
    const mixedSteps = sql.search(
      /WHERE "steps" @> '\[\{"name":"trajectory"\}\]'::jsonb\s+AND "steps" @> '\[\{"name":"skim"\}\]'::jsonb/,
    );
    const mixedReset = sql.search(
      /WHERE "reset"->'regenerate' @> '\["trajectory"\]'::jsonb\s+AND "reset"->'regenerate' @> '\["skim"\]'::jsonb/,
    );

    /* New jobs are de-duplicated by `orderSteps`. Replacing the old spelling
       blindly in a mixed row would break that invariant, while choosing either
       row's status would silently discard real progress. The migration must
       stop and name the anomalous row instead. The reset list has the same
       uniqueness contract. */
    expect(mixedSteps).toBeGreaterThanOrEqual(0);
    expect(mixedReset).toBeGreaterThanOrEqual(0);
    expect(mixedSteps).toBeLessThan(rewrite);
    expect(mixedReset).toBeLessThan(rewrite);
  });
});
