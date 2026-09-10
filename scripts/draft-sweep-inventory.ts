/**
 * How many abandoned drafts there are, how big, and what protects the rest —
 * **read-only, by construction**.
 *
 *     npx tsx scripts/draft-sweep-inventory.ts                          # the local stack
 *     DATABASE_URL='<remote>' npx tsx scripts/draft-sweep-inventory.ts  # a remote: read the Target line
 *
 * The on-demand sweep (`sweepAbandonedDrafts`, src/store/pg-revisions.ts) runs
 * per article, on a job's first step, and only counts until Greg approves the
 * first deletion against production — docs/project/cron-scheduler.md and
 * docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md § O. This
 * is the library-wide picture he approves from: what the sweep would take
 * across every article, which it never does in one go.
 *
 * **Two joins, and they have to agree.** The candidate block uses
 * `abandonedDraftCondition` — the sweep's own predicate, imported rather than
 * restated, so this cannot count a different set from the one the sweep
 * deletes. The breakdown above it classifies every draft and failed revision
 * independently, by its own `case`. The `none / older` cell of the breakdown
 * must equal the candidate count; the script says whether it does and exits 1
 * if not, because two numbers that should match and do not are a measurement
 * of a bug (docs/reusable/silent-success.md).
 *
 * **It cannot write.** Every statement runs inside `begin read only`, so an
 * `insert`, `update` or `delete` would be refused by Postgres (*"cannot execute
 * DELETE in a read-only transaction"*) rather than by this file's good
 * intentions, and the script checks `transaction_read_only` before it reads
 * anything. Not also a connection-level `default_transaction_read_only`: a
 * startup `options` parameter is the kind of thing a transaction pooler
 * refuses, and the transaction mode is what Postgres enforces either way.
 *
 * **It prints no article text and no slugs** — slugs are made from titles.
 * Articles are named by their uuid, which identifies a row to somebody who
 * already has database access and nothing to anybody else.
 *
 * `console.log`, not `log()` — this is a CLI. CLAUDE.md § Writing code.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";

import { articleRevisions, revisionBlocks } from "../src/db/schema.js";
import { sslDecisionFor, withoutPassword } from "../src/db/ssl.js";
import { resolveTargetUrl } from "../src/env.js";
import {
  ABANDONED_DRAFT_MS,
  DRAFT_SWEEP_BATCH,
  STEP_START_DRAFT_SWEEP,
  abandonedDraftCondition,
} from "../src/store/pg-revisions.js";

/* Shell wins: a URL on the command line names the database to inventory, and
   must not be buried by `.env.local`. docs/project/database.md. */
const url = resolveTargetUrl({ shellWins: true });
if (!url) {
  console.error("DATABASE_URL is not set. Local: npm run db:start. See docs/project/supabase-local.md.");
  process.exit(1);
}
console.log(`Target: ${withoutPassword(url) ?? "(a DATABASE_URL that is not a parsable URL)"}`);

const ssl = sslDecisionFor(url);
if (ssl.mode === "encrypted-unverified") console.warn(`⚠ ${ssl.why}`);

const pool = new Pool({
  connectionString: url,
  max: 1,
  ssl: ssl.ssl,
  application_name: "spideryarn draft-sweep-inventory (read-only)",
});
const db = drizzle(pool);

const hours = ABANDONED_DRAFT_MS / 3_600_000;
const mib = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MiB`;
const num = (v: unknown) => Number(v ?? 0);

try {
  await db.transaction(async (tx) => {
    const [ro] = (await tx.execute(sql`select current_setting('transaction_read_only') as ro`))
      .rows as { ro: string }[];
    if (ro?.ro !== "on") throw new Error(`refusing to go on: the transaction is not read-only (${ro?.ro})`);
    console.log(`Mode:   read-only transaction (transaction_read_only = ${ro.ro})`);
    console.log(
      `Policy: ${hours}h threshold, ${DRAFT_SWEEP_BATCH} per job start, ` +
        `step-start mode "${STEP_START_DRAFT_SWEEP}"\n`,
    );

    /* The independent classification: every draft and failed revision, by what
       protects it and which side of the threshold it is on. */
    const breakdown = (
      await tx.execute(sql`
        select r.status,
          case
            when exists (select 1 from spideryarn.articles a where a.current_revision_id = r.id) then 'current'
            when exists (select 1 from spideryarn.jobs j where j.draft_revision_id = r.id
                           and j.status in ('queued', 'running')) then 'live job'
            when exists (select 1 from spideryarn.jobs j where j.draft_revision_id = r.id) then 'ended job'
            else 'none'
          end as protection,
          case when r.created_at < now() - make_interval(secs => ${ABANDONED_DRAFT_MS / 1000}::double precision)
               then 'older' else 'younger' end as age,
          count(*)::int as revisions,
          coalesce(sum(b.n), 0)::bigint as blocks,
          coalesce(sum(b.bytes), 0)::bigint as bytes
        from spideryarn.article_revisions r
        left join lateral (
          select count(*) as n, sum(pg_column_size(rb.*)) as bytes
          from spideryarn.revision_blocks rb where rb.revision_id = r.id
        ) b on true
        where r.status in ('draft', 'failed')
        group by 1, 2, 3
        order by 1, 2, 3`)
    ).rows as Record<string, unknown>[];

    console.log(`Every draft and failed revision (the independent join):`);
    console.log(`  status   protection  age      revisions   blocks   block bytes`);
    for (const row of breakdown) {
      console.log(
        `  ${String(row.status).padEnd(8)} ${String(row.protection).padEnd(11)} ${String(row.age).padEnd(8)}` +
          ` ${String(num(row.revisions)).padStart(9)} ${String(num(row.blocks)).padStart(8)}` +
          `   ${mib(num(row.bytes))}`,
      );
    }
    const unprotectedOld = breakdown
      .filter((row) => row.protection === "none" && row.age === "older")
      .reduce((n, row) => n + num(row.revisions), 0);

    /* The sweep's own predicate, per article. */
    const perArticle = (
      await tx.execute(sql`
        select ${articleRevisions.articleId} as article_id,
          count(*)::int as revisions,
          min(${articleRevisions.createdAt}) as oldest,
          coalesce(sum((select count(*) from ${revisionBlocks} where ${revisionBlocks.revisionId} = ${articleRevisions.id})), 0)::bigint as blocks,
          coalesce(sum((select sum(pg_column_size(rb.*)) from ${revisionBlocks} rb where rb.revision_id = ${articleRevisions.id})), 0)::bigint as bytes
        from ${articleRevisions}
        where ${abandonedDraftCondition(ABANDONED_DRAFT_MS)}
        group by ${articleRevisions.articleId}
        order by count(*) desc, ${articleRevisions.articleId}`)
    ).rows as Record<string, unknown>[];

    const candidates = perArticle.reduce((n, row) => n + num(row.revisions), 0);
    const blocks = perArticle.reduce((n, row) => n + num(row.blocks), 0);
    const bytes = perArticle.reduce((n, row) => n + num(row.bytes), 0);
    const overBatch = perArticle.filter((row) => num(row.revisions) > DRAFT_SWEEP_BATCH).length;
    const oldest = perArticle
      .map((row) => (row.oldest ? new Date(String(row.oldest)).getTime() : Infinity))
      .reduce((a, b) => Math.min(a, b), Infinity);

    console.log(`\nCandidates by the sweep's own predicate (abandonedDraftCondition):`);
    console.log(`  revisions:          ${candidates}`);
    console.log(`  articles:           ${perArticle.length}`);
    console.log(`  more than a batch:  ${overBatch} article(s) need more than one job start to clear`);
    console.log(`  cascaded blocks:    ${blocks} rows, ${mib(bytes)} of block rows (pg_column_size)`);
    if (Number.isFinite(oldest)) console.log(`  oldest:             ${new Date(oldest).toISOString()}`);
    if (perArticle.length > 0) {
      console.log(`  top articles (by id):`);
      for (const row of perArticle.slice(0, 10)) {
        console.log(`    ${String(row.article_id)}  ${String(num(row.revisions)).padStart(4)} revisions  ${mib(num(row.bytes))}`);
      }
    }

    if (unprotectedOld === candidates) {
      console.log(`\n✓ the two joins agree: ${candidates} candidate(s)`);
    } else {
      console.error(
        `\n✗ the two joins disagree: the breakdown's none/older cell says ${unprotectedOld}, ` +
          `the sweep's predicate says ${candidates}. Do not approve a deletion from either number.`,
      );
      process.exitCode = 1;
    }
  }, { accessMode: "read only" });
} finally {
  await pool.end();
}
