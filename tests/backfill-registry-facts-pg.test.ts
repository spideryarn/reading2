/**
 * **The registry backfill against a real database** — what `applyPlan` writes
 * and what it refuses, and that `dryRun` cannot write
 * (src/backfill-registry-facts.ts).
 * docs/plans/261004h-…-and-the-registry-backfill.md § Stage 2, F1 and F2.
 *
 * The plan half, with no database, is tests/backfill-registry-facts.test.ts.
 *
 * ## How to watch each of these go red
 *
 * | mutation in src/backfill-registry-facts.ts | what fails |
 * |---|---|
 * | drop the `current !== row.revisionId` refusal | *refuses a revision that is no longer current*, and the race below it |
 * | drop `for update` on the article row | *waits for a publication in flight* |
 * | drop the unfinished-draft refusal | *refuses an article with an unfinished draft* |
 * | let a date be written when the other date column is set | *refuses a year where a day now exists* |
 * | `begin read only` → `begin`, or `rollback` → `commit` | the two `dryRun` cases |
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import {
  applyPlan,
  applySucceeded,
  backfillTargetOf,
  dryRun,
  PlanRefused,
  type PlanRow,
  type PlanWrite,
  type Queryable,
} from "../src/backfill-registry-facts.js";
import { loadEnvLocal } from "../src/env.js";
import { pgReady } from "./helpers/pg-ready.js";

/* Before `pgReady`, or the file fails for the wrong reason. */
loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/backfill-registry-facts-pg.test.ts",
  tables: ["spideryarn.articles", "spideryarn.article_revisions"],
  columns: [{ table: "spideryarn.article_revisions", column: "published_year" }],
  keepPool: true,
  max: 3,
});
if (!pool) throw new Error("pgReady kept no pool");

const TARGET = backfillTargetOf(process.env.DATABASE_URL as string);
const PREFIX = "test-backfill-registry-";

let db: PoolClient;

async function cleanUp(): Promise<void> {
  await pool!.query("update spideryarn.articles set current_revision_id = null where slug like $1", [`${PREFIX}%`]);
  await pool!.query("delete from spideryarn.articles where slug like $1", [`${PREFIX}%`]);
}

beforeEach(async () => {
  await cleanUp();
  db = await pool.connect();
});
afterEach(async () => {
  /* A test that failed mid-transaction must not hand a poisoned session back. */
  await db.query("rollback").catch(() => {});
  db.release();
  await cleanUp();
});
afterAll(async () => {
  await pool.end();
});

interface Held {
  doi: string | null;
  journal: string | null;
  published_at: string | null;
  published_year: number | null;
}

async function revisionFor(articleId: string, held: Partial<Held> = {}, status = "published"): Promise<string> {
  const made = await pool!.query<{ id: string }>(
    `insert into spideryarn.article_revisions (article_id, status, title, byline, doi, journal, published_at, published_year)
     values ($1, $2, 'A Piece Written For The Backfill', 'Nobody', $3, $4, $5, $6) returning id`,
    [articleId, status, held.doi ?? null, held.journal ?? null, held.published_at ?? null, held.published_year ?? null],
  );
  return made.rows[0]!.id;
}

/** An article with one published revision, which is its current one. */
async function given(name: string, held: Partial<Held> = {}): Promise<{ slug: string; articleId: string; revisionId: string }> {
  const slug = `${PREFIX}${name}`;
  const article = await pool!.query<{ id: string }>(
    "insert into spideryarn.articles (owner_id, slug) values ($1, $2) returning id",
    [ADMIN_USER_ID_LOCAL, slug],
  );
  const articleId = article.rows[0]!.id;
  const revisionId = await revisionFor(articleId, held);
  await pool!.query("update spideryarn.articles set current_revision_id = $1 where id = $2", [revisionId, articleId]);
  return { slug, articleId, revisionId };
}

async function held(revisionId: string): Promise<Held> {
  const found = await pool!.query<Held>(
    "select doi, journal, published_at, published_year from spideryarn.article_revisions where id = $1",
    [revisionId],
  );
  return found.rows[0]!;
}

function row(a: { slug: string; articleId: string; revisionId: string }, write: PlanWrite): PlanRow {
  return {
    ...a,
    title: "A Piece Written For The Backfill",
    sourceKind: "html",
    outcome: "agreed",
    candidates: [],
    asked: [],
    write,
    hasTimeline: false,
    hasDraft: false,
  };
}

const FACTS = { doi: "10.1038/nn.4304", journal: "Nature Neuroscience", published_at: "2016-05-16" } as const;
const NOTHING: Held = { doi: null, journal: null, published_at: null, published_year: null };

describe("applyPlan", () => {
  it("fills the empty columns the plan names", async () => {
    const a = await given("fills");
    const result = await applyPlan(db, { target: TARGET, rows: [row(a, FACTS)] }, TARGET);
    expect(result).toMatchObject({ written: 1, already: 0, refused: 0 });
    expect(result.rows).toEqual([{ slug: a.slug, outcome: "written", columns: ["doi", "journal", "published_at"] }]);
    expect(await held(a.revisionId)).toEqual({ ...NOTHING, ...FACTS });
    expect(applySucceeded(result)).toBe(true);
  });

  it("fills a year", async () => {
    const a = await given("year");
    await applyPlan(db, { target: TARGET, rows: [row(a, { published_year: 2011 })] }, TARGET);
    expect(await held(a.revisionId)).toEqual({ ...NOTHING, published_year: 2011 });
  });

  it("leaves a column that holds something else alone, and writes nothing else on that row", async () => {
    const a = await given("non-null", { journal: "The Publisher's Own Name" });
    const result = await applyPlan(db, { target: TARGET, rows: [row(a, FACTS)] }, TARGET);
    expect(result.rows).toEqual([{ slug: a.slug, outcome: "refused", reason: "something-else-there", columns: ["journal"] }]);
    expect(await held(a.revisionId)).toEqual({ ...NOTHING, journal: "The Publisher's Own Name" });
    expect(applySucceeded(result)).toBe(false);
  });

  it("a second run reports `already` and changes nothing", async () => {
    const a = await given("twice");
    const plan = { target: TARGET, rows: [row(a, FACTS)] };
    await applyPlan(db, plan, TARGET);
    const before = await held(a.revisionId);
    const again = await applyPlan(db, plan, TARGET);
    expect(again).toMatchObject({ written: 0, already: 1, refused: 0 });
    expect(await held(a.revisionId)).toEqual(before);
    expect(applySucceeded(again)).toBe(true);
  });

  it("refuses a plan made against another database, before writing anything", async () => {
    const a = await given("other-target");
    const elsewhere = { ...TARGET, database: `${TARGET.database}_elsewhere` };
    await expect(applyPlan(db, { target: elsewhere, rows: [row(a, FACTS)] }, TARGET)).rejects.toThrow(PlanRefused);
    expect(await held(a.revisionId)).toEqual(NOTHING);
  });

  it("refuses a revision that is no longer the article's current one", async () => {
    const a = await given("republished");
    const newer = await revisionFor(a.articleId);
    await pool.query("update spideryarn.articles set current_revision_id = $1 where id = $2", [newer, a.articleId]);
    const result = await applyPlan(db, { target: TARGET, rows: [row(a, FACTS)] }, TARGET);
    expect(result.rows).toEqual([{ slug: a.slug, outcome: "refused", reason: "revision-not-current" }]);
    expect(await held(a.revisionId)).toEqual(NOTHING);
    expect(await held(newer)).toEqual(NOTHING);
  });

  it("waits for a publication in flight, and then refuses the revision it replaced", async () => {
    const a = await given("race");
    const newer = await revisionFor(a.articleId);
    /* A publication: the article row locked, the pointer moved, not yet committed. */
    const publisher = await pool.connect();
    try {
      await publisher.query("begin");
      await publisher.query("select id from spideryarn.articles where id = $1 for update", [a.articleId]);
      await publisher.query("update spideryarn.articles set current_revision_id = $1 where id = $2", [newer, a.articleId]);

      let settled = false;
      const applying = applyPlan(db, { target: TARGET, rows: [row(a, FACTS)] }, TARGET).finally(() => {
        settled = true;
      });
      await new Promise((done) => setTimeout(done, 400));
      /* Without the lock it would have read the old pointer and written by now. */
      expect(settled).toBe(false);
      await publisher.query("commit");

      const result = await applying;
      expect(result.rows).toEqual([{ slug: a.slug, outcome: "refused", reason: "revision-not-current" }]);
    } finally {
      await publisher.query("rollback").catch(() => {});
      publisher.release();
    }
    expect(await held(a.revisionId)).toEqual(NOTHING);
  });

  it("refuses an article with an unfinished draft, which would publish later without the facts", async () => {
    const a = await given("draft");
    await revisionFor(a.articleId, {}, "draft");
    const result = await applyPlan(db, { target: TARGET, rows: [row(a, FACTS)] }, TARGET);
    expect(result.rows).toEqual([{ slug: a.slug, outcome: "refused", reason: "unfinished-draft" }]);
    expect(await held(a.revisionId)).toEqual(NOTHING);
  });

  it("a failed revision is not an unfinished draft", async () => {
    const a = await given("failed-draft");
    await revisionFor(a.articleId, {}, "failed");
    const result = await applyPlan(db, { target: TARGET, rows: [row(a, FACTS)] }, TARGET);
    expect(result.written).toBe(1);
  });

  it("refuses a year where a day now exists", async () => {
    const a = await given("day-exists", { published_at: "2011-03-04" });
    const result = await applyPlan(db, { target: TARGET, rows: [row(a, { published_year: 2011 })] }, TARGET);
    expect(result.rows).toEqual([{ slug: a.slug, outcome: "refused", reason: "something-else-there", columns: ["published_year"] }]);
    expect(await held(a.revisionId)).toEqual({ ...NOTHING, published_at: "2011-03-04" });
  });

  it("refuses a day where a year now exists", async () => {
    const a = await given("year-exists", { published_year: 2011 });
    const result = await applyPlan(db, { target: TARGET, rows: [row(a, { published_at: "2011-03-04" })] }, TARGET);
    expect(result.rows).toEqual([{ slug: a.slug, outcome: "refused", reason: "something-else-there", columns: ["published_at"] }]);
    expect(await held(a.revisionId)).toEqual({ ...NOTHING, published_year: 2011 });
  });

  it("one article's refusal does not stop the others, and rows with nothing to write are passed over", async () => {
    const good = await given("mixed-good");
    const drafted = await given("mixed-draft");
    const empty = await given("mixed-empty");
    await revisionFor(drafted.articleId, {}, "draft");
    const result = await applyPlan(
      db,
      { target: TARGET, rows: [row(drafted, FACTS), row(empty, {}), row(good, FACTS)] },
      TARGET,
    );
    expect(result).toMatchObject({ written: 1, already: 0, refused: 1 });
    expect(result.rows.map((r) => r.slug)).toEqual([drafted.slug, good.slug]);
    expect(await held(good.revisionId)).toEqual({ ...NOTHING, ...FACTS });
  });

  it("an article deleted since the plan is refused by name", async () => {
    const a = await given("gone");
    await cleanUp();
    const result = await applyPlan(db, { target: TARGET, rows: [row(a, FACTS)] }, TARGET);
    expect(result.rows).toEqual([{ slug: a.slug, outcome: "refused", reason: "article-gone" }]);
    expect(applySucceeded(result)).toBe(false);
  });

  it("refuses a plan with a year on a database that has no year column yet, and says to deploy", async () => {
    const a = await given("no-column");
    /* Production before the deploy: the one question about the column answers no. */
    const before: Queryable = {
      query: (text, values) =>
        text.includes("information_schema.columns")
          ? Promise.resolve({ rows: [], rowCount: 0 })
          : db.query(text, values as unknown[]),
    };
    await expect(
      applyPlan(before, { target: TARGET, rows: [row(a, { doi: FACTS.doi, published_year: 2011 })] }, TARGET),
    ).rejects.toThrow(/Deploy first/);
    expect(await held(a.revisionId)).toEqual(NOTHING);
  });
});

describe("dryRun", () => {
  /** `db`, with every statement written down. */
  function recorded(): { db: Queryable; statements: string[] } {
    const statements: string[] = [];
    return {
      statements,
      db: {
        query: (text, values) => {
          statements.push(text.trim().split(/\s+/).slice(0, 3).join(" ").toLowerCase());
          return db.query(text, values as unknown[]);
        },
      },
    };
  }

  const mine = (r: { slug: string }) => r.slug.startsWith(PREFIX);

  it("reads the current revision, its draft and its Timeline, and plans from them", async () => {
    const plain = await given("dry-plain");
    const busy = await given("dry-busy", { journal: "Kept" });
    await revisionFor(busy.articleId, {}, "draft");
    await pool.query(`update spideryarn.article_revisions set timeline = '{"events":[]}'::jsonb where id = $1`, [busy.revisionId]);

    const seen: { slug: string; revisionId: string }[] = [];
    const plan = await dryRun(db, TARGET, {
      only: mine,
      readSource: async (r) => {
        seen.push({ slug: r.slug, revisionId: r.revisionId });
        return null;
      },
      lookup: async () => ({ kind: "not-found" }),
    });
    expect(seen).toEqual([
      { slug: busy.slug, revisionId: busy.revisionId },
      { slug: plain.slug, revisionId: plain.revisionId },
    ]);
    expect(plan.publishedYearColumn).toBe(true);
    expect(plan.target).toEqual(TARGET);
    expect(plan.rows.map((r) => [r.slug, r.outcome, r.hasDraft, r.hasTimeline])).toEqual([
      [busy.slug, "no-source", true, true],
      [plain.slug, "no-source", false, false],
    ]);
  });

  it("opens a read-only transaction first, never commits, and rolls back last", async () => {
    await given("dry-statements");
    const { db: watched, statements } = recorded();
    await dryRun(watched, TARGET, { only: mine, readSource: async () => null, lookup: async () => ({ kind: "not-found" }) });
    expect(statements[0]).toBe("begin read only");
    expect(statements.at(-1)).toBe("rollback");
    expect(statements.filter((s) => s.startsWith("commit"))).toEqual([]);
    expect(statements.filter((s) => s.startsWith("begin"))).toEqual(["begin read only"]);
  });

  it("cannot write: Postgres refuses a write made from inside it", async () => {
    const a = await given("dry-write");
    let refusal: unknown;
    await dryRun(db, TARGET, {
      only: mine,
      readSource: async (r) => {
        /* A savepoint, so the refusal does not abort the transaction the dry run is reading in. */
        await db.query("savepoint attempt");
        refusal = await db
          .query("update spideryarn.article_revisions set journal = 'Written By A Dry Run' where id = $1", [r.revisionId])
          .then(() => null, (err: unknown) => err);
        await db.query("rollback to savepoint attempt");
        return null;
      },
      lookup: async () => ({ kind: "not-found" }),
    });
    /* 25006: read_only_sql_transaction. */
    expect(refusal).toMatchObject({ code: "25006" });
    expect(await held(a.revisionId)).toEqual(NOTHING);
  });

  it("still plans on a database with no year column, and says the column is missing", async () => {
    await given("dry-no-column");
    const before: Queryable = {
      query: (text, values) =>
        text.includes("information_schema.columns")
          ? Promise.resolve({ rows: [], rowCount: 0 })
          : db.query(text, values as unknown[]),
    };
    const statements: string[] = [];
    const watched: Queryable = {
      query: (text, values) => {
        statements.push(text);
        return before.query(text, values);
      },
    };
    const plan = await dryRun(watched, TARGET, { only: mine, readSource: async () => null, lookup: async () => ({ kind: "not-found" }) });
    expect(plan.publishedYearColumn).toBe(false);
    expect(plan.rows).toHaveLength(1);
    /* The read did not name the column that is not there. */
    expect(statements.some((s) => s.includes("r.published_year"))).toBe(false);
  });
});
