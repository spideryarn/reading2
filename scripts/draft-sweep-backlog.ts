/**
 * Clear the abandoned drafts that built up before the sweep was allowed to
 * delete — **across the whole library, once, and a dry run unless told
 * otherwise**.
 *
 *     npx tsx scripts/draft-sweep-backlog.ts                   # local, dry run
 *     npx tsx scripts/draft-sweep-backlog.ts --prod            # production, dry run (read-only)
 *     npx tsx scripts/draft-sweep-backlog.ts --prod --delete   # production, for real
 *
 * The on-demand sweep (`sweepAbandonedDrafts`, src/store/pg-revisions.ts) takes
 * one article's abandoned drafts when that article next starts a job, so an
 * article nobody touches again keeps its drafts for ever. That is the design
 * (docs/project/cron-scheduler.md), and this is the one-off that goes with
 * Greg's approval of the first deletion, 2026-10-04: *"Q-draft-sweep yes"*.
 * docs/plans/261005j-draft-sweep-deletes-and-the-count-mode-goes.md.
 *
 * **The dry run cannot write.** It runs inside `begin read only` and checks
 * `transaction_read_only` before it reads anything, as
 * scripts/draft-sweep-inventory.ts does. Never a `SET`: production is reached
 * through the transaction pooler, where a `SET` outlives the connection and
 * lands on a reader's next request (docs/project/database.md § Which host).
 *
 * **It proves its list before anything acts on it.** The candidates come from
 * `abandonedDraftCondition`, the sweep's own predicate. A second query, written
 * out by hand and sharing nothing with it, then asks of those exact ids: is any
 * published, any article's current revision, named by any job, younger than the
 * threshold, or the base another surviving revision was copied from? Every
 * answer has to be zero, and the number of rows it looked at has to be the
 * number of candidates. `--delete` refuses to start otherwise.
 *
 * **`--delete` is the app's own function in a loop**, so the lock-and-recheck
 * that protects a draft somebody claims mid-sweep is the same code a reader's
 * job runs: per article, take the article row `for update` (as
 * `openOrBeginJobDraft` does before it sweeps), delete one batch, commit,
 * reprove the locked batch, and sweep only those exact ids. The finite surveyed
 * list bounds the work even while new candidates arrive. What it reports is
 * the `DELETE`'s own row count. A lineage dependency outside a batch refuses
 * that batch; any earlier batches have already committed.
 *
 * **It prints no article text and no slugs** — slugs are made from titles.
 *
 * `console.log`, not `log()` — this is a CLI. CLAUDE.md § Writing code.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

import type { Db } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { articleRevisions, articles, revisionBlocks } from "../src/db/schema.js";
import { sslDecisionFor, withoutPassword } from "../src/db/ssl.js";
import { parseEnvFile, readEnvProd } from "../src/env.js";
import { isMain } from "../src/is-main.js";
import { READ_COMMITTED } from "../src/store/isolation.js";
import {
  ABANDONED_DRAFT_MS,
  DRAFT_SWEEP_BATCH,
  abandonedDraftCondition,
  sweepAbandonedDrafts,
} from "../src/store/pg-revisions.js";

export interface BacklogArticle {
  readonly articleId: string;
  readonly revisionIds: readonly string[];
  readonly revisions: number;
  readonly blocks: number;
  readonly bytes: number;
}

/** What the hand-written second query found among the candidate ids. All but `seen` must be zero. */
export interface BacklogProof {
  /** How many of the candidate ids the second query found at all. Must equal the candidate count. */
  readonly seen: number;
  readonly notDraftOrFailed: number;
  readonly current: number;
  readonly jobNamed: number;
  readonly young: number;
  /** Candidates that a revision which would *survive* was copied from. */
  readonly baseOfASurvivor: number;
}

export interface BacklogSurvey {
  readonly articles: readonly BacklogArticle[];
  readonly revisions: number;
  readonly failed: number;
  readonly draft: number;
  readonly blocks: number;
  readonly bytes: number;
  readonly proof: BacklogProof;
  /** Whether the list is safe to act on: every protection count zero, and every candidate seen. */
  readonly proven: boolean;
  readonly role: string;
  /** Whether the connected role may `DELETE` from `article_revisions` at all. */
  readonly mayDelete: boolean;
}

const num = (v: unknown) => Number(v ?? 0);

/**
 * The whole library's abandoned drafts, and the proof that none is protected.
 * Read-only: it opens its own `begin read only` and refuses to go on if the
 * transaction is anything else.
 */
export async function surveyDraftBacklog(db: Db): Promise<BacklogSurvey> {
  return await db.transaction(
    async (tx) => {
      const [ro] = (await tx.execute(sql`select current_setting('transaction_read_only') as ro`))
        .rows as { ro: string }[];
      if (ro?.ro !== "on") {
        throw new Error(`refusing to go on: the transaction is not read-only (${ro?.ro})`);
      }

      const [who] = (
        await tx.execute(sql`
          select current_user::text as role,
            has_table_privilege(current_user, 'spideryarn.article_revisions', 'DELETE') as may_delete`)
      ).rows as { role: string; may_delete: boolean }[];

      const candidates = await tx
        .select({
          id: articleRevisions.id,
          articleId: articleRevisions.articleId,
          status: articleRevisions.status,
          blocks: sql<number>`(select count(*) from ${revisionBlocks} where ${revisionBlocks.revisionId} = ${articleRevisions.id})`,
          bytes: sql<number>`coalesce((select sum(pg_column_size(rb.*)) from ${revisionBlocks} rb where rb.revision_id = ${articleRevisions.id}), 0)`,
        })
        .from(articleRevisions)
        .where(abandonedDraftCondition(ABANDONED_DRAFT_MS))
        .orderBy(asc(articleRevisions.createdAt), asc(articleRevisions.id));

      const byArticle = new Map<string, { revisionIds: string[]; revisions: number; blocks: number; bytes: number }>();
      for (const row of candidates) {
        const sum = byArticle.get(row.articleId) ?? { revisionIds: [], revisions: 0, blocks: 0, bytes: 0 };
        byArticle.set(row.articleId, {
          revisionIds: [...sum.revisionIds, row.id],
          revisions: sum.revisions + 1,
          blocks: sum.blocks + num(row.blocks),
          bytes: sum.bytes + num(row.bytes),
        });
      }
      const perArticle = [...byArticle]
        .map(([articleId, sum]) => ({ articleId, ...sum }))
        .sort((x, y) => y.revisions - x.revisions || x.articleId.localeCompare(y.articleId));

      const ids = candidates.map((row) => row.id);
      const proof = await proveUnprotected(tx, ids);
      const proven = proofIsClean(proof, ids.length);

      return {
        articles: perArticle,
        revisions: ids.length,
        failed: candidates.filter((row) => row.status === "failed").length,
        draft: candidates.filter((row) => row.status === "draft").length,
        blocks: perArticle.reduce((n, row) => n + row.blocks, 0),
        bytes: perArticle.reduce((n, row) => n + row.bytes, 0),
        proof,
        proven,
        role: who?.role ?? "(unknown)",
        mayDelete: who?.may_delete === true,
      };
    },
    { accessMode: "read only" },
  );
}

const NOTHING_SEEN: BacklogProof = {
  seen: 0,
  notDraftOrFailed: 0,
  current: 0,
  jobNamed: 0,
  young: 0,
  baseOfASurvivor: 0,
};

function proofIsClean(proof: BacklogProof, expected: number): boolean {
  return proof.seen === expected && proof.notDraftOrFailed === 0 && proof.current === 0 &&
    proof.jobNamed === 0 && proof.young === 0 && proof.baseOfASurvivor === 0;
}

/**
 * **The second join.** Table and column names written out, the threshold as a
 * literal interval, nothing imported from the predicate it is checking — so the
 * two can disagree, which is the only way agreeing means anything.
 * docs/reusable/silent-success.md.
 */
export async function proveUnprotected(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  ids: readonly string[],
): Promise<BacklogProof> {
  if (ids.length === 0) return NOTHING_SEEN;
  const list = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const [row] = (
    await tx.execute(sql`
      select
        count(*)::int as seen,
        count(*) filter (where r.status not in ('draft', 'failed'))::int as not_draft_or_failed,
        count(*) filter (where exists (
          select 1 from spideryarn.articles a where a.current_revision_id = r.id))::int as current,
        count(*) filter (where exists (
          select 1 from spideryarn.jobs j where j.draft_revision_id = r.id))::int as job_named,
        count(*) filter (where r.created_at >= now() - interval '6 hours')::int as young,
        count(*) filter (where exists (
          select 1 from spideryarn.article_revisions c
          where c.based_on_revision_id = r.id and c.id not in (${list})))::int as base_of_a_survivor
      from spideryarn.article_revisions r
      where r.id in (${list})`)
  ).rows as Record<string, unknown>[];
  return {
    seen: num(row?.seen),
    notDraftOrFailed: num(row?.not_draft_or_failed),
    current: num(row?.current),
    jobNamed: num(row?.job_named),
    young: num(row?.young),
    baseOfASurvivor: num(row?.base_of_a_survivor),
  };
}

export interface BacklogDeletion {
  readonly articleId: string;
  readonly deleted: number;
}

class BacklogSafetyError extends Error {}

/**
 * Delete only the survey's exact revisions, a finite batch per transaction.
 *
 * Recheck the independent proof on each eligible, locked batch. In particular,
 * a surveyed child skipped due to a lock is a survivor for this batch. Its
 * base must not be deleted and have its lineage silently set null. Dependencies
 * across batches fail closed rather than trying to order arbitrary lineage.
 */
export async function deleteDraftBacklog(
  db: Db,
  survey: BacklogSurvey,
): Promise<BacklogDeletion[]> {
  if (!survey.proven || !proofIsClean(survey.proof, survey.revisions)) {
    throw new BacklogSafetyError("refusing deletion: the survey is not proven");
  }
  const done: BacklogDeletion[] = [];
  for (const { articleId, revisionIds } of survey.articles) {
    let deleted = 0;
    for (let offset = 0; offset < revisionIds.length; offset += DRAFT_SWEEP_BATCH) {
      const batch = revisionIds.slice(offset, offset + DRAFT_SWEEP_BATCH);
      const swept = await db.transaction(async (tx) => {
        /* The article lock the app's caller holds while it sweeps: it is what
           stops a publication moving `current_revision_id` mid-decision. */
        await tx
          .select({ id: articles.id })
          .from(articles)
          .where(eq(articles.id, articleId))
          .for("update");
        const eligible = (ids: readonly string[]) => and(
          eq(articleRevisions.articleId, articleId),
          inArray(articleRevisions.id, [...ids]),
          abandonedDraftCondition(ABANDONED_DRAFT_MS),
        );
        const locked = await tx.select({ id: articleRevisions.id }).from(articleRevisions)
          .where(eligible(batch)).for("update", { skipLocked: true });
        if (locked.length === 0) return { deleted: 0 };
        // A fresh snapshot after locking: a protection may have just committed.
        const rows = await tx.select({ id: articleRevisions.id }).from(articleRevisions)
          .where(eligible(locked.map((row) => row.id)));
        const ids = rows.map((row) => row.id);
        const proof = await proveUnprotected(tx, ids);
        if (!proofIsClean(proof, ids.length)) {
          throw new BacklogSafetyError("refusing deletion: a locked batch is protected; earlier batches may have committed");
        }
        return await sweepAbandonedDrafts(tx, articleId, { revisionIds: ids });
      }, READ_COMMITTED);
      deleted += swept.deleted;
    }
    done.push({ articleId, deleted });
  }
  return done;
}

const mib = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MiB`;

/** Read the named file directly: neither a shell export nor an env pin can aim this script. */
export function draftBacklogTarget(prod: boolean): { url: string | undefined; file: string } {
  if (prod) {
    const env = readEnvProd();
    return { url: env?.values.DATABASE_URL, file: env?.file ?? ".env.prod" };
  }
  const file = path.resolve(import.meta.dirname, "../.env.local");
  try {
    return { url: parseEnvFile(readFileSync(file, "utf8")).DATABASE_URL, file };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { url: undefined, file };
    throw err;
  }
}

function printSurvey(survey: BacklogSurvey): void {
  console.log(`Role:   ${survey.role} — ${survey.mayDelete ? "may" : "MAY NOT"} delete from article_revisions`);
  console.log(
    `\nAbandoned drafts (older than ${ABANDONED_DRAFT_MS / 3_600_000}h, no job, not current, never published):`,
  );
  console.log(`  revisions:  ${survey.revisions}  (${survey.draft} draft, ${survey.failed} failed)`);
  console.log(`  articles:   ${survey.articles.length}`);
  console.log(`  blocks:     ${survey.blocks} rows, ${mib(survey.bytes)} (pg_column_size)`);
  for (const row of survey.articles) {
    console.log(
      `    ${row.articleId}  ${String(row.revisions).padStart(4)} revisions  ` +
        `${String(row.blocks).padStart(6)} blocks  ${mib(row.bytes)}`,
    );
  }
  const p = survey.proof;
  console.log(`\nThe second query, over those ${survey.revisions} ids:`);
  console.log(`  found:                       ${p.seen}`);
  console.log(`  published (or any non-draft): ${p.notDraftOrFailed}`);
  console.log(`  an article's current:        ${p.current}`);
  console.log(`  named by a job:              ${p.jobNamed}`);
  console.log(`  younger than the threshold:  ${p.young}`);
  console.log(`  base of a surviving row:     ${p.baseOfASurvivor}`);
  console.log(
    survey.proven
      ? `✓ none is protected, and all ${survey.revisions} were found`
      : `✗ the two queries disagree. Nothing should be deleted from this list.`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--prod" && arg !== "--delete");
  if (unknown.length > 0) {
    console.error("Unknown arguments. This takes --prod and --delete only.");
    process.exit(1);
  }
  const prod = args.includes("--prod");
  const doDelete = args.includes("--delete");

  /* `--prod` reads `.env.prod` itself; without it the target is `.env.local`'s,
     and a `DATABASE_URL` in the shell does not win — a deleting script should
     not be aimed by an export somebody forgot. */
  const { url, file } = draftBacklogTarget(prod);
  if (!url) {
    console.error(
      prod
        ? "--prod needs a .env.prod with a DATABASE_URL, in this checkout or the primary one."
        : "DATABASE_URL is not set. Local: npm run db:start. See docs/project/supabase-local.md.",
    );
    process.exit(1);
  }
  console.log(`Target: ${withoutPassword(url) ?? "(a DATABASE_URL that is not a parsable URL)"}`);
  console.log(`Env:    ${file}`);
  console.log(`Mode:   ${doDelete ? "DELETE" : "dry run (read-only transaction; pass --delete to do it)"}`);

  const pool = new Pool({
    connectionString: url,
    max: 1,
    ssl: sslDecisionFor(url).ssl,
    application_name: `spideryarn draft-sweep-backlog (${doDelete ? "delete" : "dry run"})`,
  });
  const db: Db = drizzle(pool, { schema });

  try {
    const before = await surveyDraftBacklog(db);
    printSurvey(before);
    if (!before.proven) {
      process.exitCode = 1;
      return;
    }
    if (!doDelete) {
      console.log(`\nNothing deleted.`);
      return;
    }
    if (before.revisions === 0) {
      console.log(`\nNothing to delete.`);
      return;
    }
    if (!before.mayDelete) {
      console.error(`\nThis role may not delete from article_revisions. Nothing deleted.`);
      process.exitCode = 1;
      return;
    }

    const done = await deleteDraftBacklog(db, before);
    const deleted = done.reduce((n, row) => n + row.deleted, 0);
    console.log(`\nDeleted, by the DELETE's own row counts:`);
    for (const row of done) console.log(`    ${row.articleId}  ${String(row.deleted).padStart(4)}`);
    console.log(`  total: ${deleted} of ${before.revisions}`);

    const after = await surveyDraftBacklog(db);
    console.log(
      after.revisions === 0
        ? `✓ none left`
        : `${after.revisions} left across ${after.articles.length} article(s) — locked by something ` +
            `at the time, or crossed the threshold since. Run it again.`,
    );
    /* A control on the count above: a `none left` would also be what deleting
       the articles themselves printed. */
    const stillThere = await db
      .select({ id: articles.id })
      .from(articles)
      .where(inArray(articles.id, before.articles.map((row) => row.articleId)));
    console.log(
      stillThere.length === before.articles.length
        ? `✓ all ${stillThere.length} articles still exist`
        : `✗ ${before.articles.length - stillThere.length} of the articles are gone — not by this script, which deletes revisions only. Look.`,
    );
    if (deleted !== before.revisions || stillThere.length !== before.articles.length) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

if (isMain(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    // Driver/Drizzle errors can contain query text, parameters or credentials.
    console.error(err instanceof BacklogSafetyError ? err.message :
      `Draft backlog failed (${err instanceof Error ? err.name : typeof err}); earlier batches may have committed.`);
    process.exitCode = 1;
  }
}
